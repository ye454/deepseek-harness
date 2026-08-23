# @deepseek-ai/dsh-work-node-runner-claude-code

[English](README.md) | 中文

把现有官方 Claude Agent SDK one-shot runtime 注册到 `ctx.workNodeDaemon`，作为 Runner Provider `claude-code`。

本包不会再实现一套 Claude CLI。原有本地 Subagent Provider 与远端 WorkNode Daemon 共用 `startClaudeCodeRun()`，因此 SDK 参数、真实 CLI 进程树、取消、严格成功判定和清理逻辑只维护一份。

## 能力

- Provider：`claude-code`
- Mode：`one-shot`
- 原生续跑：**不声明支持**
- Workspace：远端 Command 指定的 Daemon Environment Workspace
- Prompt：Gateway 已经裁剪好的 Task Context Package，仅转成一个文本块后发送一次

当前 runtime 在官方 Agent SDK 参数中明确使用 `persistSession: false`。本 Adapter 保持这一行为，不为了远端调度偷偷改变会话语义。因此跨机器或跨 Runner 的继续执行统一走系统 Handoff，而不是伪装成 Claude Code 原生 Resume。

## 配置

`env` 只包含部署方显式允许传给子进程的环境变量；`disposeGraceMs` 控制进程树退出宽限时间，默认值与现有 Claude Code Subagent Provider 一致。每次启动都会在 Daemon 所在执行环境中真实解析 `claude` 可执行文件。

本 Adapter 不生成第二份 Prompt，不回放历史对话，不传递 Chain-of-Thought，也不会把完整 Environment 状态塞给模型。
