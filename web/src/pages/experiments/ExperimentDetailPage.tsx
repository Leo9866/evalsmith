import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ExternalLink, FlaskConical } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { cancelExperiment, compareExperiments, getExperiment, getExperimentBaseline, getExperimentResults, setExperimentBaseline } from '@/api/experiments'
import DistributionChart from '@/components/charts/DistributionChart'
import StatCard from '@/components/charts/StatCard'
import PageContainer from '@/components/layout/PageContainer'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import CodeBlock from '@/components/ui/CodeBlock'
import EmptyState from '@/components/ui/EmptyState'
import Pagination from '@/components/ui/Pagination'
import ScoreBadge from '@/components/ui/ScoreBadge'
import Select from '@/components/ui/Select'
import Table, { type Column } from '@/components/ui/Table'
import Tabs from '@/components/ui/Tabs'
import { useAsyncResource } from '@/hooks/useAsyncResource'
import { applySearchParamPatch, readPositiveIntParam } from '@/lib/searchParams'
import { formatExperimentStatus, formatSplit } from '@/lib/labels'
import { toast } from '@/stores/toast'
import type { CompareResponse, ExperimentResult } from '@/types'
import { formatDate, formatDuration, toPrettyJson, truncate } from '@/lib/utils'

function buildResultQuery(sortBy: string, maxScore: string, page: number) {
  const params: {
    page: number
    page_size: number
    sort_by?: 'created_at' | 'latency_ms' | 'score'
    sort_order?: 'asc' | 'desc'
    max_score?: number
  } = {
    page,
    page_size: 20,
  }

  if (sortBy === 'score_asc') {
    params.sort_by = 'score'
    params.sort_order = 'asc'
  } else if (sortBy === 'score_desc') {
    params.sort_by = 'score'
    params.sort_order = 'desc'
  } else if (sortBy === 'latency_desc') {
    params.sort_by = 'latency_ms'
    params.sort_order = 'desc'
  } else if (sortBy === 'latency_asc') {
    params.sort_by = 'latency_ms'
    params.sort_order = 'asc'
  }

  if (maxScore) {
    const parsed = Number.parseFloat(maxScore)
    if (Number.isFinite(parsed)) {
      params.max_score = parsed
    }
  }

  return params
}

async function loadExperimentDetail(experimentId: string, page: number, sortBy: string, maxScore: string) {
  const [experiment, results] = await Promise.all([
    getExperiment(experimentId),
    getExperimentResults(experimentId, buildResultQuery(sortBy, maxScore, page)),
  ])

  return {
    experiment,
    results,
  }
}

const ACTIVE_STATUSES = new Set(['pending', 'running', 'cancel_requested'])

export default function ExperimentDetailPage() {
  const { id = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') || 'results'
  const resultSortBy = searchParams.get('sort_by') || ''
  const resultMaxScore = searchParams.get('max_score') || ''
  const resultPage = readPositiveIntParam(searchParams.get('page'))
  const setParams = (updates: Record<string, string | null | undefined>, options?: { resetPage?: boolean }) => {
    setSearchParams(applySearchParamPatch(searchParams, updates, options))
  }
  const { data, loading, error, reload } = useAsyncResource(
    () => loadExperimentDetail(id, resultPage, resultSortBy, resultMaxScore),
    [id, resultPage, resultSortBy, resultMaxScore]
  )

  useEffect(() => {
    if (!data) return undefined
    if (!ACTIVE_STATUSES.has(data.experiment.status)) return undefined
    const timer = window.setTimeout(() => {
      void reload()
    }, 2500)
    return () => window.clearTimeout(timer)
  }, [data, reload])

  const scoreDistribution = useMemo(
    () =>
      data?.experiment.summary
        ? Object.entries(data.experiment.summary.avg_scores).map(([name, value]) => ({ name, value }))
        : [],
    [data?.experiment.summary]
  )

  const resultColumns: Column<ExperimentResult>[] = [
    {
      key: 'input',
      header: '输入',
      render: (result) => (
        <div>
          <p className="font-medium">{truncate(toPrettyJson(result.input), 120)}</p>
          <p className="mt-1 text-sm text-[color:var(--color-text-soft)]">{formatSplit(result.split)}</p>
        </div>
      ),
    },
    {
      key: 'expected_output',
      header: '期望输出',
      render: (result) => <span>{truncate(toPrettyJson(result.expected_output), 96)}</span>,
    },
    {
      key: 'actual_output',
      header: '实际输出',
      render: (result) => <span>{truncate(toPrettyJson(result.actual_output), 96)}</span>,
    },
    {
      key: 'scores',
      header: '分数',
      render: (result) => (
        <div className="flex flex-wrap gap-2">
          {result.scores.map((score) => (
            <ScoreBadge key={`${result.id}-${score.evaluator_name}`} score={score.score} />
          ))}
        </div>
      ),
    },
    {
      key: 'latency',
      header: '延迟',
      render: (result) => <span>{formatDuration(result.latency_ms)}</span>,
    },
  ]

  if (error) {
    return (
      <PageContainer title="Experiment 详情" description="跟踪结果质量、得分与逐样本表现。">
        <EmptyState
          icon={<FlaskConical className="h-6 w-6" />}
          title="无法加载 Experiment"
          description={error}
          action={<Button variant="secondary" onClick={() => void reload()}>重试</Button>}
        />
      </PageContainer>
    )
  }

  const experiment = data?.experiment

  const handleCancel = async () => {
    if (!experiment) return
    try {
      await cancelExperiment(experiment.id)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '取消 Experiment 失败', '取消 Experiment 失败')
    }
  }

  const handleSetBaseline = async () => {
    if (!experiment) return
    try {
      await setExperimentBaseline(experiment.id, experiment.dataset_id)
      await reload()
      toast.success('已设为基线')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '设置基线失败', '设置基线失败')
    }
  }

  return (
    <PageContainer
      title={experiment?.name ?? 'Experiment 详情'}
      description={experiment?.description || '跟踪结果质量、得分与逐样本表现。'}
      actions={
        experiment && (
          <>
            <Button variant="ghost" onClick={() => void handleSetBaseline()}>
              {experiment.is_baseline ? '当前基线' : '设为基线'}
            </Button>
            {ACTIVE_STATUSES.has(experiment.status) ? (
              <Button variant="secondary" onClick={() => void handleCancel()}>
                请求取消
              </Button>
            ) : null}
            <Link to="/experiments/compare">
              <Button variant="secondary">去对比</Button>
            </Link>
            <Badge
              variant={
                experiment.status === 'completed'
                  ? 'success'
                  : experiment.status === 'failed'
                    ? 'danger'
                    : experiment.status === 'canceled'
                      ? 'default'
                    : 'warning'
              }
            >
              {formatExperimentStatus(experiment.status)}
            </Badge>
          </>
        )
      }
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="状态" value={experiment ? formatExperimentStatus(experiment.status) : '...'} />
        <StatCard
          label="样本数"
          value={experiment?.summary ? `${experiment.summary.completed}/${experiment.summary.total_examples}` : '...'}
        />
        <StatCard
          label="延迟 p90"
          value={experiment?.summary ? formatDuration(experiment.summary.latency_p90_ms) : '...'}
        />
        <StatCard label="创建时间" value={formatDate(experiment?.created_at)} />
      </div>

      {experiment?.last_error ? (
        <Card className="border-[color:rgba(182,81,69,0.22)] bg-[color:rgba(182,81,69,0.05)] p-5">
          <p className="text-sm font-semibold text-[color:#b65145]">最近错误</p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-[color:var(--color-text-soft)]">{experiment.last_error}</p>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <Card className="p-6">
          <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">平均分数</p>
          <div className="mt-4">
            {scoreDistribution.length > 0 ? (
              <DistributionChart data={scoreDistribution} />
            ) : (
              <EmptyState icon={<FlaskConical className="h-6 w-6" />} title="暂无汇总结果" description="等运行完成后显示。" />
            )}
          </div>
        </Card>
        <Card className="p-6">
          <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">执行配置</p>
          <div className="mt-4 space-y-3 text-sm">
            <div>
              <p className="font-medium text-[color:var(--color-text)]">Target URL</p>
              <p className="mt-1 break-all text-[color:var(--color-text-soft)]">
                {experiment?.target_method} {experiment?.target_url}
              </p>
            </div>
            <div>
              <p className="font-medium text-[color:var(--color-text)]">响应提取路径</p>
              <p className="mt-1 break-all text-[color:var(--color-text-soft)]">
                {experiment?.target_response_path || '自动识别常见字段'}
              </p>
            </div>
            <div>
              <p className="font-medium text-[color:var(--color-text)]">超时 / 并发</p>
              <p className="mt-1 text-[color:var(--color-text-soft)]">
                {experiment?.target_timeout_ms ? `${experiment.target_timeout_ms} ms` : '120000 ms'} / {experiment?.concurrency ?? 0}
              </p>
            </div>
            <div>
              <p className="font-medium text-[color:var(--color-text)]">请求头</p>
              <p className="mt-1 text-[color:var(--color-text-soft)]">
                {experiment?.target_headers && Object.keys(experiment.target_headers).length
                  ? Object.keys(experiment.target_headers).join(', ')
                  : '无额外请求头'}
              </p>
            </div>
            <div>
              <p className="font-medium text-[color:var(--color-text)]">请求模板</p>
              <div className="mt-2">
                <CodeBlock>{experiment?.target_body_template || null}</CodeBlock>
              </div>
            </div>
            {experiment?.prompt_snapshot ? (
              <div>
                <p className="font-medium text-[color:var(--color-text)]">绑定 Prompt</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant="info">{experiment.prompt_snapshot.prompt_name}</Badge>
                  <Badge variant="default">v{experiment.prompt_snapshot.version}</Badge>
                </div>
                <div className="mt-3 grid gap-3">
                  <CodeBlock>{{
                    system_prompt: experiment.prompt_snapshot.system_prompt,
                    user_prompt_template: experiment.prompt_snapshot.user_prompt_template,
                  }}</CodeBlock>
                </div>
              </div>
            ) : null}
            <div>
              <p className="font-medium text-[color:var(--color-text)]">Evaluator</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {experiment?.evaluator_ids.map((evalId) => <Badge key={evalId} variant="default">{evalId}</Badge>)}
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Tabs
        tabs={[
          { key: 'results', label: '结果表格', count: data?.results.total },
          { key: 'distribution', label: '分数分布' },
          { key: 'failures', label: '失败分析' },
          { key: 'slices', label: '分片分析' },
          { key: 'baseline', label: '基线对比' },
        ]}
        active={tab}
        onChange={(nextTab) => setParams({ tab: nextTab || null })}
      />

      {tab === 'results' && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <Select
              value={resultSortBy}
              onChange={(event) => setParams({ sort_by: event.target.value || null }, { resetPage: true })}
              options={[
                { value: '', label: '默认排序' },
                { value: 'score_asc', label: '分数升序' },
                { value: 'score_desc', label: '分数降序' },
                { value: 'latency_desc', label: '延迟降序' },
                { value: 'latency_asc', label: '延迟升序' },
              ]}
            />
            <Select
              value={resultMaxScore}
              onChange={(event) => setParams({ max_score: event.target.value || null }, { resetPage: true })}
              options={[
                { value: '', label: '全部分数' },
                { value: '0.3', label: '低分（< 0.3）' },
                { value: '0.5', label: '中低分（< 0.5）' },
                { value: '0.8', label: '非高分（< 0.8）' },
              ]}
            />
          </div>
          <Table
            columns={resultColumns}
            data={data?.results.items ?? []}
            loading={loading}
            emptyMessage="暂无结果"
          />
          <Pagination
            page={data?.results.page ?? resultPage}
            totalPages={Math.max(1, data?.results.total_pages ?? Math.ceil((data?.results.total ?? 0) / Math.max(data?.results.page_size ?? 20, 1)))}
            total={data?.results.total ?? 0}
            pageSize={data?.results.page_size ?? 20}
            onPageChange={(nextPage) => setParams({ page: String(nextPage) })}
          />
          {data?.results.items.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {data.results.items.slice(0, 4).map((result) => (
                <Card key={result.id} className="p-6">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">样本 {result.example_id}</p>
                    {result.trace_id && (
                      <Link to={`/tracing/${result.trace_id}`} className="inline-flex items-center gap-2 text-sm text-[color:var(--color-text-soft)] hover:text-[color:var(--color-text)]">
                        Trace <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>
                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div><p className="mb-1 text-sm font-medium">输入</p><CodeBlock>{result.input ?? null}</CodeBlock></div>
                    <div><p className="mb-1 text-sm font-medium">实际输出</p><CodeBlock>{result.actual_output ?? null}</CodeBlock></div>
                  </div>
                </Card>
              ))}
            </div>
          ) : null}
        </>
      )}

      {tab === 'distribution' && (
        <ScoreDistributionTab results={data?.results.items ?? []} />
      )}

      {tab === 'failures' && (
        <FailureAnalysisTab results={data?.results.items ?? []} />
      )}

      {tab === 'slices' && (
        <SliceAnalysisTab results={data?.results.items ?? []} />
      )}

      {tab === 'baseline' && (
        <BaselineCompareTab experimentId={id} datasetId={experiment?.dataset_id} isBaseline={experiment?.is_baseline} />
      )}
    </PageContainer>
  )
}

function buildHistogram(scores: number[]): Array<{ bin: string; count: number }> {
  const bins = Array.from({ length: 10 }, (_, i) => ({ bin: `${(i / 10).toFixed(1)}`, count: 0 }))
  for (const s of scores) {
    const idx = Math.min(Math.floor(s * 10), 9)
    bins[idx].count++
  }
  return bins
}

function ScoreDistributionTab({ results }: { results: ExperimentResult[] }) {
  const evaluatorNames = useMemo(() => {
    const names = new Set<string>()
    for (const r of results) {
      for (const s of r.scores) names.add(s.evaluator_name)
    }
    return Array.from(names)
  }, [results])

  if (!results.length) {
    return <EmptyState icon={<FlaskConical className="h-6 w-6" />} title="暂无数据" description="等实验完成后查看分数分布。" />
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {evaluatorNames.map((name) => {
        const scores = results.flatMap((r) => r.scores.filter((s) => s.evaluator_name === name).map((s) => s.score))
        const histogram = buildHistogram(scores)
        const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) : 0
        return (
          <Card key={name} className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-[color:var(--color-text)]">{name}</p>
              <span className="text-sm text-[color:var(--color-text-soft)]">avg {avg.toFixed(3)}</span>
            </div>
            <div className="mt-4 h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={histogram} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(93,83,73,0.12)" />
                  <XAxis dataKey="bin" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="rgba(193,109,58,0.6)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )
      })}
    </div>
  )
}

function FailureAnalysisTab({ results }: { results: ExperimentResult[] }) {
  const threshold = 0.5
  const failures = useMemo(() => {
    return results.filter((r) => r.scores.some((s) => s.score < threshold))
  }, [results])

  const byEvaluator = useMemo(() => {
    const map: Record<string, number> = {}
    for (const r of failures) {
      for (const s of r.scores) {
        if (s.score < threshold) {
          map[s.evaluator_name] = (map[s.evaluator_name] ?? 0) + 1
        }
      }
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [failures])

  if (!failures.length) {
    return <EmptyState icon={<FlaskConical className="h-6 w-6" />} title="没有低分样本" description={`所有样本分数均 >= ${threshold}。`} />
  }

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <p className="text-sm font-semibold text-[color:var(--color-text)]">低分汇总（score &lt; {threshold}）</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {byEvaluator.map(([name, count]) => (
            <div key={name} className="rounded-[1rem] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] px-4 py-3">
              <p className="text-lg font-bold text-[color:#b65145]">{count}</p>
              <p className="text-sm text-[color:var(--color-text-soft)]">{name}</p>
            </div>
          ))}
        </div>
      </Card>

      <p className="text-sm text-[color:var(--color-text-soft)]">低分样本（前 20 条）</p>
      {failures.slice(0, 20).map((result) => (
        <Card key={result.id} className="p-5">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-medium text-[color:var(--color-text)]">{truncate(toPrettyJson(result.input), 100)}</p>
            <div className="flex gap-2">
              {result.scores.map((s) => <ScoreBadge key={s.evaluator_name} score={s.score} />)}
            </div>
          </div>
          {result.scores.filter((s) => s.score < threshold).map((s) => (
            <p key={s.evaluator_name} className="mt-2 text-sm text-[color:var(--color-text-soft)]">
              <span className="font-medium">{s.evaluator_name}:</span> {s.reasoning}
            </p>
          ))}
        </Card>
      ))}
    </div>
  )
}

function BaselineCompareTab({ experimentId, datasetId, isBaseline }: { experimentId: string; datasetId?: string; isBaseline?: boolean }) {
  const [compareData, setCompareData] = useState<CompareResponse | null>(null)
  const [compareLoading, setCompareLoading] = useState(false)
  const [compareError, setCompareError] = useState('')
  const { data: baseline, loading: baselineLoading, error: baselineError } = useAsyncResource(
    () => (datasetId ? getExperimentBaseline(datasetId) : Promise.resolve(null)),
    [datasetId]
  )

  useEffect(() => {
    setCompareData(null)
    setCompareError('')
  }, [experimentId, datasetId, baseline?.experiment_id])

  const handleCompare = async () => {
    if (!baseline?.experiment_id) return
    setCompareLoading(true)
    setCompareError('')
    try {
      const result = await compareExperiments([baseline.experiment_id, experimentId], baseline.experiment_id)
      setCompareData(result)
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : '对比失败')
    } finally {
      setCompareLoading(false)
    }
  }

  useEffect(() => {
    if (!baseline?.experiment_id || baseline.experiment_id === experimentId || compareData || compareLoading) {
      return
    }
    void handleCompare()
  }, [baseline?.experiment_id, compareData, compareLoading, experimentId])

  if (!datasetId) {
    return <EmptyState icon={<FlaskConical className="h-6 w-6" />} title="缺少 Dataset 信息" description="当前实验没有关联 Dataset，暂时无法加载基线对比。" />
  }

  if (baselineLoading) {
    return <Card className="p-6 text-center text-sm text-[color:var(--color-text-soft)]">正在加载基线信息...</Card>
  }

  if (baselineError) {
    return <EmptyState icon={<FlaskConical className="h-6 w-6" />} title="无法加载基线信息" description={baselineError} />
  }

  if (isBaseline || baseline?.experiment_id === experimentId) {
    return <EmptyState icon={<FlaskConical className="h-6 w-6" />} title="当前实验是基线" description="基线实验无法与自身对比，请在其他实验中查看对比结果。" />
  }

  if (!baseline?.experiment_id) {
    return (
      <Card className="p-6 text-center">
        <p className="text-sm text-[color:var(--color-text-soft)]">当前 Dataset 还没有设置基线，先在 Experiment 列表或对比台中设定一个基线实验。</p>
      </Card>
    )
  }

  if (!compareData && !compareLoading) {
    return (
      <Card className="p-6 text-center">
        <p className="text-sm text-[color:var(--color-text-soft)]">点击下方按钮，将当前实验与该 Dataset 的基线进行对比。</p>
        <div className="mt-4">
          <Button variant="secondary" onClick={() => void handleCompare()}>
            加载对比
          </Button>
        </div>
        {compareError && <p className="mt-3 text-sm text-[color:#b65145]">{compareError}</p>}
      </Card>
    )
  }

  if (compareLoading) {
    return <Card className="p-6 text-center text-sm text-[color:var(--color-text-soft)]">正在加载对比数据...</Card>
  }

  if (!compareData) return null

  return (
    <div className="space-y-4">
      {compareData.evaluator_deltas.length > 0 && (
        <Card className="p-6">
          <p className="text-sm font-semibold text-[color:var(--color-text)]">Evaluator 级对比</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[color:var(--color-line)] text-left text-[color:var(--color-text-soft)]">
                  <th className="pb-2 pr-4">Evaluator</th>
                  <th className="pb-2 pr-4">基线分数</th>
                  <th className="pb-2 pr-4">当前分数</th>
                  <th className="pb-2 pr-4">变化</th>
                  <th className="pb-2">回退样本</th>
                </tr>
              </thead>
              <tbody>
                {compareData.evaluator_deltas.map((d) => (
                  <tr key={d.evaluator_name} className="border-b border-[color:var(--color-line)]">
                    <td className="py-2 pr-4 font-medium">{d.evaluator_name}</td>
                    <td className="py-2 pr-4">{d.baseline_score.toFixed(3)}</td>
                    <td className="py-2 pr-4">{d.candidate_score.toFixed(3)}</td>
                    <td className={`py-2 pr-4 ${d.delta < 0 ? 'text-[color:#b65145]' : 'text-[color:#2e7d52]'}`}>
                      {d.delta > 0 ? '+' : ''}{d.delta.toFixed(3)}
                    </td>
                    <td className="py-2">{d.regressed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {compareData.sample_diffs.length > 0 && (
        <Card className="p-6">
          <p className="text-sm font-semibold text-[color:var(--color-text)]">逐样本差异（前 {compareData.sample_diffs.length} 条）</p>
          <div className="mt-4 space-y-3">
            {compareData.sample_diffs.map((d) => (
              <div key={d.example_id} className="rounded-[1rem] border border-[color:var(--color-line)] px-4 py-3">
                <div className="flex items-center gap-3">
                  <Badge variant={d.verdict === 'regressed' ? 'danger' : d.verdict === 'improved' ? 'success' : 'default'}>
                    {d.verdict === 'regressed' ? '回退' : d.verdict === 'improved' ? '提升' : '持平'}
                  </Badge>
                  <span className="text-sm text-[color:var(--color-text-soft)]">样本 {d.example_id}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

function SliceAnalysisTab({ results }: { results: ExperimentResult[] }) {
  const [groupBy, setGroupBy] = useState('split')

  const metadataKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const r of results) {
      if (r.metadata && typeof r.metadata === 'object') {
        for (const k of Object.keys(r.metadata)) keys.add(k)
      }
    }
    return ['split', ...Array.from(keys)]
  }, [results])

  const slices = useMemo(() => {
    const groups: Record<string, { count: number; totalScore: number; passCount: number }> = {}
    for (const r of results) {
      const value = groupBy === 'split'
        ? (r.split || 'default')
        : String((r.metadata as Record<string, unknown>)?.[groupBy] ?? 'unknown')
      if (!groups[value]) groups[value] = { count: 0, totalScore: 0, passCount: 0 }
      groups[value].count++
      const avgScore = r.scores.length ? r.scores.reduce((sum, s) => sum + s.score, 0) / r.scores.length : 0
      groups[value].totalScore += avgScore
      if (avgScore >= 0.5) groups[value].passCount++
    }
    return Object.entries(groups)
      .map(([name, data]) => ({
        name,
        count: data.count,
        avgScore: data.count ? data.totalScore / data.count : 0,
        passRate: data.count ? data.passCount / data.count : 0,
      }))
      .sort((a, b) => b.count - a.count)
  }, [results, groupBy])

  if (!results.length) {
    return <EmptyState icon={<FlaskConical className="h-6 w-6" />} title="暂无数据" description="等实验完成后查看分片分析。" />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3">
        <Select
          label="分组维度"
          value={groupBy}
          onChange={(event) => setGroupBy(event.target.value)}
          options={metadataKeys.map((k) => ({ value: k, label: k }))}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {slices.map((slice) => (
          <Card key={slice.name} className="p-5">
            <p className="text-sm font-semibold text-[color:var(--color-text)]">{slice.name}</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-2xl font-bold text-[color:var(--color-text)]">{slice.count}</p>
                <p className="text-xs text-[color:var(--color-text-soft)]">样本</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-[color:var(--color-text)]">{slice.avgScore.toFixed(2)}</p>
                <p className="text-xs text-[color:var(--color-text-soft)]">均分</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-[color:var(--color-text)]">{(slice.passRate * 100).toFixed(0)}%</p>
                <p className="text-xs text-[color:var(--color-text-soft)]">通过率</p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
