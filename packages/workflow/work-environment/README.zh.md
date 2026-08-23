# @deepseek-ai/dsh-work-environment

全局持续工作台的持久执行环境快照。该包把 Environment 与 Runner、Node 分开：Node 可以上报一个或多个具名环境，ExecutionThread 在执行前显式绑定到某个确定的环境 revision。

## 职责

- 保存精简的 Workspace/Git、Runtime、Service、Device、Capability 和 Secret 引用事实；
- 把非活跃 `ExecutionThread` 绑定到精确的 `WorkEnvironment` revision；
- 为调度器提供 Node 可用性、execute 能力、Runner 可用性、环境状态和环境漂移检查；
- 环境发生变化后拒绝静默沿用；
- 不在本领域保存密钥值、完整进程日志、命令历史、模型对话和 Evidence。

`refreshEnvironment()` 后已有绑定会故意变成 stale。调度器必须在确认新快照后显式重新绑定，而不是把已经变化的运行现场当成原环境继续执行。

## Preflight

`preflight(threadId, runnerProvider?)` 只读，可报告：没有绑定、环境 revision 过期、Thread 忙碌、环境降级/不可用、Node 降级/离线、不支持 execute、指定 Runner 不可用。后续 P0 调度可以在分配 Runner 前先执行该检查。

## 密钥处理

只保存不透明的 `secretRefs`。本包没有环境变量值、API Key、Token、密码或其他凭据内容字段。

## Model Experience

### Environment state

#### What the model sees

无。本包不注册模型工具、不注入 Prompt，也不追加 Session 模型上下文事件。后续编排层如果把少量环境事实加入 Task Context Package，由那个 Consumer 自己负责模型可见内容。

#### Token effect

直接 Token 增量为零。环境快照和 preflight 结果在其他 Consumer 明确选择前不会进入模型请求。

#### KV Cache effect

独立。Environment 状态变化不修改模型请求前缀。

## Known Limitations and Deferred Work

- **不负责传输层** —— 身份认证、Heartbeat、RPC/WS、远程命令执行属于 Remote Node Gateway。
- **不自动迁移环境** —— 当前只识别不兼容/过期环境，不自动复制 Workspace、安装依赖或迁移硬件设备。
- **只保存当前快照** —— 历史环境版本如有需要应进入后续 Execution History/Evidence，而不是无限增长本领域记录。
