import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  WorkConsoleBoardStatus,
  WorkConsoleSnapshot,
  WorkConsoleTaskCard,
  WorkConsoleTaskDetail,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { WorkConsoleRootProps, WorkConsoleTriggerProps } from './contract.ts'
import css from './WorkConsoleRoot.module.css'

const POLL_MS = 5_000

const COLUMNS: ReadonlyArray<{ status: WorkConsoleBoardStatus; label: string }> = [
  { status: 'unclaimed', label: '待认领' },
  { status: 'running', label: '进行中' },
  { status: 'blocked', label: '阻塞' },
  { status: 'validation', label: '待确认' },
  { status: 'done', label: '完成' },
]

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

/** Frame-wide read-only global task board. */
export function WorkConsoleRoot({
  useStore,
  useWorkConsole,
  closeConsole,
  refreshConsole,
  selectTask,
  clearError,
}: WorkConsoleRootProps) {
  const open = useStore(state => state.open)
  const selectedTaskId = useStore(state => state.selectedTaskId)
  const remote = useWorkConsole(state => state)
  const [query, setQuery] = useState('')
  const [priority, setPriority] = useState<'all' | 'p0' | 'p1' | 'p2'>('all')
  const [runner, setRunner] = useState('all')
  const [node, setNode] = useState('all')

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
  const filtered = useMemo(() => filterTasks(snapshot, { query, priority, runner, node }), [snapshot, query, priority, runner, node])
  const runners = useMemo(() => unique(allTasks(snapshot).map(task => task.execution.provider)), [snapshot])
  const nodes = useMemo(() => unique(allTasks(snapshot).map(task => task.placement?.nodeName ?? task.placement?.nodeId)), [snapshot])

  if (!open) return null

  const detail = remote.detailTaskId === selectedTaskId ? remote.detail : undefined

  return (
    <div className={css.overlay} role="dialog" aria-modal="true" aria-label="持续工作控制台">
      <div className={css.surface}>
        <header className={css.header}>
          <div>
            <div className={css.eyebrow}>GLOBAL CONTINUOUS WORK</div>
            <div className={css.titleRow}>
              <h1 className={css.title}>持续工作控制台</h1>
              <span className={css.readOnly}>只读 V1</span>
            </div>
            <p className={css.subtitle}>跨任务、Runner、节点与环境的全局执行事实视图</p>
          </div>
          <div className={css.headerActions}>
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

        <ResourceStrip snapshot={snapshot} />

        <div className={css.filterRow}>
          <div className={css.filterLead}>全部任务 <span>{filtered.length}</span></div>
          <input
            className={css.search}
            value={query}
            placeholder="搜索任务 / Stage / Runner / Node"
            onChange={event => { setQuery(event.currentTarget.value) }}
          />
          <FilterSelect label="优先级" value={priority} onChange={value => { setPriority(value as typeof priority) }} options={[
            ['all', '全部优先级'], ['p0', 'P0 紧急'], ['p1', 'P1 高'], ['p2', 'P2 普通'],
          ]} />
          <FilterSelect label="Runner" value={runner} onChange={setRunner} options={[
            ['all', '全部 Runner'], ...runners.map(value => [value, value] as [string, string]),
          ]} />
          <FilterSelect label="Node" value={node} onChange={setNode} options={[
            ['all', '全部 Node'], ...nodes.map(value => [value, value] as [string, string]),
          ]} />
        </div>

        <main className={css.main}>
          <section className={css.board} aria-label="全局任务看板">
            {COLUMNS.map(column => (
              <BoardColumn
                key={column.status}
                status={column.status}
                label={column.label}
                tasks={filtered.filter(task => task.status === column.status)}
                selectedTaskId={selectedTaskId ?? undefined}
                onSelect={selectTask}
              />
            ))}
          </section>
          <TaskDetailPanel
            detail={detail}
            loading={remote.detailLoading && remote.detailTaskId === selectedTaskId}
            selectedTaskId={selectedTaskId ?? undefined}
          />
        </main>
      </div>
    </div>
  )
}

function ResourceStrip({ snapshot }: { readonly snapshot: WorkConsoleSnapshot | undefined }) {
  if (snapshot === undefined) {
    return <div className={css.resourceStrip}><div className={css.resourceSkeleton}>正在读取全局资源事实…</div></div>
  }
  const { resources, pending } = snapshot
  const nodeSecondary = resources.nodes.offline > 0
    ? `${resources.nodes.offline} 离线`
    : resources.nodes.degraded > 0 ? `${resources.nodes.degraded} 降级` : '全部在线'
  const environmentSecondary = resources.environments.unavailable > 0
    ? `${resources.environments.unavailable} 不可用`
    : resources.environments.degraded > 0 ? `${resources.environments.degraded} 降级` : '全部 Ready'
  return (
    <div className={css.resourceStrip}>
      <ResourceChip label="Nodes" primary={`${resources.nodes.online}/${resources.nodes.total}`} secondary={nodeSecondary} warning={resources.nodes.offline > 0 || resources.nodes.degraded > 0} />
      <ResourceChip label="Environments" primary={`${resources.environments.ready}/${resources.environments.total}`} secondary={environmentSecondary} warning={resources.environments.degraded > 0 || resources.environments.unavailable > 0} />
      {resources.runners.map(item => (
        <ResourceChip key={item.provider} label={item.provider} primary={`${item.onlineNodeCount}/${item.nodeCount}`} secondary="可用节点" warning={item.onlineNodeCount === 0} />
      ))}
      <div className={css.pendingBox}>
        <span className={css.pendingTitle}>Pending Center</span>
        <span>阻塞 <b>{pending.blockedTasks}</b></span>
        <span>待确认 <b>{pending.validationTasks}</b></span>
        <span>用户验收 <b>{pending.pendingUserAcceptance}</b></span>
      </div>
    </div>
  )
}

function ResourceChip({ label, primary, secondary, warning }: {
  readonly label: string
  readonly primary: string
  readonly secondary: string
  readonly warning?: boolean
}) {
  return (
    <div className={`${css.resourceChip} ${warning ? css.resourceWarning : ''}`}>
      <span className={css.resourceLabel}>{label}</span>
      <strong>{primary}</strong>
      <span className={css.resourceSecondary}>{secondary}</span>
    </div>
  )
}

function FilterSelect({ label, value, onChange, options }: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly options: ReadonlyArray<readonly [string, string]>
}) {
  return (
    <label className={css.selectWrap}>
      <span className={css.srOnly}>{label}</span>
      <select value={value} onChange={event => { onChange(event.currentTarget.value) }}>
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
    </label>
  )
}

function BoardColumn({ status, label, tasks, selectedTaskId, onSelect }: {
  readonly status: WorkConsoleBoardStatus
  readonly label: string
  readonly tasks: readonly WorkConsoleTaskCard[]
  readonly selectedTaskId: string | undefined
  readonly onSelect: (taskId: string) => void
}) {
  return (
    <div className={css.column} data-status={status}>
      <div className={css.columnHeader}>
        <span className={css.statusDot} />
        <strong>{label}</strong>
        <span className={css.columnCount}>{tasks.length}</span>
      </div>
      <div className={css.columnBody}>
        {tasks.length === 0 && <div className={css.emptyColumn}>暂无任务</div>}
        {tasks.map(task => (
          <TaskCard key={task.id} task={task} selected={task.id === selectedTaskId} onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}

function TaskCard({ task, selected, onSelect }: {
  readonly task: WorkConsoleTaskCard
  readonly selected: boolean
  readonly onSelect: (taskId: string) => void
}) {
  const placement = task.placement
  return (
    <button
      type="button"
      className={`${css.taskCard} ${selected ? css.taskCardSelected : ''} ${task.priority === 'p0' ? css.taskCardP0 : ''}`}
      onClick={() => { onSelect(task.id) }}
    >
      <div className={css.cardTop}>
        <PriorityBadge priority={task.priority} />
        {task.stage !== undefined && <span className={css.stageBadge}>{task.stage.title}</span>}
      </div>
      <div className={css.cardTitle}>{task.title}</div>
      {task.summary !== '' && <div className={css.cardSummary}>{task.summary}</div>}
      <div className={css.cardFacts}>
        {task.execution.provider !== undefined && <Fact label="Runner" value={task.execution.provider} />}
        {placement !== undefined && <Fact label="Node" value={placement.nodeName ?? placement.nodeId} warning={placement.nodeState !== 'online'} />}
        {placement !== undefined && <Fact label="Env" value={placement.environmentName ?? placement.environmentId} warning={placement.stale || placement.environmentState !== 'ready'} />}
      </div>
      <div className={css.cardBottom}>
        <span>{task.execution.runningThreadCount > 0 ? `${task.execution.runningThreadCount} Runner 运行中` : `${task.execution.threadCount} Thread`}</span>
        {task.validation !== undefined && (
          <span className={task.validation.state === 'failed' ? css.validationFailed : task.validation.state === 'passed' ? css.validationPassed : ''}>
            验收 {task.validation.requiredPassed}/{task.validation.requiredTotal}
          </span>
        )}
        {placement?.stale === true && <span className={css.stale}>ENV STALE</span>}
      </div>
    </button>
  )
}

function PriorityBadge({ priority }: { readonly priority: 'p0' | 'p1' | 'p2' }) {
  const label = priority === 'p0' ? 'P0 紧急' : priority === 'p1' ? 'P1 高' : 'P2 普通'
  const priorityClass = priority === 'p0' ? css.p0 : priority === 'p1' ? css.p1 : css.p2
  return <span className={`${css.priorityBadge} ${priorityClass}`}>{label}</span>
}

function Fact({ label, value, warning = false }: { readonly label: string; readonly value: string; readonly warning?: boolean }) {
  return <span className={`${css.fact} ${warning ? css.factWarning : ''}`}><small>{label}</small>{value}</span>
}

function TaskDetailPanel({ detail, loading, selectedTaskId }: {
  readonly detail: WorkConsoleTaskDetail | undefined
  readonly loading: boolean
  readonly selectedTaskId: string | undefined
}) {
  if (selectedTaskId === undefined) {
    return <aside className={css.detail}><div className={css.detailEmpty}>选择一个 Task 查看执行与验收事实</div></aside>
  }
  if (detail === undefined) {
    return <aside className={css.detail}><div className={css.detailEmpty}>{loading ? '正在读取 Task Detail…' : 'Task Detail 暂不可用'}</div></aside>
  }
  const { card } = detail
  return (
    <aside className={css.detail}>
      <div className={css.detailHeader}>
        <div className={css.detailBadges}><PriorityBadge priority={card.priority} /><span className={css.stageBadge}>{statusLabel(card.status)}</span></div>
        <h2>{card.title}</h2>
        {card.summary !== '' && <p>{card.summary}</p>}
      </div>

      <DetailSection title="当前状态">
        <DetailGrid rows={[
          ['类型', card.taskType ?? '未分类'],
          ['Stage', card.stage?.title ?? '未设置'],
          ['Thread', String(card.execution.threadCount)],
          ['当前 Runner', card.execution.provider ?? '未运行'],
          ['Node', card.placement?.nodeName ?? card.placement?.nodeId ?? '未绑定'],
          ['Environment', card.placement?.environmentName ?? card.placement?.environmentId ?? '未绑定'],
        ]} />
        {card.placement?.stale === true && <div className={css.detailWarning}>绑定的 Environment Revision 已过期，继续执行前应重新 Preflight / Bind。</div>}
      </DetailSection>

      <DetailSection title={`Execution Threads · ${detail.threads.length}`}>
        {detail.threads.length === 0 && <div className={css.muted}>暂无 ExecutionThread</div>}
        <div className={css.threadList}>
          {detail.threads.map(thread => {
            const attempt = thread.activeAttempt ?? thread.lastAttempt
            return (
              <div key={thread.id} className={css.threadRow}>
                <div><strong>{thread.state}</strong><span className={css.mono}>{shortId(thread.id)}</span></div>
                <div className={css.threadMeta}>
                  {attempt !== undefined && <span>{attempt.provider} · {attempt.mode}</span>}
                  {thread.blocker !== undefined && <span className={css.validationFailed}>{thread.blocker}</span>}
                </div>
              </div>
            )
          })}
        </div>
      </DetailSection>

      <DetailSection title={`Validation${detail.validationGeneration === undefined ? '' : ` · Gen ${detail.validationGeneration}`}`}>
        {detail.validators.length === 0 && <div className={css.muted}>当前 Task 没有独立验收项</div>}
        <div className={css.validatorList}>
          {detail.validators.map(validator => (
            <div key={validator.index} className={css.validatorRow}>
              <div className={css.validatorHead}>
                <span className={css.validatorRequirement}>{validator.requirement}</span>
                <strong>{validator.label}</strong>
                <span className={validator.outcome === 'failed' ? css.validationFailed : validator.outcome === 'passed' ? css.validationPassed : css.muted}>
                  {validator.outcome ?? 'pending'}
                </span>
              </div>
              {validator.evidence.map(evidence => (
                <div key={`${evidence.kind}:${evidence.reference}`} className={css.evidence}>
                  <span>{evidence.kind}</span><code>{evidence.reference}</code>
                  {evidence.summary !== undefined && <small>{evidence.summary}</small>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </DetailSection>

      <DetailSection title={`Environment · ${detail.environments.length}`}>
        {detail.environments.map(environment => (
          <div key={environment.id} className={css.environmentBlock}>
            <div className={css.environmentTitle}><strong>{environment.name}</strong><span>{environment.state} · rev {environment.revision}</span></div>
            <code className={css.path}>{environment.workspace.path}</code>
            <div className={css.environmentFacts}>
              <span>{environment.runtime.os}/{environment.runtime.arch}</span>
              {environment.workspace.branch !== undefined && <span>branch: {environment.workspace.branch}</span>}
              {environment.workspace.commit !== undefined && <span>commit: {shortId(environment.workspace.commit)}</span>}
              {environment.workspace.dirty === true && <span className={css.validationFailed}>dirty</span>}
            </div>
          </div>
        ))}
      </DetailSection>
    </aside>
  )
}

function DetailSection({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return <section className={css.detailSection}><h3>{title}</h3>{children}</section>
}

function DetailGrid({ rows }: { readonly rows: ReadonlyArray<readonly [string, string]> }) {
  return <div className={css.detailGrid}>{rows.map(([label, value]) => <div key={label}><small>{label}</small><span>{value}</span></div>)}</div>
}

function filterTasks(snapshot: WorkConsoleSnapshot | undefined, filters: {
  readonly query: string
  readonly priority: string
  readonly runner: string
  readonly node: string
}): WorkConsoleTaskCard[] {
  if (snapshot === undefined) return []
  const query = filters.query.trim().toLowerCase()
  return snapshot.tasks.filter(task => {
    if (filters.priority !== 'all' && task.priority !== filters.priority) return false
    if (filters.runner !== 'all' && task.execution.provider !== filters.runner) return false
    const nodeValue = task.placement?.nodeName ?? task.placement?.nodeId
    if (filters.node !== 'all' && nodeValue !== filters.node) return false
    if (query === '') return true
    return [task.title, task.summary, task.taskType, task.stage?.title, task.execution.provider, nodeValue, task.placement?.environmentName, ...task.tags]
      .filter((value): value is string => value !== undefined)
      .some(value => value.toLowerCase().includes(query))
  })
}

function allTasks(snapshot: WorkConsoleSnapshot | undefined): readonly WorkConsoleTaskCard[] {
  return snapshot?.tasks ?? []
}

function unique(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => value !== undefined && value !== ''))].sort()
}

function statusLabel(status: WorkConsoleBoardStatus): string {
  return COLUMNS.find(column => column.status === status)?.label ?? status
}

function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`
}
