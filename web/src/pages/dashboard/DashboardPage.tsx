import { Activity, AlertTriangle, Database, FlaskConical, Timer, Zap } from 'lucide-react'
import { listDatasets } from '@/api/datasets'
import { listEvaluators } from '@/api/evaluators'
import { listExperiments } from '@/api/experiments'
import { listMonitoringAlerts } from '@/api/monitoring'
import { getTraceStats, listTraces } from '@/api/traces'
import MetricCard from '@/components/charts/MetricCard'
import TimeSeriesChart from '@/components/charts/TimeSeriesChart'
import PageContainer from '@/components/layout/PageContainer'
import Badge from '@/components/ui/Badge'
import Card from '@/components/ui/Card'
import EmptyState from '@/components/ui/EmptyState'
import ScoreBadge from '@/components/ui/ScoreBadge'
import { useAsyncResource } from '@/hooks/useAsyncResource'
import { formatExperimentStatus } from '@/lib/labels'
import { formatDate, formatDuration, formatPercent, formatTokens } from '@/lib/utils'
import type { Dataset, Evaluator, Experiment, MonitorAlert, TraceListItem, TraceStats } from '@/types'

const DEFAULT_TRACE_STATS: TraceStats = {
  trace_count: 0,
  error_count: 0,
  avg_duration_ms: 0,
  p50_duration_ms: 0,
  p95_duration_ms: 0,
  p99_duration_ms: 0,
  total_tokens: 0,
  total_cost_usd: 0,
}

function ensureList<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : []
}

function ensureItems<T>(value: { items?: T[] | null } | T[] | null | undefined): T[] {
  if (Array.isArray(value)) {
    return value
  }
  return ensureList(value?.items)
}

async function loadDashboard() {
  const [traceStats, traceList, experiments, datasets, evaluators, alerts] = await Promise.all([
    getTraceStats({ period: '7d' }),
    listTraces({ page_size: 12 }),
    listExperiments({ page_size: 8 }),
    listDatasets({ page_size: 6 }),
    listEvaluators({ page_size: 100 }),
    listMonitoringAlerts({ page_size: 5 }).catch(() => ({ items: [], total: 0, page: 1, page_size: 5, total_pages: 0 })),
  ])

  return {
    traceStats: traceStats ?? DEFAULT_TRACE_STATS,
    traces: ensureList(traceList?.traces),
    experiments: ensureItems(experiments),
    datasets: ensureItems(datasets),
    evaluators: ensureItems(evaluators),
    alerts: ensureItems(alerts),
  }
}

export default function DashboardPage() {
  const { data, loading, error, reload } = useAsyncResource(loadDashboard, [])
  const traceStats = data?.traceStats ?? DEFAULT_TRACE_STATS
  const traces: TraceListItem[] = data?.traces ?? []
  const experiments: Experiment[] = data?.experiments ?? []
  const datasets: Dataset[] = data?.datasets ?? []
  const evaluators: Evaluator[] = data?.evaluators ?? []
  const alerts: MonitorAlert[] = data?.alerts ?? []

  const traceSeries =
    traces
      .slice()
      .reverse()
      .map((trace, index) => ({
        name: `${index + 1}`,
        duration: trace.duration_ms,
        tokens: trace.total_tokens,
      }))

  const latestExperimentScore = experiments[0]?.summary
    ? (Object.values(experiments[0].summary.avg_scores)[0] ?? undefined)
    : undefined

  return (
    <PageContainer
      title="总览控制台"
      description="用更清晰的视图查看 Trace 质量、Evaluator 覆盖度和回归健康度。"
    >
      {error ? (
        <EmptyState
          icon={<Activity className="h-6 w-6" />}
          title="无法加载概览数据"
          description={error}
          action={
            <button
              type="button"
              onClick={() => void reload()}
              className="rounded-full border border-[color:var(--color-line)] bg-white px-4 py-2 text-sm font-medium text-[color:var(--color-text)]"
            >
              重试
            </button>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Trace（7天）"
              value={loading ? '...' : `${traceStats.trace_count}`}
              icon={<Activity className="h-5 w-5" />}
            />
            <MetricCard
              label="错误率"
              value={
                loading
                  ? '...'
                  : formatPercent(traceStats.error_count / Math.max(traceStats.trace_count, 1), 1)
              }
              icon={<Zap className="h-5 w-5" />}
            />
            <MetricCard
              label="延迟 p95"
              value={loading ? '...' : formatDuration(traceStats.p95_duration_ms)}
              icon={<Timer className="h-5 w-5" />}
            />
            <MetricCard
              label="Dataset"
              value={loading ? '...' : `${datasets.length}`}
              icon={<Database className="h-5 w-5" />}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
            <Card className="p-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.7)]">
                    最近 Trace
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[color:var(--color-text)]">
                    不必点开每次运行，也能快速看见吞吐和延迟
                  </h2>
                </div>
                {latestExperimentScore !== undefined && (
                  <div className="rounded-[22px] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] px-4 py-3">
                    <p className="text-[0.68rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.64)]">
                      最近回归
                    </p>
                    <div className="mt-2 flex items-center gap-3">
                      <ScoreBadge score={latestExperimentScore} />
                      <span className="text-sm text-[color:var(--color-text-soft)]">
                        {experiments[0]?.name ?? '暂无 Experiment'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
              <div className="mt-6">
                {traceSeries.length > 0 ? (
                  <TimeSeriesChart
                    data={traceSeries}
                    lines={[
                      { key: 'duration', color: '#ba5b2a', name: '时长 (ms)' },
                      { key: 'tokens', color: '#177245', name: 'Token' },
                    ]}
                    yFormatter={(value) => `${Math.round(value)}`}
                  />
                ) : (
                  <EmptyState
                    icon={<Activity className="h-6 w-6" />}
                    title="暂无 Trace 历史"
                    description="运行演示 agent，或给应用接入埋点后，这里就会出现 Trace 时间线。"
                  />
                )}
              </div>
            </Card>

            <div className="grid gap-4">
              <Card className="p-6">
                <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.7)]">
                  Experiment 状态
                </p>
                <div className="mt-4 space-y-3">
                  {experiments.length ? (
                    experiments.map((experiment) => (
                      <div
                        key={experiment.id}
                        className="flex items-center justify-between rounded-[22px] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] px-4 py-3"
                      >
                        <div>
                          <p className="font-medium text-[color:var(--color-text)]">{experiment.name}</p>
                          <p className="mt-1 text-sm text-[color:var(--color-text-soft)]">
                            {formatDate(experiment.created_at)}
                          </p>
                        </div>
                        <Badge
                          variant={
                            experiment.status === 'completed'
                              ? 'success'
                              : experiment.status === 'failed'
                                ? 'danger'
                                : 'warning'
                          }
                        >
                          {formatExperimentStatus(experiment.status)}
                        </Badge>
                      </div>
                    ))
                  ) : (
                    <EmptyState
                      icon={<FlaskConical className="h-6 w-6" />}
                      title="暂无 Experiment"
                      description="创建一个 Experiment，把目标服务和当前 Dataset 做对比。"
                    />
                  )}
                </div>
              </Card>

              <Card className="p-6">
                <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.7)]">
                  覆盖快照
                </p>
                <div className="mt-4 space-y-4">
                  <div className="rounded-[22px] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] px-4 py-4">
                    <p className="text-sm text-[color:var(--color-text-soft)]">工作区内 Dataset</p>
                    <p className="mt-2 text-3xl font-bold tracking-[-0.05em] text-[color:var(--color-text)]">
                      {loading ? '...' : datasets.length}
                    </p>
                  </div>
                  <div className="rounded-[22px] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] px-4 py-4">
                    <p className="text-sm text-[color:var(--color-text-soft)]">启用中的 Evaluator</p>
                    <p className="mt-2 text-3xl font-bold tracking-[-0.05em] text-[color:var(--color-text)]">
                      {loading ? '...' : evaluators.length}
                    </p>
                  </div>
                  <div className="rounded-[22px] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] px-4 py-4">
                    <p className="text-sm text-[color:var(--color-text-soft)]">Token 总量</p>
                    <p className="mt-2 text-3xl font-bold tracking-[-0.05em] text-[color:var(--color-text)]">
                      {loading ? '...' : formatTokens(traceStats.total_tokens)}
                    </p>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          {experiments.length ? (
            <Card className="p-6">
              <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.7)]">
                质量趋势（最近 Experiment 平均分）
              </p>
              <div className="mt-4">
                <TimeSeriesChart
                  data={experiments
                    .filter((exp) => exp.summary?.avg_scores)
                    .slice(0, 8)
                    .reverse()
                    .map((exp) => {
                      const scores = exp.summary?.avg_scores ?? {}
                      const avg = Object.values(scores).length
                        ? Object.values(scores).reduce((a, b) => a + b, 0) / Object.values(scores).length
                        : 0
                      return { name: exp.name.slice(0, 12), avg_score: Math.round(avg * 100) / 100 }
                    })}
                  lines={[{ key: 'avg_score', color: '#2e7d52', name: '平均分' }]}
                  yFormatter={(value) => `${value}`}
                />
              </div>
            </Card>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
            <Card className="p-6">
              <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.7)]">
                最近告警
              </p>
              <div className="mt-4 space-y-3">
                {alerts.length > 0 ? (
                  alerts.map((alert) => (
                    <div
                      key={alert.id}
                      className="flex items-center justify-between rounded-[22px] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] px-4 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <AlertTriangle className={`h-4 w-4 ${alert.severity === 'critical' ? 'text-[#b65145]' : 'text-[#b68a2a]'}`} />
                        <div>
                          <p className="font-medium text-[color:var(--color-text)]">{alert.title}</p>
                          <p className="mt-0.5 text-sm text-[color:var(--color-text-soft)]">{alert.summary}</p>
                        </div>
                      </div>
                      <Badge variant={alert.status === 'resolved' ? 'default' : 'danger'}>
                        {alert.status === 'resolved' ? '已处理' : '待处理'}
                      </Badge>
                    </div>
                  ))
                ) : (
                  <EmptyState
                    icon={<AlertTriangle className="h-6 w-6" />}
                    title="暂无告警"
                    description="在监控页面配置规则后，告警会出现在这里。"
                  />
                )}
              </div>
            </Card>

            <Card className="p-6">
              <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.7)]">
                最近 Dataset
              </p>
              <div className="mt-4 space-y-3">
                {datasets.length ? (
                  datasets.map((dataset) => (
                    <div
                      key={dataset.id}
                      className="flex items-center justify-between rounded-[22px] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] px-4 py-3"
                    >
                      <div>
                        <p className="font-medium text-[color:var(--color-text)]">{dataset.name}</p>
                        <p className="mt-1 text-sm text-[color:var(--color-text-soft)]">{dataset.example_count} 条样本</p>
                      </div>
                      <Badge variant="info">v{dataset.current_version}</Badge>
                    </div>
                  ))
                ) : (
                  <EmptyState icon={<Database className="h-6 w-6" />} title="暂无 Dataset" description="创建第一个评测用 Dataset。" />
                )}
              </div>
            </Card>
          </div>
        </>
      )}
    </PageContainer>
  )
}
