# @deepseek-ai/dsh-work-validation

[English](README.md) | 中文

全局 Work Control 的详细验收与 Evidence 能力。`work-control` 只保留主看板需要的精简验收投影；本包负责可审计的当前 Validation Generation、各 Validator 判定和 Evidence 引用。

## 核心规则

- 每次验收都有单调递增的 `generation`。
- 新 Generation 开始后，旧结果只保留为审计历史，不能继续满足当前完成条件。
- Task 从 `validation` 回到 `running` 时，Work Control 的 passed summary 会自动清零，新的修改不能复用上一次验收结果。
- 自动 Validator 写入 `passed/failed` 时必须至少携带一个 Evidence 引用。
- `user-acceptance` 不能通过自动结果接口完成，必须走独立用户验收入口并记录 actor。
- 只有 `required` Validator 阻塞 `done`；`advisory/optional` 结果仍可见，但不成为硬完成门槛。
- 大日志、截图文件、Benchmark 原始数据、对话历史和命令完整输出不直接写入这里。Evidence 只保存稳定引用和可选的简短事实摘要，详细内容按需读取。

## Evidence

`EvidenceRef` 保存类型、显示名称、稳定引用以及可选摘要。引用可以是 CI Run ID、Git Commit、日志 ID、Artifact 路径、截图 URI、设备测试记录、Benchmark Artifact 或外部 URL。

这样既能让验收事实可追溯，又不会把大量历史重新塞进模型上下文。详细 Evidence 放在 Task Detail / Execution History；全局主看板只显示 `pending | failed | passed` 和 Required 通过数量。

## 完成链路

`running → beginValidation() → Validation Generation → Validator + Evidence → Work Control Summary → done`

Required 验收失败时 Task 继续停留在 Validation，由 Workflow/用户决定回到对应执行 Stage。单纯重跑同一验收可以更新当前 Generation 的 Validator Result；发生新的实现工作后则应返回 `running`，再开启新 Generation。
