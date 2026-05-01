import { useCallback, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FlaskConical, Plus, Search } from 'lucide-react'
import { listDatasets } from '@/api/datasets'
import { listExperiments } from '@/api/experiments'
import PageContainer from '@/components/layout/PageContainer'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import Input from '@/components/ui/Input'
import Pagination from '@/components/ui/Pagination'
import Select from '@/components/ui/Select'
import ScoreBadge from '@/components/ui/ScoreBadge'
import Table, { type Column } from '@/components/ui/Table'
import { useDebouncedSearchInput } from '@/hooks/useDebouncedSearchInput'
import { useAsyncResource } from '@/hooks/useAsyncResource'
import { formatExperimentStatus } from '@/lib/labels'
import { asItems, asPaginated } from '@/lib/paginated'
import { canManageEvaluationAssets } from '@/lib/permissions'
import { applySearchParamPatch, readPositiveIntParam } from '@/lib/searchParams'
import { useAppStore } from '@/stores/app'
import type { Experiment } from '@/types'
import { formatDate } from '@/lib/utils'

async function loadExperiments(page: number, query: string, status: string) {
  const [experiments, datasets] = await Promise.all([
    listExperiments({ page, page_size: 20, query: query || undefined, status: status || undefined }),
    listDatasets({ page_size: 100 }),
  ])

  const datasetMap = new Map(asItems(datasets).map((dataset) => [dataset.id, dataset.name]))

  return {
    experiments: asPaginated(experiments, page, 20),
    datasetMap,
  }
}

const ACTIVE_STATUSES = new Set(['pending', 'running', 'cancel_requested'])

export default function ExperimentListPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const currentProjectRole = useAppStore((state) => state.currentProjectRole)
  const search = searchParams.get('search')?.trim() ?? ''
  const status = searchParams.get('status') ?? ''
  const page = readPositiveIntParam(searchParams.get('page'))
  const setParams = useCallback(
    (updates: Record<string, string | null | undefined>, options?: { resetPage?: boolean }) => {
      setSearchParams(applySearchParamPatch(searchParams, updates, options))
    },
    [searchParams, setSearchParams]
  )
  const [searchInput, setSearchInput] = useDebouncedSearchInput(search, (nextValue) => {
    setParams({ search: nextValue || null }, { resetPage: true })
  })
  const { data, loading, error, reload } = useAsyncResource(
    () => loadExperiments(page, search, status),
    [page, search, status]
  )
  const canManage = canManageEvaluationAssets(currentProjectRole)

  useEffect(() => {
    if (!data?.experiments.items.some((experiment) => ACTIVE_STATUSES.has(experiment.status))) return undefined
    const timer = window.setTimeout(() => {
      void reload()
    }, 2500)
    return () => window.clearTimeout(timer)
  }, [data?.experiments, reload])

  const columns = useMemo<Column<Experiment>[]>(
    () => [
      {
        key: 'name',
        header: 'Experiment',
        render: (experiment) => (
          <div>
            <div className="flex items-center gap-2">
              <p className="font-medium">{experiment.name}</p>
              {experiment.is_baseline ? <Badge variant="info">基线</Badge> : null}
            </div>
            <p className="mt-1 text-sm text-[color:var(--color-text-soft)]">
              {experiment.description || experiment.last_error || '暂无描述'}
            </p>
          </div>
        ),
      },
      {
        key: 'dataset',
        header: 'Dataset',
        render: (experiment) => <span>{data?.datasetMap.get(experiment.dataset_id) ?? experiment.dataset_id}</span>,
      },
      {
        key: 'status',
        header: '状态',
        render: (experiment) => (
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
        ),
      },
      {
        key: 'score',
        header: '主分数',
        render: (experiment) => {
          const firstScore = experiment.summary ? Object.values(experiment.summary.avg_scores)[0] : undefined
          return firstScore !== undefined ? <ScoreBadge score={firstScore} /> : <span>待生成</span>
        },
      },
      {
        key: 'created_at',
        header: '创建时间',
        render: (experiment) => <span>{formatDate(experiment.created_at)}</span>,
      },
    ],
    [data?.datasetMap]
  )

  return (
    <PageContainer
      title="Experiment"
      description="对目标 URL 运行离线回归，并比较不同版本在同一 Dataset 上的表现。"
      actions={
        <>
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="搜索 Experiment"
            icon={<Search className="h-4 w-4" />}
            className="min-w-[14rem]"
          />
          <Select
            value={status}
            onChange={(event) => setParams({ status: event.target.value || null }, { resetPage: true })}
            options={[
              { value: '', label: '全部状态' },
              { value: 'pending', label: '待运行' },
              { value: 'running', label: '运行中' },
              { value: 'completed', label: '已完成' },
              { value: 'failed', label: '已失败' },
              { value: 'cancel_requested', label: '取消中' },
              { value: 'canceled', label: '已取消' },
            ]}
          />
          <Button variant="secondary" onClick={() => navigate('/experiments/compare')}>
            打开对比台
          </Button>
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/experiments/new')} disabled={!canManage}>
            新建 Experiment
          </Button>
        </>
      }
    >
      {error ? (
        <EmptyState
          icon={<FlaskConical className="h-6 w-6" />}
          title="无法加载 Experiment"
          description={error}
          action={<Button variant="secondary" onClick={() => void reload()}>重试</Button>}
        />
      ) : (data?.experiments.items.length ?? 0) === 0 && !loading ? (
        <EmptyState
          icon={<FlaskConical className="h-6 w-6" />}
          title="暂无 Experiment"
          description="创建一个 Experiment，对目标服务和 Dataset 做基准对比。"
          action={<Button onClick={() => navigate('/experiments/new')} disabled={!canManage}>创建 Experiment</Button>}
        />
      ) : (
        <Table
          columns={columns}
          data={data?.experiments.items ?? []}
          loading={loading}
          onRowClick={(experiment) => navigate(`/experiments/${experiment.id}`)}
        />
      )}
      <Pagination
        page={data?.experiments.page ?? page}
        totalPages={data?.experiments.total_pages ?? Math.max(1, Math.ceil((data?.experiments.total ?? 0) / Math.max(data?.experiments.page_size ?? 20, 1)))}
        total={data?.experiments.total ?? 0}
        pageSize={data?.experiments.page_size ?? 20}
        onPageChange={(nextPage) => setParams({ page: String(nextPage) })}
      />
    </PageContainer>
  )
}
