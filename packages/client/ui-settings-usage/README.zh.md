# @deepseek-ai/dsh-client-ui-settings-usage

[English](README.md) | 中文

用量设置页。浏览器插件注册一个 id 为 `usage`、顺序为 `12` 的本地化 `settings.section` 贡献。它不再向 Host 发起额外读取：计费合计来自每条 `SessionSummary` 上已有的会话列表 `tokenUsage` 投影，与对话统计行读取的是同一份持久计量。

该页列出所有非空白会话，包括已归档会话和子代理会话。每行显示标题、工作区（或未分组）、输入、输出与合计。标题／工作区搜索与最少合计筛选只在本地生效。打开一行会调用 `ctx.sessions.open` 并关闭设置。**导出 CSV** 和 **导出 JSON** 下载当前可见行；CSV 列为 title、workspace、sessionId、input、output、cacheRead、cacheWrite、total 和 updatedAt。

token 数量的紧凑拼写使用 [`dsh-token-meter`](../../llm/token-meter/README.zh.md) 的 `formatCompactTokens`。注册使用 `ctx.slots.inject()`，因此能跟随分区 slot 的延迟声明、重新声明、本地化变化与 teardown。

## 模型体验

无，因为本包只在浏览器设置中展示既有会话列表投影，不注册任何模型接口。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **仅列表投影** —— 该页不会重新折叠会话日志，也不会估算费用；提供方从未报告用量的会话显示为零。
- **没有价格或按模型拆分** —— 导出的是 token 计数，不是货币或按模型分行。
