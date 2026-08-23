# @deepseek-ai/dsh-work-node

[English](README.md) | 中文

全局持续工作台的持久 Worker Node Registry。Work Node 表示能够承载 Runner、后续还能上报 Execution Environment 的机器/Daemon 身份。本包只保存 Gateway 完成认证后已经接受的节点事实，不负责 Socket、Heartbeat Timer、Process、Credential 或 Environment 细节。

## Node 事实

每个节点拥有 branded `WorkNodeId`、CAS revision、显示名、状态、协议版本、Runner Provider 列表和显式能力：

- `execute`
- `cancel`
- `resume`
- `usage`
- `tool-events`
- `environment-report`
- `mcp-stdio`
- `mcp-streamable-http`

这个能力词汇刻意小于任何单一 Runtime Protocol。例如 Multica DSH Runtime 通过 JSONL 暴露版本化 Execute、Cancel、Resume、Usage、Tool Event 和 MCP Transport；本 Registry 只记录调度器真正需要的事实，不复制它的 Transport/Session 模型。

## 生命周期

```text
register -> online
              | refresh online
              | refresh degraded(reason)
              v
          online/degraded
              |
              | 真实连接观察者决定
              v
            offline
              |
              | 成功 refresh
              v
            online
```

`registerNode()` 总是创建新的 online 身份。`refreshNode()` 是被确认的 heartbeat/capability replacement 操作；未指定 state 时显式解析为 online，degraded 必须带非空 reason。`markOffline()` 不内置超时策略：只有真正观察连接状态的未来 Gateway/Monitor 才有权决定何时离线。

Registry 本身不会拒绝协议升级/降级。Handshake 是否兼容属于 Wire Gateway 的解析职责；Gateway 接受报告之后，本包只原样保存被接受的协议版本。

## 并发与发布

Refresh/Offline 都通过 `WorkNodeRef { id, revision }` 做 CAS。旧 heartbeat 不能覆盖更新的能力或状态。`work-node/changed` 只在持久提交后发送，Listener 异常被隔离，因为已经提交的节点事实不能被 Observer 回滚。

Runner Provider 名称与 Feature 数组会标准化、去重。Node Name 只是显示标签而不是身份，因此允许重名。

## 组合

本包是 opt-in，并依赖 `ctx.storageDomain`：

```sh
dsh plugin --profile web add <path-to-work-node>
```

后续 Remote Node Gateway 会在认证并解析 Wire Protocol 后使用本服务。

## Model Experience

### Work Node Registry 状态

#### What the model sees

模型不会直接看到任何内容。本包不注册 Tool、Prompt、Session Message 或 Context Injection。后续 Resource Center / Scheduler Consumer 可以按需投影精简的 Node Facts。

#### Token effect

直接 Token 消耗为零。Node 注册、Heartbeat/Capability Refresh 和 Offline 变更都不会进入模型请求。

#### KV Cache effect

相互独立。持久 Node 变更不会修改模型请求前缀。

## Known Limitations and Deferred Work

- **尚未实现 Transport/Auth** —— WebSocket/stdin/gRPC、Credential、Reconnect Policy 与 Heartbeat Ownership 属于独立 Gateway Package。
- **不会自动推断 Offline** —— 只有观察真实连接的组件才能调用 `markOffline()`；Registry 不根据挂钟时间自行判断。
- **尚未实现 Environment Records** —— Workspace/Git/Runtime/Service/Device Snapshot 与 ExecutionThread Binding 是下一层能力。
- **尚未实现 Resource Lease / Scheduler** —— Registry 暴露可用事实，但不负责资源预约和任务调度。
