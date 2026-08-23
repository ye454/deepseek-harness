# Use the Web UI

English | [中文](index.zh.md)

Start the Web UI through the [root README](../../../README.md#run); the command prints its URL. This guide begins after that server is running. The `dsh` process uses its invoking directory as the default filesystem location, but a fresh Web UI has no selected workspace until you add one.

## Configure a model

Open **Settings → Models**, enter a [DeepSeek API key](https://platform.deepseek.com/), and save it. The model route becomes usable immediately without restarting the server.

The [model configuration guide](./providers.md) covers other providers and custom OpenAI-compatible endpoints.

## Choose a workspace

Click **Choose workspace**, add the project directory where you started `dsh`, and select it. The session composer remains unavailable until a workspace is selected.

## Run a task

Start a session and send:

> Summarize this repository and identify its main packages.

The agent can read and edit workspace files, run commands, delegate work, and maintain a plan. The Web UI asks before operations that require approval under the active permission policy.

## Review token usage

After a provider reports usage, each sidebar session row shows a compact billed total beside the relative time. Hover the row to see input, output, and total. A session whose provider never reported usage stays unlabeled.

Open **Settings → Usage** to compare those same durable totals across every non-blank session, including archived conversations and subagent children the sidebar hides.

1. Filter by title or workspace name, or set a minimum total.
2. Click a row to open that session and close Settings.
3. Export the currently visible rows as CSV or JSON. The files contain token counts, not prices.

Custom OpenAI-compatible endpoints configured under **Settings → Models** use this same meter. See [Configure models](./providers.md).

## Continue

- [Configure models](./providers.md)
- [Use the Python SDK](./python-sdk.md)
- [Use other CLI modes](../../../apps/cli/README.md)
- [Develop a plugin](../develop/basic/index.md)
