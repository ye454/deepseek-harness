/** Deterministic zero-token organization templates for Work Console V1. */
import type { OrganizeTaskRequest } from './internal/control/index.ts'
import type { WorkConsoleTaskType } from './intake-types.ts'

/** Build a fresh mutable-independent organization request for one selected task type. */
export function organizationTemplate(taskType: WorkConsoleTaskType): OrganizeTaskRequest {
  switch (taskType) {
    case 'bug-fix':
      return request(taskType,
        [
          ['diagnosis', '问题诊断', 'diagnosis'],
          ['implementation', '修复落地', 'implementation'],
          ['validation', '回归验收', 'validation'],
        ],
        [
          ['automated-test', 'required', '自动回归测试'],
          ['user-acceptance', 'required', '人工确认'],
        ])
    case 'ui-fix':
      return request(taskType,
        [
          ['diagnosis', '界面定位', 'diagnosis'],
          ['implementation', '界面修复', 'implementation'],
          ['validation', '视觉验收', 'validation'],
        ],
        [
          ['visual-model', 'required', '视觉模型验收'],
          ['user-acceptance', 'required', '人工确认'],
        ])
    case 'feature':
      return request(taskType,
        [
          ['design', '方案设计', 'design'],
          ['implementation', '功能实现', 'implementation'],
          ['validation', '功能验收', 'validation'],
        ],
        [
          ['automated-test', 'required', '自动测试'],
          ['user-acceptance', 'required', '人工确认'],
        ])
    case 'performance':
      return request(taskType,
        [
          ['baseline', '基线测量', 'experiment'],
          ['analysis', '性能分析', 'diagnosis'],
          ['implementation', '优化落地', 'implementation'],
          ['validation', '对比验证', 'validation'],
        ],
        [
          ['benchmark', 'required', '性能基准对比'],
          ['user-acceptance', 'required', '人工确认'],
        ])
    case 'deployment':
      return request(taskType,
        [
          ['prepare', '部署准备', 'design'],
          ['deployment', '执行部署', 'deployment'],
          ['validation', '上线检查', 'validation'],
        ],
        [
          ['smoke-test', 'required', 'Smoke Test'],
          ['user-acceptance', 'required', '人工确认'],
        ])
    case 'research':
      return request(taskType,
        [
          ['research', '调研', 'research'],
          ['experiment', '验证实验', 'experiment'],
          ['conclusion', '结论沉淀', 'conclusion'],
        ],
        [
          ['artifact-check', 'required', '研究产物检查'],
          ['user-acceptance', 'required', '人工确认'],
        ])
    case 'custom':
      return request(taskType,
        [
          ['implementation', '执行', 'custom'],
          ['validation', '验收', 'validation'],
        ],
        [['user-acceptance', 'required', '人工确认']])
  }
}

function request(
  taskType: WorkConsoleTaskType,
  stages: readonly (readonly [id: string, title: string, kind: OrganizeTaskRequest['workflow']['stages'][number]['kind']])[],
  validators: readonly (readonly [
    kind: OrganizeTaskRequest['validationPolicy']['validators'][number]['kind'],
    requirement: OrganizeTaskRequest['validationPolicy']['validators'][number]['requirement'],
    label: string,
  ])[],
): OrganizeTaskRequest {
  return {
    taskType,
    workflow: {
      version: 1,
      stages: stages.map(([id, title, kind]) => ({ id, title, kind })),
    },
    validationPolicy: {
      version: 1,
      validators: validators.map(([kind, requirement, label]) => ({ kind, requirement, label })),
    },
  }
}
