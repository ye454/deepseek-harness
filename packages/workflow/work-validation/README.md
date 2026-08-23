# @deepseek-ai/dsh-work-validation

English | [中文](README.zh.md)

Detailed validation/evidence capability for the global work-control stack. `work-control` keeps only the compact board projection; this package owns the auditable current validation generation and its per-validator Evidence references.

## Core rules

- Every validation cycle has a monotonically increasing `generation`.
- Starting a new generation makes older results audit history only; they cannot satisfy the current completion gate.
- Returning a Task from `validation` to `running` resets Work Control's compact validation summary, so new implementation work cannot reuse an earlier pass.
- Automated Validator results must carry at least one compact Evidence reference.
- `user-acceptance` cannot be satisfied through the automated-result API; it has a separate explicit user decision operation with an actor.
- Only `required` validators gate `done`. Advisory/optional outcomes remain visible evidence without becoming hard completion gates.
- Large logs, screenshots, benchmark files, transcripts, and command output are not embedded. Evidence stores stable references plus an optional short factual summary and is fetched on demand.

## Evidence

An `EvidenceRef` records a kind, display label, stable lookup reference, and optional short summary. Typical references are CI run ids, Git commits, log ids, artifact paths, screenshot URIs, device-test records, benchmark artifacts, or external URLs.

This design keeps validation auditable without inflating the model context. Detailed evidence belongs to task detail/execution history; the global board receives only `pending | failed | passed` plus required-pass counts.

## Completion flow

`running → beginValidation() → validation generation → Validator results/Evidence → Work Control summary → done`

When required validation fails, the Task remains in validation until the workflow/user routes it back to the relevant execution stage. A later retry can overwrite the current generation's Validator result, while a materially new work cycle should return to `running` and start a fresh generation.
