# Work Console plugin boundary

This file records a non-negotiable architecture invariant for the continuous-work system.

## External boundary

`@deepseek-ai/dsh-work-console` is the **only installable DSH bundle** owned by this subsystem.

No `work-*` implementation module may declare its own `dsh.bundle.patch` or ship an independent `cordis.patch.yml`.

The root plugin owns the default Host composition and mounts its internal Cordis children with `ctx.plugin(...)`. Cordis service boundaries remain useful internally; they do not imply independent product/plugin boundaries.

## Internal modules

The current implementation is still physically split across workspace packages while consolidation is in progress. They are implementation modules, not independently installable DSH plugins:

- Work Control
- Work Execution
- Work Node
- Work Environment
- Work Orchestrator
- Work Validation
- Work Execution Coordinator
- Work Node Gateway
- Work Node Daemon
- Subagent Runner bridge
- Codex Runner adapter
- Claude Code Runner adapter
- Web Work Console UI

The target physical layout is one distributable package with these capabilities exposed as internal modules/subpath faces where necessary.

## Runtime faces

The default Host face is mounted by the root `work-console` plugin. Deployment-specific remote-node/runner adapters may remain optional child faces because they require environment-specific configuration; optional does not mean separately installable product plugin.

The browser UI is a Web client face of the same product. During the physical consolidation migration it may temporarily remain a private workspace dependency, but it must not acquire a separate bundle identity.

## Guardrail

Before adding a new Work capability, first place it under the existing Work Console plugin boundary. Creating another `work-*` package or another `dsh.bundle.patch` requires an explicit architecture decision that updates this file; feature iteration alone is not sufficient justification.
