# @deepseek-ai/dsh-execution-thread

全局工作控制任务的持久执行线程。该包把一次任务执行绑定到 DSH 的 continuable subagent provider 与子 Session；任务状态、验收、Remote Node 和 UI 仍由独立能力负责。

线程只持久化精简的运行事实：任务 id、provider、父/子 Session id、生命周期状态，以及可选的交接摘要。它不会把完整对话或模型私有推理复制到工作控制域。

## 生命周期

```text
starting -> running -> paused -> running
                    -> blocked -> running
                    -> completed | failed | cancelled
```

`start()` 先写入持久 `starting` 记录，再通过 `ctx.subagents.startContinuable()` 建立子 Agent。子会话接收首条消息后，线程更新为 `running`；启动失败时尽力记录 `failed`，随后继续抛出原始错误。

`pause()` 使用精确的实时父 Agent 作为权限凭据调用 `ctx.subagents.interrupt()`，但不销毁持久子 Session。`continue()` 通过 `ctx.subagents.followup()` 向同一子 Session 投递下一轮，因此支持冷恢复的 provider 可继续使用 DSH 原生恢复机制。

`setHandoff()` 只保存 `summary`、`nextStep` 和时间戳。未来跨 Runner 交接应组合该短记录、任务事实和环境证据，而不是重放完整聊天历史。

## Model Experience

### Execution-thread state

#### What the model sees

模型不会直接看到任何内容。该包不注册模型工具、不注入提示词，也不自动添加上下文。未来任务面板或 Runner Consumer 如需暴露字段，应由对应 Consumer 记录自己的模型体验。

#### Token effect

直接 Token 消耗为零。线程和 Handoff 持久记录不会进入模型请求，除非其他 Consumer 显式读取并注入。

#### KV Cache effect

独立。创建、暂停、继续或更新线程本身不会修改模型请求前缀。

## Known Limitations and Deferred Work

- **尚未绑定 Remote Node** —— 当前只绑定 DSH continuable provider 与 Session；Node、Environment 兼容性与资源租约后续单独实现。
- **不自动推断完成** —— continuable child 可以有多个 activation epoch，因此单个 `subagent/end` 不代表任务完成；后续执行策略/Validator Consumer 负责写入终态。
- **跨服务提交不是原子事务** —— 子会话收件箱接收与线程域写入属于两个持久系统；若子消息已接收而线程写入失败，可能出现短暂不一致，后续由执行策略层负责恢复与对账。
