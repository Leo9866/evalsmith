import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Activity, Search } from 'lucide-react'
import { listDatasets } from '@/api/datasets'
import { backfillTracesToAnnotation, backfillTracesToDataset, listTraces } from '@/api/traces'
import PageContainer from '@/components/layout/PageContainer'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import Input from '@/components/ui/Input'
import Modal from '@/components/ui/Modal'
import Pagination from '@/components/ui/Pagination'
import Select from '@/components/ui/Select'
import StatusDot from '@/components/ui/StatusDot'
import Table, { type Column } from '@/components/ui/Table'
import { useAsyncResource } from '@/hooks/useAsyncResource'
import { asItems, asPaginated } from '@/lib/paginated'
import { applySearchParamPatch, readPositiveIntParam } from '@/lib/searchParams'
import { toast } from '@/stores/toast'
import type { TraceListItem } from '@/types'
import { formatDate, formatDuration, formatTokens } from '@/lib/utils'

function timeRangeToISO(range: string): { start_time?: string; end_time?: string } {
  if (!range) return {}
  const now = new Date()
  const ms: Record<string, number> = { '1h': 3600000, '24h': 86400000, '7d': 604800000, '30d': 2592000000 }
  const offset = ms[range]
  if (!offset) return {}
  return {
    start_time: new Date(now.getTime() - offset).toISOString(),
    end_time: now.toISOString(),
  }
}

async function loadTraces(
  search: string,
  status: string,
  timeRange: string,
  sortBy: string,
  page: number,
  minDurationMs?: number,
  maxDurationMs?: number
) {
  const time = timeRangeToISO(timeRange)
  return listTraces({
    page,
    page_size: 20,
    search: search || undefined,
    status: status || undefined,
    start_time: time.start_time,
    end_time: time.end_time,
    sort_by: sortBy || undefined,
    sort_order: 'desc',
    min_duration_ms: minDurationMs,
    max_duration_ms: maxDurationMs,
  }).then((result) => asPaginated({ ...result, items: result?.traces }, page, 20))
}

export default function TraceListPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('search')?.trim() ?? ''
  const status = searchParams.get('status') ?? ''
  const timeRange = searchParams.get('time_range') ?? ''
  const sortBy = searchParams.get('sort_by') ?? ''
  const minDurationInput = searchParams.get('min_duration_ms') ?? ''
  const maxDurationInput = searchParams.get('max_duration_ms') ?? ''
  const page = readPositiveIntParam(searchParams.get('page'))
  const minDurationMs = minDurationInput ? Number.parseInt(minDurationInput, 10) : undefined
  const maxDurationMs = maxDurationInput ? Number.parseInt(maxDurationInput, 10) : undefined
  const [searchInput, setSearchInput] = useState(search)

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    setSearchInput(search)
  }, [search])

  const setParams = useCallback(
    (updates: Record<string, string | null | undefined>, options?: { resetPage?: boolean }) => {
      setSearchParams(applySearchParamPatch(searchParams, updates, options))
    },
    [searchParams, setSearchParams]
  )

  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value)
  }, [])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (searchInput === search) {
      return () => clearTimeout(debounceRef.current)
    }
    debounceRef.current = setTimeout(() => {
      setParams({ search: searchInput || null }, { resetPage: true })
    }, 400)
    return () => clearTimeout(debounceRef.current)
  }, [search, searchInput, setParams])

  useEffect(() => () => clearTimeout(debounceRef.current), [])
  const [selectedTraceIds, setSelectedTraceIds] = useState<string[]>([])
  const [datasetModalOpen, setDatasetModalOpen] = useState(false)
  const [selectedDatasetId, setSelectedDatasetId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const { data, loading, error, reload } = useAsyncResource(
    () => loadTraces(search, status, timeRange, sortBy, page, minDurationMs, maxDurationMs),
    [search, status, timeRange, sortBy, page, minDurationMs, maxDurationMs]
  )
  const { data: datasets } = useAsyncResource(() => listDatasets({ page_size: 100 }).then((result) => asItems(result)), [])
  const traces = data?.items ?? []

  const toggleTrace = (traceId: string) => {
    setSelectedTraceIds((current) =>
      current.includes(traceId) ? current.filter((id) => id !== traceId) : [...current, traceId]
    )
  }

  const columns = useMemo<Column<TraceListItem>[]>(
    () => [
      {
        key: 'selected',
        header: '',
        className: 'w-12',
        render: (trace) => (
          <input
            type="checkbox"
            checked={selectedTraceIds.includes(trace.trace_id)}
            onChange={() => toggleTrace(trace.trace_id)}
            onClick={(event) => event.stopPropagation()}
            className="h-4 w-4 rounded border-[color:var(--color-line-strong)] accent-[color:var(--color-accent-strong)]"
          />
        ),
      },
      {
        key: 'name',
        header: 'Trace',
        render: (trace) => (
          <div>
            <div className="flex items-center gap-3">
              <StatusDot status={trace.status} />
              <p className="font-medium">{trace.name}</p>
            </div>
            <p className="mt-1 text-sm text-[color:var(--color-text-soft)]">{trace.trace_id}</p>
          </div>
        ),
      },
      {
        key: 'input_preview',
        header: '输入',
        render: (trace) => <span className="line-clamp-2 max-w-[16rem]">{trace.input_preview || '—'}</span>,
      },
      {
        key: 'output_preview',
        header: '输出',
        render: (trace) => <span className="line-clamp-2 max-w-[16rem]">{trace.output_preview || '—'}</span>,
      },
      {
        key: 'duration_ms',
        header: '时长',
        render: (trace) => <span>{formatDuration(trace.duration_ms)}</span>,
      },
      {
        key: 'total_tokens',
        header: 'Token',
        render: (trace) => <span>{formatTokens(trace.total_tokens)}</span>,
      },
      {
        key: 'created_at',
        header: '时间',
        render: (trace) => <span>{formatDate(trace.start_time)}</span>,
      },
    ],
    [selectedTraceIds]
  )

  const handleBackfillToDataset = async () => {
    if (!selectedDatasetId || selectedTraceIds.length === 0) {
      toast.info('请先选择 Dataset 和 Trace')
      return
    }
    setSubmitting(true)
    try {
      const result = await backfillTracesToDataset({
        dataset_id: selectedDatasetId,
        trace_ids: selectedTraceIds,
        split: 'default',
      })
      setDatasetModalOpen(false)
      setSelectedTraceIds([])
      const failedCount = (result.actions ?? []).filter((action) => action.status === 'failed').length
      if (failedCount === 0) {
        toast.success('已添加到 Dataset')
      } else if (failedCount === (result.actions ?? []).length) {
        toast.error(`回流失败 ${failedCount} 条`, '添加到 Dataset 失败')
      } else {
        toast.info(`已回流 ${result.added} 条，失败 ${failedCount} 条`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '添加到 Dataset 失败', '添加到 Dataset 失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSendToAnnotation = async () => {
    if (selectedTraceIds.length === 0) {
      toast.info('请先选择 Trace')
      return
    }
    setSubmitting(true)
    try {
      const result = await backfillTracesToAnnotation({ trace_ids: selectedTraceIds, mode: 'single_run' })
      setSelectedTraceIds([])
      const failedCount = (result.actions ?? []).filter((action) => action.status === 'failed').length
      if (failedCount === 0) {
        toast.success('已送入标注队列')
      } else if (failedCount === (result.actions ?? []).length) {
        toast.error(`送标失败 ${failedCount} 条`, '发送到标注队列失败')
      } else {
        toast.info(`已创建 ${result.added} 条标注任务，失败 ${failedCount} 条`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '发送到标注队列失败', '发送到标注队列失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PageContainer
      title="Trace"
      description="查看请求流、延迟热点，以及究竟是哪条输入或输出触发了回归。"
      actions={
        <>
          {selectedTraceIds.length > 0 ? (
            <>
              <Button variant="secondary" loading={submitting} onClick={() => setDatasetModalOpen(true)}>
                添加到 Dataset
              </Button>
              <Button variant="ghost" loading={submitting} onClick={() => void handleSendToAnnotation()}>
                送入标注队列
              </Button>
            </>
          ) : null}
          <Input
            value={searchInput}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder="搜索 Trace"
            icon={<Search className="h-4 w-4" />}
            className="min-w-[13rem]"
          />
          <Input
            type="number"
            min="0"
            value={minDurationInput}
            onChange={(event) => setParams({ min_duration_ms: event.target.value || null }, { resetPage: true })}
            placeholder="最小时延(ms)"
            className="w-36"
          />
          <Input
            type="number"
            min="0"
            value={maxDurationInput}
            onChange={(event) => setParams({ max_duration_ms: event.target.value || null }, { resetPage: true })}
            placeholder="最大时延(ms)"
            className="w-36"
          />
          <Select
            value={timeRange}
            onChange={(event) => setParams({ time_range: event.target.value || null }, { resetPage: true })}
            options={[
              { value: '', label: '全部时间' },
              { value: '1h', label: '最近 1 小时' },
              { value: '24h', label: '最近 24 小时' },
              { value: '7d', label: '最近 7 天' },
              { value: '30d', label: '最近 30 天' },
            ]}
          />
          <Select
            value={status}
            onChange={(event) => setParams({ status: event.target.value || null }, { resetPage: true })}
            options={[
              { value: '', label: '全部状态' },
              { value: 'ok', label: '成功' },
              { value: 'error', label: '异常' },
            ]}
          />
          <Select
            value={sortBy}
            onChange={(event) => setParams({ sort_by: event.target.value || null }, { resetPage: true })}
            options={[
              { value: '', label: '默认排序' },
              { value: 'start_time', label: '按时间' },
              { value: 'duration_ms', label: '按延迟' },
              { value: 'total_tokens', label: '按 Token' },
            ]}
          />
        </>
      }
    >
      {error ? (
        <EmptyState
          icon={<Activity className="h-6 w-6" />}
          title="无法加载 Trace"
          description={error}
          action={<Button variant="secondary" onClick={() => void reload()}>重试</Button>}
        />
      ) : traces.length === 0 && !loading ? (
        <EmptyState
          icon={<Activity className="h-6 w-6" />}
          title="暂无 Trace"
          description="运行演示 agent，或通过 Python SDK 上报 Trace 后，这里就会出现时间线。"
        />
      ) : (
        <>
          <Table
            columns={columns}
            data={traces}
            loading={loading}
            onRowClick={(trace) => navigate(`/tracing/${trace.trace_id}`)}
          />
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between text-sm text-[color:var(--color-text-soft)]">
              <span>{data?.total ?? 0} 条 Trace</span>
              <div className="flex flex-wrap gap-2">
                {traces.slice(0, 3).flatMap((trace) => trace.tags).slice(0, 6).map((tag) => (
                  <Badge key={tag} variant="default">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
            <Pagination
              page={data?.page ?? page}
              totalPages={Math.max(1, Math.ceil((data?.total ?? 0) / Math.max(data?.page_size ?? 20, 1)))}
              total={data?.total ?? 0}
              pageSize={data?.page_size ?? 20}
              onPageChange={(nextPage) => setParams({ page: String(nextPage) })}
            />
          </div>
        </>
      )}
      <Modal
        open={datasetModalOpen}
        onClose={() => setDatasetModalOpen(false)}
        title="批量添加到 Dataset"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setDatasetModalOpen(false)}>
              取消
            </Button>
            <Button loading={submitting} onClick={() => void handleBackfillToDataset()}>
              确认添加
            </Button>
          </div>
        }
      >
        <Select
          label="目标 Dataset"
          value={selectedDatasetId}
          onChange={(event) => setSelectedDatasetId(event.target.value)}
          options={[
            { value: '', label: '请选择 Dataset' },
            ...((datasets ?? []).map((dataset) => ({ value: dataset.id, label: dataset.name }))),
          ]}
        />
      </Modal>
    </PageContainer>
  )
}
