# Current Status

- Blockers: `DSH_SNAPSHOT=replay pnpm run test:web` remains red on the existing Windows replay/fixture corpus; one Work Console node-gateway test has an environment-dependent timeout connecting to `127.0.0.1:26046`; `pnpm run verify-client-packages` reports only the 3 pre-existing `ui-settings-usage` violations.
- Recent verification: Work Console tests passed 33/34 files/tests scope (134/135 tests; one node-gateway timeout); Host build and `pnpm run verify-cordis-config` passed; a fresh `pnpm dsh web --no-open` starts at `http://127.0.0.1:3080`; real browser click opens `持续工作控制台`, shows `Nodes 0/0` and `Env 0/0`, and the RPC route returns HTTP 200 with protocol-level validation.
- Next experiment: none for this fix; keep the local Web process available for manual inspection at `http://127.0.0.1:3080`.
- Prohibitions: do not delete the pre-existing untracked build outputs or commit them.
- Risks: browser interaction, real runner/remote execution, API-backed e2e, and hardware acceptance remain unverified; constraints remain blocked outside this change scope.
- Published: `20ec54955e` (`fix(web): mount consolidated work console`) is published on `origin/feat/session-list-and-settings-usage`; local and remote heads are synchronized.
