# @deepseek-ai/dsh-work-node-runner-claude-code

English | [中文](README.zh.md)

Adapter that registers the existing official Claude Agent SDK one-shot runtime on `ctx.workNodeDaemon` as Runner provider `claude-code`.

It deliberately does not implement a second Claude CLI integration. The local Subagent provider and remote WorkNode daemon share `startClaudeCodeRun()`, so SDK options, real CLI process ownership, cancellation, strict success handling, and cleanup stay in one implementation.

## Capability

- provider: `claude-code`
- mode: `one-shot`
- native resume: **not advertised**
- workspace: the exact daemon Environment workspace supplied by the remote command
- prompt: the Gateway's already-bounded Task Context Package, forwarded once as a text block

The current runtime sets `persistSession: false` in the official Agent SDK options. This adapter preserves that behavior. Cross-machine or cross-Runner continuation therefore uses the system Handoff packet rather than pretending to resume a native Claude Code session.

## Configuration

`env` contains explicitly opted-in child environment entries. `disposeGraceMs` controls process-tree termination grace and defaults to the same value as the existing Claude Code Subagent provider. The `claude` executable is resolved in the daemon's execution world for each start.

No transcript, chain-of-thought, Environment dump, or additional model prompt is created by this adapter.
