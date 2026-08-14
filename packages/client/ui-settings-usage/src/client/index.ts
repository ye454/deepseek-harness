/**
 * Usage settings plugin, browser half. Registers the Usage page on
 * `settings.section` and reads billed totals from the existing session-list
 * `tokenUsage` projection. Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { UsageSection, type UsageSectionInjected } from './UsageSection.tsx'
import { downloadText } from './download.ts'
import { en, zh, type UsageKey } from './locales.ts'

export type { UsageSectionInjected, UsageSectionProps } from './UsageSection.tsx'
export type { UsageKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Usage settings page copy. */
    'settings.usage': UsageKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.usage'

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registration depends on the slot through `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'sessions']

/**
 * Register the Usage section once the `settings.section` declaration is on
 * the ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-usage: copy dictionaries')

  const t = ctx.locale.bind(NS)
  const injected = (): UsageSectionInjected => ({
    open: (sessionId) => { ctx.sessions.open(sessionId) },
    downloadText,
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'usage',
    order: 12,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, UsageSection))
}
