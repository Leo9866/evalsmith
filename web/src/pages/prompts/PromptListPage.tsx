import { useCallback, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { MessageSquarePlus, Plus, Search } from 'lucide-react'
import { createPrompt, listPrompts } from '@/api/prompts'
import PageContainer from '@/components/layout/PageContainer'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import EmptyState from '@/components/ui/EmptyState'
import Input from '@/components/ui/Input'
import Modal from '@/components/ui/Modal'
import Pagination from '@/components/ui/Pagination'
import Select from '@/components/ui/Select'
import Table, { type Column } from '@/components/ui/Table'
import Textarea from '@/components/ui/Textarea'
import { useDebouncedSearchInput } from '@/hooks/useDebouncedSearchInput'
import { useAsyncResource } from '@/hooks/useAsyncResource'
import { formatStatus } from '@/lib/labels'
import { canManageEvaluationAssets } from '@/lib/permissions'
import { applySearchParamPatch, readPositiveIntParam } from '@/lib/searchParams'
import { formatDate } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { toast } from '@/stores/toast'
import type { Prompt } from '@/types'

async function loadPrompts(page: number, query: string, status: string) {
  return listPrompts({
    page,
    page_size: 20,
    query: query || undefined,
    status: status || undefined,
  })
}

export default function PromptListPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const currentProjectRole = useAppStore((state) => state.currentProjectRole)
  const canManage = canManageEvaluationAssets(currentProjectRole)
  const search = searchParams.get('search')?.trim() ?? ''
  const statusFilter = searchParams.get('status') ?? ''
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
    () => loadPrompts(page, search, statusFilter),
    [page, search, statusFilter]
  )

  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('客服回复 Prompt')
  const [description, setDescription] = useState('用于实验中向远程 Agent 发送统一提示。')
  const [status, setStatus] = useState('draft')
  const [systemPrompt, setSystemPrompt] = useState('你是一个可靠的客服助手。')
  const [userPromptTemplate, setUserPromptTemplate] = useState('用户问题：{{inputs.input}}')
  const [changeNote, setChangeNote] = useState('初始化版本')

  const columns: Column<Prompt>[] = [
    {
      key: 'name',
      header: 'Prompt',
      render: (prompt) => (
        <div>
          <p className="font-medium text-[color:var(--color-text)]">{prompt.name}</p>
          <p className="mt-1 text-sm text-[color:var(--color-text-soft)]">{prompt.description || '暂无描述'}</p>
        </div>
      ),
    },
    {
      key: 'version',
      header: '当前版本',
      render: (prompt) => <span className="font-mono text-sm">v{prompt.current_version}</span>,
    },
    {
      key: 'status',
      header: '状态',
      render: (prompt) => <Badge variant={prompt.status === 'active' ? 'success' : 'default'}>{formatStatus(prompt.status)}</Badge>,
    },
    {
      key: 'updated_at',
      header: '更新时间',
      render: (prompt) => <span>{formatDate(prompt.updated_at)}</span>,
    },
  ]

  const handleCreate = async () => {
    setCreating(true)
    try {
      const prompt = await createPrompt({
        name,
        description,
        status,
        system_prompt: systemPrompt,
        user_prompt_template: userPromptTemplate,
        change_note: changeNote,
      })
      setCreateOpen(false)
      await reload()
      navigate(`/prompts/${prompt.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建 Prompt 失败', '创建 Prompt 失败')
    } finally {
      setCreating(false)
    }
  }

  if (error) {
    return (
      <PageContainer title="Prompts" description="把系统提示词和用户模板纳入版本化管理。">
        <EmptyState
          icon={<MessageSquarePlus className="h-6 w-6" />}
          title="无法加载 Prompt 列表"
          description={error}
          action={<Button variant="secondary" onClick={() => void reload()}>重试</Button>}
        />
      </PageContainer>
    )
  }

  return (
    <PageContainer
      title="Prompts"
      description="把 Prompt 当成项目资产来管理，并在 Experiment 中稳定复用。"
      actions={
        <>
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="搜索 Prompt"
            icon={<Search className="h-4 w-4" />}
            className="min-w-[14rem]"
          />
          <Select
            value={statusFilter}
            onChange={(event) => setParams({ status: event.target.value || null }, { resetPage: true })}
            options={[
              { value: '', label: '全部状态' },
              { value: 'draft', label: '草稿' },
              { value: 'active', label: '已启用' },
              { value: 'archived', label: '已归档' },
            ]}
          />
          {canManage ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              新建 Prompt
            </Button>
          ) : null}
        </>
      }
    >
      <Card className="p-6">
        <Table
          columns={columns}
          data={data?.items ?? []}
          loading={loading}
          emptyMessage="当前项目还没有 Prompt，先创建一个版本化模板。"
          onRowClick={(prompt) => navigate(`/prompts/${prompt.id}`)}
        />
      </Card>
      <Pagination
        page={data?.page ?? page}
        totalPages={data?.total_pages ?? Math.max(1, Math.ceil((data?.total ?? 0) / Math.max(data?.page_size ?? 20, 1)))}
        total={data?.total ?? 0}
        pageSize={data?.page_size ?? 20}
        onPageChange={(nextPage) => setParams({ page: String(nextPage) })}
      />

      <Modal
        open={createOpen}
        onClose={() => !creating && setCreateOpen(false)}
        title="新建 Prompt"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
              取消
            </Button>
            <Button onClick={() => void handleCreate()} loading={creating}>
              创建
            </Button>
          </>
        )}
      >
        <div className="grid gap-4">
          <p className="text-sm text-[color:var(--color-text-soft)]">创建一个基础 Prompt，并自动生成 v1 版本。</p>
          <Input label="名称" value={name} onChange={(event) => setName(event.target.value)} />
          <Textarea label="描述" value={description} onChange={(event) => setDescription(event.target.value)} />
          <Select
            label="状态"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            options={[
              { value: 'draft', label: '草稿' },
              { value: 'active', label: '立即启用' },
              { value: 'archived', label: '先归档' },
            ]}
          />
          <Textarea
            label="System Prompt"
            value={systemPrompt}
            onChange={(event) => setSystemPrompt(event.target.value)}
            className="min-h-[8rem] font-mono"
          />
          <Textarea
            label="User Prompt Template"
            value={userPromptTemplate}
            onChange={(event) => setUserPromptTemplate(event.target.value)}
            className="min-h-[10rem] font-mono"
          />
          <Input label="版本说明" value={changeNote} onChange={(event) => setChangeNote(event.target.value)} />
        </div>
      </Modal>
    </PageContainer>
  )
}
