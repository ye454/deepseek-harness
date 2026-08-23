# Agent Note: Web bundle mounts the Work Console browser plugin

Status: implemented

English | [中文](2026-08-23-web-bundle-mounts-work-console.zh.md)

## Problem

The Work Console browser package and its client bundle were built, but the shipped Web bundle did not include a `dsh.client` roster row or a declared bundle dependency. The host therefore served a valid page without loading the Work Console panel. After adding the browser row, the Host also needed the consolidated `@deepseek-ai/dsh-work-console` row; its package default now points at the composite bundle entry so Loader does not select the Gateway class directly and leave its internal services pending.

## Decision

The Web bundle mounts `@deepseek-ai/dsh-client-ui-work-console` as the `ui-work-console` browser roster entry and declares both client and Host packages in the bundle's dependencies. The Host package exports a composite default entry that mounts its internal services and Gateway; when a caller already mounted the core services, it preserves that composition and only mounts the Gateway. The client package keeps `react` and `ui-slots` in `devDependencies` because they are static client inputs, while its dynamic service dependencies remain in the peer and development sections.

## Alternatives considered

**Rely on the package's built `lib/client.js` being present.** Rejected because the client module host scans enabled Loader entries; an unlisted artifact is never requested or activated.

**Import the panel from the static Web shell.** Rejected because product UI features are host-composed client plugins and static imports would bypass the runtime roster and HMR lifecycle.

**Add a separate application-specific panel path.** Rejected because the existing plugin already registers the sidebar action and shell overlay through the established slot system; only composition was missing.

**Keep the Gateway class as the package default.** Rejected because Loader unwraps the default export; it would activate the Gateway before the consolidated internal services and leave the Web entry pending.

## Consequences

New Web launches include the Work Console entry in `__DSH_BOOT__`, and the sidebar action renders as `全局工作台`. The package manifest now satisfies the client package dependency rule for its own static inputs. Existing `ui-settings-usage` manifest violations and unrelated Web replay fixture failures remain outside this fix.
