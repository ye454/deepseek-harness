# Agent Note: Session-list and Settings usage from tokenUsage

Status: implemented

[English](2026-08-14-session-list-and-settings-usage.md) | 中文

## 问题

提供方报告的 token 用量已经存在于持久化 `tokenUsage` 会话投影和对话统计行中，但会话列表和设置里无法比较各对话或导出这些数字。接入第三方 OpenAI 兼容路由的用户仍然需要按对话查看计费合计，且不应再引入第二套计量。

## 决策

**列表行与设置页都读取既有的列表 `tokenUsage` 投影。** 每个列表快照上已有 `SessionSummary.projectionValues.tokenUsage`。`ui-workspace` 把计费输入／输出／合计投影到 `SessionNode`，并在合计大于零的非空白行上绘制紧凑合计；悬浮卡片列出输入、输出与合计。紧凑拼写使用 `@deepseek-ai/dsh-token-meter/client` 的 `formatCompactTokens`，与对话底部统计行相同。该 `/client` 说明符是精确的 inline-safe wire 层（类型加纯函数助手）；宿主包根仍不在客户端纯度白名单中。

**用量是独立的设置分区，而不是通用设置里的一行。** `@deepseek-ai/dsh-client-ui-settings-usage` 以 id `usage`、顺序 `12` 注册 `settings.section`。它列出所有非空白会话（包括已归档会话和子代理会话），在本地按标题／工作区和最少合计筛选，打开一行时调用 `ctx.sessions.open` 再 `close()`，并把当前可见行下载为 CSV 或 JSON。它不新增 Host RPC、第二次 fold 或价格列。

## 曾考虑的替代方案

**把该页放进 `ui-workspace`。** 不采用：设置页的自注册已经由功能包持有顶级页面（`ui-settings-models`），把计费表混进侧边栏浏览界面会把浏览框架和导出／筛选 UI 绑在一起。

**在浏览器里重新折叠每个会话日志。** 不采用：列表快照已经携带持久投影；第二次 fold 会与对话统计漂移，并且每行都要一次往返。

**只在悬浮卡片里显示 token。** 不采用：所要求的列表能力是一眼可比较的合计；悬浮卡片仍承担明细。

## 后果

有计费用量的对话会在侧边栏相对时间旁显示紧凑合计。设置 → 用量汇总同一组数字，包括侧边栏隐藏的会话（已归档、子代理）。导出的是 token 计数，不是货币。提供方从未报告用量的会话在列表中不标注，在用量页显示为零。
