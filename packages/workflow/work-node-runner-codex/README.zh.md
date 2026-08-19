# @deepseek-ai/dsh-work-node-runner-codex

[English](README.md) | 中文

把现有官方 Codex app-server one-shot runtime 注册到 `ctx.workNodeDaemon`，作为 Runner Provider `codex`。

本包不会再实现一套 Codex CLI。原有本地 Subagent Provider 与远端 WorkNode Daemon 共用 `startCodexRun()`，因此启动、app-server 协议、取消、失败处理和进程树清理只维护一份。

## 能力

- Provider：`codex`
- Mode：`one-shot`
- 原生续跑：**不声明支持**
- Workspace：远端 Command 指定的 Daemon Environment Workspace
- Prompt：Gateway 已经裁剪好的 Task Context Package，仅转成一个文本块后发送一次

当前 Codex runtime 每次执行都会建立临时 app-server thread，并没有对外提供可持续恢复的 native session contract。因此跨机器或跨 Runner 的继续执行统一走系统 Handoff，而不是伪装成 Codex 原生 Resume。

## 配置

`env` 只包含部署方显式允许传给子进程的环境变量；`disposeGraceMs` 控制进程树退出宽限时间，默认值与现有 Codex Subagent Provider 一致。

本 Adapter 不生成第二份 Prompt，不回放历史对话，不传递 Chain-of-Thought，也不会把完整 Environment 状态塞给模型。
