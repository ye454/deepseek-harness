/** Test-only isolated subagent service for the Loader composition smoke. */

import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentProvider, SubagentRuntime, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'

/** Cordis fixture plugin name. */
export const name = 'work-runner-fake-subagents'

/**
 * Provide one isolated one-shot provider without performing a real model call.
 * @param ctx - Loader fixture context.
 */
export function apply(ctx: Context): void {
  const provider: SubagentProvider = {
    name: 'fixture-runner',
    capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
    inheritsParentContext: false,
    start: async () => { throw new Error('fixture provider.start is not called through this fake runtime') },
  }
  const runtime = {
    list: () => [provider.name],
    getProvider: (providerName: string) => providerName === provider.name ? provider : undefined,
    start: async (providerName: string, request: SubagentStartRequest) => {
      if (providerName !== provider.name) throw new Error(`unexpected fixture provider '${providerName}'`)
      const prompt = request.prompt[0]
      if (prompt?.type !== 'text') throw new Error('fixture expected one text prompt')
      return {
        id: SessionId('fixture-child'),
        localAgent: undefined,
        result: Promise.resolve({
          output: [{ type: 'text' as const, text: `fixture:${prompt.text.length}` }],
          stopReason: 'completed' as const,
        }),
        dispose: async () => {},
      }
    },
  } as unknown as SubagentRuntime
  ctx.provide('subagents', runtime)
}
