# Agent Note：持续工作基于耐久执行坐标推进

Status: implemented

[English](2026-08-22-continuous-work-stage-coordination.md) | 中文

## 问题

全局 Work Console 已能组织 Task，并显式派发一个或多个隔离 Runner 角色，但此前耐久执行层在远程 Runner 结束后就停止：`settleAttempt()` 只把 ExecutionThread 退回 `idle`，系统无法安全判断这次完成属于当前 Workflow Stage、旧 Stage，还是 Host 在 Stage 已推进但下一 Runner 尚未发布时崩溃留下的旧完成记录。

不能把 Runner 文本当答案。Runner 自报“completed”只证明本次执行正常结束，不等于测试、Benchmark、设备检查、视觉检查、运行时检查或人工验收已经通过；把完整会话重新送给协调器也会破坏全局工作系统的有界上下文与 Token 效率目标。

P0 还引入另一个问题：同一 Stage 可能有多个隔离 Thread 并行完成。系统必须等待 fan-out 收敛，但不能让之后每个 Stage 都无条件继续扩大并行写入。Runner 修改 workspace 后，节点上报还可能让 Environment revision 增长，因此下一阶段也不能继续使用旧绑定。

## 决策

**所有新发布的执行 Attempt 都保存当前 Workflow `stageId` 这一紧凑耐久坐标。** 该值由 WorkExecution 在 Runner 真正发布时从 WorkControl 读取并写入，浏览器与远程节点不能提供。存储层仍允许该字段缺失，仅为了兼容升级前的旧记录；旧 completed Attempt 若没有 Stage 坐标，系统会阻塞并要求人工恢复，而不是猜测。

**新增独立插件 `dsh-work-execution-coordinator` 负责推进策略，而不拥有执行状态。** 它不建立第二套 Task、Thread、Environment、Command 或 Validation 数据库，只监听已提交的 WorkControl、WorkExecution 和远程 Command 事实，按 Task 串行化 reconcile，并在每次决策前重新读取权威 Service。

**先提交 Stage，再派发下一 Stage。** 当前 Stage 的相关 Thread 全部以 `completed` 结束后，Coordinator 先耐久更新 `currentStageId`，再让 WorkOrchestrator 继续 primary Thread。即使 Host 在两步之间退出，旧 Attempt 上的 `stageId` 仍能证明新 Stage 尚未执行。若重启后发现该 Thread 已有 queued/accepted Command，Orchestrator 会将其视为幂等恢复，不重复派发。

**Continuation 继续由 Orchestrator 统一做准入检查。** 下一 Stage 默认复用上一 Attempt 的 Runner/provider 与同一 Environment identity。如果该 Environment 已上报新 revision，系统会明确把 inactive Thread 重绑到当前精确 revision，然后重新执行 Environment、Node、Runner 与 workspace lease 的 Preflight。不会静默切换 Environment，也不会绕过调度检查。

**P0 在一个 Stage 后收敛。** 当前 Stage 的所有选中 Thread 都必须成功结束。系统确定性选择创建时间最早的稳定 Thread 作为 primary，关闭其余 inactive sibling，释放 workspace lease。之后 Stage 默认由 primary 连续推进，除非未来某个 Stage 明确配置新的 fan-out 策略。

**Validation 仍是独立权威。** 进入 Workflow 的 validation Stage，或走到没有显式 validation Stage 的 workflow 末尾时，Coordinator 会打开新的 WorkValidation generation。Runner 文本不会转换成 Evidence，Runner `completed` 也不会直接让 Task 完成；最终仍由 WorkValidation 结果和显式人工验收控制。

**失败是阻塞事实。** failed/refused/limit/cancelled Attempt 或耐久 Remote Command rejection 都会把 Task 转到 `blocked`。Coordinator 不会伪装 P0 部分派发可以原子回滚，也不会为了让看板状态整齐而强行杀死仍在运行的 sibling Runner；其最终结果仍保留为耐久历史，而 blocked Task 不再接收新的 Stage 工作。

## 重启与事件顺序

Coordinator 监听耐久写入之后的事件，并在初始化时主动扫描已有 Task。它自己的状态修改也会触发同一事件流，但每个 Task 都有独立串行 tail，因此新事件只是排到当前 reconcile 后面重新读取，不会在同一个调用栈中递归修改状态。

关键崩溃窗口因此可恢复：

1. Stage A Attempt 已耐久记录 `completed`，并带 `stageId=A`；
2. WorkControl 已耐久推进到 Stage B；
3. Host 可能在 Stage B Command 入队前退出；
4. 重启后 Coordinator 看到 `currentStageId=B`，同时看到 primary 的最后 Attempt 仍标记 A，于是只恢复一次 B continuation。

若 Command 已 accepted，则 Thread 已处于 running，系统只等待；若 Command 仍 queued，则按 Command id 复用。

## 模型与 Token 边界

Coordinator reconcile 本身不调用模型、不注册 Prompt Section，也不保存 Transcript 或 private chain-of-thought。下一 Stage 唯一新增的模型可见信息，是现有有界 Task Context 加上一条紧凑 `nextStep`，说明当前 Workflow Stage。只有 Gateway 真正派发 Runner 后才开始消耗模型 Token。

## 测试

定点组合测试使用真实 WorkControl、WorkExecution、WorkNode、WorkEnvironment、WorkValidation、WorkOrchestrator，仅在 Gateway 边界使用 fake。覆盖：P0 fan-out 收敛、Environment revision 显式重绑、连续 Stage 推进、进入新 Validation generation 且不伪造 Validator Result、Runner 失败阻塞、耐久 Command rejection，以及已有 queued continuation 的重启幂等恢复。

WorkExecution 测试还会固定“Runner 发布时 Attempt 获得 Task-owned Stage 坐标”这一契约。

## 考虑过的替代方案

**只看 `stopReason=completed`，不保存 Stage。** 拒绝。Host 在 Stage 更新后崩溃时，旧完成记录与新 Stage 完成无法区分。

**把 Runner 输出保存并重放给 Coordinator。** 拒绝。自然语言不是 Acceptance Evidence，同时会增加 Token，并把调度逻辑绑到具体 Provider 输出格式。

**每个 Stage 都创建新 Thread。** 默认路径拒绝。这样会丢失可复用的 Environment/Runner 连续性，也让 P0 lease 清理更复杂；未来有明确策略时仍可创建新的独立 Thread。

**P0 的所有 branch 在每个 Stage 都保持并行。** 默认路径拒绝。并行 writer 会放大文件冲突与资源成本；若后续 Stage 确实需要 fan-out，应由 Stage policy 显式声明。

## 结果与后续工作

现在系统具备确定性的“执行 → Stage 推进 → Validation”生命周期，不修改 `dsh-agent-loop`，也不增加第二套工作数据库。升级前没有 Stage 坐标的旧 Attempt 需要人工恢复。自动 Validator Executor 仍是下一层：Coordinator 只负责打开 Validation，不会虚构测试、Benchmark、截图、设备或运行时 Evidence。blocked Task 的恢复界面和更复杂的 Stage 级 fan-out 策略也继续留待后续实现。
