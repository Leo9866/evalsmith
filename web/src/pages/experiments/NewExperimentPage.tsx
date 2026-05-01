import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { createExperiment, listExperiments, previewExperimentTarget } from '@/api/experiments'
import { listDatasetSplits, listDatasets, listExamples, listVersions } from '@/api/datasets'
import { listEvaluators } from '@/api/evaluators'
import { listPrompts, listPromptVersions } from '@/api/prompts'
import PageContainer from '@/components/layout/PageContainer'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import CodeBlock from '@/components/ui/CodeBlock'
import EmptyState from '@/components/ui/EmptyState'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Textarea from '@/components/ui/Textarea'
import { useAsyncResource } from '@/hooks/useAsyncResource'
import { formatEvaluatorType } from '@/lib/labels'
import { asItems } from '@/lib/paginated'
import { canManageEvaluationAssets } from '@/lib/permissions'
import { useAppStore } from '@/stores/app'
import { toast } from '@/stores/toast'
import type { Evaluator, ExperimentTargetPreview, HTTPMethod, Prompt } from '@/types'

function parseHeadersInput(raw: string) {
  if (!raw.trim()) {
    return {}
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(error instanceof Error ? `请求头 JSON 解析失败：${error.message}` : '请求头 JSON 解析失败')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('请求头必须是一个 JSON 对象，例如 {"Authorization":"Bearer token"}')
  }

  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, value == null ? '' : String(value)])
  )
}

async function loadExperimentForm() {
  const [datasets, evaluators, experiments, prompts] = await Promise.all([
    listDatasets({ page_size: 100 }),
    listEvaluators({ page_size: 100 }),
    listExperiments({ page_size: 100 }),
    listPrompts({ page_size: 100 }),
  ])

  return {
    datasets: asItems(datasets),
    evaluators: asItems(evaluators),
    experiments: asItems(experiments),
    prompts: asItems(prompts),
  }
}

export default function NewExperimentPage() {
  const navigate = useNavigate()
  const currentProjectRole = useAppStore((state) => state.currentProjectRole)
  const { data, loading, error, reload } = useAsyncResource(loadExperimentForm, [])
  const canManage = canManageEvaluationAssets(currentProjectRole)
  const [name, setName] = useState('候选 Prompt 回归')
  const [description, setDescription] = useState('将候选目标与当前 Dataset 做对比。')
  const [datasetId, setDatasetId] = useState('')
  const [datasetVersion, setDatasetVersion] = useState('')
  const [split, setSplit] = useState('default')
  const [promptId, setPromptId] = useState('')
  const [promptVersion, setPromptVersion] = useState('')
  const [targetUrl, setTargetUrl] = useState('http://localhost:8010/answer')
  const [targetMethod, setTargetMethod] = useState<HTTPMethod>('POST')
  const [targetHeadersText, setTargetHeadersText] = useState('{}')
  const [bodyTemplate, setBodyTemplate] = useState('{"input": {{inputs.input}}}')
  const [responsePath, setResponsePath] = useState('')
  const [timeoutMs, setTimeoutMs] = useState('120000')
  const [concurrency, setConcurrency] = useState('2')
  const [selectedEvaluatorIds, setSelectedEvaluatorIds] = useState<string[]>(['builtin:exact_match', 'builtin:not_empty'])
  const [submitting, setSubmitting] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [previewResult, setPreviewResult] = useState<ExperimentTargetPreview | null>(null)
  const [previewExampleId, setPreviewExampleId] = useState('')

  const datasetOptions = useMemo(
    () => (data?.datasets ?? []).map((dataset) => ({ value: dataset.id, label: dataset.name })),
    [data?.datasets]
  )
  const promptOptions = useMemo(
    () => [{ value: '', label: '不绑定 Prompt（保持现有模板）' }, ...((data?.prompts ?? []).map((prompt: Prompt) => ({
      value: prompt.id,
      label: `${prompt.name} · v${prompt.current_version}`,
    })))],
    [data?.prompts]
  )
  const activeDatasetId = datasetId || data?.datasets[0]?.id || ''
  const activePromptId = promptId || ''
  const { data: datasetConfig } = useAsyncResource(
    async () => {
      if (!activeDatasetId) {
        return { versions: [], splits: [] }
      }

      const [versions, splits] = await Promise.all([listVersions(activeDatasetId), listDatasetSplits(activeDatasetId)])
      return { versions, splits }
    },
    [activeDatasetId]
  )
  const { data: promptVersions } = useAsyncResource(
    async () => {
      if (!activePromptId) {
        return []
      }
      return listPromptVersions(activePromptId)
    },
    [activePromptId]
  )

  useEffect(() => {
    if (!datasetConfig?.versions.length) {
      if (!activeDatasetId) {
        setDatasetVersion('')
      }
      return
    }

    const availableVersions = datasetConfig.versions.map((item) => String(item.version))
    if (!datasetVersion || !availableVersions.includes(datasetVersion)) {
      setDatasetVersion(availableVersions[0] ?? '')
    }
  }, [activeDatasetId, datasetConfig?.versions, datasetVersion])

  useEffect(() => {
    if (!datasetConfig?.splits.length) {
      return
    }
    const availableSplits = new Set(['all', ...datasetConfig.splits.map((item) => item.split)])
    if (!availableSplits.has(split)) {
      setSplit('all')
    }
  }, [datasetConfig?.splits, split])

  useEffect(() => {
    if (!activePromptId) {
      setPromptVersion('')
      return
    }
    if (!promptVersions?.length) {
      return
    }
    const current = promptVersions.find((item) => item.is_current) ?? promptVersions[0]
    const versionValues = new Set(promptVersions.map((item) => String(item.version)))
    if (!promptVersion || !versionValues.has(promptVersion)) {
      setPromptVersion(String(current?.version ?? ''))
    }
  }, [activePromptId, promptVersion, promptVersions])

  const versionOptions = useMemo(
    () =>
      (datasetConfig?.versions ?? []).map((version) => ({
        value: String(version.version),
        label: `v${version.version}${version.description ? ` · ${version.description}` : ''}`,
      })),
    [datasetConfig?.versions]
  )

  const splitOptions = useMemo(
    () => [
      { value: 'all', label: '全部样本' },
      ...((datasetConfig?.splits ?? []).map((item) => ({
        value: item.split,
        label: `${item.split} (${item.count})`,
      }))),
    ],
    [datasetConfig?.splits]
  )
  const promptVersionOptions = useMemo(
    () =>
      (promptVersions ?? []).map((version) => ({
        value: String(version.version),
        label: `v${version.version}${version.change_note ? ` · ${version.change_note}` : version.is_current ? ' · 当前版本' : ''}`,
      })),
    [promptVersions]
  )

  const toggleEvaluator = (evaluatorId: string) => {
    setSelectedEvaluatorIds((current) =>
      current.includes(evaluatorId)
        ? current.filter((id) => id !== evaluatorId)
        : [...current, evaluatorId]
    )
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const parsedHeaders = parseHeadersInput(targetHeadersText)
      const parsedTimeout = Number(timeoutMs)
      const experiment = await createExperiment({
        name,
        description,
        dataset_id: activeDatasetId,
        dataset_version: datasetVersion ? Number(datasetVersion) : undefined,
        split,
        evaluator_ids: selectedEvaluatorIds,
        target_url: targetUrl,
        target_method: targetMethod,
        target_headers: parsedHeaders,
        target_body_template: bodyTemplate,
        target_response_path: responsePath.trim() || undefined,
        target_timeout_ms: parsedTimeout,
        concurrency: Number(concurrency),
        prompt_ref: promptId
          ? {
              prompt_id: promptId,
              version: promptVersion ? Number(promptVersion) : undefined,
            }
          : undefined,
      })
      navigate(`/experiments/${experiment.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建 Experiment 失败', '创建 Experiment 失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handlePreview = async () => {
    if (!activeDatasetId) {
      toast.error('请先选择一个 Dataset，再试调目标服务。', '缺少 Dataset')
      return
    }

    setPreviewing(true)
    try {
      const parsedHeaders = parseHeadersInput(targetHeadersText)
      const parsedTimeout = Number(timeoutMs)
      const examples = await listExamples(activeDatasetId, {
        page_size: 1,
        split: split === 'all' ? undefined : split,
        version: datasetVersion ? Number(datasetVersion) : undefined,
      })
      const sample = examples.items[0]
      if (!sample) {
        throw new Error('当前 Dataset / Split 下没有可用于试调的样本')
      }

      const preview = await previewExperimentTarget({
        target_url: targetUrl,
        target_method: targetMethod,
        target_headers: parsedHeaders,
        target_body_template: bodyTemplate,
        target_response_path: responsePath.trim() || undefined,
        target_timeout_ms: parsedTimeout,
        prompt_ref: promptId
          ? {
              prompt_id: promptId,
              version: promptVersion ? Number(promptVersion) : undefined,
            }
          : undefined,
        example: {
          id: sample.id,
          inputs: sample.inputs,
          expected_outputs: sample.expected_outputs,
          metadata: sample.metadata,
          split: sample.split,
        },
      })
      setPreviewResult(preview)
      setPreviewExampleId(sample.id)
      toast.success('目标服务试调成功，可以直接启动 Experiment。')
    } catch (err) {
      setPreviewResult(null)
      setPreviewExampleId('')
      toast.error(err instanceof Error ? err.message : '试调目标服务失败', '试调失败')
    } finally {
      setPreviewing(false)
    }
  }

  if (error) {
    return (
      <PageContainer title="创建 Experiment" description="让真实目标服务跑一次回归集合。">
        <EmptyState
          icon={<Badge variant="danger">!</Badge>}
          title="无法加载前置数据"
          description={error}
          action={<Button variant="secondary" onClick={() => void reload()}>重试</Button>}
        />
      </PageContainer>
    )
  }

  if (!canManage) {
    return (
      <PageContainer title="创建 Experiment" description="当前角色只能查看 Experiment，不能启动新的回归任务。">
        <EmptyState
          icon={<ShieldAlert className="h-6 w-6" />}
          title="当前角色没有创建权限"
          description="请切换到拥有 Developer 及以上权限的项目角色，或联系项目 Owner / Admin。"
          action={
            <Button variant="secondary" onClick={() => navigate('/experiments')}>
              返回 Experiment 列表
            </Button>
          }
        />
      </PageContainer>
    )
  }

  return (
    <PageContainer
      title="创建 Experiment"
      description="关联 Dataset、选择 Evaluator，并让运行器去调用一个已运行中的 Agent endpoint。"
      actions={
        <>
          <Button variant="ghost" onClick={() => navigate('/experiments')}>
            返回
          </Button>
          <Button loading={submitting || loading} onClick={() => void handleSubmit()}>
            启动 Experiment
          </Button>
        </>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="p-6">
          <div className="grid gap-4">
            <Input label="名称" value={name} onChange={(event) => setName(event.target.value)} />
            <Textarea label="描述" value={description} onChange={(event) => setDescription(event.target.value)} />
            <Select
              label="Dataset"
              value={activeDatasetId}
              onChange={(event) => setDatasetId(event.target.value)}
              options={datasetOptions}
            />
            <Select
              label="Dataset 版本"
              value={datasetVersion}
              onChange={(event) => setDatasetVersion(event.target.value)}
              options={versionOptions.length ? versionOptions : [{ value: '', label: '当前最新版本' }]}
            />
            <Select
              label="Split"
              value={split}
              onChange={(event) => setSplit(event.target.value)}
              options={splitOptions.length ? splitOptions : [{ value: 'default', label: 'default' }]}
            />
            <div className="grid gap-4 md:grid-cols-2">
              <Select
                label="Prompt（可选）"
                value={promptId}
                onChange={(event) => setPromptId(event.target.value)}
                options={promptOptions}
              />
              <Select
                label="Prompt 版本"
                value={promptVersion}
                onChange={(event) => setPromptVersion(event.target.value)}
                options={promptVersionOptions.length ? promptVersionOptions : [{ value: '', label: '当前最新版本' }]}
                disabled={!promptId}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-[0.38fr_0.62fr]">
              <Select
                label="请求方法"
                value={targetMethod}
                onChange={(event) => setTargetMethod(event.target.value as HTTPMethod)}
                options={[
                  { value: 'POST', label: 'POST' },
                  { value: 'PUT', label: 'PUT' },
                  { value: 'PATCH', label: 'PATCH' },
                  { value: 'GET', label: 'GET' },
                ]}
              />
              <Input
                label="Target URL"
                value={targetUrl}
                onChange={(event) => setTargetUrl(event.target.value)}
                placeholder="http://localhost:8010/answer"
              />
            </div>
            <Textarea
              label="请求头 (JSON)"
              value={targetHeadersText}
              onChange={(event) => setTargetHeadersText(event.target.value)}
              className="min-h-[7rem] font-mono"
              placeholder='{"Authorization":"Bearer <token>"}'
            />
            <Textarea
              label="请求体模板"
              value={bodyTemplate}
              onChange={(event) => setBodyTemplate(event.target.value)}
              className="min-h-[10rem] font-mono"
            />
            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label="响应提取路径（可选）"
                value={responsePath}
                onChange={(event) => setResponsePath(event.target.value)}
                placeholder="例如 data.answer"
              />
              <Input
                label="超时（毫秒）"
                type="number"
                min="1000"
                max="600000"
                value={timeoutMs}
                onChange={(event) => setTimeoutMs(event.target.value)}
              />
            </div>
            <Input
              label="并发数"
              type="number"
              min="1"
              max="50"
              value={concurrency}
              onChange={(event) => setConcurrency(event.target.value)}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" loading={previewing} onClick={() => void handlePreview()}>
                测试目标
              </Button>
              <p className="text-sm text-[color:var(--color-text-soft)]">
                会用当前 Dataset / Split 下的第一条样本试调 endpoint，验证请求模板和响应提取是否正确。
              </p>
            </div>
            <div className="rounded-[22px] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] p-4 text-sm leading-7 text-[color:var(--color-text-soft)]">
              <p>
                模板支持读取样本字段，例如 <code>{'{{inputs.input}}'}</code>、<code>{'{{expected_outputs.answer}}'}</code>、
                <code>{'{{metadata.locale}}'}</code>。
              </p>
              <p className="mt-2">
                如果绑定了 Prompt，也可以在请求模板中使用 <code>{'{{prompt.system}}'}</code>、<code>{'{{prompt.user}}'}</code>、
                <code>{'{{prompt.messages}}'}</code>。
              </p>
              <p className="mt-2">
                如果目标返回的是标准 JSON，可留空“响应提取路径”，系统会优先尝试 <code>output/result/data/response/text/content/answer</code>。
              </p>
              <p className="mt-2">
                预览与正式运行会使用当前选择的 Dataset 版本和 Split，避免试调样本与实际跑批样本不一致。
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">Evaluator 集合</p>
          <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-[color:var(--color-text)]">
            选择你信任的评估信号
          </h2>
          <div className="mt-5 space-y-3">
            {(data?.evaluators ?? []).map((evaluator: Evaluator) => {
              const selected = selectedEvaluatorIds.includes(evaluator.id)
              return (
                <button
                  key={evaluator.id}
                  type="button"
                  onClick={() => toggleEvaluator(evaluator.id)}
                  className={`w-full rounded-[22px] border px-4 py-4 text-left transition ${
                    selected
                      ? 'border-[color:rgba(186,91,42,0.28)] bg-[rgba(186,91,42,0.08)]'
                      : 'border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] hover:border-[color:var(--color-line-strong)]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-[color:var(--color-text)]">{evaluator.name}</p>
                      <p className="mt-1 text-sm text-[color:var(--color-text-soft)]">
                        {evaluator.description || '暂无描述'}
                      </p>
                    </div>
                    <Badge variant={selected ? 'info' : 'default'}>
                      {selected ? '已选中' : formatEvaluatorType(evaluator.type)}
                    </Badge>
                  </div>
                </button>
              )
            })}
          </div>

          <div className="mt-6 rounded-[22px] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] p-4 text-sm leading-7 text-[color:var(--color-text-soft)]">
            <p>
              演示 agent 最适合搭配 <strong>builtin:exact_match</strong> 和 <strong>builtin:not_empty</strong>。
            </p>
            <p className="mt-2">
              如果你启用了 LLM Judge，请确认 eval engine 已为当前模型提供方配置有效的 API Key。
            </p>
          </div>
        </Card>
      </div>

      {previewResult ? (
        <Card className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">Target Preview</p>
              <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-[color:var(--color-text)]">已完成 endpoint 试调</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="info">{previewResult.request_method}</Badge>
              <Badge variant="success">{previewResult.response_status_code}</Badge>
              <Badge variant="default">{previewResult.latency_ms} ms</Badge>
              {previewExampleId ? <Badge variant="default">样本 {previewExampleId}</Badge> : null}
            </div>
          </div>
          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-medium text-[color:var(--color-text)]">请求体</p>
              <CodeBlock>{previewResult.request_body ?? null}</CodeBlock>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-[color:var(--color-text)]">提取后的输出</p>
              <CodeBlock>{previewResult.output ?? null}</CodeBlock>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-[color:var(--color-text)]">原始响应</p>
              <CodeBlock>{previewResult.raw_response ?? null}</CodeBlock>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-[color:var(--color-text)]">渲染后的 Prompt</p>
              <CodeBlock>
                {previewResult.prompt_preview
                  ? {
                      system_prompt: previewResult.prompt_preview.system_prompt,
                      user_prompt: previewResult.prompt_preview.user_prompt,
                      messages: previewResult.prompt_preview.messages,
                      warnings: previewResult.prompt_preview.warnings,
                    }
                  : '未绑定 Prompt'}
              </CodeBlock>
            </div>
            <div className="space-y-3 rounded-[22px] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] p-4 text-sm text-[color:var(--color-text-soft)]">
              <div>
                <p className="font-medium text-[color:var(--color-text)]">请求 URL</p>
                <p className="mt-1 break-all">{previewResult.request_url}</p>
              </div>
              <div>
                <p className="font-medium text-[color:var(--color-text)]">响应路径</p>
                <p className="mt-1">{previewResult.response_path_used || '自动识别'}</p>
              </div>
              <div>
                <p className="font-medium text-[color:var(--color-text)]">Trace ID</p>
                <p className="mt-1 break-all">{previewResult.trace_id || '目标返回中未携带'}</p>
              </div>
            </div>
          </div>
        </Card>
      ) : null}
    </PageContainer>
  )
}
