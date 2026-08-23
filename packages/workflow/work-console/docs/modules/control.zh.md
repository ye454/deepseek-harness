# @deepseek-ai/dsh-work-control

[English](README.md) | 中文

轻量持续工作台的全局工作控制领域。它明确区分“被动想法”和“可执行任务”：记录想法时只保存文本与标签；只有显式调用 `promoteIdea()`，同一个稳定条目才会进入 `organizing`。之后由组织器补充任务类型、顺序 Workflow 和该任务专属的验收策略，再开始执行。

本包不拥有 Runner、Remote Node、Environment、详细 Evidence 或模型长期记忆。这些能力在任务完成组织后再独立挂接，从而让全局首页保持轻量，并确保记录想法不会自动消耗模型 Token 或执行资源。

## 生命周期

```text
idea
  └─ 人工显式推进 → organizing
                     └─ 组织完成 → running
                                  ├─ blocked → running
                                  ├─ validation → running | done
                                  ├─ done
                                  └─ cancelled
```

优先级只保留 `p0`、`p1`、`p2`。领域层只记录优先级；调度器可以把 `p0` 解释为加急并安全分配多个 Runner，但并发策略不会硬编码在这里。

## 持久状态

本包打开 `work-control` storage domain，只保存一张判别联合类型的 `items` 表。想法推进时通过一次持久表更新把 idea 原地转换成 task，同时保留 `WorkItemId`，避免“想法表 → 任务表”的双记录事务。想法推进与删除在服务内部串行化，因此同一个 revision 不可能同时提交“删除”和“推进”。Task 变更继续通过 `WorkItemRef { id, revision }` 做 compare-and-set 并发保护。

Task 可以携带动态生成的 Workflow 和可组合 Validation Policy。Validator 包含自动测试、视觉模型、运行状态、日志、Benchmark、真机、静态检查、产物检查与用户验收；每个 Validator 可以是 required、advisory 或 optional。required 数量从持久策略中派生，所有 required validator 未通过前，领域层会拒绝进入 `done`。因此只要 `user-acceptance` 被声明为 required，即使 AI 自动验收已经通过，任务仍必须等待人工验收记录。

## 组合

本包自带可选 bundle patch：

```sh
dsh plugin --profile web add <path-to-package>
```

它依赖 `ctx.storageDomain`。标准 Web 组合会挂载 `storage`、JSON backend 和 `storage-domain`；base/headless 组合若要使用本包，需要显式挂载合适的 storage backend 与 `storage-domain`。

## Model Experience

### 全局工作控制状态

#### What the model sees

模型不会直接看到任何内容。本包不注册模型工具、Prompt section、Conversation Node 或 Session 消息。后续的组织器/Runner Consumer 决定哪些经过裁剪的 Task 字段进入模型请求。

#### Token effect

直接 Token 消耗为零。记录想法、修改状态或更新看板元数据都不会进入模型上下文。

#### KV Cache effect

相互独立。Work-control 的持久状态变化不会修改模型请求前缀。

## Known Limitations and Deferred Work

- **尚未挂接执行器** —— `ExecutionThread`、Runner、Remote Node、Environment、Handoff 和 Evidence 会作为独立 Package 继续实现。
- **尚未提供全局 Web UI** —— 目标是“想法 / 执行 / 验收”三块轻量面板，由 Client Plugin 覆盖在本服务之上，而不是塞进持久领域。
- **尚未提供组织器 Consumer** —— 想法推进后停在 `organizing`，后续组织器才会选择/生成 Workflow 与 Validation Policy。
- **尚未提供 Validator 执行器** —— 本包已经强制 required 数量和完成条件保持一致，但自动测试、视觉检查、真机验证和人工验收记录由后续 validator consumer 执行。
