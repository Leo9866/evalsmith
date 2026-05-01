import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { GitCompareArrows, ExternalLink } from 'lucide-react'
import { compareExperiments, getExperimentBaseline, listExperiments, setExperimentBaseline } from '@/api/experiments'
import PageContainer from '@/components/layout/PageContainer'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import CodeBlock from '@/components/ui/CodeBlock'
import EmptyState from '@/components/ui/EmptyState'
import Select from '@/components/ui/Select'
import Table, { type Column } from '@/components/ui/Table'
import { useAsyncResource } from '@/hooks/useAsyncResource'
import { asItems } from '@/lib/paginated'
import { toast } from '@/stores/toast'
import type { CompareResponse } from '@/types'
import { formatExperimentStatus } from '@/lib/labels'

async function loadExperimentContext() {
  const experiments = await listExperiments({ page_size: 100 })
  const experimentItems = asItems(experiments)
  const datasetIds = Array.from(new Set(experimentItems.map((experiment) => experiment.dataset_id)))
  const baselines = await Promise.all(datasetIds.map(async (datasetId) => [datasetId, await getExperimentBaseline(datasetId)] as const))
  return {
    experiments: experimentItems,
    baselines: new Map(baselines),
  }
}

async function loadCompare(baselineId: string, candidateId: string) {
  return compareExperiments([baselineId, candidateId], baselineId)
}

export default function ExperimentComparePage() {
  const { data: context, loading: contextLoading, error: contextError, reload: reloadContext } = useAsyncResource(loadExperimentContext, [])
  const [baselineId, setBaselineId] = useState('')
  const [candidateId, setCandidateId] = useState('')
  const [savingBaseline, setSavingBaseline] = useState(false)

  const datasetExperiments = useMemo(() => {
    if (!context?.experiments.length) return []
    if (baselineId) {
      const baseline = context.experiments.find((item) => item.id === baselineId)
      if (baseline) {
        return context.experiments.filter((item) => item.dataset_id === baseline.dataset_id)
      }
    }
    return context.experiments
  }, [baselineId, context?.experiments])

  useEffect(() => {
    if (!context?.experiments.length) {
      return
    }
    if (!baselineId) {
      const preferred = context.experiments.find((item) => item.is_baseline) ?? context.experiments[0]
      setBaselineId(preferred.id)
    }
  }, [baselineId, context?.experiments])

  useEffect(() => {
    if (!context?.experiments.length || !baselineId) {
      return
    }
    const baseline = context.experiments.find((item) => item.id === baselineId)
    if (!baseline) {
      return
    }
    const preferred = context.baselines.get(baseline.dataset_id)?.experiment_id
    const nextCandidate = context.experiments.find((item) => item.dataset_id === baseline.dataset_id && item.id !== (preferred || baselineId))
    if (!candidateId || candidateId === baselineId) {
      setCandidateId(nextCandidate?.id ?? '')
    }
  }, [baselineId, candidateId, context?.baselines, context?.experiments])

  const { data, loading, error, reload } = useAsyncResource(
    () => (baselineId && candidateId ? loadCompare(baselineId, candidateId) : Promise.resolve(null)),
    [baselineId, candidateId]
  )

  const deltaColumns = useMemo<Column<NonNullable<CompareResponse>['evaluator_deltas'][number]>[]>(
    () => [
      { key: 'evaluator_name', header: 'Evaluator', render: (item) => <span className="font-medium">{item.evaluator_name}</span> },
      { key: 'baseline_score', header: '基线分数', render: (item) => <span>{item.baseline_score.toFixed(3)}</span> },
      { key: 'candidate_score', header: '当前分数', render: (item) => <span>{item.candidate_score.toFixed(3)}</span> },
      {
        key: 'delta',
        header: '变化',
        render: (item) => (
          <span className={item.delta < 0 ? 'text-[color:#b65145]' : 'text-[color:#2e7d52]'}>
            {item.delta > 0 ? '+' : ''}
            {item.delta.toFixed(3)}
          </span>
        ),
      },
      { key: 'regressed', header: '回退样本', render: (item) => <span>{item.regressed}</span> },
    ],
    []
  )

  const handleSetBaseline = async () => {
    const baseline = context?.experiments.find((item) => item.id === baselineId)
    if (!baseline) return
    setSavingBaseline(true)
    try {
      await setExperimentBaseline(baseline.id, baseline.dataset_id)
      await reloadContext()
      await reload()
      toast.success('已更新基线')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '设置基线失败', '设置基线失败')
    } finally {
      setSavingBaseline(false)
    }
  }

  if (contextError) {
    return (
      <PageContainer title="实验对比" description="对比不同实验的回归结果和逐样本差异。">
        <EmptyState
          icon={<GitCompareArrows className="h-6 w-6" />}
          title="无法加载对比上下文"
          description={contextError}
          action={<Button variant="secondary" onClick={() => void reloadContext()}>重试</Button>}
        />
      </PageContainer>
    )
  }

  return (
    <PageContainer
      title="实验对比"
      description="选择基线和候选 Experiment，查看分数变化、回退样本和逐条差异。"
      actions={
        <>
          <Select
            value={baselineId}
            onChange={(event) => setBaselineId(event.target.value)}
            options={(context?.experiments ?? []).map((item) => ({
              value: item.id,
              label: `${item.name}${item.is_baseline ? '（当前基线）' : ''}`,
            }))}
            disabled={contextLoading}
          />
          <Select
            value={candidateId}
            onChange={(event) => setCandidateId(event.target.value)}
            options={datasetExperiments.filter((item) => item.id !== baselineId).map((item) => ({ value: item.id, label: item.name }))}
            disabled={contextLoading || !baselineId}
          />
          <Button variant="secondary" loading={savingBaseline} onClick={() => void handleSetBaseline()} disabled={!baselineId}>
            设为基线
          </Button>
        </>
      }
    >
      {error ? (
        <EmptyState
          icon={<GitCompareArrows className="h-6 w-6" />}
          title="无法加载对比结果"
          description={error}
          action={<Button variant="secondary" onClick={() => void reload()}>重试</Button>}
        />
      ) : !baselineId || !candidateId ? (
        <EmptyState
          icon={<GitCompareArrows className="h-6 w-6" />}
          title="先选择两个 Experiment"
          description="同一 Dataset 下的两个 Experiment 才能得到有意义的回归对比。"
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {(data?.experiments ?? []).map((item) => (
              <Card key={item.experiment_id} className="p-6">
                <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">
                  {item.experiment_id === data?.baseline_experiment_id ? '基线 Experiment' : '候选 Experiment'}
                </p>
                <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-[color:var(--color-text)]">{item.name}</h2>
                <div className="mt-4 grid gap-3 text-sm text-[color:var(--color-text-soft)]">
                  <p>状态：{formatExperimentStatus(item.status || 'pending')}</p>
                  <p>样本：{item.summary.completed}/{item.summary.total_examples}</p>
                  <p>平均分项：{Object.keys(item.summary.avg_scores).length} 个</p>
                </div>
              </Card>
            ))}
          </div>

          <Table
            columns={deltaColumns}
            data={data?.evaluator_deltas ?? []}
            loading={loading}
            emptyMessage="暂无 evaluator 级对比结果"
          />

          <div className="grid gap-4">
            {(data?.sample_diffs ?? []).map((item) => (
              <Card key={item.example_id} className="p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">
                      样本 {item.example_id}
                    </p>
                    <p className="mt-2 text-sm text-[color:var(--color-text-soft)]">判定：{item.verdict === 'regressed' ? '回退' : item.verdict === 'improved' ? '提升' : '基本持平'}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {item.baseline_trace_id ? (
                      <Link to={`/tracing/${item.baseline_trace_id}`} className="inline-flex items-center gap-2 rounded-[0.95rem] border border-[color:var(--color-line)] px-3 py-2 text-sm">
                        基线 Trace
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    ) : null}
                    {item.candidate_trace_id ? (
                      <Link to={`/tracing/${item.candidate_trace_id}`} className="inline-flex items-center gap-2 rounded-[0.95rem] border border-[color:var(--color-line)] px-3 py-2 text-sm">
                        当前 Trace
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    ) : null}
                  </div>
                </div>
                <div className="mt-5 grid gap-4 lg:grid-cols-3">
                  <div>
                    <p className="mb-2 text-sm font-medium text-[color:var(--color-text)]">输入</p>
                    <CodeBlock>{item.input ?? null}</CodeBlock>
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-medium text-[color:var(--color-text)]">基线输出</p>
                    <CodeBlock>{item.baseline_output ?? null}</CodeBlock>
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-medium text-[color:var(--color-text)]">当前输出</p>
                    <CodeBlock>{item.candidate_output ?? null}</CodeBlock>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </PageContainer>
  )
}
