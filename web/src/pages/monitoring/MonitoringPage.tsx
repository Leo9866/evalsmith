import { useCallback, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BellRing, Radar, Search, ShieldAlert, Sparkles, TriangleAlert } from 'lucide-react'
import { createMonitoringRule, getMonitoringOverview, listMonitoringAlerts, listMonitoringRules, listMonitoringRuns, resolveMonitoringAlert, runMonitoringRule, updateMonitoringRule } from '@/api/monitoring'
import { listDatasets } from '@/api/datasets'
import { listEvaluators } from '@/api/evaluators'
import MetricCard from '@/components/charts/MetricCard'
import PageContainer from '@/components/layout/PageContainer'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import EmptyState from '@/components/ui/EmptyState'
import Input from '@/components/ui/Input'
import Modal from '@/components/ui/Modal'
import Pagination from '@/components/ui/Pagination'
import Select from '@/components/ui/Select'
import Textarea from '@/components/ui/Textarea'
import { useDebouncedSearchInput } from '@/hooks/useDebouncedSearchInput'
import { useAsyncResource } from '@/hooks/useAsyncResource'
import { formatMonitorSeverity, formatStatus } from '@/lib/labels'
import { asItems, asPaginated } from '@/lib/paginated'
import { applySearchParamPatch, readPositiveIntParam } from '@/lib/searchParams'
import { formatDate, formatPercent } from '@/lib/utils'
import type { MonitoringRule } from '@/types'

async function loadMonitoring(params: {
  rulePage: number
  ruleQuery: string
  ruleStatus: string
  alertPage: number
  alertQuery: string
  alertStatus: string
  runPage: number
  runQuery: string
}) {
  const [overview, rules, alerts, runs, datasets, evaluators] = await Promise.all([
    getMonitoringOverview(),
    listMonitoringRules({
      page: params.rulePage,
      page_size: 6,
      query: params.ruleQuery || undefined,
      status: params.ruleStatus || undefined,
    }),
    listMonitoringAlerts({
      page: params.alertPage,
      page_size: 6,
      query: params.alertQuery || undefined,
      status: params.alertStatus || undefined,
    }),
    listMonitoringRuns({
      page: params.runPage,
      page_size: 6,
      query: params.runQuery || undefined,
    }),
    listDatasets({ page_size: 100 }),
    listEvaluators({ page_size: 100 }),
  ])
  return {
    overview,
    rules: asPaginated(rules, params.rulePage, 6),
    alerts: asPaginated(alerts, params.alertPage, 6),
    runs: asPaginated(runs, params.runPage, 6),
    datasets: asItems(datasets),
    evaluators: asItems(evaluators),
  }
}

type RuleFormState = {
  name: string
  description: string
  status: string
  sampling_rate: string
  threshold: string
  severity: string
  evaluator_ids: string[]
  backfill_dataset_id: string
  backfill_split: string
  auto_annotation: boolean
  blocked_keywords: string
  blocked_regexes: string
  max_output_chars: string
  require_non_empty_output: boolean
}

function toRuleForm(rule?: MonitoringRule): RuleFormState {
  return {
    name: rule?.name ?? '',
    description: rule?.description ?? '',
    status: rule?.status ?? 'active',
    sampling_rate: String(rule?.sampling_rate ?? 1),
    threshold: String(rule?.threshold ?? 0.7),
    severity: rule?.severity ?? 'warning',
    evaluator_ids: rule?.evaluator_ids ?? [],
    backfill_dataset_id: rule?.backfill_dataset_id ?? '',
    backfill_split: rule?.backfill_split ?? 'regression',
    auto_annotation: rule?.auto_annotation ?? false,
    blocked_keywords: (rule?.guardrail_config?.blocked_keywords ?? []).join('\n'),
    blocked_regexes: (rule?.guardrail_config?.blocked_regexes ?? []).join('\n'),
    max_output_chars: rule?.guardrail_config?.max_output_chars ? String(rule.guardrail_config.max_output_chars) : '',
    require_non_empty_output: rule?.guardrail_config?.require_non_empty_output ?? false,
  }
}

function alertVariant(severity: string) {
  switch (severity) {
    case 'critical':
      return 'danger'
    case 'warning':
      return 'warning'
    default:
      return 'info'
  }
}

function describeAlertReason(details: Record<string, unknown>, kind: string) {
  if (kind === 'guardrail') {
    const hits = Array.isArray(details.guardrail_hits) ? details.guardrail_hits.filter((item) => typeof item === 'string') : []
    return hits.length ? `Guardrail 命中：${hits.join('；')}` : 'Guardrail 命中'
  }
  if (kind === 'trace_error') {
    return 'Trace 运行状态为 error'
  }
  const avgScore = typeof details.avg_score === 'number' ? details.avg_score : null
  const threshold = typeof details.threshold === 'number' ? details.threshold : null
  if (avgScore !== null && threshold !== null) {
    return `平均分 ${avgScore.toFixed(2)} 低于阈值 ${threshold.toFixed(2)}`
  }
  return '规则触发告警'
}

function describeRunReason(
  run: {
    alert_triggered: boolean
    guardrail_hits: string[]
    trace_status: string
    avg_score?: number | null
    error_message?: string | null
  },
  threshold?: number
) {
  if (!run.alert_triggered) {
    return '未触发告警'
  }
  if (run.guardrail_hits.length > 0) {
    return `Guardrail 命中：${run.guardrail_hits.join('；')}`
  }
  if (run.trace_status === 'error') {
    return 'Trace 运行状态为 error'
  }
  if (threshold !== undefined && run.avg_score !== null && run.avg_score !== undefined && run.avg_score < threshold) {
    return `平均分 ${run.avg_score.toFixed(2)} 低于阈值 ${threshold.toFixed(2)}`
  }
  if (run.error_message) {
    return `运行错误：${run.error_message}`
  }
  return '规则触发'
}

export default function MonitoringPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const ruleQuery = searchParams.get('rule_query')?.trim() ?? ''
  const ruleStatus = searchParams.get('rule_status') ?? ''
  const rulePage = readPositiveIntParam(searchParams.get('rule_page'))
  const alertQuery = searchParams.get('alert_query')?.trim() ?? ''
  const alertStatus = searchParams.get('alert_status') ?? ''
  const alertPage = readPositiveIntParam(searchParams.get('alert_page'))
  const runQuery = searchParams.get('run_query')?.trim() ?? ''
  const runPage = readPositiveIntParam(searchParams.get('run_page'))
  const setParams = useCallback(
    (updates: Record<string, string | null | undefined>, options?: { resetPage?: boolean; resetPageKeys?: string[] }) => {
      setSearchParams(applySearchParamPatch(searchParams, updates, options))
    },
    [searchParams, setSearchParams]
  )
  const [ruleSearchInput, setRuleSearchInput] = useDebouncedSearchInput(ruleQuery, (nextValue) => {
    setParams({ rule_query: nextValue || null }, { resetPageKeys: ['rule_page'] })
  })
  const [alertSearchInput, setAlertSearchInput] = useDebouncedSearchInput(alertQuery, (nextValue) => {
    setParams({ alert_query: nextValue || null }, { resetPageKeys: ['alert_page'] })
  })
  const [runSearchInput, setRunSearchInput] = useDebouncedSearchInput(runQuery, (nextValue) => {
    setParams({ run_query: nextValue || null }, { resetPageKeys: ['run_page'] })
  })
  const { data, loading, error, reload } = useAsyncResource(
    () =>
      loadMonitoring({
        rulePage,
        ruleQuery,
        ruleStatus,
        alertPage,
        alertQuery,
        alertStatus,
        runPage,
        runQuery,
      }),
    [rulePage, ruleQuery, ruleStatus, alertPage, alertQuery, alertStatus, runPage, runQuery]
  )
  const [modalOpen, setModalOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<MonitoringRule | null>(null)
  const [saving, setSaving] = useState(false)
  const [submittingRuleId, setSubmittingRuleId] = useState<string | null>(null)
  const [resolvingAlertId, setResolvingAlertId] = useState<string | null>(null)
  const [form, setForm] = useState<RuleFormState>(toRuleForm())
  const rules = data?.rules ?? asPaginated<MonitoringRule>([], rulePage, 6)
  const alerts = data?.alerts ?? asPaginated([], alertPage, 6)
  const runs = data?.runs ?? asPaginated([], runPage, 6)

  const datasetOptions = useMemo(
    () => [{ value: '', label: '不自动回流到 Dataset' }, ...((data?.datasets ?? []).map((dataset) => ({ value: dataset.id, label: dataset.name })))],
    [data?.datasets]
  )

  const handleOpenCreate = () => {
    setEditingRule(null)
    setForm(toRuleForm())
    setModalOpen(true)
  }

  const handleOpenEdit = (rule: MonitoringRule) => {
    setEditingRule(rule)
    setForm(toRuleForm(rule))
    setModalOpen(true)
  }

  const evaluatorOptions = data?.evaluators ?? []
  const ruleThresholdMap = useMemo(
    () => new Map(rules.items.map((rule) => [rule.id, rule.threshold])),
    [rules.items]
  )

  const selectedEvaluatorNames = (rule: MonitoringRule) =>
    rule.evaluator_ids.map((id) => evaluatorOptions.find((item) => item.id === id)?.name || id).join(' / ')

  async function submitForm() {
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        status: form.status,
        sampling_rate: Number(form.sampling_rate || '1'),
        threshold: Number(form.threshold || '0.7'),
        severity: form.severity,
        evaluator_ids: form.evaluator_ids,
        backfill_dataset_id: form.backfill_dataset_id || null,
        backfill_split: form.backfill_split || 'regression',
        auto_annotation: form.auto_annotation,
        guardrail_config: {
          blocked_keywords: form.blocked_keywords.split('\n').map((item) => item.trim()).filter(Boolean),
          blocked_regexes: form.blocked_regexes.split('\n').map((item) => item.trim()).filter(Boolean),
          max_output_chars: form.max_output_chars ? Number(form.max_output_chars) : null,
          require_non_empty_output: form.require_non_empty_output,
        },
      }

      if (editingRule) {
        await updateMonitoringRule(editingRule.id, payload)
      } else {
        await createMonitoringRule(payload)
      }
      setModalOpen(false)
      await reload()
    } finally {
      setSaving(false)
    }
  }

  async function handleRunRule(ruleId: string) {
    setSubmittingRuleId(ruleId)
    try {
      await runMonitoringRule(ruleId)
      await reload()
    } finally {
      setSubmittingRuleId(null)
    }
  }

  async function handleResolveAlert(alertId: string) {
    setResolvingAlertId(alertId)
    try {
      await resolveMonitoringAlert(alertId)
      await reload()
    } finally {
      setResolvingAlertId(null)
    }
  }

  return (
    <PageContainer
      title="在线监控"
      description="把线上 Trace 按规则持续评分、命中 Guardrail 后自动告警，并把低质量样本回流到 Dataset 或标注队列。"
      actions={<Button onClick={handleOpenCreate} icon={<Sparkles className="h-4 w-4" />}>新建监控规则</Button>}
    >
      {error ? (
        <EmptyState
          icon={<Radar className="h-6 w-6" />}
          title="无法加载监控数据"
          description={error}
          action={
            <Button variant="secondary" onClick={() => void reload()}>
              重试
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="规则数" value={loading ? '...' : `${data?.overview.rule_count ?? 0}`} icon={<Radar className="h-5 w-5" />} />
            <MetricCard label="启用规则" value={loading ? '...' : `${data?.overview.active_rule_count ?? 0}`} icon={<Sparkles className="h-5 w-5" />} />
            <MetricCard label="未处理告警" value={loading ? '...' : `${data?.overview.open_alert_count ?? 0}`} icon={<BellRing className="h-5 w-5" />} />
            <MetricCard
              label="告警率"
              value={loading ? '...' : formatPercent(data?.overview.alert_rate ?? 0, 1)}
              icon={<ShieldAlert className="h-5 w-5" />}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <Card className="p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.7)]">规则面板</p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[color:var(--color-text)]">
                    实时评分、关键词 Guardrail、自动回流一页配置
                  </h2>
                </div>
                <div className="flex flex-col gap-3 lg:items-end">
                  {data?.overview.avg_score !== undefined && data?.overview.avg_score !== null && (
                    <Badge variant="info">最近 7 天均分 {data.overview.avg_score.toFixed(2)}</Badge>
                  )}
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Input
                      value={ruleSearchInput}
                      onChange={(event) => setRuleSearchInput(event.target.value)}
                      placeholder="搜索监控规则"
                      icon={<Search className="h-4 w-4" />}
                      className="min-w-[14rem]"
                    />
                    <Select
                      value={ruleStatus}
                      onChange={(event) => setParams({ rule_status: event.target.value || null }, { resetPageKeys: ['rule_page'] })}
                      options={[
                        { value: '', label: '全部状态' },
                        { value: 'active', label: '启用中' },
                        { value: 'paused', label: '已暂停' },
                      ]}
                    />
                  </div>
                </div>
              </div>
              <div className="mt-5 space-y-3">
                {rules.items.length ? (
                  rules.items.map((rule) => (
                    <div key={rule.id} className="rounded-[22px] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-base font-semibold text-[color:var(--color-text)]">{rule.name}</p>
                            <Badge variant={rule.status === 'active' ? 'success' : 'default'}>{formatStatus(rule.status)}</Badge>
                            <Badge variant={alertVariant(rule.severity)}>{formatMonitorSeverity(rule.severity)}</Badge>
                          </div>
                          <p className="text-sm leading-6 text-[color:var(--color-text-soft)]">{rule.description || '暂无描述'}</p>
                          <div className="flex flex-wrap gap-4 text-sm text-[color:var(--color-text-soft)]">
                            <span>抽样 {Math.round(rule.sampling_rate * 100)}%</span>
                            <span>阈值 {rule.threshold.toFixed(2)}</span>
                            <span>Evaluator: {selectedEvaluatorNames(rule) || '无'}</span>
                            <span>上次扫描 {formatDate(rule.last_checked_at)}</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            variant="secondary"
                            loading={submittingRuleId === rule.id}
                            onClick={() => void handleRunRule(rule.id)}
                          >
                            立即扫描
                          </Button>
                          <Button variant="ghost" onClick={() => handleOpenEdit(rule)}>
                            编辑
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState
                    icon={<Radar className="h-6 w-6" />}
                    title="还没有监控规则"
                    description="先创建一条在线监控规则，让新的 Trace 自动被评分和告警。"
                  />
                )}
              </div>
              <Pagination
                className="mt-4"
                page={rules.page}
                totalPages={rules.total_pages ?? Math.max(1, Math.ceil(rules.total / Math.max(rules.page_size || 6, 1)))}
                total={rules.total}
                pageSize={rules.page_size || 6}
                onPageChange={(nextPage) => setParams({ rule_page: String(nextPage) })}
              />
            </Card>

            <div className="grid gap-4">
              <Card className="p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.7)]">最新告警</p>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Input
                      value={alertSearchInput}
                      onChange={(event) => setAlertSearchInput(event.target.value)}
                      placeholder="搜索告警 / Trace / Run"
                      icon={<Search className="h-4 w-4" />}
                      className="min-w-[14rem]"
                    />
                    <Select
                      value={alertStatus}
                      onChange={(event) => setParams({ alert_status: event.target.value || null }, { resetPageKeys: ['alert_page'] })}
                      options={[
                        { value: '', label: '全部状态' },
                        { value: 'open', label: '未处理' },
                        { value: 'resolved', label: '已处理' },
                      ]}
                    />
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  {alerts.items.length ? (
                    alerts.items.map((alert) => (
                      <div key={alert.id} className="rounded-[22px] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-[color:var(--color-text)]">{alert.title}</p>
                              <Badge variant={alertVariant(alert.severity)}>{formatMonitorSeverity(alert.severity)}</Badge>
                              <Badge variant={alert.status === 'open' ? 'warning' : 'success'}>{formatStatus(alert.status)}</Badge>
                            </div>
                            <p className="mt-2 text-sm leading-6 text-[color:var(--color-text-soft)]">{alert.summary}</p>
                            <p className="mt-2 text-sm text-[color:var(--color-text)]">
                              {describeAlertReason(alert.details, alert.kind)}
                            </p>
                            <p className="mt-2 text-sm text-[color:var(--color-text-soft)]">
                              {alert.trace_id ? (
                                <Link to={`/tracing/${alert.trace_id}`} className="inline-flex items-center gap-1 hover:text-[color:var(--color-text)]">
                                  Trace {alert.trace_id}
                                </Link>
                              ) : (
                                'Trace 无'
                              )}{' '}
                              · Run {alert.run_id || '无'} · {formatDate(alert.created_at)}
                            </p>
                          </div>
                          {alert.status === 'open' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              loading={resolvingAlertId === alert.id}
                              onClick={() => void handleResolveAlert(alert.id)}
                            >
                              标记已处理
                            </Button>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <EmptyState
                      icon={<TriangleAlert className="h-6 w-6" />}
                      title="暂无告警"
                      description="规则开始扫描后，这里会展示低分、异常或 Guardrail 命中的事件。"
                    />
                  )}
                </div>
                <Pagination
                  className="mt-4"
                  page={alerts.page}
                  totalPages={alerts.total_pages ?? Math.max(1, Math.ceil(alerts.total / Math.max(alerts.page_size || 6, 1)))}
                  total={alerts.total}
                  pageSize={alerts.page_size || 6}
                  onPageChange={(nextPage) => setParams({ alert_page: String(nextPage) })}
                />
              </Card>

              <Card className="p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.7)]">最近运行</p>
                  <Input
                    value={runSearchInput}
                    onChange={(event) => setRunSearchInput(event.target.value)}
                    placeholder="搜索 Trace / Run"
                    icon={<Search className="h-4 w-4" />}
                    className="min-w-[14rem]"
                  />
                </div>
                <div className="mt-4 space-y-3">
                  {runs.items.length ? (
                    runs.items.map((run) => (
                      <div key={run.id} className="rounded-[22px] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] px-4 py-3">
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex flex-col gap-1">
                              <Link to={`/tracing/${run.trace_id}`} className="font-medium text-[color:var(--color-text)] hover:text-[color:var(--color-accent-strong)]">
                                {run.trace_id}
                              </Link>
                              <p className="text-sm text-[color:var(--color-text-soft)]">
                                {describeRunReason(run, ruleThresholdMap.get(run.rule_id))}
                              </p>
                            </div>
                            <Badge variant={run.alert_triggered ? 'warning' : 'success'}>
                              {run.alert_triggered ? '已触发' : '通过'}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap gap-4 text-sm text-[color:var(--color-text-soft)]">
                            <span>状态 {formatStatus(run.trace_status)}</span>
                            <span>均分 {run.avg_score !== null && run.avg_score !== undefined ? run.avg_score.toFixed(2) : '无'}</span>
                            <span>Dataset 回流 {run.dataset_action_id ? (run.dataset_backfilled ? '成功' : '失败') : '未触发'}</span>
                            <span>标注 {run.annotation_action_id ? (run.annotation_created ? '已创建' : '失败') : '未触发'}</span>
                          </div>
                          {(run.dataset_action_id || run.annotation_action_id) && (
                            <div className="flex flex-wrap gap-4 text-sm text-[color:var(--color-text-soft)]">
                              {run.dataset_action_id ? <span>Dataset Action {run.dataset_action_id}</span> : null}
                              {run.annotation_action_id ? <span>标注 Action {run.annotation_action_id}</span> : null}
                            </div>
                          )}
                          {run.backfill_error_message ? (
                            <p className="text-sm text-[color:var(--color-danger)]">{run.backfill_error_message}</p>
                          ) : null}
                          {run.guardrail_hits.length > 0 && (
                            <p className="text-sm text-[color:var(--color-warning)]">Guardrail: {run.guardrail_hits.join('；')}</p>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <EmptyState
                      icon={<Sparkles className="h-6 w-6" />}
                      title="暂无监控运行记录"
                      description="创建规则后执行一次扫描，这里就会出现真实的在线评测结果。"
                    />
                  )}
                </div>
                <Pagination
                  className="mt-4"
                  page={runs.page}
                  totalPages={runs.total_pages ?? Math.max(1, Math.ceil(runs.total / Math.max(runs.page_size || 6, 1)))}
                  total={runs.total}
                  pageSize={runs.page_size || 6}
                  onPageChange={(nextPage) => setParams({ run_page: String(nextPage) })}
                />
              </Card>
            </div>
          </div>
        </>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingRule ? '编辑监控规则' : '新建监控规则'}
        size="lg"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              取消
            </Button>
            <Button loading={saving} onClick={() => void submitForm()}>
              {editingRule ? '保存规则' : '创建规则'}
            </Button>
          </div>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="规则名称" value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
          <Select
            label="状态"
            value={form.status}
            onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
            options={[
              { value: 'active', label: '启用中' },
              { value: 'paused', label: '已暂停' },
            ]}
          />
          <div className="md:col-span-2">
            <Textarea
              label="规则说明"
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              className="min-h-[7rem]"
            />
          </div>
          <Input
            label="抽样率 (0-1)"
            type="number"
            min="0"
            max="1"
            step="0.1"
            value={form.sampling_rate}
            onChange={(event) => setForm((prev) => ({ ...prev, sampling_rate: event.target.value }))}
          />
          <Input
            label="告警阈值 (0-1)"
            type="number"
            min="0"
            max="1"
            step="0.05"
            value={form.threshold}
            onChange={(event) => setForm((prev) => ({ ...prev, threshold: event.target.value }))}
          />
          <Select
            label="告警级别"
            value={form.severity}
            onChange={(event) => setForm((prev) => ({ ...prev, severity: event.target.value }))}
            options={[
              { value: 'info', label: '信息' },
              { value: 'warning', label: '警告' },
              { value: 'critical', label: '严重' },
            ]}
          />
          <Select
            label="回流 Split"
            value={form.backfill_split}
            onChange={(event) => setForm((prev) => ({ ...prev, backfill_split: event.target.value }))}
            options={[
              { value: 'regression', label: 'regression' },
              { value: 'default', label: 'default' },
              { value: 'validation', label: 'validation' },
              { value: 'train', label: 'train' },
            ]}
          />
          <Select
            label="回流 Dataset"
            value={form.backfill_dataset_id}
            onChange={(event) => setForm((prev) => ({ ...prev, backfill_dataset_id: event.target.value }))}
            options={datasetOptions}
          />
          <Input
            label="输出最大长度"
            type="number"
            min="1"
            value={form.max_output_chars}
            onChange={(event) => setForm((prev) => ({ ...prev, max_output_chars: event.target.value }))}
          />

          <div className="space-y-2 md:col-span-2">
            <label className="text-[0.74rem] font-semibold uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.7)]">
              选择 Evaluator
            </label>
            <div className="grid gap-3 rounded-[1rem] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] p-4 md:grid-cols-2">
              {evaluatorOptions.map((evaluator) => (
                <label key={evaluator.id} className="flex items-start gap-3 text-sm text-[color:var(--color-text)]">
                  <input
                    type="checkbox"
                    checked={form.evaluator_ids.includes(evaluator.id)}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        evaluator_ids: event.target.checked
                          ? [...prev.evaluator_ids, evaluator.id]
                          : prev.evaluator_ids.filter((item) => item !== evaluator.id),
                      }))
                    }
                    className="mt-1 h-4 w-4 rounded border-[color:var(--color-line-strong)]"
                  />
                  <span>{evaluator.name}</span>
                </label>
              ))}
            </div>
          </div>

          <Textarea
            label="屏蔽关键词（每行一个）"
            value={form.blocked_keywords}
            onChange={(event) => setForm((prev) => ({ ...prev, blocked_keywords: event.target.value }))}
            className="min-h-[8rem]"
          />
          <Textarea
            label="屏蔽正则（每行一个）"
            value={form.blocked_regexes}
            onChange={(event) => setForm((prev) => ({ ...prev, blocked_regexes: event.target.value }))}
            className="min-h-[8rem]"
          />

          <div className="md:col-span-2">
            <div className="rounded-[1rem] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] p-4">
              <label className="flex items-start gap-3 text-sm text-[color:var(--color-text)]">
                <input
                  type="checkbox"
                  checked={form.require_non_empty_output}
                  onChange={(event) => setForm((prev) => ({ ...prev, require_non_empty_output: event.target.checked }))}
                  className="mt-1 h-4 w-4 rounded border-[color:var(--color-line-strong)]"
                />
                <span>要求输出非空</span>
              </label>
              <label className="mt-3 flex items-start gap-3 text-sm text-[color:var(--color-text)]">
                <input
                  type="checkbox"
                  checked={form.auto_annotation}
                  onChange={(event) => setForm((prev) => ({ ...prev, auto_annotation: event.target.checked }))}
                  className="mt-1 h-4 w-4 rounded border-[color:var(--color-line-strong)]"
                />
                <span>触发告警后自动送入标注队列</span>
              </label>
            </div>
          </div>
        </div>
      </Modal>
    </PageContainer>
  )
}
