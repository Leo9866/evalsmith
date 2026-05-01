import { useCallback, useRef, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { Database, FileUp, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { addExamples, deleteExample, getDataset, getDatasetVersionDiff, importDataset, listDatasetSplits, listExamples, listVersions, rollbackDatasetVersion, updateDataset, updateDatasetVersion, updateExample } from '@/api/datasets'
import StatCard from '@/components/charts/StatCard'
import PageContainer from '@/components/layout/PageContainer'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import CodeBlock from '@/components/ui/CodeBlock'
import EmptyState from '@/components/ui/EmptyState'
import Input from '@/components/ui/Input'
import Modal from '@/components/ui/Modal'
import Pagination from '@/components/ui/Pagination'
import Select from '@/components/ui/Select'
import Table, { type Column } from '@/components/ui/Table'
import Tabs from '@/components/ui/Tabs'
import Textarea from '@/components/ui/Textarea'
import { useDebouncedSearchInput } from '@/hooks/useDebouncedSearchInput'
import { useAsyncResource } from '@/hooks/useAsyncResource'
import { formatDatasetImportSummary, hasDatasetImportIssues } from '@/lib/datasetImports'
import { formatExampleSource, formatSplit } from '@/lib/labels'
import { canManageEvaluationAssets } from '@/lib/permissions'
import { applySearchParamPatch, readPositiveIntParam } from '@/lib/searchParams'
import { useAppStore } from '@/stores/app'
import { toast } from '@/stores/toast'
import type { Dataset, DatasetImportResult, DatasetVersion, DatasetVersionDiff, Example, SplitSummary } from '@/types'
import { formatDate, toPrettyJson, truncate } from '@/lib/utils'

async function loadDatasetDetail(datasetId: string, examplePage: number, exampleSearch: string, exampleSplit: string) {
  const [dataset, examples, versions, splits] = await Promise.all([
    getDataset(datasetId),
    listExamples(datasetId, {
      page: examplePage,
      page_size: 20,
      split: exampleSplit || undefined,
      query: exampleSearch || undefined,
    }),
    listVersions(datasetId),
    listDatasetSplits(datasetId),
  ])

  return {
    dataset,
    examples,
    versions,
    splits,
  }
}

export default function DatasetDetailPage() {
  const { id = '' } = useParams()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const currentProjectRole = useAppStore((state) => state.currentProjectRole)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const initialImportSummary = (location.state as { importSummary?: DatasetImportResult } | null)?.importSummary ?? null
  const tab = searchParams.get('tab') ?? 'examples'
  const examplePage = readPositiveIntParam(searchParams.get('example_page'))
  const exampleSearch = searchParams.get('example_search')?.trim() ?? ''
  const exampleSplit = searchParams.get('example_split') ?? ''
  const [modalOpen, setModalOpen] = useState(false)
  const [schemaModalOpen, setSchemaModalOpen] = useState(false)
  const [inputsText, setInputsText] = useState('{\n  "input": ""\n}')
  const [expectedText, setExpectedText] = useState('""')
  const [metadataText, setMetadataText] = useState('{\n  "topic": ""\n}')
  const [schemaText, setSchemaText] = useState('{\n  "inputs": {"type": "object"},\n  "expected_outputs": {"type": "string"}\n}')
  const [submitting, setSubmitting] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editExampleId, setEditExampleId] = useState('')
  const [editInputs, setEditInputs] = useState('')
  const [editExpected, setEditExpected] = useState('')
  const [editMetadata, setEditMetadata] = useState('')
  const [diffModalOpen, setDiffModalOpen] = useState(false)
  const [rollbackModalOpen, setRollbackModalOpen] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState<DatasetVersion | null>(null)
  const [versionDiff, setVersionDiff] = useState<DatasetVersionDiff | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [rollbackDescription, setRollbackDescription] = useState('')
  const [importSummary, setImportSummary] = useState<DatasetImportResult | null>(initialImportSummary)
  const [versionEditModalOpen, setVersionEditModalOpen] = useState(false)
  const [versionToEdit, setVersionToEdit] = useState<DatasetVersion | null>(null)
  const [versionDescriptionText, setVersionDescriptionText] = useState('')

  const setParams = useCallback(
    (updates: Record<string, string | null | undefined>, options?: { resetPage?: boolean; resetPageKeys?: string[] }) => {
      setSearchParams(applySearchParamPatch(searchParams, updates, options))
    },
    [searchParams, setSearchParams]
  )
  const [exampleSearchInput, setExampleSearchInput] = useDebouncedSearchInput(exampleSearch, (nextValue) => {
    setParams({ example_search: nextValue || null }, { resetPageKeys: ['example_page'] })
  })
  const { data, loading, error, reload } = useAsyncResource(
    () => loadDatasetDetail(id, examplePage, exampleSearch, exampleSplit),
    [id, examplePage, exampleSearch, exampleSplit]
  )
  const canManage = canManageEvaluationAssets(currentProjectRole)

  const openEditModal = (example: Example) => {
    setEditExampleId(example.id)
    setEditInputs(JSON.stringify(example.inputs, null, 2))
    setEditExpected(JSON.stringify(example.expected_outputs, null, 2))
    setEditMetadata(JSON.stringify(example.metadata ?? {}, null, 2))
    setEditModalOpen(true)
  }

  const handleEditSave = async () => {
    setSubmitting(true)
    try {
      await updateExample(id, editExampleId, {
        inputs: JSON.parse(editInputs),
        expected_outputs: JSON.parse(editExpected),
        metadata: JSON.parse(editMetadata),
      })
      setEditModalOpen(false)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新样本失败', '更新样本失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (exampleId: string) => {
    if (!window.confirm('确定要删除这条样本吗？')) return
    try {
      await deleteExample(id, exampleId)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除样本失败', '删除样本失败')
    }
  }

  const exampleColumns: Column<Example>[] = [
    {
      key: 'inputs',
      header: '输入',
      render: (example) => {
        const metadata = example.metadata && typeof example.metadata === 'object' && !Array.isArray(example.metadata)
          ? (example.metadata as Record<string, unknown>)
          : null
        const traceId = typeof metadata?.trace_id === 'string' ? metadata.trace_id : ''
        const backfillActionId = typeof metadata?.backfill_action_id === 'string' ? metadata.backfill_action_id : ''
        return (
          <div>
            <p className="font-medium">{truncate(toPrettyJson(example.inputs), 120)}</p>
            <p className="mt-1 text-sm text-[color:var(--color-text-soft)]">{formatExampleSource(example.source)}</p>
            {(traceId || backfillActionId) && (
              <div className="mt-1 flex flex-wrap gap-3 text-sm text-[color:var(--color-text-soft)]">
                {traceId ? (
                  <Link to={`/tracing/${traceId}`} className="text-[color:var(--color-accent-strong)] hover:underline">
                    来源 Trace
                  </Link>
                ) : null}
                {backfillActionId ? <span>Action {backfillActionId}</span> : null}
              </div>
            )}
          </div>
        )
      },
    },
    {
      key: 'expected_outputs',
      header: '期望输出',
      render: (example) => <span>{truncate(toPrettyJson(example.expected_outputs), 96)}</span>,
    },
    {
      key: 'split',
      header: 'Split',
      render: (example) => <span>{formatSplit(example.split)}</span>,
    },
    {
      key: 'created_at',
      header: '创建时间',
      render: (example) => <span>{formatDate(example.created_at)}</span>,
    },
    {
      key: 'actions',
      header: '',
      className: 'w-24',
      render: (example) => canManage ? (
        <div className="flex gap-1">
          <button type="button" title="编辑" onClick={(event) => { event.stopPropagation(); openEditModal(example) }} className="rounded-full p-1.5 text-[color:var(--color-text-soft)] hover:bg-[rgba(36,31,26,0.06)] hover:text-[color:var(--color-text)]">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button type="button" title="删除" onClick={(event) => { event.stopPropagation(); void handleDelete(example.id) }} className="rounded-full p-1.5 text-[color:var(--color-text-soft)] hover:bg-[rgba(182,81,69,0.08)] hover:text-[#b65145]">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null,
    },
  ]

  const versionColumns: Column<DatasetVersion>[] = [
    {
      key: 'version',
      header: '版本',
      render: (version) => <span className="font-mono">v{version.version}</span>,
    },
    {
      key: 'description',
      header: '说明',
      render: (version) => <span>{version.description || '版本变更'}</span>,
    },
    {
      key: 'created_at',
      header: '创建时间',
      render: (version) => <span>{formatDate(version.created_at)}</span>,
    },
    {
      key: 'actions',
      header: '',
      className: 'w-72',
      render: (version) => (
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation()
              setVersionToEdit(version)
              setVersionDescriptionText(version.description ?? '')
              setVersionEditModalOpen(true)
            }}
            disabled={!canManage}
          >
            编辑说明
          </Button>
          <Button
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation()
              void handleShowDiff(version)
            }}
            disabled={!dataset || version.version === dataset.current_version}
          >
            查看 Diff
          </Button>
          <Button
            variant="secondary"
            onClick={(event) => {
              event.stopPropagation()
              setSelectedVersion(version)
              setRollbackDescription(`Rolled back to version v${version.version}`)
              setRollbackModalOpen(true)
            }}
            disabled={!canManage || !dataset || version.version === dataset.current_version}
          >
            回滚到此版本
          </Button>
        </div>
      ),
    },
  ]

  const splitColumns: Column<SplitSummary>[] = [
    {
      key: 'split',
      header: 'Split',
      render: (item) => <span className="font-medium">{formatSplit(item.split)}</span>,
    },
    {
      key: 'count',
      header: '样本数',
      render: (item) => <span>{item.count}</span>,
    },
  ]

  const handleAddExample = async () => {
    setSubmitting(true)
    try {
      await addExamples(id, [
        {
          inputs: JSON.parse(inputsText),
          expected_outputs: JSON.parse(expectedText),
          metadata: JSON.parse(metadataText),
          split: 'default',
        },
      ])
      setModalOpen(false)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '添加样本失败', '添加样本失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleImport = async (file: File | undefined) => {
    if (!file) return
    try {
      const result = await importDataset(id, file)
      setImportSummary(result)
      const summary = formatDatasetImportSummary(result)
      if (result.added > 0) {
        if (hasDatasetImportIssues(result)) {
          toast.info(summary, '导入完成，部分样本被跳过')
        } else {
          toast.success(summary, '导入完成')
        }
      } else {
        toast.info(summary, '导入未新增样本')
      }
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入 Dataset 文件失败', '导入失败')
    }
  }

  const handleSchemaSave = async () => {
    setSubmitting(true)
    try {
      await updateDataset(id, {
        schema_def: JSON.parse(schemaText),
      })
      setSchemaModalOpen(false)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新 Schema 失败', '更新 Schema 失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleShowDiff = async (version: DatasetVersion) => {
    if (!dataset || version.version === dataset.current_version) return
    setSelectedVersion(version)
    setVersionDiff(null)
    setDiffLoading(true)
    setDiffModalOpen(true)
    try {
      const diff = await getDatasetVersionDiff(id, dataset.current_version, version.version)
      setVersionDiff(diff)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载版本 Diff 失败', '加载版本 Diff 失败')
      setDiffModalOpen(false)
    } finally {
      setDiffLoading(false)
    }
  }

  const handleRollbackVersion = async () => {
    if (!selectedVersion) return
    setSubmitting(true)
    try {
      const result = await rollbackDatasetVersion(id, selectedVersion.version, {
        description: rollbackDescription.trim() || undefined,
      })
      toast.success(`已回滚到 v${result.restored_from_version}，生成新版本 v${result.new_version}`)
      setRollbackModalOpen(false)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '回滚 Dataset 版本失败', '回滚失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleVersionDescriptionSave = async () => {
    if (!versionToEdit) return
    setSubmitting(true)
    try {
      await updateDatasetVersion(id, versionToEdit.version, {
        description: versionDescriptionText.trim(),
      })
      toast.success(`已更新 v${versionToEdit.version} 的版本说明`)
      setVersionEditModalOpen(false)
      setVersionToEdit(null)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新版本说明失败', '更新版本说明失败')
    } finally {
      setSubmitting(false)
    }
  }

  if (error) {
    return (
      <PageContainer title="Dataset 详情" description="查看样本、Schema 和版本历史。">
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="无法加载 Dataset"
          description={error}
          action={<Button variant="secondary" onClick={() => void reload()}>重试</Button>}
        />
      </PageContainer>
    )
  }

  const dataset = data?.dataset as Dataset | undefined

  return (
    <PageContainer
      title={dataset?.name ?? 'Dataset 详情'}
      description={dataset?.description || '查看样本、Schema 和版本历史。'}
	      actions={
	        <>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.jsonl,.csv"
            hidden
            onChange={(event) => void handleImport(event.target.files?.[0])}
          />
          <Button
            variant="secondary"
            icon={<FileUp className="h-4 w-4" />}
            onClick={() => fileInputRef.current?.click()}
            disabled={!canManage}
          >
            导入文件
          </Button>
	          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setModalOpen(true)} disabled={!canManage}>
	            添加样本
	          </Button>
          <Button
            variant="ghost"
            icon={<Pencil className="h-4 w-4" />}
            onClick={() => {
              setSchemaText(JSON.stringify(dataset?.schema_def ?? {}, null, 2))
              setSchemaModalOpen(true)
            }}
          >
            编辑 Schema
          </Button>
	        </>
	      }
	    >
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="样本数" value={loading ? '...' : dataset?.example_count ?? 0} />
        <StatCard label="当前版本" value={loading ? '...' : `v${dataset?.current_version ?? 0}`} />
        <StatCard label="创建时间" value={loading ? '...' : formatDate(dataset?.created_at)} />
      </div>

      {importSummary ? (
        <Card className="p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">最近一次导入摘要</p>
              <p className="mt-3 text-sm font-medium text-[color:var(--color-text)]">{formatDatasetImportSummary(importSummary)}</p>
              {importSummary.version_description ? (
                <p className="mt-2 text-sm text-[color:var(--color-text-soft)]">版本说明：{importSummary.version_description}</p>
              ) : null}
            </div>
            <Button variant="ghost" onClick={() => setImportSummary(null)}>
              收起
            </Button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            <StatCard label="总行数" value={importSummary.total_rows} />
            <StatCard label="新增样本" value={importSummary.added} />
            <StatCard label="重复跳过" value={importSummary.duplicate_count} />
            <StatCard label="无效样本" value={importSummary.invalid_count} />
          </div>

          {importSummary.duplicates.length > 0 ? (
            <div className="mt-5">
              <p className="text-sm font-medium text-[color:var(--color-text)]">重复样本示例</p>
              <div className="mt-3 space-y-3">
                {importSummary.duplicates.map((item) => (
                  <div key={`${item.scope}-${item.row}`} className="rounded-[1rem] border border-[color:var(--color-line)] p-4">
                    <p className="text-sm font-medium text-[color:var(--color-text)]">
                      第 {item.row} 行 · {item.scope === 'dataset' ? '与现有 Dataset 重复' : '与导入文件内其他行重复'}
                    </p>
                    <p className="mt-1 text-sm text-[color:var(--color-text-soft)]">{item.message}</p>
                    {item.inputs_preview ? (
                      <p className="mt-2 font-mono text-xs text-[color:var(--color-text-soft)]">{item.inputs_preview}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {importSummary.invalid_examples.length > 0 ? (
            <div className="mt-5">
              <p className="text-sm font-medium text-[color:var(--color-text)]">无效样本示例</p>
              <div className="mt-3 space-y-3">
                {importSummary.invalid_examples.map((item) => (
                  <div key={`invalid-${item.row}`} className="rounded-[1rem] border border-[color:var(--color-line)] p-4">
                    <p className="text-sm font-medium text-[color:var(--color-text)]">第 {item.row} 行</p>
                    <p className="mt-1 text-sm text-[color:var(--color-text-soft)]">{item.message}</p>
                    {item.raw_preview ? (
                      <p className="mt-2 font-mono text-xs text-[color:var(--color-text-soft)]">{item.raw_preview}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

	      <Tabs
	        tabs={[
	          { key: 'examples', label: '样本', count: data?.examples.total ?? dataset?.example_count },
	          { key: 'versions', label: '版本', count: data?.versions.length },
	          { key: 'splits', label: 'Splits', count: data?.splits.length },
	          { key: 'schema', label: 'Schema' },
	        ]}
        active={tab}
        onChange={(nextTab) => setParams({ tab: nextTab })}
      />

      {tab === 'examples' && (
        <>
          <div className="mb-4 flex flex-col gap-3 lg:flex-row">
            <Input
              value={exampleSearchInput}
              onChange={(event) => setExampleSearchInput(event.target.value)}
              placeholder="搜索样本内容 / ID / Metadata"
              icon={<Search className="h-4 w-4" />}
              className="min-w-[16rem]"
            />
            <Select
              value={exampleSplit}
              onChange={(event) => setParams({ example_split: event.target.value || null }, { resetPageKeys: ['example_page'] })}
              options={[
                { value: '', label: '全部 Split' },
                ...((data?.splits ?? []).map((item) => ({
                  value: item.split,
                  label: `${formatSplit(item.split)} (${item.count})`,
                }))),
              ]}
            />
          </div>
          <Table columns={exampleColumns} data={data?.examples.items ?? []} loading={loading} emptyMessage="暂无样本" />
          <Pagination
            className="mt-4"
            page={data?.examples.page ?? examplePage}
            totalPages={data?.examples.total_pages ?? Math.max(1, Math.ceil((data?.examples.total ?? 0) / Math.max(data?.examples.page_size ?? 20, 1)))}
            total={data?.examples.total ?? 0}
            pageSize={data?.examples.page_size ?? 20}
            onPageChange={(nextPage) => setParams({ example_page: String(nextPage) })}
          />
        </>
      )}

	      {tab === 'versions' && (
	        <Table columns={versionColumns} data={data?.versions ?? []} loading={loading} emptyMessage="暂无版本" />
	      )}

        {tab === 'splits' && (
          <Table columns={splitColumns} data={data?.splits ?? []} loading={loading} emptyMessage="暂无 Split 数据" />
        )}

      {tab === 'schema' && (
        <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <CodeBlock>{dataset?.schema_def ?? {}}</CodeBlock>
          <div className="rounded-[24px] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] p-6">
            <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">Dataset 使用建议</p>
            <div className="mt-4 space-y-3 text-sm leading-7 text-[color:var(--color-text-soft)]">
              <p>尽量保持输入结构稳定，这样不同 Experiment 之间的请求体模板才更可预测。</p>
              <p>用 Metadata 标记主题、失败模式和归属人，后续排查会快很多。</p>
              <p>每次样本变更都会生成新的 Dataset 版本，所以新增样本最好按回归资产来管理。</p>
            </div>
          </div>
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="添加样本"
        size="lg"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              取消
            </Button>
	            <Button loading={submitting} onClick={() => void handleAddExample()} disabled={!canManage}>
              保存样本
            </Button>
          </div>
        }
      >
        <div className="grid gap-4">
          <Textarea
            label="输入 (JSON)"
            value={inputsText}
            onChange={(event) => setInputsText(event.target.value)}
            className="min-h-[10rem] font-mono"
          />
          <Textarea
            label="期望输出 (JSON)"
            value={expectedText}
            onChange={(event) => setExpectedText(event.target.value)}
            className="min-h-[9rem] font-mono"
          />
          <Textarea
            label="Metadata (JSON)"
            value={metadataText}
            onChange={(event) => setMetadataText(event.target.value)}
            className="min-h-[9rem] font-mono"
          />
        </div>
	      </Modal>

      <Modal
        open={schemaModalOpen}
        onClose={() => setSchemaModalOpen(false)}
        title="编辑 Schema"
        size="lg"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setSchemaModalOpen(false)}>
              取消
            </Button>
            <Button loading={submitting} onClick={() => void handleSchemaSave()}>
              保存 Schema
            </Button>
          </div>
        }
      >
        <Textarea
          label="Schema (JSON)"
          value={schemaText}
          onChange={(event) => setSchemaText(event.target.value)}
          className="min-h-[18rem] font-mono"
        />
      </Modal>

      <Modal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title="编辑样本"
        size="lg"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setEditModalOpen(false)}>取消</Button>
            <Button loading={submitting} onClick={() => void handleEditSave()}>保存</Button>
          </div>
        }
      >
        <div className="grid gap-4">
          <Textarea label="输入 (JSON)" value={editInputs} onChange={(event) => setEditInputs(event.target.value)} className="min-h-[10rem] font-mono" />
          <Textarea label="期望输出 (JSON)" value={editExpected} onChange={(event) => setEditExpected(event.target.value)} className="min-h-[9rem] font-mono" />
          <Textarea label="Metadata (JSON)" value={editMetadata} onChange={(event) => setEditMetadata(event.target.value)} className="min-h-[6rem] font-mono" />
        </div>
      </Modal>

      <Modal
        open={versionEditModalOpen}
        onClose={() => {
          setVersionEditModalOpen(false)
          setVersionToEdit(null)
        }}
        title={versionToEdit ? `编辑 v${versionToEdit.version} 版本说明` : '编辑版本说明'}
        footer={
          <div className="flex justify-end gap-3">
            <Button
              variant="ghost"
              onClick={() => {
                setVersionEditModalOpen(false)
                setVersionToEdit(null)
              }}
            >
              取消
            </Button>
            <Button loading={submitting} onClick={() => void handleVersionDescriptionSave()} disabled={!versionToEdit}>
              保存说明
            </Button>
          </div>
        }
      >
        <Textarea
          label="版本说明"
          value={versionDescriptionText}
          onChange={(event) => setVersionDescriptionText(event.target.value)}
          placeholder="例如：Imported regression fixes after dedupe cleanup"
        />
      </Modal>

      <Modal
        open={diffModalOpen}
        onClose={() => {
          setDiffModalOpen(false)
          setVersionDiff(null)
          setSelectedVersion(null)
        }}
        title={selectedVersion ? `版本 Diff · v${selectedVersion.version} -> v${dataset?.current_version ?? '-'}` : '版本 Diff'}
        size="lg"
      >
        {diffLoading ? (
          <div className="py-8 text-center text-sm text-[color:var(--color-text-soft)]">正在加载版本差异...</div>
        ) : versionDiff ? (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label="新增样本" value={versionDiff.added_count} />
              <StatCard label="移除样本" value={versionDiff.removed_count} />
              <StatCard label="变更样本" value={versionDiff.changed_count} />
            </div>

            {versionDiff.changed.length > 0 ? (
              <div>
                <p className="mb-3 text-sm font-medium text-[color:var(--color-text)]">变更样本</p>
                <div className="space-y-3">
                  {versionDiff.changed.slice(0, 8).map((item) => (
                    <div key={item.example_id} className="grid gap-3 rounded-[1rem] border border-[color:var(--color-line)] p-4 lg:grid-cols-2">
                      <div>
                        <p className="mb-2 text-sm font-medium">旧版本 · {item.example_id}</p>
                        <CodeBlock>{item.before.inputs}</CodeBlock>
                      </div>
                      <div>
                        <p className="mb-2 text-sm font-medium">当前版本 · {item.example_id}</p>
                        <CodeBlock>{item.after.inputs}</CodeBlock>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {versionDiff.added.length > 0 ? (
              <div>
                <p className="mb-3 text-sm font-medium text-[color:var(--color-text)]">新增样本</p>
                <div className="space-y-3">
                  {versionDiff.added.slice(0, 8).map((item) => (
                    <div key={item.example_id} className="rounded-[1rem] border border-[color:var(--color-line)] p-4">
                      <p className="mb-2 text-sm font-medium">{item.example_id}</p>
                      <CodeBlock>{item.inputs}</CodeBlock>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {versionDiff.removed.length > 0 ? (
              <div>
                <p className="mb-3 text-sm font-medium text-[color:var(--color-text)]">移除样本</p>
                <div className="space-y-3">
                  {versionDiff.removed.slice(0, 8).map((item) => (
                    <div key={item.example_id} className="rounded-[1rem] border border-[color:var(--color-line)] p-4">
                      <p className="mb-2 text-sm font-medium">{item.example_id}</p>
                      <CodeBlock>{item.inputs}</CodeBlock>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="py-8 text-center text-sm text-[color:var(--color-text-soft)]">暂无可显示的版本差异。</div>
        )}
      </Modal>

      <Modal
        open={rollbackModalOpen}
        onClose={() => {
          setRollbackModalOpen(false)
          setSelectedVersion(null)
        }}
        title={selectedVersion ? `回滚到 v${selectedVersion.version}` : '回滚 Dataset'}
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setRollbackModalOpen(false)}>
              取消
            </Button>
            <Button variant="secondary" loading={submitting} onClick={() => void handleRollbackVersion()} disabled={!selectedVersion}>
              确认回滚
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-[color:var(--color-text-soft)]">
            回滚不会覆盖历史版本，而是基于目标版本重新生成一个新的当前版本，方便后续继续迭代和审计。
          </p>
          <Textarea
            label="版本说明"
            value={rollbackDescription}
            onChange={(event) => setRollbackDescription(event.target.value)}
            placeholder="例如：Rolled back to version v3 after regression review"
          />
        </div>
      </Modal>
    </PageContainer>
  )
}
