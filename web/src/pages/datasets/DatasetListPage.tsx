import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Database, Plus, Search } from 'lucide-react'
import { createDataset, listDatasets } from '@/api/datasets'
import PageContainer from '@/components/layout/PageContainer'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import Input from '@/components/ui/Input'
import Modal from '@/components/ui/Modal'
import Pagination from '@/components/ui/Pagination'
import Table, { type Column } from '@/components/ui/Table'
import Textarea from '@/components/ui/Textarea'
import { useDebouncedSearchInput } from '@/hooks/useDebouncedSearchInput'
import { useAsyncResource } from '@/hooks/useAsyncResource'
import { canManageEvaluationAssets } from '@/lib/permissions'
import { applySearchParamPatch, readPositiveIntParam } from '@/lib/searchParams'
import { useAppStore } from '@/stores/app'
import { toast } from '@/stores/toast'
import type { Dataset } from '@/types'
import { formatDate } from '@/lib/utils'

async function loadDatasets(page: number, name: string) {
  return listDatasets({ page, page_size: 20, name: name || undefined })
}

export default function DatasetListPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const currentProjectRole = useAppStore((state) => state.currentProjectRole)
  const search = searchParams.get('search')?.trim() ?? ''
  const page = readPositiveIntParam(searchParams.get('page'))
  const [modalOpen, setModalOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [schemaText, setSchemaText] = useState('{\n  "inputs": {"type": "object"},\n  "expected_outputs": {"type": "string"}\n}')
  const [submitting, setSubmitting] = useState(false)

  const setParams = useCallback(
    (updates: Record<string, string | null | undefined>, options?: { resetPage?: boolean }) => {
      setSearchParams(applySearchParamPatch(searchParams, updates, options))
    },
    [searchParams, setSearchParams]
  )
  const [searchInput, setSearchInput] = useDebouncedSearchInput(search, (nextValue) => {
    setParams({ search: nextValue || null }, { resetPage: true })
  })

  const { data, loading, error, reload } = useAsyncResource(() => loadDatasets(page, search), [page, search])
  const canManage = canManageEvaluationAssets(currentProjectRole)

  const columns = useMemo<Column<Dataset>[]>(
    () => [
      {
        key: 'name',
        header: 'Dataset',
        render: (dataset) => (
          <div>
            <p className="font-medium">{dataset.name}</p>
            <p className="mt-1 text-sm text-[color:var(--color-text-soft)]">{dataset.description || '暂无描述'}</p>
          </div>
        ),
      },
      {
        key: 'examples',
        header: '样本数',
        render: (dataset) => <span>{dataset.example_count}</span>,
      },
      {
        key: 'version',
        header: '版本',
        render: (dataset) => <Badge variant="info">v{dataset.current_version}</Badge>,
      },
      {
        key: 'updated_at',
        header: '更新时间',
        render: (dataset) => <span>{formatDate(dataset.updated_at)}</span>,
      },
    ],
    []
  )

  const handleCreate = async () => {
    setSubmitting(true)
    try {
      const schema = schemaText.trim() ? JSON.parse(schemaText) : undefined
      await createDataset({
        name,
        description,
        schema_def: schema,
      })
      setModalOpen(false)
      setName('')
      setDescription('')
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建 Dataset 失败', '创建 Dataset 失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PageContainer
      title="Dataset"
      description="维护可复用的回归样本，追踪版本，并把失败转成可重复使用的评测资产。"
      actions={
        <>
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="搜索 Dataset"
            icon={<Search className="h-4 w-4" />}
            className="min-w-[14rem]"
          />
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/datasets/new')} disabled={!canManage}>
            新建 Dataset
          </Button>
        </>
      }
    >
      {error ? (
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="无法加载 Dataset"
          description={error}
          action={<Button variant="secondary" onClick={() => void reload()}>重试</Button>}
        />
      ) : data && data.items.length === 0 && !loading ? (
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="暂无 Dataset"
          description="创建 Dataset，或运行演示 bootstrap 把真实样本带入工作区。"
          action={<Button onClick={() => navigate('/datasets/new')} disabled={!canManage}>创建 Dataset</Button>}
        />
      ) : (
        <Table
          columns={columns}
          data={data?.items ?? []}
          loading={loading}
          onRowClick={(dataset) => navigate(`/datasets/${dataset.id}`)}
        />
      )}
      <Pagination
        page={data?.page ?? page}
        totalPages={data?.total_pages ?? Math.max(1, Math.ceil((data?.total ?? 0) / Math.max(data?.page_size ?? 20, 1)))}
        total={data?.total ?? 0}
        pageSize={data?.page_size ?? 20}
        onPageChange={(nextPage) => setParams({ page: String(nextPage) })}
      />

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="创建 Dataset"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              取消
            </Button>
              <Button loading={submitting} onClick={() => void handleCreate()} disabled={!canManage}>
                创建 Dataset
              </Button>
          </div>
        }
      >
        <div className="grid gap-4">
          <Input label="名称" value={name} onChange={(event) => setName(event.target.value)} placeholder="客服问答示例" />
          <Textarea
            label="描述"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="这个 Dataset 用来保护什么能力。"
          />
          <Textarea
            label="Schema (JSON)"
            value={schemaText}
            onChange={(event) => setSchemaText(event.target.value)}
            className="min-h-[12rem] font-mono"
          />
        </div>
      </Modal>
    </PageContainer>
  )
}
