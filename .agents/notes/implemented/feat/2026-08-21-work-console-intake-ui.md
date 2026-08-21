# Work Console intake UI

## Scope

Adds only the visible human intake/organization controls on top of the existing Work Console command boundary.

- `+ 记录想法` opens a compact inline form for title, optional summary and comma-separated tags.
- Saving delegates to the Host-owned `workConsole.createIdea()` command; the browser does not write Work Control records directly.
- Passive Idea capture does not promote, organize, create an ExecutionThread, start a Runner, allocate an Environment, or invoke a model.
- An `unclaimed` / organizing Task exposes a Task Detail organization panel.
- The user explicitly selects one of the deterministic Task Type templates and presses `确认组织`.
- Organization delegates to `workConsole.organizeTask()` and does not itself start a Runner or model.

## Product boundary

The visible V1 intake flow is:

`record Idea -> explicit promotion -> explicit human organization -> later orchestration/execution`

The homepage remains `想法区 | 执行区 | 验收区`; task-specific workflow stages are not promoted to global board columns.

## Verification assets

Client component tests cover explicit Idea capture, tag normalization, explicit promotion/drag, explicit organization type selection, and evidence-first human acceptance. Slot wiring tests cover the create/organize callbacks and their authoritative refresh/detail behavior.

No passing build/test claim is made until the stacked lockfile and repository pnpm gates can run in a trusted checkout.