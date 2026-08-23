# Fix Work Console and Publish

## Scope

Repair the `origin/work` consolidation after merging it into the current feature branch, run the relevant tests and compiler gates, then commit and push the intentional changes to `origin`.

## Non-goals

Do not remove existing untracked build output, redesign the Work Console architecture, or claim browser, remote-runner, hardware, or real API acceptance without evidence.

## Current evidence

- Merge commit: `bce53858dd`, source tip: `origin/work` at `e7f59ee40f`.
- `packages/workflow` contains only the five expected package directories.
- Constraints report package metadata failures and stale generated workspace directories.
- Focused Work Console tests report stale `@deepseek-ai/dsh-work-*` imports and old relative test paths; UI rendering has an isolated passing case.
- Package typechecks report missing remote types/exports and strict TypeScript errors.
- The official Host → Client → Web build passed and recorded 204 client artifacts.
- `pnpm dsh web --no-open` served `http://127.0.0.1:3080` with HTTP 200 HTML containing `__DSH_BOOT__` and `__ModuleLoader__`.

## Acceptance

- [x] Work Console source, package metadata, tests, and client remote types use the consolidated package.
- [x] Focused Work Console tests pass without disabling cases.
- [x] Relevant TypeScript, package invariant, and startup checks pass; remaining workspace constraint failures are explicitly documented.
- [x] The assembled Web application starts locally and serves the injected boot page.
- [x] Only intentional files are committed and pushed to the current `origin` branch.

## Stop conditions

Stop before push if unrelated tracked changes appear, credentials are requested, or the fix requires an architectural redesign beyond this consolidation.
