import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, FileUp, Plus } from 'lucide-react'
import { addExamples, createDataset, importDataset } from '@/api/datasets'
import PageContainer from '@/components/layout/PageContainer'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Textarea from '@/components/ui/Textarea'
import { formatDatasetImportSummary, hasDatasetImportIssues } from '@/lib/datasetImports'
import { toast } from '@/stores/toast'
import type { DatasetImportResult } from '@/types'

type ManualExampleInput = {
  inputs: unknown
  expected_outputs?: unknown
  metadata?: unknown
  split?: string
  source?: string
}

const SCHEMA_TEMPLATES: Record<string, string> = {
  custom: '{\n  "inputs": {"type": "object"},\n  "expected_outputs": {"type": "string"}\n}',
  qa: '{\n  "inputs": {\n    "type": "object",\n    "properties": {\n      "query": {"type": "string"}\n    },\n    "required": ["query"]\n  },\n  "expected_outputs": {\n    "type": "object",\n    "properties": {\n      "answer": {"type": "string"}\n    }\n  }\n}',
  rag: '{\n  "inputs": {\n    "type": "object",\n    "properties": {\n      "query": {"type": "string"},\n      "context": {"type": "string"}\n    },\n    "required": ["query"]\n  },\n  "expected_outputs": {\n    "type": "object",\n    "properties": {\n      "answer": {"type": "string"},\n      "sources": {"type": "array"}\n    }\n  }\n}',
  agent: '{\n  "inputs": {\n    "type": "object",\n    "properties": {\n      "query": {"type": "string"},\n      "available_tools": {"type": "array"}\n    },\n    "required": ["query"]\n  },\n  "expected_outputs": {\n    "type": "object",\n    "properties": {\n      "answer": {"type": "string"},\n      "expected_tools": {"type": "array"}\n    }\n  }\n}',
}

export default function NewDatasetPage() {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [schemaTemplate, setSchemaTemplate] = useState('custom')
  const [schemaText, setSchemaText] = useState(SCHEMA_TEMPLATES.custom)
  const [dataMode, setDataMode] = useState<'manual' | 'file'>('manual')
  const [examplesText, setExamplesText] = useState('[\n  {\n    "inputs": {"query": ""},\n    "expected_outputs": ""\n  }\n]')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const steps = ['基本信息', '定义 Schema', '添加数据', '确认创建']

  const canProceed = () => {
    if (step === 0) return name.trim().length > 0
    return true
  }

  const handleTemplateChange = (value: string) => {
    setSchemaTemplate(value)
    if (SCHEMA_TEMPLATES[value]) {
      setSchemaText(SCHEMA_TEMPLATES[value])
    }
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      let schemaDef: Record<string, unknown> | undefined
      if (schemaText.trim()) {
        try {
          schemaDef = JSON.parse(schemaText)
        } catch {
          throw new Error('Schema 不是合法的 JSON')
        }
      }

      let manualExamples: ManualExampleInput[] = []
      if (dataMode === 'manual') {
        try {
          const parsed = JSON.parse(examplesText)
          manualExamples = (Array.isArray(parsed) ? parsed : [parsed]) as ManualExampleInput[]
        } catch {
          throw new Error('样本数据不是合法的 JSON')
        }
      }

      const dataset = await createDataset({ name: name.trim(), description, schema_def: schemaDef })
      let importSummary: DatasetImportResult | undefined

      if (dataMode === 'manual') {
        if (manualExamples.length > 0 && manualExamples[0]?.inputs) {
          await addExamples(dataset.id, manualExamples)
        }
      } else if (dataMode === 'file' && selectedFile) {
        importSummary = await importDataset(dataset.id, selectedFile)
      }

      if (importSummary) {
        const summary = formatDatasetImportSummary(importSummary)
        if (importSummary.added > 0) {
          if (hasDatasetImportIssues(importSummary)) {
            toast.info(summary, '导入完成，部分样本被跳过')
          } else {
            toast.success(summary, '导入完成')
          }
        } else {
          toast.info(summary, 'Dataset 已创建，导入未新增样本')
        }
      }

      navigate(`/datasets/${dataset.id}`, importSummary ? { state: { importSummary } } : undefined)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建 Dataset 失败', '创建 Dataset 失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PageContainer
      title="新建 Dataset"
      description="通过向导创建评测数据集。"
      actions={
        <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/datasets')}>
          返回列表
        </Button>
      }
    >
      <div className="flex items-center gap-2">
        {steps.map((label, index) => (
          <div key={label} className="flex items-center gap-2">
            {index > 0 && <div className="h-px w-8 bg-[color:var(--color-line)]" />}
            <button
              type="button"
              onClick={() => index < step && setStep(index)}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition ${
                index === step
                  ? 'border-[color:rgba(193,109,58,0.3)] bg-[rgba(193,109,58,0.1)] font-semibold text-[color:var(--color-text)]'
                  : index < step
                    ? 'border-[color:var(--color-line)] text-[color:var(--color-text-soft)] hover:border-[color:var(--color-line-strong)]'
                    : 'border-transparent text-[color:rgba(93,83,73,0.4)]'
              }`}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[rgba(36,31,26,0.06)] text-xs">
                {index < step ? <Check className="h-3 w-3" /> : index + 1}
              </span>
              {label}
            </button>
          </div>
        ))}
      </div>

      {step === 0 && (
        <Card className="mt-6 p-6">
          <div className="grid max-w-lg gap-4">
            <Input label="数据集名称" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 customer-support-v1" />
            <Textarea label="描述（可选）" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="描述数据集的用途和内容" />
          </div>
        </Card>
      )}

      {step === 1 && (
        <Card className="mt-6 p-6">
          <div className="grid max-w-2xl gap-4">
            <Select
              label="Schema 模板"
              value={schemaTemplate}
              onChange={(event) => handleTemplateChange(event.target.value)}
              options={[
                { value: 'custom', label: '自定义' },
                { value: 'qa', label: '通用 QA' },
                { value: 'rag', label: 'RAG' },
                { value: 'agent', label: 'Agent Tool Call' },
              ]}
            />
            <Textarea
              label="Schema (JSON)"
              value={schemaText}
              onChange={(event) => setSchemaText(event.target.value)}
              className="min-h-[16rem] font-mono"
            />
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card className="mt-6 p-6">
          <div className="grid max-w-2xl gap-4">
            <Select
              label="数据来源"
              value={dataMode}
              onChange={(event) => setDataMode(event.target.value as 'manual' | 'file')}
              options={[
                { value: 'manual', label: '手动输入 JSON' },
                { value: 'file', label: '上传文件 (CSV/JSON/JSONL)' },
              ]}
            />

            {dataMode === 'manual' && (
              <Textarea
                label="样本数据 (JSON 数组)"
                value={examplesText}
                onChange={(event) => setExamplesText(event.target.value)}
                className="min-h-[16rem] font-mono"
                placeholder='[{"inputs": {"query": "..."}, "expected_outputs": "..."}]'
              />
            )}

            {dataMode === 'file' && (
              <div className="grid gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,.jsonl,.csv"
                  hidden
                  onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                />
                <Button variant="secondary" icon={<FileUp className="h-4 w-4" />} onClick={() => fileInputRef.current?.click()}>
                  {selectedFile ? selectedFile.name : '选择文件'}
                </Button>
                <p className="text-sm text-[color:var(--color-text-soft)]">
                  支持 .json / .jsonl / .csv 格式。创建后也可以继续添加样本。
                </p>
              </div>
            )}
          </div>
        </Card>
      )}

      {step === 3 && (
        <Card className="mt-6 p-6">
          <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">创建预览</p>
          <div className="mt-4 grid gap-3 text-sm">
            <div className="flex gap-2">
              <span className="w-20 shrink-0 text-[color:var(--color-text-soft)]">名称</span>
              <span className="font-medium text-[color:var(--color-text)]">{name}</span>
            </div>
            {description && (
              <div className="flex gap-2">
                <span className="w-20 shrink-0 text-[color:var(--color-text-soft)]">描述</span>
                <span className="text-[color:var(--color-text)]">{description}</span>
              </div>
            )}
            <div className="flex gap-2">
              <span className="w-20 shrink-0 text-[color:var(--color-text-soft)]">数据来源</span>
              <span className="text-[color:var(--color-text)]">
                {dataMode === 'manual' ? '手动输入' : selectedFile ? selectedFile.name : '无文件'}
              </span>
            </div>
          </div>
        </Card>
      )}

      <div className="mt-6 flex items-center justify-between">
        <Button variant="ghost" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> 上一步
        </Button>
        {step < steps.length - 1 ? (
          <Button onClick={() => setStep(step + 1)} disabled={!canProceed()}>
            下一步 <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        ) : (
          <Button icon={<Plus className="h-4 w-4" />} loading={submitting} onClick={() => void handleSubmit()} disabled={!name.trim()}>
            创建 Dataset
          </Button>
        )}
      </div>
    </PageContainer>
  )
}
