import { useEffect, useMemo, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import type {
  WorkConsoleIdeaCard,
  WorkConsoleSnapshot,
  WorkConsoleTaskCard,
  WorkConsoleTaskDetail,
  WorkConsoleTaskType,
  WorkConsoleValidatorDetail,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { WorkConsoleRootProps, WorkConsoleTriggerProps } from './contract.ts'
import css from './WorkConsoleRoot.module.css'

const POLL_MS = 5_000
const IDEA_DRAG_TYPE = 'application/x-dsh-work-idea'

/** Sidebar entry opening the global, project-independent Work Console. */
export function WorkConsoleTrigger({ wide, useStore, openConsole, closeConsole }: WorkConsoleTriggerProps) {
  const open = useStore(state => state.open)
  const selectedTaskId = useStore(state => state.selectedTaskId)
  return (
    <button
      type="button"
      className={wide ? css.trigger : `${css.trigger} ${css.triggerRail}`}
      aria-label="全局工作台"
      aria-pressed={open}
      title={wide ? undefined : '全局工作台'}
      onClick={() => { if (open) closeConsole(); else openConsole(selectedTaskId) }}
    >
      <span className={css.triggerIcon} aria-hidden="true">▦</span>
      {wide && <span className={css.triggerLabel}>全局工作台</span>}
    </button>
  )
}

/** Lightweight root surface: passive ideas, active execution, and human-ready acceptance. */
export function WorkConsoleRoot({
  useStore,
  actions,
  useWorkConsole,
  closeConsole,
  refreshConsole,
  selectTask,
  createIdea,
  promoteIdea,
  organizeTask,
  decideAcceptance,
  clearError,
}: WorkConsoleRootProps) {
  const open = useStore(state => state.open)
  const selectedTaskId = useStore(state => state.selectedTaskId)
  const remote = useWorkConsole(state => state)
  const [query, setQuery] = useState('')
  const [priority, setPriority] = useState<'all' | 'p0' | 'p1' | 'p2'>('all')
  const [busyKey, setBusyKey] = useState<string | undefined>()
  const [captureOpen, setCaptureOpen] = useState(false)
  const [ideaTitle, setIdeaTitle] = useState('')
  const [ideaSummary, setIdeaSummary] = useState('')
  const [ideaTags, setIdeaTags] = useState('')

  useEffect(() => {
    if (!open) return undefined
    const timer = window.setInterval(() => { refreshConsole(selectedTaskId) }, POLL_MS)
    return () => { window.clearInterval(timer) }
  }, [open, refreshConsole, selectedTaskId])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeConsole()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [closeConsole, open])

  const snapshot = remote.snapshot
  const ideas = useMemo(() => filterIdeas(snapshot?.ideas ?? [], query), [snapshot, query])
  const tasks = useMemo(() => filterTasks(snapshot, query, priority), [snapshot, query, priority])
  const acceptance = useMemo(() => tasks.filter(isHumanReady), [tasks])
  const execution = useMemo(() => tasks.filter(task => task.status !== 'done' && !isHumanReady(task)), [tasks])
  const doneCount = snapshot?.tasks.filter(task => task.status === 'done').length ?? 0

  if (!open) return null

  const detail = remote.detailTaskId === selectedTaskId ? remote.detail : undefined

  const runCreateIdea = async (): Promise<void> => {
    if (busyKey !== undefined || ideaTitle.trim() === '') return
    setBusyKey('idea:create')
    try {
      const ok = await createIdea(ideaTitle, ideaSummary, parseTags(ideaTags))
      if (!ok) return
      setIdeaTitle('')
      setIdeaSummary('')
      setIdeaTags('')
      setCaptureOpen(false)
    } finally {
      setBusyKey(undefined)
    }
  }

  const runPromotion = async (idea: Pick<WorkConsoleIdeaCard, 'id' | 'revision'>): Promise<void> => {
    const key = `idea:${idea.id}`
    if (busyKey !== undefined) return
    setBusyKey(key)
    try {
      await promoteIdea(idea.id, idea.revision)
    } finally {
      setBusyKey(undefined)
    }
  }

  const runOrganization = async (detailValue: WorkConsoleTaskDetail, taskType: WorkConsoleTaskType): Promise<void> => {
    if (busyKey !== undefined) return
    const key = `organize:${detailValue.card.id}`
    setBusyKey(key)
    try {
      await organizeTask(detailValue.card.id, detailValue.card.revision, taskType)
    } finally {
      setBusyKey(undefined)
    }
  }

  const runDecision = async (
    detailValue: WorkConsoleTaskDetail,
    validator: WorkConsoleValidatorDetail,
    decision: 'accept' | 'return',
  ): Promise<void> => {
    if (detailValue.validationGeneration === undefined || busyKey !== undefined) return
    const key = `accept:${detailValue.card.id}`
    setBusyKey(key)
    try {
      await decideAcceptance(
        detailValue.card.id,
        detailValue.card.revision,
        detailValue.validationGeneration,
        validator.index,
        decision,
      )
    } finally {
      setBusyKey(undefined)
    }
  }

  return (
    <div className={css.overlay} role="dialog" aria-modal="true" aria-label="持续工作控制台">
      <div className={css.surface}>
        <header className={css.header}>
          <div>
            <div className={css.titleRow}>
              <h1 className={css.title}>持续工作控制台</h1>
              <span className={css.readOnly}>V1</span>
            </div>
            <p className={css.subtitle}>想法沉淀 → 人工组织 → 持续执行 → AI 验收后人工确认</p>
          </div>
          <div className={css.headerActions}>
            <button type="button" className={css.secondaryButton} onClick={() => { setCaptureOpen(value => !value) }}>
              {captureOpen ? '取消记录' : '+ 记录想法'}
            </button>
            <button type="button" className={css.secondaryButton} disabled={remote.loading} onClick={() => { refreshConsole(selectedTaskId) }}>
              {remote.loading ? '刷新中…' : '刷新'}
            </button>
            <button type="button" className={css.closeButton} aria-label="关闭工作台" onClick={closeConsole}>×</button>
          </div>
        </header>

        {remote.error !== undefined && (
          <div className={css.errorBanner}>
            <span>{remote.error}</span>
            <button type="button" onClick={clearError}>关闭</button>
          </div>
        )}

        {captureOpen && (
          <div className={css.toolbar} aria-label="记录想法">
            <input className={css.search} aria-label="想法标题" value={ideaTitle} placeholder="想法标题（必填）" onChange={event => { setIdeaTitle(event.currentTarget.value) }} />
            <input className={css.search} aria-label="想法说明" value={ideaSummary} placeholder="一句话说明（可选）" onChange={event => { setIdeaSummary(event.currentTarget.value) }} />
            <input className={css.search} aria-label="想法标签" value={ideaTags} placeholder="标签，逗号分隔（可选）" onChange={event => { setIdeaTags(event.currentTarget.value) }} />
            <span className={css.historyHint}>仅记录，不进入执行，不调用模型</span>
            <button
              type="button"
              className={css.secondaryButton}
              disabled={busyKey !== undefined || ideaTitle.trim() === ''}
              onClick={() => { void runCreateIdea() }}
            >
              {busyKey === 'idea:create' ? '记录中…' : '保存想法'}
            </button>
          </div>
        )}

        <ResourceStrip snapshot={snapshot} />

        <div className={css.toolbar}>
          <input
            className={css.search}
            value={query}
            placeholder="搜索想法 / Task / Stage / Runner"
            onChange={event => { setQuery(event.currentTarget.value) }}
          />
          <label className={css.selectWrap}>
            <span className={css.srOnly}>优先级</span>
            <select value={priority} onChange={event => { setPriority(event.currentTarget.value as typeof priority) }}>
              <option value="all">全部优先级</option>
              <option value="p0">P0 紧急</option>
              <option value="p1">P1 高</option>
              <option value="p2">P2 普通</option>
            </select>
          </label>
          <span className={css.historyHint}>已完成 {doneCount} · 进入执行历史查看</span>
        </div>

        <main className={css.workspace}>
          <IdeaSection ideas={ideas} busyKey={busyKey} onPromote={runPromotion} />
          <TaskSection
            title="执行区"
            hint="拖入成熟想法；待组织 Task 需人工确认流程后再进入执行"
            tasks={execution}
            empty="当前没有执行中的 Task"
            onSelect={selectTask}
            onIdeaDrop={runPromotion}
          />
          <TaskSection
            title="验收区"
            hint="自动验收已满足；打开证据后人工决定"
            tasks={acceptance}
            empty="当前没有等待人工验收的 Task"
            acceptance
            onSelect={selectTask}
          />
        </main>

        {selectedTaskId !== null && (
          <TaskDetailDrawer
            detail={detail}
            loading={remote.detailLoading && remote.detailTaskId === selectedTaskId}
            decisionBusy={busyKey === `accept:${selectedTaskId}`}
            organizationBusy={busyKey === `organize:${selectedTaskId}`}
            onDecision={runDecision}
            onOrganize={runOrganization}
            onClose={() => { actions.selectTask(null) }}
          />
        )}
      </div>
    </div>
  )
}

function ResourceStrip({ snapshot }: { readonly snapshot: WorkConsoleSnapshot | undefined }) {
  if (snapshot === undefined) return <div className={css.resourceStrip}>正在读取资源事实…</div>
  const { resources, pending } = snapshot
  const nodeState = resources.nodes.offline > 0
    ? `${resources.nodes.offline} 离线`
    : resources.nodes.degraded > 0 ? `${resources.nodes.degraded} 降级` : '正常'
  const environmentState = resources.environments.unavailable > 0
    ? `${resources.environments.unavailable} 不可用`
    : resources.environments.degraded > 0 ? `${resources.environments.degraded} 降级` : '正常'
  return (
    <div className={css.resourceStrip}>
      <ResourceFact label="Nodes" value={`${resources.nodes.online}/${resources.nodes.total}`} state={nodeState} warning={resources.nodes.offline > 0 || resources.nodes.degraded > 0} />
      <ResourceFact label="Env" value={`${resources.environments.ready}/${resources.environments.total}`} state={environmentState} warning={resources.environments.degraded > 0 || resources.environments.unavailable > 0} />
      {resources.runners.map(runner => (
        <ResourceFact
          key={runner.provider}
          label={runner.provider}
          value={`${runner.onlineNodeCount}/${runner.nodeCount}`}
          state="可用节点"
          warning={runner.onlineNodeCount === 0}
        />
      ))}
      <span className={css.acceptanceCounter}>待人工验收 <strong>{pending.pendingUserAcceptance}</strong></span>
    </div>
  )
}

function ResourceFact({ label, value, state, warning }: {
  readonly label: string
  readonly value: string
  readonly state: string
  readonly warning: boolean
}) {
  return (
    <span className={`${css.resourceFact} ${warning ? css.resourceWarning : ''}`}>
      <b>{label}</b><strong>{value}</strong><small>{state}</small>
    </span>
  )
}

function IdeaSection({ ideas, busyKey, onPromote }: {
  readonly ideas: readonly WorkConsoleIdeaCard[]
  readonly busyKey: string | undefined
  readonly onPromote: (idea: Pick<WorkConsoleIdeaCard, 'id' | 'revision'>) => Promise<void>
}) {
  return (
    <section className={`${css.zone} ${css.ideaZone}`} aria-label="想法区">
      <ZoneHeader title="想法区" count={ideas.length} hint="只记录，不自动执行" />
      <div className={css.zoneBody}>
        {ideas.length === 0 && <div className={css.empty}>暂无想法</div>}
        {ideas.map(idea => {
          const busy = busyKey === `idea:${idea.id}`
          return (
            <article
              key={idea.id}
              className={css.ideaCard}
              draggable={!busy}
              onDragStart={event => {
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData(IDEA_DRAG_TYPE, JSON.stringify({ id: idea.id, revision: idea.revision }))
              }}
            >
              <strong>{idea.title}</strong>
              {idea.summary !== '' && <p>{idea.summary}</p>}
              {idea.tags.length > 0 && <div className={css.tags}>{idea.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}
              <div className={css.ideaActions}>
                <span>拖入执行区</span>
                <button type="button" disabled={busyKey !== undefined} onClick={() => { void onPromote(idea) }}>
                  {busy ? '推进中…' : '推进到执行'}
                </button>
              </div>
            </article>
          )
        })}
      </div>
      <div className={css.zoneFoot}>成熟后由用户明确推进到执行区</div>
    </section>
  )
}

function TaskSection({ title, hint, tasks, empty, acceptance = false, onSelect, onIdeaDrop }: {
  readonly title: string
  readonly hint: string
  readonly tasks: readonly WorkConsoleTaskCard[]
  readonly empty: string
  readonly acceptance?: boolean
  readonly onSelect: (taskId: string) => void
  readonly onIdeaDrop?: (idea: { readonly id: string; readonly revision: number }) => Promise<void>
}) {
  const acceptsIdeas = onIdeaDrop !== undefined
  return (
    <section
      className={`${css.zone} ${acceptance ? css.acceptanceZone : css.executionZone}`}
      aria-label={title}
      onDragOver={acceptsIdeas ? event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } : undefined}
      onDrop={acceptsIdeas ? event => { void handleIdeaDrop(event, onIdeaDrop) } : undefined}
    >
      <ZoneHeader title={title} count={tasks.length} hint={hint} />
      <div className={css.zoneBody}>
        {tasks.length === 0 && <div className={css.empty}>{empty}</div>}
        {tasks.map(task => <TaskCard key={task.id} task={task} acceptance={acceptance} onSelect={onSelect} />)}
      </div>
      {acceptsIdeas && <div className={css.zoneFoot}>将想法拖到这里，或使用“推进到执行”</div>}
    </section>
  )
}

function ZoneHeader({ title, count, hint }: { readonly title: string; readonly count: number; readonly hint: string }) {
  return (
    <header className={css.zoneHeader}>
      <div><strong>{title}</strong><span>{count}</span></div>
      <small>{hint}</small>
    </header>
  )
}

function TaskCard({ task, acceptance, onSelect }: {
  readonly task: WorkConsoleTaskCard
  readonly acceptance: boolean
  readonly onSelect: (taskId: string) => void
}) {
  const placement = task.placement
  return (
    <button type="button" className={`${css.taskCard} ${task.priority === 'p0' ? css.taskCardP0 : ''}`} onClick={() => { onSelect(task.id) }}>
      <div className={css.cardTop}>
        <PriorityBadge priority={task.priority} />
        <span className={css.statusBadge}>{acceptance ? '待人工验收' : executionLabel(task)}</span>
      </div>
      <strong className={css.cardTitle}>{task.title}</strong>
      {task.summary !== '' && <span className={css.cardSummary}>{task.summary}</span>}
      <div className={css.cardFacts}>
        {task.stage !== undefined && <Fact label="Stage" value={task.stage.title} />}
        {task.execution.provider !== undefined && <Fact label="Runner" value={task.execution.provider} />}
        {placement !== undefined && <Fact label="Node" value={placement.nodeName ?? placement.nodeId} warning={placement.nodeState !== 'online'} />}
      </div>
      <div className={css.cardBottom}>
        {acceptance ? (
          <span className={css.validationPassed}>自动验证已满足 · 点击查看证据</span>
        ) : (
          <span>{task.execution.runningThreadCount > 0 ? `${task.execution.runningThreadCount} Runner 运行中` : `${task.execution.threadCount} Thread`}</span>
        )}
        {placement?.stale === true && <span className={css.stale}>ENV STALE</span>}
      </div>
    </button>
  )
}

function PriorityBadge({ priority }: { readonly priority: 'p0' | 'p1' | 'p2' }) {
  const label = priority === 'p0' ? 'P0' : priority === 'p1' ? 'P1' : 'P2'
  const priorityClass = priority === 'p0' ? css.p0 : priority === 'p1' ? css.p1 : css.p2
  return <span className={`${css.priorityBadge} ${priorityClass}`}>{label}</span>
}

function Fact({ label, value, warning = false }: { readonly label: string; readonly value: string; readonly warning?: boolean }) {
  return <span className={`${css.fact} ${warning ? css.factWarning : ''}`}><small>{label}</small>{value}</span>
}

function TaskDetailDrawer({ detail, loading, decisionBusy, organizationBusy, onDecision, onOrganize, onClose }: {
  readonly detail: WorkConsoleTaskDetail | undefined
  readonly loading: boolean
  readonly decisionBusy: boolean
  readonly organizationBusy: boolean
  readonly onDecision: (
    detail: WorkConsoleTaskDetail,
    validator: WorkConsoleValidatorDetail,
    decision: 'accept' | 'return',
  ) => Promise<void>
  readonly onOrganize: (detail: WorkConsoleTaskDetail, taskType: WorkConsoleTaskType) => Promise<void>
  readonly onClose: () => void
}) {
  return (
    <div className={css.drawerBackdrop} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <aside className={css.drawer} aria-label="Task Detail">
        <button type="button" className={css.drawerClose} aria-label="关闭 Task Detail" onClick={onClose}>×</button>
        {detail === undefined ? (
          <div className={css.detailEmpty}>{loading ? '正在读取 Task Detail…' : 'Task Detail 暂不可用'}</div>
        ) : <TaskDetail detail={detail} decisionBusy={decisionBusy} organizationBusy={organizationBusy} onDecision={onDecision} onOrganize={onOrganize} />}
      </aside>
    </div>
  )
}

function TaskDetail({ detail, decisionBusy, organizationBusy, onDecision, onOrganize }: {
  readonly detail: WorkConsoleTaskDetail
  readonly decisionBusy: boolean
  readonly organizationBusy: boolean
  readonly onDecision: (
    detail: WorkConsoleTaskDetail,
    validator: WorkConsoleValidatorDetail,
    decision: 'accept' | 'return',
  ) => Promise<void>
  readonly onOrganize: (detail: WorkConsoleTaskDetail, taskType: WorkConsoleTaskType) => Promise<void>
}) {
  const { card } = detail
  const actionable = actionableUserValidator(detail)
  const [taskType, setTaskType] = useState<WorkConsoleTaskType>('custom')
  return (
    <>
      <div className={css.detailHeader}>
        <div className={css.cardTop}><PriorityBadge priority={card.priority} /><span className={css.statusBadge}>{statusLabel(card.status)}</span></div>
        <h2>{card.title}</h2>
        {card.summary !== '' && <p>{card.summary}</p>}
      </div>

      {card.status === 'unclaimed' && (
        <div className={css.acceptanceActions}>
          <div>
            <strong>组织执行</strong>
            <span>选择任务类型后生成确定性 Workflow / Validator；不会调用模型，也不会自动启动 Runner。</span>
          </div>
          <div>
            <label className={css.selectWrap}>
              <span className={css.srOnly}>任务类型</span>
              <select aria-label="任务类型" value={taskType} onChange={event => { setTaskType(event.currentTarget.value as WorkConsoleTaskType) }}>
                <option value="bug-fix">问题修复</option>
                <option value="ui-fix">UI 修复</option>
                <option value="feature">新功能</option>
                <option value="performance">性能优化</option>
                <option value="deployment">部署</option>
                <option value="research">技术研究</option>
                <option value="custom">自定义</option>
              </select>
            </label>
            <button type="button" className={css.acceptButton} disabled={organizationBusy} onClick={() => { void onOrganize(detail, taskType) }}>
              {organizationBusy ? '组织中…' : '确认组织'}
            </button>
          </div>
        </div>
      )}

      {actionable !== undefined && detail.validationGeneration !== undefined && (
        <div className={css.acceptanceActions}>
          <div>
            <strong>人工验收</strong>
            <span>先核对下面的 Evidence；通过后才会完成或进入下一个人工门禁。</span>
          </div>
          <div>
            <button type="button" disabled={decisionBusy} onClick={() => { void onDecision(detail, actionable, 'return') }}>
              {decisionBusy ? '处理中…' : '退回执行'}
            </button>
            <button type="button" className={css.acceptButton} disabled={decisionBusy} onClick={() => { void onDecision(detail, actionable, 'accept') }}>
              {decisionBusy ? '处理中…' : '通过验收'}
            </button>
          </div>
        </div>
      )}

      <DetailSection title="当前事实">
        <DetailGrid rows={[
          ['类型', card.taskType ?? '未分类'],
          ['Stage', card.stage?.title ?? '未设置'],
          ['Thread', String(card.execution.threadCount)],
          ['Runner', card.execution.provider ?? '未运行'],
          ['Node', card.placement?.nodeName ?? card.placement?.nodeId ?? '未绑定'],
          ['Environment', card.placement?.environmentName ?? card.placement?.environmentId ?? '未绑定'],
        ]} />
        {card.placement?.stale === true && <div className={css.detailWarning}>Environment Revision 已变化，继续执行前必须重新 Preflight / Bind。</div>}
      </DetailSection>

      <DetailSection title={`Execution Threads · ${detail.threads.length}`}>
        {detail.threads.length === 0 && <div className={css.muted}>暂无 ExecutionThread</div>}
        <div className={css.detailList}>
          {detail.threads.map(thread => {
            const attempt = thread.activeAttempt ?? thread.lastAttempt
            return (
              <div key={thread.id} className={css.detailRow}>
                <div><strong>{thread.state}</strong><code>{shortId(thread.id)}</code></div>
                {attempt !== undefined && <small>{attempt.provider} · {attempt.mode}</small>}
                {thread.blocker !== undefined && <small className={css.validationFailed}>{thread.blocker}</small>}
              </div>
            )
          })}
        </div>
      </DetailSection>

      <DetailSection title={`Validation${detail.validationGeneration === undefined ? '' : ` · Gen ${detail.validationGeneration}`}`}>
        {detail.validators.length === 0 && <div className={css.muted}>当前 Task 没有独立验收项</div>}
        <div className={css.detailList}>
          {detail.validators.map(validator => (
            <div key={validator.index} className={css.detailRow}>
              <div><strong>{validator.label}</strong><span>{validator.requirement}</span></div>
              <small className={validator.outcome === 'failed' ? css.validationFailed : validator.outcome === 'passed' ? css.validationPassed : css.muted}>
                {validator.outcome ?? 'pending'}{validator.source === 'user' && validator.actor !== undefined ? ` · ${validator.actor}` : ''}
              </small>
              {validator.evidence.map(evidence => <code key={`${evidence.kind}:${evidence.reference}`}>{evidence.reference}</code>)}
            </div>
          ))}
        </div>
      </DetailSection>

      <DetailSection title={`Environment · ${detail.environments.length}`}>
        {detail.environments.map(environment => (
          <div key={environment.id} className={css.environmentBlock}>
            <div><strong>{environment.name}</strong><span>{environment.state}</span></div>
            <code>{environment.workspace.path}</code>
            <small>{environment.runtime.os} · {environment.runtime.arch}</small>
          </div>
        ))}
      </DetailSection>
    </>
  )
}

function DetailSection({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return <section className={css.detailSection}><h3>{title}</h3>{children}</section>
}

function DetailGrid({ rows }: { readonly rows: ReadonlyArray<readonly [string, string]> }) {
  return (
    <div className={css.detailGrid}>
      {rows.map(([label, value]) => <div key={label}><small>{label}</small><span>{value}</span></div>)}
    </div>
  )
}

async function handleIdeaDrop(
  event: DragEvent<HTMLElement>,
  onDrop: (idea: { readonly id: string; readonly revision: number }) => Promise<void>,
): Promise<void> {
  event.preventDefault()
  const raw = event.dataTransfer.getData(IDEA_DRAG_TYPE)
  if (raw === '') return
  try {
    const value = JSON.parse(raw) as { id?: unknown; revision?: unknown }
    if (typeof value.id !== 'string' || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1) return
    await onDrop({ id: value.id, revision: Number(value.revision) })
  } catch {
    // Ignore unrelated/invalid drag payloads instead of turning them into work.
  }
}

function actionableUserValidator(detail: WorkConsoleTaskDetail): WorkConsoleValidatorDetail | undefined {
  if (detail.card.status !== 'validation' || detail.card.validation?.acceptanceState !== 'human-ready') return undefined
  return detail.validators.find(validator =>
    validator.kind === 'user-acceptance'
    && validator.requirement === 'required'
    && validator.outcome !== 'passed')
}

function filterIdeas(ideas: readonly WorkConsoleIdeaCard[], query: string): WorkConsoleIdeaCard[] {
  const needle = query.trim().toLocaleLowerCase()
  if (needle === '') return [...ideas]
  return ideas.filter(idea => [idea.title, idea.summary, ...idea.tags].join('\n').toLocaleLowerCase().includes(needle))
}

function filterTasks(snapshot: WorkConsoleSnapshot | undefined, query: string, priority: 'all' | 'p0' | 'p1' | 'p2'): WorkConsoleTaskCard[] {
  const needle = query.trim().toLocaleLowerCase()
  return (snapshot?.tasks ?? []).filter(task => {
    if (priority !== 'all' && task.priority !== priority) return false
    if (needle === '') return true
    return [
      task.title,
      task.summary,
      task.stage?.title,
      task.execution.provider,
      task.placement?.nodeName,
      task.placement?.nodeId,
      ...task.tags,
    ].filter((value): value is string => value !== undefined).join('\n').toLocaleLowerCase().includes(needle)
  })
}

function isHumanReady(task: WorkConsoleTaskCard): boolean {
  return task.status === 'validation' && task.validation?.acceptanceState === 'human-ready'
}

function executionLabel(task: WorkConsoleTaskCard): string {
  if (task.status === 'validation') {
    return task.validation?.acceptanceState === 'automated-failed' ? '自动验收失败' : '自动验收'
  }
  return statusLabel(task.status)
}

function statusLabel(status: WorkConsoleTaskCard['status']): string {
  const labels = { unclaimed: '待组织', running: '进行中', blocked: '阻塞', validation: '验收中', done: '完成' } as const
  return labels[status]
}

function parseTags(value: string): string[] {
  return [...new Set(value.split(',').map(tag => tag.trim()).filter(tag => tag !== ''))]
}

function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`
}
