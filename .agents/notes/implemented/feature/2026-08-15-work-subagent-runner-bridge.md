# Agent Note: Bounded work runner bridge over DSH subagents

Status: implemented

## Problem

The work console needs to execute an `ExecutionThread` through Claude Code, Codex, or another DSH runner without creating a second provider runtime or replaying an entire coordinator conversation into every child. The provider registry already exists in `ctx.subagents`, but its providers have materially different context and continuation behavior. Treating every provider as equivalent would either duplicate DSH infrastructure or falsely claim native resume and bounded context where neither exists.

The bridge also becomes the first work-console layer that deliberately sends Task state to a model. DSH requires every model-visible input to be reconstructable from the Session log, while the product requirement is to minimize token use and avoid copying private chain-of-thought during handoff.

## Decision

Add `@deepseek-ai/dsh-work-runner-subagent` as a consumer of `ctx.subagents`, `ctx.workControl`, and `ctx.workExecution`. It does not register providers. `listRunners()` projects provider facts directly from the existing registry: all registered providers have the one-shot `start()` path, native continuation is reported only when `prepareContinuable` exists, and `inheritsParentContext` is preserved as a separate fact.

V1 implements only an isolated one-shot execution operation. Providers with `inheritsParentContext: true` are rejected on this path because the bridge cannot bound or account for history the provider adds outside the generated Task Context Package. An inherited-context operation may be added later only as an explicit separate mode with its own context accounting.

The Task Context Package contains current task identity, objective text, priority, task type, current workflow stage, required acceptance labels, and optional operational Handoff conclusions. Handoff accepts completed work, facts, decisions, constraints, references, and next step; it intentionally has no transcript or reasoning field. The package renders a deterministic prompt, measures the complete UTF-8 value, and requires a caller-supplied `maxPromptBytes`. Oversized prompts fail before any Session event or provider call; nothing is silently truncated.

Before `ctx.subagents.start()` is invoked, the exact rendered prompt and its measured bytes are appended to the delegating parent Session as the required `work-runner/subagent-request` event. This is a non-surface audit record: it reconstructs the child model input without changing the parent conversation surface. Startup can still reject after that record; the event therefore represents an attempted child request, not proof that a child was published.

A provider fulfillment is the DSH publication boundary. Only after a real `SubagentRun` exists does the bridge call `workExecution.beginAttempt()` with the provider, factual `one-shot` mode, and returned child Session id. If that compare-and-set loses a race, the already-published run is disposed immediately. Normal results map the known DSH stop reasons into the runner-neutral execution taxonomy and settle the thread. A post-publication infrastructure rejection attempts to settle a still-owned running thread as `unknown`, disposes the run, and propagates the failure. The bridge returns child output to its caller but does not copy it into the bounded thread record.

## Token and cache consequences

The bridge never replays the parent transcript itself. Its model-visible addition is the single complete bounded prompt, whose byte ceiling is enforced after all wrappers and JSON fields are assembled. Required acceptance labels are included so token reduction cannot silently remove completion gates. Only references, not referenced file/log bodies, enter the Handoff packet; later runners fetch those artifacts on demand.

Provider-owned system prompts and tool schemas are outside this package's byte count. That is why provider context inheritance is explicitly refused on the isolated path rather than being hidden behind a nominal packet budget. The child request is independent from the parent's model request. Parent audit events are non-surface and therefore do not alter the parent's model-visible conversation prefix.

## Boundaries

The package does not choose providers, schedule P0 fan-out, lease resources, create Remote Nodes, persist evidence/history, or decide Task completion. It does not implement native continuable execution yet even when discovery reports that a provider supports it. It does not modify `dsh-agent-loop` or any existing Claude/Codex provider.

## Verification

Focused tests cover deterministic packet rendering, UTF-8 byte ceilings, required acceptance inclusion, Handoff normalization, provider capability projection, inherited-context refusal, prompt-budget refusal before startup, exact request logging before provider dispatch, published-run attachment, startup rejection, CAS-loss disposal, result mapping, and infrastructure rejection cleanup. The invariant companion cross-checks every `work-runner/subagent-request` event's measured bytes, configured ceiling, mode/version, and stable prompt prefix.

A Loader-composition smoke and assembled model-visible snapshot are required before this stack becomes merge-ready. No passing runtime result is claimed until those repository checks are actually executed.

## Consequences

- Claude Code/Codex providers can be reused through the DSH subagent seam instead of being reimplemented.
- Native continuation capability remains truthful and distinct from cross-runner Handoff.
- Cross-runner continuation transfers bounded operational conclusions, not conversation replay or private reasoning.
- A runner is not recorded as active until DSH has actually published it.
- The exact child prompt is durable before any model may see it, satisfying the DSH model-visible/logged rule.
- Token accounting has a concrete package-owned upper bound for the child task packet rather than a best-effort summary length.

## Known limitations and deferred work

- Native `startContinuable()` / `followup()` integration is deferred.
- Scheduler/resource-center policy is deferred.
- Full evidence and execution history are deferred.
- Remote Node dispatch is deferred.
- Provider-owned system/tool context is observable elsewhere (for example through context-audit tooling) but is not included in this package's prompt-byte metric.
