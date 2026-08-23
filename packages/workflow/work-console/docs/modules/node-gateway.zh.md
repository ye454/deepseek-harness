# @deepseek-ai/dsh-work-node-gateway

全局持续工作台的认证 HTTP Pull 传输层与持久命令队列。所有连接都由远端 Worker Daemon 主动发起，因此中心 Harness 不要求能直接入站访问 Worker 机器，短暂断线也不会让已排队任务丢失。

## 协议

Host 在 `ctx.webServer` 注册四个精确 POST 路由：

- `/work-node/v1/hello`：建立/恢复配置中的 `nodeKey` → 持久 `WorkNodeId` 身份；
- `/work-node/v1/poll`：Heartbeat、能力/Environment 上报，以及拉取排队命令；
- `/work-node/v1/ack`：报告真实 Runner 已发布或拒绝命令；
- `/work-node/v1/result`：结束已接受的 execute/resume 命令。

认证使用 HMAC-SHA256，不在网络中发送共享密钥本身。Daemon 发送 `x-dsh-node-key`、`x-dsh-timestamp`、`x-dsh-signature`；签名覆盖 `METHOD + path + timestamp + 原始请求 Body`。共享密钥每次请求都通过 `ctx.credentials` 重新解析，时间偏差超过 `maxClockSkewMs` 的请求会被拒绝。

`nodeKey` 是部署身份，不是持久 WorkNode id。同一个 Daemon 重连仍复用同一条 WorkNode 记录。Gateway 是 Heartbeat 超时的所有者，超过 `heartbeatTimeoutMs` 后可以把 Node 标记为 offline。

## 命令生命周期

execute/resume 命令持久保存，并在 `queued` 状态采用 at-least-once 投递，所以 Daemon **必须按 command id 去重**。Poll 不会提前把 ExecutionThread 标成 running。Daemon 先真正启动 Runner，再调用 `ack`；只有 ack 被中心接受后才调用 `ctx.workExecution.beginAttempt()`。

如果 Poll 之后 Task、Thread 或 Environment 已变化，中心无法接纳刚发布的 Runner，ack 会返回冲突，此时 Daemon 必须停止刚启动的 Runner。若进程恰好在 `beginAttempt()` 成功、命令状态尚未持久化之间崩溃，重复 ack 可以根据匹配的 active attempt 完成恢复。

`cancel` 是控制命令。它的 ack 只表示取消指令已经送达；原 execute/resume 命令仍通过 `result` 收尾，通常结果为 cancelled/interrupted。

每次真正投递前都会重新校验 queued 命令。Task 状态、Thread revision、Node 状态/能力、Runner 可用性、Environment 绑定或 Environment revision 发生变化时，会拒绝旧命令，而不是在变化后的现场继续执行。

## Native continuation 与系统 Handoff

Native resume 只允许恢复此前由**同一个 WorkNode**发布的 continuable Runner native session。Thread 改绑到其他机器后，不能伪装成原生续跑；必须新建 Attempt，通过 bounded Handoff/Task Context Package 做系统级交接。

## Environment 上报

Poll 可以上报具名的 Node 本地 Environment。Gateway 持久维护 `(nodeKey, environmentKey)` → `WorkEnvironmentId`。完全一致的 Heartbeat Environment 报告会被忽略，不会无意义增加 Environment revision；Workspace/Runtime/Service/Device 等实际发生变化时才 refresh，并使旧 Thread binding 变 stale。

## 配置

所有部署相关参数都要求显式配置，因此本包刻意不提供“无配置即可安装”的 bundle patch。

| key | 含义 |
| --- | --- |
| `nodes` | `nodeKey` → DSH CredentialRef |
| `maxRequestBodyBytes` | 完整 JSON 请求体大小上限 |
| `maxPromptBytes` | 远程 execute/resume 的完整 bounded Task Context 上限 |
| `maxCommandsPerPoll` | 单次 Poll 最多返回的 queued 命令数 |
| `maxClockSkewMs` | HMAC 请求时间戳允许偏差 |
| `heartbeatTimeoutMs` | Node Heartbeat 超时阈值 |
| `sweepIntervalMs` | Heartbeat 超时扫描间隔 |

CredentialRef 对应的是共享 HMAC Key，不要把真实 Key 直接写进 `cordis.yml`。

## Model Experience

### Remote Task Context Package

#### What the model sees

间接通过远端 Runner 可见。execute/resume 命令携带 `@deepseek-ai/dsh-work-runner-subagent` 生成的同一份 bounded Task Context Package：当前 Task/Stage/必需验收条件，以及可选的操作性 Handoff 结论；不携带完整 Transcript 或 Chain-of-Thought。最终模型请求及其 Session 日志由远端 Runner Runtime 负责。

#### Token effect

每个 execute/resume 命令受必填 `maxPromptBytes` 限制。Heartbeat、Node、Environment、Command ID、Ack 和 Result 本身不会增加模型 Token。

#### KV Cache effect

中心 Gateway 独立于 Provider KV Cache。远端 Provider 的缓存行为由 Runner Runtime 所有；跨 Runner Handoff 不会重放旧模型 Transcript。

## Known Limitations and Deferred Work

- **当前是 HTTP Pull，不是流式传输**：命令/事件延迟受 Daemon Poll 频率影响；以后可替换为 WebSocket/gRPC，而不改变 WorkNode/Environment/ExecutionThread 所有权。
- **at-least-once 要求 Daemon 去重**：queued 命令在 ack 前可能多次返回。
- **Node 在 ack 后失联不会被伪造为完成**：Gateway 会把 Node 标记 offline，但不会编造 Runner terminal result。
- **HMAC 存在有限重放窗口**：时间戳限制重放持续时间，revision/command id 又进一步限制状态重放；V1 尚未持久保存 nonce 历史。
- **尚未实现 Resource Lease Scheduler**：P0 并发、资源占用/预约属于后续 Scheduler Consumer。
