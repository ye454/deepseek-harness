# Evidence-backed Work Validation

Date: 2026-08-16

## Decision

Keep Task-level validation state compact in `@deepseek-ai/dsh-work-control`, and own detailed validator outcomes plus Evidence references in a separate `@deepseek-ai/dsh-work-validation` capability.

The split is intentional:

- Work Control owns the global board projection and the hard `done` gate.
- Work Validation owns validation generations, per-policy-entry judgments, Evidence references, and explicit user acceptance.
- Large evidence payloads remain in their source systems/artifacts and are fetched on demand.

## Validation generations

One validation cycle is identified by a monotonically increasing generation per Task. Detailed results are keyed by `(taskId, generation, validatorIndex)`.

Starting a new generation invalidates older results for completion while retaining them as audit history. Returning from `validation` to `running` resets Work Control's compact summary. This prevents a previously passed test or user approval from authorizing completion after new implementation work.

## Evidence boundary

Automated validator results require at least one `EvidenceRef`. Evidence references carry compact lookup facts such as CI run ids, log ids, Git commits, artifact paths, screenshot URIs, device-test records, benchmark artifacts, or URLs. Raw logs, screenshots, transcripts, command output, and private chain-of-thought do not enter this domain.

`user-acceptance` is deliberately separated from automated validator submission. A human decision records an actor and may optionally reference additional evidence; an automated Runner cannot mark the human gate passed through the automation API.

## Aggregation

Only validators with `requirement: required` gate completion. The current generation is summarized into Work Control as:

- `pending`: at least one required validator has no passing result and none has failed;
- `failed`: at least one required validator currently failed;
- `passed`: every required validator currently passed.

Advisory and optional outcomes remain visible in detailed validation but do not contribute to `requiredPassed` / `requiredTotal`.

## Added validator

`smoke-test` is added to the shared Work Control validator vocabulary because deployment/runtime smoke checks are a distinct first-class acceptance mechanism in the product design.

## Failure and recovery

Detailed Evidence/result persistence is authoritative. Compact Work Control summary is a derived projection and may be reconciled again after a concurrent revision conflict. The product should route a failed required validator back to the relevant dynamic Workflow stage rather than blindly selecting the previous stage.
