# @deepseek-ai/dsh-work-node-runner-codex

English | [中文](README.zh.md)

Adapter that registers the existing official Codex app-server one-shot runtime on `ctx.workNodeDaemon` as Runner provider `codex`.

It deliberately does not implement a second Codex CLI integration. The local Subagent provider and remote WorkNode daemon share `startCodexRun()`, so startup, app-server framing, cancellation, failure mapping, and process-tree cleanup stay in one implementation.

## Capability

- provider: `codex`
- mode: `one-shot`
- native resume: **not advertised**
- workspace: the exact daemon Environment workspace supplied by the remote command
- prompt: the Gateway's already-bounded Task Context Package, forwarded once as a text block

The current Codex runtime creates an ephemeral app-server thread for each run and exposes no continuable session contract. Cross-machine or cross-Runner continuation therefore uses the system Handoff packet rather than pretending to resume a native Codex session.

## Configuration

`env` contains explicitly opted-in child environment entries. `disposeGraceMs` controls process-tree termination grace and defaults to the same value as the existing Codex Subagent provider.

No transcript, chain-of-thought, Environment dump, or additional model prompt is created by this adapter.
