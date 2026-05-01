import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Activity, Database, MessageSquare, RefreshCcw } from 'lucide-react'
import { listDatasets } from '@/api/datasets'
import { backfillTracesToAnnotation, backfillTracesToDataset, getTrace, listTraceActions, retryTraceAction, submitTraceFeedback } from '@/api/traces'
import StatCard from '@/components/charts/StatCard'
import PageContainer from '@/components/layout/PageContainer'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import CodeBlock from '@/components/ui/CodeBlock'
import EmptyState from '@/components/ui/EmptyState'
import Modal from '@/components/ui/Modal'
import Select from '@/components/ui/Select'
import StatusDot from '@/components/ui/StatusDot'
import Tabs from '@/components/ui/Tabs'
import Textarea from '@/components/ui/Textarea'
import { useAsyncResource } from '@/hooks/useAsyncResource'
import { formatSpanType, formatTraceStatus } from '@/lib/labels'
import { toast } from '@/stores/toast'
import type { SpanNode, TraceDetail, TraceFeedbackAction } from '@/types'
import { cn, formatDate, formatDuration, formatTokens, parseJsonLike } from '@/lib/utils'

export default function TraceDetailPage() {
  const { id = '' } = useParams()
  const [tab, setTab] = useState('overview')
  const [comment, setComment] = useState('')
  const [feedbackLoading, setFeedbackLoading] = useState(false)
  const [datasetModalOpen, setDatasetModalOpen] = useState(false)
  const [selectedDatasetId, setSelectedDatasetId] = useState('')
  const [backfillLoading, setBackfillLoading] = useState(false)
  const [retryingActionId, setRetryingActionId] = useState<string | null>(null)
  const [selectedSpanId, setSelectedSpanId] = useState('')
  const { data, loading, error, reload } = useAsyncResource(() => getTrace(id), [id])
  const { data: datasets } = useAsyncResource(() => listDatasets({ page_size: 100 }), [])
  const { data: actions = [], loading: actionsLoading, reload: reloadActions } = useAsyncResource(() => listTraceActions(id), [id])
  const traceActions = actions ?? []

  const metadata = useMemo(() => parseJsonLike(data?.metadata) ?? data?.metadata_json ?? {}, [data])

  const submitFeedback = async (score: number) => {
    setFeedbackLoading(true)
    try {
      await submitTraceFeedback(id, { score, comment, tags: [] })
      setComment('')
      toast.success('反馈已记录')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '提交反馈失败', '提交反馈失败')
    } finally {
      setFeedbackLoading(false)
    }
  }

  const handleBackfillToDataset = async () => {
    if (!selectedDatasetId) {
      toast.info('请先选择 Dataset')
      return
    }
    setBackfillLoading(true)
    try {
      const result = await backfillTracesToDataset({
        dataset_id: selectedDatasetId,
        trace_ids: [id],
        split: 'default',
      })
      setDatasetModalOpen(false)
      await reloadActions()
      const action = result.actions?.[0]
      if (action?.status === 'failed') {
        toast.error(action.error_message || '添加到 Dataset 失败', '添加到 Dataset 失败')
        return
      }
      toast.success(`已添加 ${result.added} 条样本到 Dataset，新版本 v${result.new_version}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '添加到 Dataset 失败', '添加到 Dataset 失败')
    } finally {
      setBackfillLoading(false)
    }
  }

  const handleSendToAnnotation = async () => {
    setBackfillLoading(true)
    try {
      const result = await backfillTracesToAnnotation({ trace_ids: [id], mode: 'single_run' })
      await reloadActions()
      const action = result.actions?.[0]
      if (action?.status === 'failed') {
        toast.error(action.error_message || '发送到标注队列失败', '发送到标注队列失败')
        return
      }
      toast.success(`已创建 ${result.added} 条标注任务`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '发送到标注队列失败', '发送到标注队列失败')
    } finally {
      setBackfillLoading(false)
    }
  }

  const handleRetryAction = async (actionId: string) => {
    setRetryingActionId(actionId)
    try {
      const action = await retryTraceAction(actionId)
      await reloadActions()
      if (action.status === 'failed') {
        toast.error(action.error_message || '重试失败', '重试失败')
        return
      }
      toast.success('回流动作已重试成功')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '重试失败', '重试失败')
    } finally {
      setRetryingActionId(null)
    }
  }

  if (error) {
    return (
      <PageContainer title="Trace 详情" description="查看原始载荷与执行树中的每个 Span。">
        <EmptyState
          icon={<Activity className="h-6 w-6" />}
          title="无法加载 Trace"
          description={error}
          action={<Button variant="secondary" onClick={() => void reload()}>重试</Button>}
        />
      </PageContainer>
    )
  }

  const trace = data as TraceDetail | null

  return (
    <PageContainer
      title={trace?.name ?? 'Trace 详情'}
      description="查看原始载荷与执行树中的每个 Span。"
      actions={
        trace && (
          <Badge variant={trace.status === 'ok' ? 'success' : 'danger'}>
            {formatTraceStatus(trace.status)}
          </Badge>
        )
      }
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="时长" value={loading ? '...' : formatDuration(trace?.duration_ms ?? 0)} />
        <StatCard label="Span 数" value={loading ? '...' : trace?.span_count ?? 0} />
        <StatCard label="Token" value={loading ? '...' : formatTokens(trace?.total_tokens ?? 0)} />
        <StatCard label="开始时间" value={loading ? '...' : formatDate(trace?.start_time)} />
      </div>

      <Tabs
        tabs={[
          { key: 'overview', label: '概览' },
          { key: 'spans', label: 'Span', count: trace?.span_count },
          { key: 'raw', label: '原始载荷' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'overview' && trace && (
        <div className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <Card className="p-6">
              <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">概览</p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <p className="text-sm font-medium text-[color:var(--color-text)]">输入</p>
                  <div className="mt-2">
                    <CodeBlock>{trace.input ?? trace.input_preview}</CodeBlock>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-[color:var(--color-text)]">输出</p>
                  <div className="mt-2">
                    <CodeBlock>{trace.output ?? trace.output_preview}</CodeBlock>
                  </div>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                {trace.tags.map((tag) => (
                  <Badge key={tag} variant="default">
                    {tag}
                  </Badge>
                ))}
              </div>
            </Card>

            <Card className="p-6">
              <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">反馈</p>
              <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-[color:var(--color-text)]">
                标记这次运行是否应该回流到 Dataset
              </h2>
              <div className="mt-5 space-y-4">
                <Textarea
                  label="备注"
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="这条 Trace 为什么好或不好？"
                />
                <div className="flex gap-3">
                  <Button
                    loading={feedbackLoading}
                    icon={<MessageSquare className="h-4 w-4" />}
                    onClick={() => void submitFeedback(1)}
                  >
                    标记为优质
                  </Button>
                  <Button
                    variant="secondary"
                    loading={feedbackLoading}
                    icon={<MessageSquare className="h-4 w-4" />}
                    onClick={() => void submitFeedback(0)}
                  >
                    标记为较差
                  </Button>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="secondary"
                    icon={<Database className="h-4 w-4" />}
                    loading={backfillLoading}
                    onClick={() => setDatasetModalOpen(true)}
                  >
                    添加到 Dataset
                  </Button>
                  <Button variant="ghost" loading={backfillLoading} onClick={() => void handleSendToAnnotation()}>
                    送入标注队列
                  </Button>
                </div>
              </div>
            </Card>
          </div>

          <Card className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">回流记录</p>
                <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-[color:var(--color-text)]">
                  每次回流都会生成可追踪的 action
                </h2>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {actionsLoading ? (
                <p className="text-sm text-[color:var(--color-text-soft)]">正在加载回流记录...</p>
              ) : traceActions.length ? (
                traceActions.map((action) => {
                  const targetHref = resolveActionTargetHref(action)
                  return (
                    <div
                      key={action.id}
                      className="rounded-[1.25rem] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] p-4"
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="info">{formatActionType(action.action_type)}</Badge>
                            <Badge variant={actionStatusVariant(action.status)}>{formatActionStatus(action.status)}</Badge>
                            <span className="text-sm text-[color:var(--color-text-soft)]">{formatDate(action.created_at)}</span>
                          </div>
                          <p className="text-sm text-[color:var(--color-text-soft)]">
                            来源 {formatActionSource(action.source_type)}
                            {action.source_ref_id ? ` · 引用 ${action.source_ref_id}` : ''}
                            {action.created_by ? ` · 操作人 ${action.created_by}` : ''}
                          </p>
                          <div className="flex flex-wrap items-center gap-3 text-sm">
                            <span className="text-[color:var(--color-text-soft)]">Action ID</span>
                            <span className="font-mono text-[color:var(--color-text)]">{action.id}</span>
                            {action.target_id ? (
                              targetHref ? (
                                <Link to={targetHref} className="text-[color:var(--color-accent-strong)] hover:underline">
                                  打开{action.target_type === 'dataset' ? ' Dataset' : '标注任务'}
                                </Link>
                              ) : (
                                <span className="text-[color:var(--color-text)]">{action.target_id}</span>
                              )
                            ) : null}
                            {action.target_version ? (
                              <span className="text-[color:var(--color-text-soft)]">版本 v{action.target_version}</span>
                            ) : null}
                          </div>
                          {action.error_message ? (
                            <p className="text-sm text-[color:var(--color-danger)]">{action.error_message}</p>
                          ) : null}
                        </div>
                        {action.status === 'failed' ? (
                          <Button
                            variant="secondary"
                            icon={<RefreshCcw className="h-4 w-4" />}
                            loading={retryingActionId === action.id}
                            onClick={() => void handleRetryAction(action.id)}
                          >
                            重试
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  )
                })
              ) : (
                <p className="text-sm text-[color:var(--color-text-soft)]">当前 Trace 还没有回流记录。</p>
              )}
            </div>
          </Card>
        </div>
      )}

      {tab === 'spans' && (
        trace?.spans.length ? (
          <SpanSplitView spans={trace.spans} selectedSpanId={selectedSpanId} onSelectSpan={setSelectedSpanId} />
        ) : (
          <EmptyState
            icon={<Activity className="h-6 w-6" />}
            title="暂无 Span"
            description="当前 Trace 还没有索引到任何 Span。"
          />
        )
      )}

      {tab === 'raw' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <CodeBlock>{metadata}</CodeBlock>
          <CodeBlock>{trace ?? null}</CodeBlock>
        </div>
      )}

      <Modal
        open={datasetModalOpen}
        onClose={() => setDatasetModalOpen(false)}
        title="添加到 Dataset"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setDatasetModalOpen(false)}>
              取消
            </Button>
            <Button loading={backfillLoading} onClick={() => void handleBackfillToDataset()}>
              确认添加
            </Button>
          </div>
        }
      >
        <div className="grid gap-4">
          <Select
            label="目标 Dataset"
            value={selectedDatasetId}
            onChange={(event) => setSelectedDatasetId(event.target.value)}
            options={[
              { value: '', label: '请选择 Dataset' },
              ...((datasets?.items ?? []).map((dataset) => ({ value: dataset.id, label: dataset.name }))),
            ]}
          />
          <p className="text-sm leading-7 text-[color:var(--color-text-soft)]">
            当前 Trace 的输入会写入样本输入，输出会写入期望输出，来源会标记为 `trace_backfill`。
          </p>
        </div>
      </Modal>
    </PageContainer>
  )
}

function formatActionType(actionType: string) {
  switch (actionType) {
    case 'dataset_backfill':
      return '回流到 Dataset'
    case 'annotation_create':
      return '创建标注任务'
    default:
      return actionType
  }
}

function formatActionSource(sourceType: string) {
  switch (sourceType) {
    case 'manual':
      return '手动触发'
    case 'monitor_rule':
      return '监控规则'
    case 'experiment_result':
      return '实验结果'
    default:
      return sourceType
  }
}

function formatActionStatus(status: string) {
  switch (status) {
    case 'pending':
      return '处理中'
    case 'succeeded':
      return '成功'
    case 'failed':
      return '失败'
    case 'deduped':
      return '已去重'
    default:
      return status
  }
}

function actionStatusVariant(status: string): 'default' | 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'succeeded':
      return 'success'
    case 'failed':
      return 'danger'
    case 'pending':
      return 'warning'
    default:
      return 'default'
  }
}

function resolveActionTargetHref(action: TraceFeedbackAction) {
  if (action.target_type === 'dataset' && action.target_id) {
    return `/datasets/${action.target_id}`
  }
  if (action.target_type === 'annotation_task' && action.target_id) {
    return `/annotation/${action.target_id}`
  }
  return ''
}

function findSpan(spans: SpanNode[], spanId: string): SpanNode | null {
  for (const span of spans) {
    if (span.span_id === spanId) return span
    const found = findSpan(span.children, spanId)
    if (found) return found
  }
  return null
}

function firstSpanId(spans: SpanNode[]): string {
  return spans[0]?.span_id ?? ''
}

function SpanSplitView({ spans, selectedSpanId, onSelectSpan }: { spans: SpanNode[]; selectedSpanId: string; onSelectSpan: (id: string) => void }) {
  const activeId = selectedSpanId || firstSpanId(spans)
  const activeSpan = useMemo(() => findSpan(spans, activeId), [spans, activeId])

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <Card className="max-h-[70vh] overflow-y-auto p-3">
        <p className="mb-2 px-2 text-[0.68rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.54)]">Span 树</p>
        {spans.map((span) => (
          <CompactSpanNode key={span.span_id} span={span} depth={0} activeId={activeId} onSelect={onSelectSpan} />
        ))}
      </Card>

      <Card className="p-6">
        {activeSpan ? (
          <SpanDetailPanel span={activeSpan} />
        ) : (
          <p className="text-sm text-[color:var(--color-text-soft)]">点击左侧 Span 节点查看详情</p>
        )}
      </Card>
    </div>
  )
}

function CompactSpanNode({ span, depth, activeId, onSelect }: { span: SpanNode; depth: number; activeId: string; onSelect: (id: string) => void }) {
  const isActive = span.span_id === activeId
  return (
    <>
      <button
        type="button"
        onClick={() => onSelect(span.span_id)}
        className={cn(
          'flex w-full items-center gap-2 rounded-[0.7rem] px-2 py-1.5 text-left text-sm transition',
          isActive
            ? 'bg-[rgba(193,109,58,0.11)] text-[color:var(--color-text)]'
            : 'text-[color:var(--color-text-soft)] hover:bg-[rgba(36,31,26,0.04)] hover:text-[color:var(--color-text)]'
        )}
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        <StatusDot status={span.status} />
        <span className="min-w-0 flex-1 truncate font-medium">{span.name}</span>
        <span className="shrink-0 text-xs tabular-nums text-[color:var(--color-text-soft)]">{formatDuration(span.duration_ms)}</span>
      </button>
      {span.children.map((child) => (
        <CompactSpanNode key={child.span_id} span={child} depth={depth + 1} activeId={activeId} onSelect={onSelect} />
      ))}
    </>
  )
}

function SpanDetailPanel({ span }: { span: SpanNode }) {
  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <StatusDot status={span.status} />
          <h3 className="text-lg font-semibold text-[color:var(--color-text)]">{span.name}</h3>
          {span.model && <Badge variant="info">{span.model}</Badge>}
          {span.error_message && <Badge variant="danger">错误</Badge>}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-[color:var(--color-text-soft)]">
          <span>{formatSpanType(span.span_type)}</span>
          <span>{formatDuration(span.duration_ms)}</span>
          {span.token_input != null && <span>输入 Token: {span.token_input}</span>}
          {span.token_output != null && <span>输出 Token: {span.token_output}</span>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-sm font-medium text-[color:var(--color-text)]">输入</p>
          <CodeBlock>{span.input ?? span.input_preview}</CodeBlock>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-[color:var(--color-text)]">输出</p>
          <CodeBlock>{span.output ?? span.output_preview}</CodeBlock>
        </div>
      </div>

      {span.error_message && (
        <div>
          <p className="mb-2 text-sm font-medium text-[color:#b65145]">错误信息</p>
          <CodeBlock>{span.error_message}</CodeBlock>
        </div>
      )}
    </div>
  )
}
