# Agent Note: Web bundle 挂载 Work Console 浏览器插件

Status: implemented

[English](2026-08-23-web-bundle-mounts-work-console.md) | 中文

## Problem

Work Console 浏览器包及其 client bundle 虽然已经构建，但随附的 Web bundle 没有加入 `dsh.client` roster 条目，也没有声明该 bundle 依赖。因此 host 能返回有效页面，却不会加载 Work Console 面板。补齐浏览器条目后，Host 还需要挂载合并后的 `@deepseek-ai/dsh-work-console`；其默认导出现在指向组合入口，避免 Loader 直接选中 Gateway 类并使内部服务保持 pending。

## Decision

Web bundle 以 `ui-work-console` roster 条目挂载 `@deepseek-ai/dsh-client-ui-work-console`，并在 bundle 依赖中同时声明 client 与 Host 包。Host 包的默认入口负责挂载内部服务和 Gateway；调用方已经挂载核心服务时，则保留现有组合，只挂载 Gateway。由于 `react` 与 `ui-slots` 是静态 client 输入，包只将它们保留在 `devDependencies`；动态服务依赖继续同时位于 peer 与开发依赖中。

## Alternatives considered

**依赖已生成的 `lib/client.js` 自动出现。** 否决，因为 client module host 只扫描启用的 Loader entry；没有列入 roster 的产物不会被请求或激活。

**从静态 Web shell 直接导入面板。** 否决，因为产品 UI 功能必须由 host 组合的 client 插件提供，静态导入会绕过运行时 roster 与 HMR 生命周期。

**增加一条应用专属面板路径。** 否决，因为现有插件已经通过既定 slot 体系注册侧栏动作与 shell overlay；缺少的只是组合入口。

**保留 Gateway 类作为包默认导出。** 否决，因为 Loader 会解包并激活默认导出；Gateway 会在合并后的内部服务之前启动，使 Web entry 保持 pending。

## Consequences

新的 Web 启动会在 `__DSH_BOOT__` 中包含 Work Console entry，侧栏动作显示为“全局工作台”。包 manifest 现在符合自身静态 client 输入的依赖规则。已有的 `ui-settings-usage` manifest 违规和无关的 Web replay fixture 失败仍在本修复范围之外。
