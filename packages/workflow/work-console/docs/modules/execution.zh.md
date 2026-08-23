# @deepseek-ai/dsh-work-execution

[English](README.md) | 中文

全局持续工作台的持久 ExecutionThread 领域。Task 仍然由 `@deepseek-ai/dsh-work-control` 表示长期目标；`ExecutionThread` 表示围绕该 Task 的一次独立执行努力。一个 Task 可以拥有多个 Thread，因此后续 P0 调度可以安全并行多个独立执行，而不是让多个 Runner 同时争用一个 Thread。

本包只记录执行事实，不直接启动 Claude Code、Codex、DSH 或其他 Runner。Runner Consumer 需要先真正发布 Runner，再把 Attempt 记录到这里。本包也不保存完整对话、私有推理、详细日志、Evidence 内容、Environment 或 Remote Node 状态。

## Thread 生命周期

```text
idle ── Runner 已发布后 begin ──> running
  │                               │
  ├─ block ──> blocked ─ resume ──┘
  │                               │
  ├─ close ──> closed             └─ settle ──> idle
  └─ cancel ─> cancelled
```

一个 Thread 同时最多只有一个 active attempt。需要并行时创建多个 Thread。只有所属 Task 处于 `running` 时才允许新建或恢复执行；全局 Task 若处于 blocked、validation、done、cancelled、organizing，或者仍是 idea，都不能启动新的执行工作。

## Runner 连续性

每个 Attempt 记录 `mode: one-shot | continuable`，以及可选的 DSH subagent session id。该字段只是 Runner 真正发布后的事实记录，本包绝不会把 one-shot Provider 包装成“可原生续会话”。

因此后续 Runner Bridge 必须真实映射 Provider 能力：支持 native continuation 的 Runner 使用原生 Session；Claude/Codex 等当前 one-shot Provider 在跨 Runner 接力时走压缩后的 Handoff / Task Context Package。Native Resume 与系统级 Continuation 是两个不同能力。

## 持久状态

本包打开 `work-execution` storage domain，只使用一张 `threads` 表。主记录只保存当前执行状态、Active Attempt 和最近一次 Settled Attempt；完整执行历史放到后续 Execution History / Evidence 能力，避免主记录无限增长。

每次变更通过 `ExecutionThreadRef { id, revision }` 做 compare-and-set。`work-execution/changed` 只在持久提交后发送；监听器异常会被隔离，因为不能让已经落盘成功的变更表现成失败。

## 组合

本包自带 opt-in bundle patch，并依赖 `ctx.storageDomain` 与 `ctx.workControl`：

```sh
dsh plugin --profile web add <path-to-work-control>
dsh plugin --profile web add <path-to-work-execution>
```

Storage backend/domain 由实际 DSH composition 负责挂载。

## Model Experience

### ExecutionThread 状态

#### What the model sees

模型不会直接看到任何内容。本包不注册模型工具、Prompt section、Conversation message 或 Runner。后续 Organizer / Runner Consumer 决定哪些经过裁剪的 Task Context Package 字段进入模型请求。

#### Token effect

直接 Token 消耗为零。Thread 状态、Provider 名称、Attempt 计数和 Settlement 元数据都不会进入模型请求，除非其他 Consumer 显式选择。

#### KV Cache effect

相互独立。ExecutionThread 的持久变更不会修改模型请求前缀。

## Known Limitations and Deferred Work

- **尚未实现 Runner Bridge** —— 本领域不直接调用 `ctx.subagents`；Provider 能力检测、真实 Runner 发布、取消与结果映射由独立 Consumer 实现。
- **尚未挂接 Environment / Remote Node** —— 执行位置和运行环境兼容性属于独立能力。
- **尚未提供完整历史 / Evidence Store** —— 主记录只保留 Active Attempt 与最近一次结果，完整事件历史刻意后置。
- **不会自动修改 Task 状态** —— 单个 Runner 结束不能替多 Thread Task 判断“阻塞 / 进入验收 / 完成”，该策略属于 Organizer / Coordinator。
