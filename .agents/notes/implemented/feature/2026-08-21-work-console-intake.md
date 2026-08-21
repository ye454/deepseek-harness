# Work Console passive intake and deterministic organization

## Problem

The global Work Console could promote an existing Idea and decide human acceptance, but it still lacked two core human-side transitions: capturing a new passive Idea from the product surface and organizing a promoted Task into a concrete Workflow/ValidationPolicy before execution.

## Decision

V1 keeps both operations Host-owned and deterministic:

- `workConsole.createIdea()` delegates to Work Control passive Idea capture. It creates no Task, ExecutionThread, Runner, Environment, Agent turn, or model request.
- `workConsole.organizeTask()` accepts a human-selected Task Type and maps it to a built-in Workflow + ValidationPolicy template before calling `workControl.organizeTask()`.

The organization step deliberately does not call an LLM. The user decides the task category; the Host provides a deterministic template. This keeps Idea intake and organization at zero direct model tokens and avoids turning every small task into an AI-planning request.

Organization changes the Work Control Task from `organizing` to `running` at its first workflow stage, but it does not create an ExecutionThread or publish a Runner. Runner/Node/Environment selection remains a later scheduler/execution action.

## Built-in V1 templates

- bug fix: diagnosis -> implementation -> validation; automated test + human acceptance
- UI fix: diagnosis -> implementation -> visual validation; visual model + human acceptance
- feature: design -> implementation -> validation; automated test + human acceptance
- performance: baseline -> analysis -> implementation -> validation; benchmark + human acceptance
- deployment: prepare -> deployment -> validation; smoke test + human acceptance
- research: research -> experiment -> conclusion; artifact check + human acceptance
- custom: implementation -> validation; human acceptance

These templates are product defaults, not universal process columns. Workflow Stage remains task-specific and can evolve later without changing the homepage `Ideas | Execution | Acceptance` model.

## Client boundary

The same generated `workConsole` Remote namespace owns `createIdea` and `organizeTask`; no second workspace package or Remote namespace is introduced. Client-safe intake wire types are exported separately and re-exported through the API Remote facade.

The controller contains the mutation methods and tests, but the visible UI callbacks are intentionally landed in a follow-up surface change so the existing Slot contract is not expanded before the form/organization controls are present.

## Verification boundary

Focused Host tests assert passive capture creates no Task and organization creates no ExecutionThread for every built-in Task Type. Client tests assert transport/business failures are visible and successful intake refreshes authoritative facts.

Repository-wide build, generated Typert output, coverage, frozen-lock install, and Web replay still require a trusted checkout with pnpm. No passing runtime claim is made here.
