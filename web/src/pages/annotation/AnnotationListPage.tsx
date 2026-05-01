import { useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CheckSquare, Search } from 'lucide-react'
import { getAnnotationStats, listAnnotationTasks } from '@/api/annotation'
import PageContainer from '@/components/layout/PageContainer'
import StatCard from '@/components/charts/StatCard'
import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import Input from '@/components/ui/Input'
import Pagination from '@/components/ui/Pagination'
import Select from '@/components/ui/Select'
import Table, { type Column } from '@/components/ui/Table'
import { useDebouncedSearchInput } from '@/hooks/useDebouncedSearchInput'
import { useAsyncResource } from '@/hooks/useAsyncResource'
import { applySearchParamPatch, readPositiveIntParam } from '@/lib/searchParams'
import { formatStatus } from '@/lib/labels'
import type { AnnotationTask } from '@/types'
import { formatDate, truncate, toPrettyJson } from '@/lib/utils'

async function loadAnnotationOverview(status: string, query: string, page: number) {
  const [stats, tasks] = await Promise.all([
    getAnnotationStats(),
    listAnnotationTasks({ page, page_size: 20, status: status || undefined, query: query || undefined }),
  ])
  return {
    stats,
    tasks,
  }
}

export default function AnnotationListPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const status = searchParams.get('status') ?? ''
  const search = searchParams.get('search')?.trim() ?? ''
  const page = readPositiveIntParam(searchParams.get('page'))
  const { data, loading, error, reload } = useAsyncResource(
    () => loadAnnotationOverview(status, search, page),
    [status, search, page]
  )
  const setParams = useCallback(
    (updates: Record<string, string | null | undefined>, options?: { resetPage?: boolean }) => {
      setSearchParams(applySearchParamPatch(searchParams, updates, options))
    },
    [searchParams, setSearchParams]
  )
  const [searchInput, setSearchInput] = useDebouncedSearchInput(search, (nextValue) => {
    setParams({ search: nextValue || null }, { resetPage: true })
  })

  const columns = useMemo<Column<AnnotationTask>[]>(
    () => [
      {
        key: 'source_id',
        header: '来源',
        render: (task) => (
          <div>
            <p className="font-medium">{task.source_type === 'trace' ? 'Trace 标注' : '实验结果标注'}</p>
            <p className="mt-1 text-sm text-[color:var(--color-text-soft)]">{task.source_id}</p>
          </div>
        ),
      },
      {
        key: 'input_payload',
        header: '输入',
        render: (task) => <span>{truncate(toPrettyJson(task.input_payload), 120)}</span>,
      },
      {
        key: 'status',
        header: '状态',
        render: (task) => <span>{formatStatus(task.status)}</span>,
      },
      {
        key: 'created_at',
        header: '创建时间',
        render: (task) => <span>{formatDate(task.created_at)}</span>,
      },
    ],
    []
  )

  return (
    <PageContainer
      title="标注队列"
      description="承接 Trace 和 Experiment Result 的回流样本，完成 Single-run 或 Pairwise 评估。"
      actions={
        <>
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="搜索任务 / Trace / Experiment"
            icon={<Search className="h-4 w-4" />}
            className="min-w-[14rem]"
          />
          <Select
            value={status}
            onChange={(event) => setParams({ status: event.target.value || null }, { resetPage: true })}
            options={[
              { value: '', label: '全部状态' },
              { value: 'pending', label: '待处理' },
              { value: 'in_progress', label: '处理中' },
              { value: 'completed', label: '已完成' },
            ]}
          />
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="总任务" value={data?.stats.total ?? 0} />
        <StatCard label="待处理" value={data?.stats.pending ?? 0} />
        <StatCard label="处理中" value={data?.stats.in_progress ?? 0} />
        <StatCard label="已完成" value={data?.stats.completed ?? 0} />
      </div>

      {error ? (
        <EmptyState
          icon={<CheckSquare className="h-6 w-6" />}
          title="无法加载标注队列"
          description={error}
          action={<Button variant="secondary" onClick={() => void reload()}>重试</Button>}
        />
      ) : (data?.tasks.items.length ?? 0) === 0 && !loading ? (
        <EmptyState
          icon={<CheckSquare className="h-6 w-6" />}
          title="暂无标注任务"
          description="先从 Trace 或 Experiment 结果把样本送进标注队列，这里才会出现可处理任务。"
        />
      ) : (
        <Table
          columns={columns}
          data={data?.tasks.items ?? []}
          loading={loading}
          emptyMessage="暂无标注任务"
          onRowClick={(task) => navigate(`/annotation/${task.id}`)}
        />
      )}
      <Pagination
        page={data?.tasks.page ?? page}
        totalPages={data?.tasks.total_pages ?? Math.max(1, Math.ceil((data?.tasks.total ?? 0) / Math.max(data?.tasks.page_size ?? 20, 1)))}
        total={data?.tasks.total ?? 0}
        pageSize={data?.tasks.page_size ?? 20}
        onPageChange={(nextPage) => setParams({ page: String(nextPage) })}
      />
    </PageContainer>
  )
}
