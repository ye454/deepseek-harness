/** Copy dictionaries for the Usage settings section. */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  nav: '用量',
  title: '用量',
  intro: '按会话汇总提供方报告的 token 用量。数字来自会话日志投影，与对话底部统计一致。',
  search: '搜索会话或工作区',
  minTotal: '最少合计 token',
  empty: '暂无用量记录。',
  emptySearch: '没有匹配的会话。',
  'col.title': '会话',
  'col.workspace': '工作区',
  'col.input': '输入',
  'col.output': '输出',
  'col.total': '合计',
  'totals.sessions': '{n} 个会话',
  exportCsv: '导出 CSV',
  exportJson: '导出 JSON',
  archived: '已归档',
  subagent: '子代理',
  ungrouped: '未分组',
} satisfies Record<string, string>

/** Usage locale key union. */
export type UsageKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  nav: 'Usage',
  title: 'Usage',
  intro: 'Provider-reported token usage grouped by session. Figures come from the session-log projection and match the conversation stats.',
  search: 'Search sessions or workspaces',
  minTotal: 'Minimum total tokens',
  empty: 'No usage records yet.',
  emptySearch: 'No matching sessions.',
  'col.title': 'Session',
  'col.workspace': 'Workspace',
  'col.input': 'Input',
  'col.output': 'Output',
  'col.total': 'Total',
  'totals.sessions': '{n} sessions',
  exportCsv: 'Export CSV',
  exportJson: 'Export JSON',
  archived: 'Archived',
  subagent: 'Subagent',
  ungrouped: 'Ungrouped',
} satisfies Record<UsageKey, string>
