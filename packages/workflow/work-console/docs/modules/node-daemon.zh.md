# @deepseek-ai/dsh-work-node-daemon

全局持续工作台的远端 Worker Runtime。它主动连接 `@deepseek-ai/dsh-work-node-gateway`，上报本机 Environment，用持久 Journal 对 Gateway 的 at-least-once 命令去重，并通过 Daemon 本地 Runner Provider 执行工作。

## Runner Registry

Runner 插件通过 `ctx.workNodeDaemon.registerRunner(provider)` 注册。Provider 必须声明稳定名称和真实支持的 `one-shot / continuable` 模式，并返回拥有 cancel、dispose、never-reject terminal result 的 Runner Handle。

Daemon 根据 Registry 自动向中心声明 Node 能力：

- 没有 Runner：只上报 `environment-report`；
- 有 Runner：上报 `execute + cancel` 以及 Provider 名称；
- 只有至少一个 Provider 真实支持 `continuable` 时才上报 `resume`。

当前 DeepSeek Harness 内置的 `codex`、`claude-code`、`dsh-sdk` Subagent Provider 都是 one-shot，因此 Daemon Core 不会为它们虚假声明 Native Resume。真实 Adapter 作为独立 Provider 插件接入。

## 持久 Command Journal

Gateway 对 queued 命令采用 at-least-once 投递。Daemon 在发布 Runner 前，以 `RemoteNodeCommandId` 为 Key 写入本地 `work-node-daemon` Storage Domain Journal，重复 Poll 不会启动第二个 Runner。

Journal 状态为 `starting / published / accepted / settled / rejected / interrupted`。只有中心确认 Terminal Result 后才写入 `reportedAt`。

Daemon 重启后不会假设旧的进程内 Runner Handle 仍然有效。对于未结束 Journal：

- 中心仍是 queued：拒绝已中断的本地执行；
- 中心已经 accepted：上报 Terminal `unknown`；
- 中心已经 settled/rejected：本地 Journal 收敛到中心事实。

未知结果绝不会被伪装成成功。

## Environment 上报

每个配置环境包含 Key、显示名称、Workspace 路径及可选 Capability、Device、SecretRef。内置 Collector 使用 DSH Subprocess 能力获取 Git Commit、Branch、Origin、Dirty 状态，以及 Node/OS/Arch。Git 检查失败只会把 Environment 标记 degraded，不会停止 Heartbeat。

只会上报 Secret 引用名称，不读取或上传 Secret Value。

## 配置

所有部署参数都要求显式配置，因此本包没有“无配置即可安装”的 Bundle Patch。

| key | 含义 |
| --- | --- |
| `gatewayUrl` | 中心 Gateway Origin，例如 `https://control.example` |
| `nodeKey` | Gateway 配置中的部署身份 |
| `nodeName` | Hello 上报的显示名称 |
| `credential` | 保存共享 HMAC Key 的 DSH CredentialRef |
| `protocolVersion` | Remote Node 协议版本 |
| `pollIntervalMs` | 正常 Poll 间隔 |
| `retryDelayMs` | 网络/协议故障后的重试间隔 |
| `requestTimeoutMs` | 单次请求超时 |
| `maxConcurrentRuns` | Daemon 同时拥有的 Runner Handle 上限 |
| `gitCommand` | 通过 `ctx.subprocess` 解析的 Git 命令名/路径 |
| `environmentCommandOutputBytes` | 单次 Git 检查 stdout/stderr 保留上限 |
| `processGraceMs` | 子进程终止 Grace |
| `environments` | 本机 Workspace Environment 列表 |

## Model Experience

### Remote Runner input

#### What the model sees

仅通过注册 Runner Provider 间接可见。Daemon 原样转交 Gateway 已经限长的 Task Context Package，不追加 Node Heartbeat、Command History、完整 Environment、旧 Transcript 或私有推理。

#### Token effect

Daemon 自身不增加 Prompt Token。Prompt 已受中心 `maxPromptBytes` 限制；Provider 自己的 System Prompt / Tool Schema 属于 Provider 责任。

#### KV Cache effect

Daemon 层独立。One-shot Provider 启动新请求；未来只有真正保持 Native Session 语义的 Provider 才能声明 `continuable`。

## Known Limitations and Deferred Work

- **尚无内置生产 Runner Adapter**：本包只负责 Runtime/Registry；Claude Code、Codex、DSH Adapter 是下一层独立 Provider 插件。
- **尚未传输模型输出/Evidence**：V1 中心 Result 只有 Stop Reason；结构化 Handoff/Evidence 属于后续 Validation/Evidence 协议层。
- **Daemon 崩溃会丢失 Live Handle**：Journal 会把 accepted 但失去控制权的 Attempt 上报为 `unknown`，不会尝试重新附着 OS Process。
- **当前 Environment Collector 以 Git 为主**：Service/Device Health Probe 后续可作为 Provider 扩展，本版不运行隐藏的任意探测命令。
- **当前为 Polling**：延迟受 `pollIntervalMs` 影响，实时 Tool/Usage Stream 后续再扩展。
