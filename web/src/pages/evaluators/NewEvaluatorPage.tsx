import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { createEvaluator, getEvaluator, listEvaluatorVersions, testEvaluatorConfig } from '@/api/evaluators'
import { listProjectModels } from '@/api/settings'
import PageContainer from '@/components/layout/PageContainer'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import EmptyState from '@/components/ui/EmptyState'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Textarea from '@/components/ui/Textarea'
import { useAsyncResource } from '@/hooks/useAsyncResource'
import { canManageEvaluationAssets } from '@/lib/permissions'
import { useAppStore } from '@/stores/app'
import { toast } from '@/stores/toast'
import type {
  Evaluator,
  EvaluatorConfig,
  EvaluatorType,
  JsonValue,
  LLMJudgeConfig,
  LLMProtocol,
  ProjectModelConfig,
  RuleConfig,
  StatisticalConfig,
} from '@/types'

const ruleKinds: Array<{ value: RuleConfig['kind']; label: string }> = [
  { value: 'exact_match', label: '精确匹配' },
  { value: 'contains', label: '包含' },
  { value: 'regex_match', label: '正则匹配' },
  { value: 'json_schema_valid', label: 'JSON Schema 校验' },
  { value: 'not_empty', label: '非空' },
  { value: 'length_in_range', label: '长度范围' },
  { value: 'latency_threshold', label: '延迟阈值' },
  { value: 'cost_threshold', label: '成本阈值' },
]

function formatCloneName(sourceName: string) {
  return sourceName.endsWith('_copy') ? sourceName : `${sourceName}_copy`
}

function stringifyJson(value: JsonValue | Record<string, JsonValue> | undefined, fallback: string) {
  if (value == null) {
    return fallback
  }
  return JSON.stringify(value, null, 2)
}

function hasExplicitLLMSettings(config?: LLMJudgeConfig | null) {
  return Boolean(
    (!config?.project_model_id && !config?.use_project_default_model && config?.model) ||
      config?.protocol_config?.base_url ||
      config?.protocol_config?.api_key ||
      config?.protocol_config?.model
  )
}

export default function NewEvaluatorPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const currentProject = useAppStore((state) => state.currentProject)
  const currentProjectRole = useAppStore((state) => state.currentProjectRole)
  const { data: projectModels, error: projectModelError } = useAsyncResource(
    () => listProjectModels(currentProject),
    [currentProject]
  )
  const canManage = canManageEvaluationAssets(currentProjectRole)

  const cloneEvaluatorId = searchParams.get('clone')?.trim() ?? ''
  const cloneVersionParam = searchParams.get('version')?.trim() ?? ''
  const cloneKey = cloneEvaluatorId ? `${cloneEvaluatorId}:${cloneVersionParam || 'current'}` : ''

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<EvaluatorType>('rule')
  const [ruleKind, setRuleKind] = useState<RuleConfig['kind']>('not_empty')
  const [keywords, setKeywords] = useState('有帮助, 准确')
  const [pattern, setPattern] = useState('.*')
  const [schemaText, setSchemaText] = useState('{\n  "type": "object"\n}')
  const [minLength, setMinLength] = useState('1')
  const [maxLength, setMaxLength] = useState('10000')
  const [thresholdMs, setThresholdMs] = useState('5000')
  const [costThreshold, setCostThreshold] = useState('0.10')
  const [statisticalKind, setStatisticalKind] = useState<StatisticalConfig['kind']>('levenshtein')
  const [codeText, setCodeText] = useState(
    'def evaluate(input, output, expected=None, metadata=None, trace=None):\n    score = 1.0 if output else 0.0\n    return {"score": score, "reasoning": "Custom logic"}\n'
  )
  const [systemPrompt, setSystemPrompt] = useState(
    '请把答案按 0 到 1 打分，并返回 JSON：{"score": <number>, "reasoning": "<原因>"}'
  )
  const [userTemplate, setUserTemplate] = useState(
    '输入: {{input}}\n输出: {{output}}\n期望: {{expected}}\n上下文: {{context}}'
  )
  const [modelSource, setModelSource] = useState<'project_default' | 'project_model' | 'custom'>('project_default')
  const [selectedProjectModelId, setSelectedProjectModelId] = useState('')
  const [protocol, setProtocol] = useState<LLMProtocol>('openai')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [modelName, setModelName] = useState('')
  const [temperature, setTemperature] = useState('0')
  const [submitting, setSubmitting] = useState(false)
  const [playgroundInput, setPlaygroundInput] = useState('用户询问如何重置 API Key')
  const [playgroundOutput, setPlaygroundOutput] = useState('你可以去设置页生成新的 API Key。')
  const [playgroundExpected, setPlaygroundExpected] = useState('进入设置页，在 API Key 分页里生成新的密钥。')
  const [playgroundContext, setPlaygroundContext] = useState('这是一个 EvalSmith 控制台问题。')
  const [playgroundLoading, setPlaygroundLoading] = useState(false)
  const [playgroundResult, setPlaygroundResult] = useState<{ score?: number; reasoning?: string; raw?: string } | null>(null)
  const [projectModelSeeded, setProjectModelSeeded] = useState(false)
  const [cloneLoading, setCloneLoading] = useState(false)
  const [cloneBanner, setCloneBanner] = useState('')
  const [cloneError, setCloneError] = useState('')
  const [appliedCloneKey, setAppliedCloneKey] = useState('')
  const defaultProjectModel = useMemo(
    () => (projectModels ?? []).find((item) => item.is_default_judge && item.status === 'active') ?? null,
    [projectModels]
  )
  const selectedProjectModel = useMemo(
    () => (projectModels ?? []).find((item) => item.id === selectedProjectModelId) ?? null,
    [projectModels, selectedProjectModelId]
  )
  const projectModelOptions = useMemo(
    () =>
      (projectModels ?? []).filter((item) => item.status === 'active').map((item: ProjectModelConfig) => ({
        value: item.id,
        label: `${item.name} · ${item.model}`,
      })),
    [projectModels]
  )

  useEffect(() => {
    setProjectModelSeeded(false)
    setSelectedProjectModelId('')
    setModelSource('project_default')
  }, [currentProject])

  useEffect(() => {
    if (projectModelSeeded) {
      return
    }
    const activeModels = (projectModels ?? []).filter((item) => item.status === 'active')
    if (defaultProjectModel) {
      setModelSource('project_default')
      setSelectedProjectModelId(defaultProjectModel.id)
      setProjectModelSeeded(true)
      return
    }
    if (activeModels.length > 0) {
      setModelSource('project_model')
      setSelectedProjectModelId(activeModels[0]?.id || '')
      setProjectModelSeeded(true)
      return
    }
    setModelSource('custom')
    setProjectModelSeeded(true)
  }, [defaultProjectModel, projectModelSeeded, projectModels])

  useEffect(() => {
    if (!cloneKey || cloneKey === appliedCloneKey) {
      return
    }

    let active = true

    const applyClone = (source: Evaluator, sourceConfig: EvaluatorConfig, sourceVersion: number) => {
      setName(formatCloneName(source.name))
      setDescription(
        source.description
          ? `${source.description}\n\nCloned from ${source.name} v${sourceVersion}${source.is_builtin ? ' (built-in)' : ''}.`
          : `Cloned from ${source.name} v${sourceVersion}${source.is_builtin ? ' (built-in)' : ''}.`
      )
      setType(sourceConfig.type)
      setPlaygroundResult(null)

      if (sourceConfig.type === 'rule' && sourceConfig.rule_config) {
        const rule = sourceConfig.rule_config
        setRuleKind(rule.kind)
        setKeywords(rule.keywords?.join(', ') || '')
        setPattern(rule.pattern || '.*')
        setSchemaText(stringifyJson(rule.schema, '{\n  "type": "object"\n}'))
        setMinLength(String(rule.min_length ?? 1))
        setMaxLength(String(rule.max_length ?? 10000))
        setThresholdMs(String(rule.threshold_ms ?? 5000))
        setCostThreshold(String(rule.threshold ?? 0.1))
      }

      if (sourceConfig.type === 'llm_judge' && sourceConfig.llm_judge_config) {
        const llmConfig = sourceConfig.llm_judge_config
        const explicitLLMSettings = hasExplicitLLMSettings(llmConfig)
        setSystemPrompt(llmConfig.system_prompt || systemPrompt)
        setUserTemplate(llmConfig.user_prompt_template || userTemplate)
        setTemperature(String(llmConfig.temperature ?? 0))
        if (llmConfig.project_model_id) {
          setModelSource('project_model')
          setSelectedProjectModelId(llmConfig.project_model_id)
        } else if (llmConfig.use_project_default_model) {
          setModelSource('project_default')
        } else {
          setModelSource(explicitLLMSettings ? 'custom' : 'project_default')
        }
        setProtocol((llmConfig.protocol as LLMProtocol) || 'openai')
        setBaseUrl(llmConfig.protocol_config?.base_url || '')
        setApiKey(llmConfig.protocol_config?.api_key || '')
        setModelName(llmConfig.model || llmConfig.protocol_config?.model || '')
        setProjectModelSeeded(true)
      }

      if (sourceConfig.type === 'code' && sourceConfig.code_config?.code) {
        setCodeText(sourceConfig.code_config.code)
      }

      if (sourceConfig.type === 'statistical' && sourceConfig.statistical_config?.kind) {
        setStatisticalKind(sourceConfig.statistical_config.kind)
      }

      setCloneBanner(
        source.is_builtin
          ? `当前正在基于内置 Evaluator ${source.name} 的 v${sourceVersion} 创建自定义版本。内置资产保持只读，保存后会生成新的自定义 Evaluator。`
          : `当前正在基于 ${source.name} 的 v${sourceVersion} 创建自定义版本。保存后不会覆盖原 Evaluator。`
      )
    }

    const loadClone = async () => {
      setCloneLoading(true)
      setCloneError('')
      try {
        const source = await getEvaluator(cloneEvaluatorId)
        let sourceConfig = source.config
        let sourceVersion = source.version

        if (cloneVersionParam && !source.is_builtin) {
          const requestedVersion = Number.parseInt(cloneVersionParam, 10)
          if (Number.isNaN(requestedVersion)) {
            throw new Error(`无效的版本号：${cloneVersionParam}`)
          }

          const versions = await listEvaluatorVersions(cloneEvaluatorId)
          const matchedVersion = versions.find((entry) => entry.version === requestedVersion)
          if (!matchedVersion) {
            throw new Error(`没有找到 ${source.name} 的 v${requestedVersion} 版本`)
          }
          sourceConfig = matchedVersion.config
          sourceVersion = matchedVersion.version
        }

        if (!active) {
          return
        }

        applyClone(source, sourceConfig, sourceVersion)
        setAppliedCloneKey(cloneKey)
      } catch (err) {
        if (!active) {
          return
        }

        const message = err instanceof Error ? err.message : '加载克隆源失败'
        setCloneError(message)
        toast.error(message, '克隆 Evaluator 失败')
      } finally {
        if (active) {
          setCloneLoading(false)
        }
      }
    }

    void loadClone()

    return () => {
      active = false
    }
  }, [appliedCloneKey, cloneEvaluatorId, cloneKey, cloneVersionParam, systemPrompt, userTemplate])

  const effectiveProtocol =
    modelSource === 'custom'
      ? protocol
      : ((modelSource === 'project_model' ? selectedProjectModel?.protocol : defaultProjectModel?.protocol) as LLMProtocol) || 'openai'
  const effectiveBaseUrl = modelSource === 'custom'
    ? baseUrl
    : modelSource === 'project_model'
      ? (selectedProjectModel?.base_url || '')
      : (defaultProjectModel?.base_url || '')
  const effectiveApiKey = modelSource === 'custom' ? apiKey : ''
  const effectiveModel = modelSource === 'custom'
    ? modelName
    : modelSource === 'project_model'
      ? (selectedProjectModel?.model || '')
      : (defaultProjectModel?.model || '')

  const config = useMemo<EvaluatorConfig>(() => {
    const parsedSchema = (() => {
      try {
        return JSON.parse(schemaText) as Record<string, JsonValue>
      } catch {
        return {}
      }
    })()

    if (type === 'llm_judge') {
      return {
        type,
        llm_judge_config: {
          protocol: effectiveProtocol,
          protocol_config:
            modelSource === 'custom'
              ? {
                  base_url: effectiveBaseUrl || undefined,
                  api_key: effectiveApiKey || undefined,
                  model: effectiveModel || undefined,
                }
              : undefined,
          project_model_id: modelSource === 'project_model' ? (selectedProjectModelId || undefined) : undefined,
          use_project_default_model: modelSource === 'project_default',
          system_prompt: systemPrompt,
          user_prompt_template: userTemplate,
          model: effectiveModel || undefined,
          temperature: Number(temperature || '0'),
        },
      }
    }

    if (type === 'code') {
      return {
        type,
        code_config: { language: 'python', code: codeText, timeout_seconds: 30 },
      }
    }

    if (type === 'statistical') {
      return {
        type,
        statistical_config: { kind: statisticalKind },
      }
    }

    const ruleConfig: RuleConfig = {
      kind: ruleKind,
      case_sensitive: true,
      strip: true,
    }

    if (ruleKind === 'contains') {
      ruleConfig.keywords = keywords
        .split(',')
        .map((keyword) => keyword.trim())
        .filter(Boolean)
      ruleConfig.mode = 'all'
    }

    if (ruleKind === 'regex_match') {
      ruleConfig.pattern = pattern
    }

    if (ruleKind === 'json_schema_valid') {
      ruleConfig.schema = parsedSchema
    }

    if (ruleKind === 'length_in_range') {
      ruleConfig.min_length = parseInt(minLength, 10) || 1
      ruleConfig.max_length = parseInt(maxLength, 10) || 10000
    }

    if (ruleKind === 'latency_threshold') {
      ruleConfig.threshold_ms = parseInt(thresholdMs, 10) || 5000
    }

    if (ruleKind === 'cost_threshold') {
      ruleConfig.threshold = parseFloat(costThreshold) || 0.1
    }

    return {
      type,
      rule_config: ruleConfig,
    }
  }, [
    codeText,
    costThreshold,
    effectiveApiKey,
    effectiveBaseUrl,
    effectiveModel,
    effectiveProtocol,
    keywords,
    maxLength,
    minLength,
    pattern,
    ruleKind,
    schemaText,
    statisticalKind,
    selectedProjectModelId,
    systemPrompt,
    temperature,
    thresholdMs,
    type,
    userTemplate,
    modelSource,
  ])

  const validateLLMSource = () => {
    if (type !== 'llm_judge') {
      return true
    }
    if (modelSource === 'project_default' && !defaultProjectModel) {
      toast.error('当前项目还没有默认 Judge 模型，请先到设置页添加并设为默认。', '缺少默认模型')
      return false
    }
    if (modelSource === 'project_model' && !selectedProjectModelId) {
      toast.error('请先选择一个项目模型，再保存或测试当前 Evaluator。', '缺少项目模型')
      return false
    }
    return true
  }

  const handleSubmit = async () => {
    if (!validateLLMSource()) {
      return
    }
    setSubmitting(true)
    try {
      await createEvaluator({
        name,
        description,
        config,
      })
      navigate('/evaluators')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建 Evaluator 失败', '创建 Evaluator 失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handlePlayground = async () => {
    if (!validateLLMSource()) {
      return
    }
    setPlaygroundLoading(true)
    try {
      const result = await testEvaluatorConfig({
        config,
        eval_input: {
          input: playgroundInput,
          output: playgroundOutput,
          expected: playgroundExpected,
          context: playgroundContext,
        },
      })
      setPlaygroundResult({
        score: result.score,
        reasoning: result.reasoning ?? '',
        raw: JSON.stringify(result, null, 2),
      })
    } catch (err) {
      setPlaygroundResult({ raw: err instanceof Error ? err.message : '调试失败' })
    } finally {
      setPlaygroundLoading(false)
    }
  }

  const projectDefaultReady = Boolean(defaultProjectModel)

  if (!canManage) {
    return (
      <PageContainer title="创建 Evaluator" description="当前角色只能查看 Evaluator，不能创建新的评估器。">
        <EmptyState
          icon={<ShieldAlert className="h-6 w-6" />}
          title="当前角色没有创建权限"
          description="请切换到拥有 Developer 及以上权限的项目角色，或联系项目 Owner / Admin。"
          action={
            <Button variant="secondary" onClick={() => navigate('/evaluators')}>
              返回 Evaluator 列表
            </Button>
          }
        />
      </PageContainer>
    )
  }

  return (
    <PageContainer
      title={cloneEvaluatorId ? '克隆 Evaluator' : '创建 Evaluator'}
      description={
        cloneEvaluatorId
          ? '基于现有 Evaluator 快速复制一份自定义版本，再按项目需要继续调整。'
          : '定义可复用的评分规则或 Judge Prompt，让每个 Experiment 使用同一套标准。'
      }
      actions={
        <>
          <Button variant="ghost" onClick={() => navigate('/evaluators')}>
            返回
          </Button>
          <Button loading={submitting} onClick={() => void handleSubmit()}>
            保存 Evaluator
          </Button>
        </>
      }
    >
      {(cloneLoading || cloneBanner || cloneError) && (
        <div className="mb-4 space-y-3">
          {cloneLoading && (
            <div className="rounded-[18px] border border-dashed border-[color:rgba(193,109,58,0.26)] bg-[rgba(193,109,58,0.06)] px-4 py-3 text-sm leading-7 text-[color:var(--color-text-soft)]">
              正在读取克隆源配置，请稍等。
            </div>
          )}
          {cloneBanner && !cloneLoading && (
            <div className="rounded-[18px] border border-[color:var(--color-line)] bg-[rgba(255,252,247,0.82)] px-4 py-3 text-sm leading-7 text-[color:var(--color-text-soft)]">
              {cloneBanner}
            </div>
          )}
          {cloneError && !cloneLoading && (
            <div className="rounded-[18px] border border-dashed border-[color:rgba(186,63,54,0.24)] bg-[rgba(186,63,54,0.06)] px-4 py-3 text-sm leading-7 text-[color:var(--color-text-soft)]">
              {cloneError}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="p-6">
          <div className="grid gap-4">
            <Input label="名称" value={name} onChange={(event) => setName(event.target.value)} placeholder="support_quality_guard" />
            <Textarea
              label="描述"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="这个 Evaluator 用来保护什么能力。"
            />
            <Select
              label="Evaluator 类型"
              value={type}
              onChange={(event) => setType(event.target.value as EvaluatorType)}
              options={[
                { value: 'rule', label: '规则 Evaluator' },
                { value: 'llm_judge', label: 'LLM Judge' },
                { value: 'code', label: '代码 Evaluator' },
                { value: 'statistical', label: '统计 Evaluator' },
              ]}
            />

            {type === 'code' ? (
              <Textarea
                label="Python 评估函数"
                value={codeText}
                onChange={(event) => setCodeText(event.target.value)}
                className="min-h-[18rem] font-mono text-sm"
                placeholder={'def evaluate(input, output, expected=None, metadata=None, trace=None):\n    return {"score": 0.0, "reasoning": "..."}'}
              />
            ) : type === 'statistical' ? (
              <Select
                label="统计指标"
                value={statisticalKind}
                onChange={(event) => setStatisticalKind(event.target.value as StatisticalConfig['kind'])}
                options={[
                  { value: 'bleu', label: 'BLEU（翻译/摘要）' },
                  { value: 'rouge_l', label: 'ROUGE-L（摘要/文本生成）' },
                  { value: 'levenshtein', label: 'Levenshtein 编辑距离' },
                  { value: 'semantic_similarity', label: '语义相似度（词袋余弦）' },
                ]}
              />
            ) : type === 'rule' ? (
              <>
                <Select
                  label="规则类型"
                  value={ruleKind}
                  onChange={(event) => setRuleKind(event.target.value as RuleConfig['kind'])}
                  options={ruleKinds}
                />
                {ruleKind === 'contains' && (
                  <Input
                    label="关键词"
                    value={keywords}
                    onChange={(event) => setKeywords(event.target.value)}
                    placeholder="用逗号分隔关键词"
                  />
                )}
                {ruleKind === 'regex_match' && (
                  <Input label="模式" value={pattern} onChange={(event) => setPattern(event.target.value)} />
                )}
                {ruleKind === 'json_schema_valid' && (
                  <Textarea
                    label="JSON Schema"
                    value={schemaText}
                    onChange={(event) => setSchemaText(event.target.value)}
                    className="min-h-[12rem] font-mono"
                  />
                )}
                {ruleKind === 'length_in_range' && (
                  <div className="grid grid-cols-2 gap-3">
                    <Input label="最小长度" type="number" value={minLength} onChange={(event) => setMinLength(event.target.value)} />
                    <Input label="最大长度" type="number" value={maxLength} onChange={(event) => setMaxLength(event.target.value)} />
                  </div>
                )}
                {ruleKind === 'latency_threshold' && (
                  <Input label="延迟阈值 (ms)" type="number" value={thresholdMs} onChange={(event) => setThresholdMs(event.target.value)} />
                )}
                {ruleKind === 'cost_threshold' && (
                  <Input label="成本阈值 (USD)" type="number" step="0.01" value={costThreshold} onChange={(event) => setCostThreshold(event.target.value)} />
                )}
              </>
            ) : (
              <>
                <Select
                  label="模型来源"
                  value={modelSource}
                  onChange={(event) => setModelSource(event.target.value as 'project_default' | 'project_model' | 'custom')}
                  options={[
                    { value: 'project_default', label: '项目默认模型' },
                    { value: 'project_model', label: '指定项目模型' },
                    { value: 'custom', label: '单独填写连接配置' },
                  ]}
                />

                {!projectDefaultReady && modelSource === 'project_default' && (
                  <div className="rounded-[18px] border border-dashed border-[color:rgba(193,109,58,0.26)] bg-[rgba(193,109,58,0.06)] px-4 py-3 text-sm leading-7 text-[color:var(--color-text-soft)]">
                    当前项目还没有默认 Judge 模型。你可以先去“设置 → 模型与 LLM”里录入模型，并把其中一项设为默认。
                  </div>
                )}

                {projectModelError && (
                  <div className="rounded-[18px] border border-dashed border-[color:rgba(186,63,54,0.24)] bg-[rgba(186,63,54,0.06)] px-4 py-3 text-sm leading-7 text-[color:var(--color-text-soft)]">
                    无法读取项目模型：{projectModelError}
                  </div>
                )}

                {modelSource === 'project_model' && (
                  <Select
                    label="项目模型"
                    value={selectedProjectModelId}
                    onChange={(event) => setSelectedProjectModelId(event.target.value)}
                    options={
                      projectModelOptions.length
                        ? projectModelOptions
                        : [{ value: '', label: '当前项目还没有可用模型' }]
                    }
                  />
                )}

                {modelSource !== 'custom' && (
                  <div className="rounded-[18px] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] px-4 py-4 text-sm leading-7 text-[color:var(--color-text-soft)]">
                    <p>当前将引用项目中的模型资产，Evaluator 保存后只记录模型引用，不再把 API Key 写进配置。</p>
                    <p>生效模型：{effectiveModel || '未配置'}；Base URL：{effectiveBaseUrl || '未配置'}。</p>
                  </div>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                  <Select
                    label="协议"
                    value={effectiveProtocol}
                    onChange={(event) => setProtocol(event.target.value as LLMProtocol)}
                    options={[{ value: 'openai', label: 'OpenAI Compatible' }]}
                    disabled={modelSource !== 'custom'}
                  />
                  <Input
                    label="模型"
                    value={effectiveModel}
                    onChange={(event) => setModelName(event.target.value)}
                    placeholder="gpt-4o-mini"
                    disabled={modelSource !== 'custom'}
                  />
                </div>

                <Input
                  label="Base URL"
                  value={effectiveBaseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="https://api.openai.com/v1"
                  disabled={modelSource !== 'custom'}
                />
                <Input
                  label="API Key"
                  value={effectiveApiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="输入提供方 API Key"
                  disabled={modelSource !== 'custom'}
                />
                <Input
                  label="Temperature"
                  value={temperature}
                  onChange={(event) => setTemperature(event.target.value)}
                  placeholder="0"
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                />
                <Textarea
                  label="System Prompt"
                  value={systemPrompt}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                  className="min-h-[10rem]"
                />
                <Textarea
                  label="用户模板"
                  value={userTemplate}
                  onChange={(event) => setUserTemplate(event.target.value)}
                  className="min-h-[10rem] font-mono"
                />
              </>
            )}
          </div>
        </Card>

        <Card className="p-6">
          <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">预览</p>
          <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-[color:var(--color-text)]">
            最终载荷
          </h2>
          <pre className="mt-4 overflow-auto rounded-[1.35rem] bg-[#1e1916] p-4 text-xs leading-6 text-[#f3ede3]">
            <code>{JSON.stringify(config, null, 2)}</code>
          </pre>
          <div className="mt-5 space-y-3 text-sm leading-7 text-[color:var(--color-text-soft)]">
            <p>规则 Evaluator 适合精确匹配、关键词覆盖和 Schema 校验这类确定性检查。</p>
            <p>LLM Judge 现在既可以直接携带 `protocol + protocol_config`，也可以引用项目里的模型资产。</p>
            <p>如果你希望多个 Judge 复用同一组模型参数，优先使用“项目默认模型”或“指定项目模型”会更稳妥。</p>
          </div>
          <div className="mt-6 border-t border-[color:var(--color-line)] pt-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">Playground</p>
                <h3 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-[color:var(--color-text)]">先跑一条样本看看</h3>
              </div>
              <Button variant="secondary" loading={playgroundLoading} onClick={() => void handlePlayground()}>
                测试配置
              </Button>
            </div>
            <div className="mt-4 grid gap-3">
              <Textarea label="输入" value={playgroundInput} onChange={(event) => setPlaygroundInput(event.target.value)} />
              <Textarea label="输出" value={playgroundOutput} onChange={(event) => setPlaygroundOutput(event.target.value)} />
              <Textarea label="期望" value={playgroundExpected} onChange={(event) => setPlaygroundExpected(event.target.value)} />
              <Textarea label="上下文" value={playgroundContext} onChange={(event) => setPlaygroundContext(event.target.value)} />
              {playgroundResult ? (
                <div className="space-y-3 rounded-[1.35rem] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] p-4">
                  {playgroundResult.score != null && (
                    <div className="flex items-center gap-3">
                      <span className="text-2xl font-bold text-[color:var(--color-text)]">{playgroundResult.score.toFixed(2)}</span>
                    </div>
                  )}
                  {playgroundResult.reasoning && (
                    <p className="text-sm leading-7 text-[color:var(--color-text-soft)]">{playgroundResult.reasoning}</p>
                  )}
                  {playgroundResult.raw && !playgroundResult.reasoning && (
                    <pre className="overflow-auto text-xs text-[color:var(--color-text-soft)]"><code>{playgroundResult.raw}</code></pre>
                  )}
                </div>
              ) : (
                <p className="rounded-[1.35rem] border border-dashed border-[color:var(--color-line)] p-4 text-center text-sm text-[color:var(--color-text-soft)]">
                  点击"测试配置"后显示评估结果。
                </p>
              )}
            </div>
          </div>
        </Card>
      </div>
    </PageContainer>
  )
}
