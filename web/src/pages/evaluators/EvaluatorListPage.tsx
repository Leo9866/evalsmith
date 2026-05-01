import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Copy, FlaskConical, History, Play, Plus, RefreshCw, Save, Search } from 'lucide-react'
import {
  getEvaluatorVersionDiff,
  listEvaluatorVersions,
  listEvaluators,
  runEvaluatorRegressionTest,
  testEvaluator,
} from '@/api/evaluators'
import PageContainer from '@/components/layout/PageContainer'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import EmptyState from '@/components/ui/EmptyState'
import Input from '@/components/ui/Input'
import Modal from '@/components/ui/Modal'
import Pagination from '@/components/ui/Pagination'
import ScoreBadge from '@/components/ui/ScoreBadge'
import Select from '@/components/ui/Select'
import Textarea from '@/components/ui/Textarea'
import { useDebouncedSearchInput } from '@/hooks/useDebouncedSearchInput'
import { useAsyncResource } from '@/hooks/useAsyncResource'
import { formatEvaluatorType } from '@/lib/labels'
import { asPaginated } from '@/lib/paginated'
import { canManageEvaluationAssets } from '@/lib/permissions'
import { applySearchParamPatch, readPositiveIntParam } from '@/lib/searchParams'
import { useAppStore } from '@/stores/app'
import { toast } from '@/stores/toast'
import type {
  EvalScore,
  Evaluator,
  EvaluatorRegressionResponse,
  EvaluatorRegressionSample,
  EvaluatorVersion,
  EvaluatorVersionDiff,
} from '@/types'

const REGRESSION_STORAGE_PREFIX = 'evaluator-regression-samples:'
const DEFAULT_REGRESSION_SAMPLES = JSON.stringify(
  [
    {
      label: 'helpful_answer',
      eval_input: {
        input: '如何重置 API Key？',
        output: '进入设置页，在 API Key 分页里生成新的密钥。',
        expected: '进入设置页，在 API Key 分页里生成新的密钥。',
        context: '这是一个 EvalSmith 控制台使用问题。',
      },
    },
    {
      label: 'bad_answer',
      eval_input: {
        input: '如何重置 API Key？',
        output: '',
        expected: '进入设置页，在 API Key 分页里生成新的密钥。',
        context: '这是一个 EvalSmith 控制台使用问题。',
      },
    },
  ],
  null,
  2
)

function collectConfigBadges(evaluator: Evaluator) {
  const badges: string[] = []
  if (evaluator.config.rule_config?.kind) {
    badges.push(evaluator.config.rule_config.kind)
  }
  if (evaluator.config.llm_judge_config?.protocol) {
    badges.push(String(evaluator.config.llm_judge_config.protocol))
  }
  if (evaluator.config.llm_judge_config?.use_project_default_model) {
    badges.push('项目默认模型')
  }
  if (evaluator.config.llm_judge_config?.project_model_id) {
    badges.push('项目模型')
  }
  if (evaluator.config.llm_judge_config?.model) {
    badges.push(evaluator.config.llm_judge_config.model)
  }
  if (evaluator.config.llm_judge_config?.protocol_config?.model && !evaluator.config.llm_judge_config?.model) {
    badges.push(evaluator.config.llm_judge_config.protocol_config.model)
  }
  return badges
}

function formatVersionTimestamp(value?: string | null) {
  if (!value) {
    return '当前版本'
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return parsed.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDiffValue(value: unknown) {
  if (value == null) {
    return '—'
  }
  if (typeof value === 'string') {
    return value
  }
  return JSON.stringify(value, null, 2)
}

function loadRegressionDraft(evaluatorId: string) {
  if (typeof window === 'undefined') {
    return DEFAULT_REGRESSION_SAMPLES
  }

  try {
    return window.localStorage.getItem(`${REGRESSION_STORAGE_PREFIX}${evaluatorId}`) ?? DEFAULT_REGRESSION_SAMPLES
  } catch {
    return DEFAULT_REGRESSION_SAMPLES
  }
}

function saveRegressionDraft(evaluatorId: string, draft: string) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(`${REGRESSION_STORAGE_PREFIX}${evaluatorId}`, draft)
  } catch {
    // Ignore localStorage failures and keep the in-memory draft.
  }
}

function parseRegressionSamples(raw: string) {
  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('样本集需要是一个非空 JSON 数组')
  }
  return parsed as EvaluatorRegressionSample[]
}

export default function EvaluatorListPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const currentProjectRole = useAppStore((state) => state.currentProjectRole)
  const search = searchParams.get('search')?.trim() ?? ''
  const typeFilter = searchParams.get('type') ?? ''
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
    () =>
      listEvaluators({
        page,
        page_size: 9,
        query: search || undefined,
        type: (typeFilter || undefined) as 'rule' | 'llm_judge' | 'code' | 'statistical' | undefined,
      }).then((result) => asPaginated(result, page, 9)),
    [page, search, typeFilter]
  )
  const canManage = canManageEvaluationAssets(currentProjectRole)

  const [testModalOpen, setTestModalOpen] = useState(false)
  const [testEvaluatorId, setTestEvaluatorId] = useState('')
  const [testEvaluatorName, setTestEvaluatorName] = useState('')
  const [testInput, setTestInput] = useState('用户的问题')
  const [testOutput, setTestOutput] = useState('Agent 的回答')
  const [testExpected, setTestExpected] = useState('')
  const [testContext, setTestContext] = useState('')
  const [testLoading, setTestLoading] = useState(false)
  const [testResult, setTestResult] = useState<EvalScore | null>(null)

  const [versionModalOpen, setVersionModalOpen] = useState(false)
  const [versionLoading, setVersionLoading] = useState(false)
  const [versionError, setVersionError] = useState('')
  const [versionTarget, setVersionTarget] = useState<Evaluator | null>(null)
  const [versionEntries, setVersionEntries] = useState<EvaluatorVersion[]>([])
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const [versionDiff, setVersionDiff] = useState<EvaluatorVersionDiff | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState('')
  const [regressionDraft, setRegressionDraft] = useState(DEFAULT_REGRESSION_SAMPLES)
  const [selectedRegressionVersions, setSelectedRegressionVersions] = useState<number[]>([])
  const [regressionLoading, setRegressionLoading] = useState(false)
  const [regressionError, setRegressionError] = useState('')
  const [regressionResult, setRegressionResult] = useState<EvaluatorRegressionResponse | null>(null)

  const selectedVersion = useMemo(
    () => versionEntries.find((entry) => entry.id === selectedVersionId) ?? versionEntries[0] ?? null,
    [selectedVersionId, versionEntries]
  )
  const currentVersion = useMemo(
    () => versionEntries.find((entry) => entry.is_current) ?? versionEntries[0] ?? null,
    [versionEntries]
  )
  const versionTargetId = versionTarget?.id ?? ''
  const diffBaseVersion = useMemo(() => {
    if (!selectedVersion) {
      return null
    }
    if (selectedVersion.is_current) {
      return versionEntries.find((entry) => !entry.is_current)?.version ?? null
    }
    return currentVersion?.version ?? null
  }, [currentVersion?.version, selectedVersion, versionEntries])

  useEffect(() => {
    if (!versionTargetId) {
      return
    }
    setRegressionDraft(loadRegressionDraft(versionTargetId))
    setRegressionError('')
    setRegressionResult(null)
  }, [versionTargetId])

  useEffect(() => {
    if (!versionModalOpen || !versionTargetId || !selectedVersion || diffBaseVersion == null) {
      setVersionDiff(null)
      setDiffLoading(false)
      setDiffError('')
      return
    }

    let active = true
    setDiffLoading(true)
    setDiffError('')

    void getEvaluatorVersionDiff(versionTargetId, selectedVersion.version, diffBaseVersion)
      .then((diff) => {
        if (active) {
          setVersionDiff(diff)
        }
      })
      .catch((err) => {
        if (active) {
          setVersionDiff(null)
          setDiffError(err instanceof Error ? err.message : '无法加载版本差异')
        }
      })
      .finally(() => {
        if (active) {
          setDiffLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [diffBaseVersion, selectedVersion, versionModalOpen, versionTargetId])

  const openTestModal = (evaluatorId: string, evaluatorName: string) => {
    setTestEvaluatorId(evaluatorId)
    setTestEvaluatorName(evaluatorName)
    setTestResult(null)
    setTestModalOpen(true)
  }

  const openVersionModal = async (evaluator: Evaluator) => {
    setVersionTarget(evaluator)
    setVersionModalOpen(true)
    setVersionLoading(true)
    setVersionError('')
    setVersionEntries([])
    setSelectedVersionId('')
    setVersionDiff(null)
    setDiffError('')
    setRegressionError('')
    setRegressionResult(null)

    try {
      const versions = await listEvaluatorVersions(evaluator.id)
      setVersionEntries(versions)
      setSelectedVersionId(versions.find((entry) => entry.is_current)?.id ?? versions[0]?.id ?? '')
      setSelectedRegressionVersions(versions.slice(0, 3).map((entry) => entry.version))
    } catch (err) {
      setVersionError(err instanceof Error ? err.message : '无法加载版本历史')
    } finally {
      setVersionLoading(false)
    }
  }

  const openCloneForm = (evaluatorId: string, version?: number) => {
    const params = new URLSearchParams({ clone: evaluatorId })
    if (typeof version === 'number') {
      params.set('version', String(version))
    }
    navigate(`/evaluators/new?${params.toString()}`)
  }

  const handleTest = async () => {
    setTestLoading(true)
    setTestResult(null)
    try {
      const result = await testEvaluator(testEvaluatorId, {
        eval_input: {
          input: testInput,
          output: testOutput,
          expected: testExpected || undefined,
          context: testContext || undefined,
        },
      })
      setTestResult(result)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '测试失败', '测试失败')
    } finally {
      setTestLoading(false)
    }
  }

  const handleSaveRegressionDraft = () => {
    if (!versionTargetId) {
      return
    }
    saveRegressionDraft(versionTargetId, regressionDraft)
    toast.success('最近样本集已保存，下次打开会自动复用', '样本集已保存')
  }

  const toggleRegressionVersion = (version: number) => {
    const orderedVersions = versionEntries.map((entry) => entry.version)
    setSelectedRegressionVersions((current) => {
      const next = current.includes(version) ? current.filter((item) => item !== version) : [...current, version]
      return orderedVersions.filter((item) => next.includes(item))
    })
  }

  const handleRunRegression = async () => {
    if (!versionTargetId) {
      return
    }

    let samples: EvaluatorRegressionSample[]
    try {
      samples = parseRegressionSamples(regressionDraft)
    } catch (err) {
      const message = err instanceof Error ? err.message : '样本集 JSON 解析失败'
      setRegressionError(message)
      toast.error(message, '回归测试失败')
      return
    }

    if (!selectedRegressionVersions.length) {
      const message = '至少选择一个需要回归的版本'
      setRegressionError(message)
      toast.error(message, '回归测试失败')
      return
    }

    setRegressionLoading(true)
    setRegressionError('')
    try {
      saveRegressionDraft(versionTargetId, regressionDraft)
      const result = await runEvaluatorRegressionTest(versionTargetId, {
        versions: selectedRegressionVersions,
        samples,
      })
      setRegressionResult(result)
      toast.success(`已完成 ${result.versions.length} 个版本的回归测试`, '回归测试完成')
    } catch (err) {
      const message = err instanceof Error ? err.message : '回归测试失败'
      setRegressionError(message)
      toast.error(message, '回归测试失败')
    } finally {
      setRegressionLoading(false)
    }
  }

  return (
    <PageContainer
      title="Evaluator"
      description="管理内置检查和自定义 Judge，让每次 Experiment 使用同一套评判标准。"
      actions={
        <>
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="搜索 Evaluator"
            icon={<Search className="h-4 w-4" />}
            className="min-w-[14rem]"
          />
          <Select
            value={typeFilter}
            onChange={(event) => setParams({ type: event.target.value || null }, { resetPage: true })}
            options={[
              { value: '', label: '全部类型' },
              { value: 'rule', label: '规则' },
              { value: 'llm_judge', label: 'LLM Judge' },
              { value: 'code', label: '代码' },
              { value: 'statistical', label: '统计' },
            ]}
          />
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/evaluators/new')} disabled={!canManage}>
            新建 Evaluator
          </Button>
        </>
      }
    >
      {error ? (
        <EmptyState
          icon={<FlaskConical className="h-6 w-6" />}
          title="无法加载 Evaluator"
          description={error}
          action={<Button variant="secondary" onClick={() => void reload()}>重试</Button>}
        />
      ) : loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Card key={index} className="h-56 animate-pulse bg-[color:var(--color-panel-strong)]">
              <div />
            </Card>
          ))}
        </div>
      ) : (data?.items.length ?? 0) ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(data?.items ?? []).map((evaluator) => {
            const badges = collectConfigBadges(evaluator)

            return (
              <Card key={evaluator.id} className="p-6" hover>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">
                      {formatEvaluatorType(evaluator.type)}
                    </p>
                    <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-[color:var(--color-text)]">
                      {evaluator.name}
                    </h2>
                  </div>
                  <Badge variant={evaluator.is_builtin ? 'info' : 'default'}>
                    {evaluator.is_builtin ? '内置' : '自定义'}
                  </Badge>
                </div>

                <p className="mt-4 text-sm leading-7 text-[color:var(--color-text-soft)]">
                  {evaluator.description || '暂无描述'}
                </p>

                <div className="mt-5 flex flex-wrap gap-2">
                  {badges.map((badge) => (
                    <Badge key={`${evaluator.id}-${badge}`} variant="default">
                      {badge}
                    </Badge>
                  ))}
                  <Badge variant="default">v{evaluator.version}</Badge>
                </div>

                <div className="mt-5 rounded-[1.1rem] border border-[color:var(--color-line)] bg-[rgba(255,252,247,0.82)] px-4 py-3 text-sm leading-7 text-[color:var(--color-text-soft)]">
                  {evaluator.is_builtin
                    ? '内置 Evaluator 当前为只读资产。如果需要调整规则或 Prompt，请先克隆为自定义版本。'
                    : '自定义 Evaluator 支持查看版本差异，并可用同一组样本回归最近几个版本。'}
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<History className="h-3.5 w-3.5" />}
                    onClick={() => void openVersionModal(evaluator)}
                  >
                    查看版本
                  </Button>
                  {canManage && (
                    <Button
                      size="sm"
                      variant={evaluator.is_builtin ? 'secondary' : 'ghost'}
                      icon={<Copy className="h-3.5 w-3.5" />}
                      onClick={() => openCloneForm(evaluator.id, evaluator.version)}
                    >
                      克隆为自定义
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Play className="h-3.5 w-3.5" />}
                    onClick={() => openTestModal(evaluator.id, evaluator.name)}
                  >
                    测试
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      ) : (
        <EmptyState
          icon={<FlaskConical className="h-6 w-6" />}
          title="暂无 Evaluator"
          description="内置 Evaluator 通常会自动出现；如果列表为空，请确认 eval engine 正在运行。"
        />
      )}
      <Pagination
        page={data?.page ?? page}
        totalPages={data?.total_pages ?? Math.max(1, Math.ceil((data?.total ?? 0) / Math.max(data?.page_size ?? 9, 1)))}
        total={data?.total ?? 0}
        pageSize={data?.page_size || 9}
        onPageChange={(nextPage) => setParams({ page: String(nextPage) })}
      />

      <Modal
        open={versionModalOpen}
        onClose={() => setVersionModalOpen(false)}
        title={versionTarget ? `${versionTarget.name} 版本历史` : '版本历史'}
        size="lg"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setVersionModalOpen(false)}>关闭</Button>
            {canManage && versionTarget && selectedVersion && (
              <Button variant="secondary" onClick={() => openCloneForm(versionTarget.id, selectedVersion.version)}>
                基于当前版本克隆
              </Button>
            )}
          </div>
        }
      >
        {versionLoading ? (
          <div className="grid gap-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-24 animate-pulse rounded-[1.35rem] bg-[color:var(--color-panel-strong)]" />
            ))}
          </div>
        ) : versionError ? (
          <div className="rounded-[1.35rem] border border-dashed border-[color:rgba(186,63,54,0.24)] bg-[rgba(186,63,54,0.06)] px-4 py-3 text-sm leading-7 text-[color:var(--color-text-soft)]">
            {versionError}
          </div>
        ) : selectedVersion ? (
          <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-3">
              {versionEntries.map((entry) => {
                const active = entry.id === selectedVersion.id
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setSelectedVersionId(entry.id)}
                    className={[
                      'w-full rounded-[1.35rem] border px-4 py-4 text-left transition',
                      active
                        ? 'border-[rgba(193,109,58,0.36)] bg-[rgba(193,109,58,0.08)] shadow-[0_12px_24px_rgba(150,75,36,0.08)]'
                        : 'border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] hover:border-[color:var(--color-line-strong)]',
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[color:var(--color-text)]">v{entry.version}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.22em] text-[color:rgba(93,83,73,0.6)]">
                          {entry.is_current ? 'Current' : 'Snapshot'}
                        </p>
                      </div>
                      {entry.is_current && <Badge variant="info">当前版本</Badge>}
                    </div>
                    <p className="mt-3 text-sm leading-7 text-[color:var(--color-text-soft)]">
                      {entry.changelog || entry.description || '暂无变更说明'}
                    </p>
                    <p className="mt-2 text-xs text-[color:rgba(93,83,73,0.72)]">
                      {formatVersionTimestamp(entry.created_at)}
                    </p>
                  </button>
                )
              })}
            </div>

            <div className="space-y-4">
              <Card className="p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">
                    版本详情
                  </p>
                  <Badge variant={selectedVersion.is_current ? 'info' : 'default'}>
                    {selectedVersion.is_current ? '当前版本' : `历史版本 v${selectedVersion.version}`}
                  </Badge>
                </div>
                <h3 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-[color:var(--color-text)]">
                  {versionTarget?.name}
                </h3>
                <p className="mt-3 text-sm leading-7 text-[color:var(--color-text-soft)]">
                  {selectedVersion.description || versionTarget?.description || '暂无描述'}
                </p>
                <div className="mt-4 rounded-[1.1rem] border border-[color:var(--color-line)] bg-[rgba(255,252,247,0.82)] px-4 py-3 text-sm leading-7 text-[color:var(--color-text-soft)]">
                  {selectedVersion.changelog || '当前版本没有额外变更说明。'}
                </div>
              </Card>

              <Card className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">版本差异</p>
                    <h3 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-[color:var(--color-text)]">
                      {diffBaseVersion != null
                        ? `v${selectedVersion.version} 对比 v${diffBaseVersion}`
                        : '当前没有可对比的其他版本'}
                    </h3>
                  </div>
                  {diffBaseVersion != null && (
                    <Badge variant="default">
                      {versionDiff?.changes.length ?? 0} 处字段变化
                    </Badge>
                  )}
                </div>

                {diffLoading ? (
                  <div className="mt-4 grid gap-3">
                    {Array.from({ length: 3 }).map((_, index) => (
                      <div key={index} className="h-20 animate-pulse rounded-[1.1rem] bg-[color:var(--color-panel-strong)]" />
                    ))}
                  </div>
                ) : diffError ? (
                  <div className="mt-4 rounded-[1.1rem] border border-dashed border-[color:rgba(186,63,54,0.24)] bg-[rgba(186,63,54,0.06)] px-4 py-3 text-sm leading-7 text-[color:var(--color-text-soft)]">
                    {diffError}
                  </div>
                ) : diffBaseVersion == null ? (
                  <p className="mt-4 rounded-[1.1rem] border border-dashed border-[color:var(--color-line)] px-4 py-3 text-sm leading-7 text-[color:var(--color-text-soft)]">
                    当前只有一个版本记录，暂时没有可比对的历史版本。
                  </p>
                ) : versionDiff && versionDiff.changes.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    {versionDiff.changes.map((change) => (
                      <div key={`${change.path}-${change.change_type}`} className="rounded-[1.1rem] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-mono text-sm font-semibold text-[color:var(--color-text)]">{change.path}</p>
                          <Badge variant={change.change_type === 'changed' ? 'info' : 'default'}>
                            {change.change_type === 'added' ? '新增' : change.change_type === 'removed' ? '移除' : '变更'}
                          </Badge>
                        </div>
                        <div className="mt-3 grid gap-3 lg:grid-cols-2">
                          <div>
                            <p className="text-xs uppercase tracking-[0.22em] text-[color:rgba(93,83,73,0.62)]">对照版本</p>
                            <pre className="mt-2 overflow-auto rounded-[0.95rem] bg-[#1e1916] p-3 text-xs leading-6 text-[#f3ede3]">
                              <code>{formatDiffValue(change.before)}</code>
                            </pre>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.22em] text-[color:rgba(93,83,73,0.62)]">所选版本</p>
                            <pre className="mt-2 overflow-auto rounded-[0.95rem] bg-[#1e1916] p-3 text-xs leading-6 text-[#f3ede3]">
                              <code>{formatDiffValue(change.after)}</code>
                            </pre>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 rounded-[1.1rem] border border-dashed border-[color:var(--color-line)] px-4 py-3 text-sm leading-7 text-[color:var(--color-text-soft)]">
                    当前所选版本与对照版本在配置上没有差异。
                  </p>
                )}
              </Card>

              {!selectedVersion.is_current && currentVersion ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card className="p-5">
                    <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">当前配置</p>
                    <pre className="mt-4 overflow-auto rounded-[1.1rem] bg-[#1e1916] p-4 text-xs leading-6 text-[#f3ede3]">
                      <code>{JSON.stringify(currentVersion.config, null, 2)}</code>
                    </pre>
                  </Card>
                  <Card className="p-5">
                    <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">所选版本配置</p>
                    <pre className="mt-4 overflow-auto rounded-[1.1rem] bg-[#1e1916] p-4 text-xs leading-6 text-[#f3ede3]">
                      <code>{JSON.stringify(selectedVersion.config, null, 2)}</code>
                    </pre>
                  </Card>
                </div>
              ) : (
                <Card className="p-5">
                  <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">配置快照</p>
                  <pre className="mt-4 overflow-auto rounded-[1.1rem] bg-[#1e1916] p-4 text-xs leading-6 text-[#f3ede3]">
                    <code>{JSON.stringify(selectedVersion.config, null, 2)}</code>
                  </pre>
                </Card>
              )}

              <Card className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">版本回归测试</p>
                    <h3 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-[color:var(--color-text)]">复用最近样本，快速比较多个版本</h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" icon={<Save className="h-3.5 w-3.5" />} onClick={handleSaveRegressionDraft}>
                      保存样本集
                    </Button>
                    <Button size="sm" variant="secondary" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={regressionLoading} onClick={() => void handleRunRegression()}>
                      运行回归
                    </Button>
                  </div>
                </div>

                <div className="mt-4 rounded-[1.1rem] border border-[color:var(--color-line)] bg-[rgba(255,252,247,0.82)] px-4 py-3 text-sm leading-7 text-[color:var(--color-text-soft)]">
                  样本集会保存在当前浏览器中。默认勾选最近 3 个版本，适合在每次调整规则或 Prompt 后快速做回归复测。
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  {versionEntries.map((entry) => (
                    <label key={`regression-version-${entry.id}`} className="flex items-center gap-2 rounded-full border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] px-3 py-2 text-sm text-[color:var(--color-text)]">
                      <input
                        type="checkbox"
                        checked={selectedRegressionVersions.includes(entry.version)}
                        onChange={() => toggleRegressionVersion(entry.version)}
                        className="h-4 w-4 rounded border-[color:var(--color-line-strong)] accent-[color:var(--color-accent-strong)]"
                      />
                      <span>v{entry.version}{entry.is_current ? '（当前）' : ''}</span>
                    </label>
                  ))}
                </div>

                <div className="mt-4">
                  <Textarea
                    label="回归样本集（JSON 数组）"
                    value={regressionDraft}
                    onChange={(event) => setRegressionDraft(event.target.value)}
                    className="min-h-[16rem] font-mono text-xs"
                  />
                </div>

                {regressionError && (
                  <div className="mt-4 rounded-[1.1rem] border border-dashed border-[color:rgba(186,63,54,0.24)] bg-[rgba(186,63,54,0.06)] px-4 py-3 text-sm leading-7 text-[color:var(--color-text-soft)]">
                    {regressionError}
                  </div>
                )}

                {regressionResult ? (
                  <div className="mt-5 space-y-4">
                    {regressionResult.versions.map((versionResult) => (
                      <div key={`regression-result-${versionResult.version}`} className="rounded-[1.1rem] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <p className="text-base font-semibold text-[color:var(--color-text)]">v{versionResult.version}</p>
                            {versionResult.is_current && <Badge variant="info">当前版本</Badge>}
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-sm text-[color:var(--color-text-soft)]">
                            <span>平均分 {versionResult.avg_score != null ? versionResult.avg_score.toFixed(2) : '—'}</span>
                            <span>通过 {versionResult.passed}</span>
                            <span>失败 {versionResult.failed}</span>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3">
                          {versionResult.sample_results.map((sampleResult) => (
                            <div key={`regression-sample-${versionResult.version}-${sampleResult.index}`} className="rounded-[0.95rem] border border-[color:var(--color-line)] px-4 py-3">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <p className="text-sm font-medium text-[color:var(--color-text)]">
                                    {sampleResult.label || `样本 ${sampleResult.index + 1}`}
                                  </p>
                                  {sampleResult.result?.reasoning && (
                                    <p className="mt-1 text-sm leading-7 text-[color:var(--color-text-soft)]">
                                      {sampleResult.result.reasoning}
                                    </p>
                                  )}
                                  {sampleResult.error && (
                                    <p className="mt-1 text-sm leading-7 text-[color:var(--color-danger)]">
                                      {sampleResult.error}
                                    </p>
                                  )}
                                </div>
                                {sampleResult.result ? (
                                  <div className="flex items-center gap-3">
                                    <span className="text-lg font-semibold text-[color:var(--color-text)]">
                                      {sampleResult.result.score.toFixed(2)}
                                    </span>
                                    <ScoreBadge score={sampleResult.result.score} />
                                  </div>
                                ) : (
                                  <Badge variant="default">运行失败</Badge>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 rounded-[1.1rem] border border-dashed border-[color:var(--color-line)] px-4 py-3 text-sm leading-7 text-[color:var(--color-text-soft)]">
                    运行后会展示各版本在同一组样本上的平均分、通过数和逐样本结果。
                  </p>
                )}
              </Card>
            </div>
          </div>
        ) : (
          <p className="text-sm text-[color:var(--color-text-soft)]">暂无版本记录。</p>
        )}
      </Modal>

      <Modal
        open={testModalOpen}
        onClose={() => setTestModalOpen(false)}
        title={`测试 ${testEvaluatorName}`}
        size="lg"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setTestModalOpen(false)}>关闭</Button>
            <Button loading={testLoading} onClick={() => void handleTest()}>运行测试</Button>
          </div>
        }
      >
        <div className="grid gap-4">
          <Textarea label="Input（用户输入）" value={testInput} onChange={(event) => setTestInput(event.target.value)} className="min-h-[5rem]" />
          <Textarea label="Output（Agent 输出）" value={testOutput} onChange={(event) => setTestOutput(event.target.value)} className="min-h-[5rem]" />
          <Textarea label="Expected（期望输出，可选）" value={testExpected} onChange={(event) => setTestExpected(event.target.value)} className="min-h-[4rem]" />
          <Textarea label="Context（上下文，可选）" value={testContext} onChange={(event) => setTestContext(event.target.value)} className="min-h-[4rem]" />

          {testResult && (
            <Card className="p-5">
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">评分结果</p>
                  <div className="mt-2 flex items-center gap-3">
                    <span className="text-3xl font-bold text-[color:var(--color-text)]">{testResult.score.toFixed(2)}</span>
                    <ScoreBadge score={testResult.score} />
                  </div>
                </div>
              </div>
              {testResult.reasoning && (
                <div className="mt-4">
                  <p className="text-sm font-medium text-[color:var(--color-text)]">Reasoning</p>
                  <p className="mt-1 text-sm leading-7 text-[color:var(--color-text-soft)]">{testResult.reasoning}</p>
                </div>
              )}
            </Card>
          )}
        </div>
      </Modal>
    </PageContainer>
  )
}
