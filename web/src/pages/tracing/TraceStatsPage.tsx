import { Activity } from 'lucide-react'
import { getTraceStats, listTraces } from '@/api/traces'
import DistributionChart from '@/components/charts/DistributionChart'
import StatCard from '@/components/charts/StatCard'
import TimeSeriesChart from '@/components/charts/TimeSeriesChart'
import PageContainer from '@/components/layout/PageContainer'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import EmptyState from '@/components/ui/EmptyState'
import { useAsyncResource } from '@/hooks/useAsyncResource'
import { asPaginated } from '@/lib/paginated'
import { formatTraceStatus } from '@/lib/labels'
import type { TraceStats } from '@/types'
import { formatCost, formatDuration, formatTokens } from '@/lib/utils'

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

async function loadTraceAnalytics(period: '1h' | '24h' | '7d' | '30d') {
  const [stats, traces] = await Promise.all([
    getTraceStats({ period }),
    listTraces({ page_size: 30 }),
  ])

  return {
    stats: stats ?? DEFAULT_TRACE_STATS,
    traces: asPaginated({ ...traces, items: traces?.traces }, 1, 30).items,
  }
}

export default function TraceStatsPage() {
  const period: '1h' | '24h' | '7d' | '30d' = '7d'
  const { data, loading, error, reload } = useAsyncResource(() => loadTraceAnalytics(period), [period])
  const stats = data?.stats ?? DEFAULT_TRACE_STATS
  const traces = data?.traces ?? []

  const durationSeries =
    traces
      .slice()
      .reverse()
      .map((trace, index) => ({
        name: `${index + 1}`,
        duration: trace.duration_ms,
      }))

  const statusDistribution = [
    { name: formatTraceStatus('ok'), value: traces.filter((trace) => trace.status === 'ok').length },
    { name: formatTraceStatus('error'), value: traces.filter((trace) => trace.status === 'error').length },
  ]

  return (
    <PageContainer
      title="Trace 分析"
      description="从更高层的视角查看吞吐、失败率和成本，在问题影响用户之前发现回归。"
    >
      {error ? (
        <EmptyState
          icon={<Activity className="h-6 w-6" />}
          title="无法加载 Trace 分析"
          description={error}
          action={<Button variant="secondary" onClick={() => void reload()}>重试</Button>}
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Trace 数" value={loading ? '...' : stats.trace_count} />
            <StatCard label="平均时长" value={loading ? '...' : formatDuration(stats.avg_duration_ms)} />
            <StatCard label="Token 总量" value={loading ? '...' : formatTokens(stats.total_tokens)} />
            <StatCard label="总成本" value={loading ? '...' : formatCost(stats.total_cost_usd)} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
            <Card className="p-6">
              <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">延迟曲线</p>
              <div className="mt-5">
                {durationSeries.length > 0 ? (
                  <TimeSeriesChart
                    data={durationSeries}
                    lines={[{ key: 'duration', color: '#ba5b2a', name: '时长 (ms)' }]}
                  />
                ) : (
                  <EmptyState
                    icon={<Activity className="h-6 w-6" />}
                    title="暂无 Trace 序列"
                    description="一旦 Trace 被索引，这里就会自动出现图表。"
                  />
                )}
              </div>
            </Card>

            <Card className="p-6">
              <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">状态分布</p>
              <div className="mt-5">
                <DistributionChart data={statusDistribution} color="#177245" />
              </div>
            </Card>
          </div>
        </>
      )}
    </PageContainer>
  )
}
