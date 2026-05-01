import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { History, MessageSquarePlus, RotateCcw, Sparkles } from 'lucide-react'
import {
  createPromptVersion,
  getPrompt,
  listPromptVersions,
  releasePrompt,
  renderPromptPreview,
  rollbackPrompt,
} from '@/api/prompts'
import PageContainer from '@/components/layout/PageContainer'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import CodeBlock from '@/components/ui/CodeBlock'
import EmptyState from '@/components/ui/EmptyState'
import Input from '@/components/ui/Input'
import Modal from '@/components/ui/Modal'
import Table, { type Column } from '@/components/ui/Table'
import Textarea from '@/components/ui/Textarea'
import { useAsyncResource } from '@/hooks/useAsyncResource'
import { formatStatus } from '@/lib/labels'
import { canManageEvaluationAssets } from '@/lib/permissions'
import { formatDate } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { toast } from '@/stores/toast'
import type { PromptRenderPreview, PromptVersion } from '@/types'

async function loadPromptDetail(id: string) {
  const [prompt, versions] = await Promise.all([getPrompt(id), listPromptVersions(id)])
  return { prompt, versions }
}

function parseJsonText(label: string, text: string) {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${label} JSON 解析失败：${error instanceof Error ? error.message : '格式错误'}`)
  }
}

export default function PromptDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const currentProjectRole = useAppStore((state) => state.currentProjectRole)
  const canManage = canManageEvaluationAssets(currentProjectRole)
  const { data, loading, error, reload } = useAsyncResource(() => loadPromptDetail(id), [id])

  const [versionModalOpen, setVersionModalOpen] = useState(false)
  const [savingVersion, setSavingVersion] = useState(false)
  const [systemPrompt, setSystemPrompt] = useState('')
  const [userPromptTemplate, setUserPromptTemplate] = useState('')
  const [changeNote, setChangeNote] = useState('更新模板')

  const [previewVersion, setPreviewVersion] = useState<number | null>(null)
  const [previewInputsText, setPreviewInputsText] = useState('{\n  "input": "如何回滚 Prompt 版本？"\n}')
  const [previewExpectedText, setPreviewExpectedText] = useState('""')
  const [previewMetadataText, setPreviewMetadataText] = useState('{\n  "lang": "zh-CN"\n}')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewResult, setPreviewResult] = useState<PromptRenderPreview | null>(null)

  const prompt = data?.prompt
  const versions = data?.versions ?? []
  const activePreviewVersion = previewVersion ?? prompt?.current_version ?? null

  useEffect(() => {
    if (!prompt?.current_version_detail) {
      return
    }
    setSystemPrompt(prompt.current_version_detail.system_prompt)
    setUserPromptTemplate(prompt.current_version_detail.user_prompt_template)
    setPreviewVersion(prompt.current_version)
  }, [prompt?.current_version, prompt?.current_version_detail])

  const versionColumns: Column<PromptVersion>[] = useMemo(
    () => [
      {
        key: 'version',
        header: '版本',
        render: (version) => (
          <div className="flex items-center gap-2">
            <span className="font-mono">v{version.version}</span>
            {version.is_current ? <Badge variant="success">当前</Badge> : null}
          </div>
        ),
      },
      {
        key: 'change_note',
        header: '说明',
        render: (version) => <span>{version.change_note || '未填写说明'}</span>,
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
              onClick={() => {
                setPreviewVersion(version.version)
                setPreviewResult(null)
              }}
            >
              预览此版本
            </Button>
            <Button
              variant="ghost"
              onClick={() => void handleRelease(version.version)}
              disabled={!canManage}
            >
              发布
            </Button>
            <Button
              variant="secondary"
              onClick={() => void handleRollback(version.version)}
              disabled={!canManage || version.is_current}
            >
              回滚到此版本
            </Button>
          </div>
        ),
      },
    ],
    [canManage]
  )

  const handleCreateVersion = async () => {
    setSavingVersion(true)
    try {
      await createPromptVersion(id, {
        system_prompt: systemPrompt,
        user_prompt_template: userPromptTemplate,
        change_note: changeNote,
      })
      setVersionModalOpen(false)
      await reload()
      toast.success('已创建新的 Prompt 版本')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建版本失败', '创建版本失败')
    } finally {
      setSavingVersion(false)
    }
  }

  const handleRollback = async (version: number) => {
    try {
      await rollbackPrompt(id, version, `Rolled back to v${version}`)
      await reload()
      toast.success(`已基于 v${version} 生成新的当前版本`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '回滚失败', '回滚失败')
    }
  }

  const handleRelease = async (version?: number) => {
    try {
      await releasePrompt(id, { version, note: version ? `Release v${version}` : 'Release current version' })
      await reload()
      toast.success('已发布 Prompt')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '发布失败', '发布失败')
    }
  }

  const handlePreview = async () => {
    if (!activePreviewVersion) {
      return
    }
    setPreviewLoading(true)
    try {
      const preview = await renderPromptPreview(id, {
        version: activePreviewVersion,
        sample: {
          inputs: parseJsonText('inputs', previewInputsText),
          expected_outputs: parseJsonText('expected_outputs', previewExpectedText),
          metadata: parseJsonText('metadata', previewMetadataText),
          split: 'default',
        },
      })
      setPreviewResult(preview)
    } catch (err) {
      setPreviewResult(null)
      toast.error(err instanceof Error ? err.message : '渲染预览失败', '渲染预览失败')
    } finally {
      setPreviewLoading(false)
    }
  }

  if (error) {
    return (
      <PageContainer title="Prompt 详情" description="查看 Prompt 版本与渲染结果。">
        <EmptyState
          icon={<MessageSquarePlus className="h-6 w-6" />}
          title="无法加载 Prompt"
          description={error}
          action={<Button variant="secondary" onClick={() => void reload()}>重试</Button>}
        />
      </PageContainer>
    )
  }

  return (
    <PageContainer
      title={prompt?.name ?? 'Prompt 详情'}
      description={prompt?.description || '查看 Prompt 当前版本、历史版本和渲染预览。'}
      actions={
        <>
          <Button variant="ghost" onClick={() => navigate('/prompts')}>
            返回
          </Button>
          {canManage ? (
            <Button onClick={() => setVersionModalOpen(true)}>
              <History className="mr-2 h-4 w-4" />
              新建版本
            </Button>
          ) : null}
        </>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={prompt?.status === 'active' ? 'success' : 'default'}>
              {formatStatus(prompt?.status)}
            </Badge>
            <Badge variant="default">v{prompt?.current_version ?? 0}</Badge>
            <Badge variant="default">{prompt?.template_engine || 'mustache'}</Badge>
          </div>
          <div className="mt-5 space-y-4">
            <div>
              <p className="text-sm font-medium text-[color:var(--color-text)]">System Prompt</p>
              <div className="mt-2">
                <CodeBlock>{prompt?.current_version_detail?.system_prompt || null}</CodeBlock>
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-[color:var(--color-text)]">User Prompt Template</p>
              <div className="mt-2">
                <CodeBlock>{prompt?.current_version_detail?.user_prompt_template || null}</CodeBlock>
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">Render Preview</p>
          <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-[color:var(--color-text)]">
            用样本检查变量替换
          </h2>
          <div className="mt-5 grid gap-4">
            <Input
              label="预览版本"
              value={activePreviewVersion ? `v${activePreviewVersion}` : '未选择'}
              readOnly
            />
            <Textarea
              label="inputs (JSON)"
              value={previewInputsText}
              onChange={(event) => setPreviewInputsText(event.target.value)}
              className="min-h-[8rem] font-mono"
            />
            <Textarea
              label="expected_outputs (JSON)"
              value={previewExpectedText}
              onChange={(event) => setPreviewExpectedText(event.target.value)}
              className="min-h-[6rem] font-mono"
            />
            <Textarea
              label="metadata (JSON)"
              value={previewMetadataText}
              onChange={(event) => setPreviewMetadataText(event.target.value)}
              className="min-h-[6rem] font-mono"
            />
            <div className="flex items-center gap-3">
              <Button variant="secondary" loading={previewLoading} onClick={() => void handlePreview()}>
                <Sparkles className="mr-2 h-4 w-4" />
                渲染预览
              </Button>
              <p className="text-sm text-[color:var(--color-text-soft)]">
                当前会对选中版本做变量解析，并展示 system / user / messages。
              </p>
            </div>
          </div>
        </Card>
      </div>

      {previewResult ? (
        <Card className="p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="info">预览版本 v{activePreviewVersion}</Badge>
            {previewResult.warnings.length ? <Badge variant="warning">{previewResult.warnings.length} 个警告</Badge> : <Badge variant="success">变量完整</Badge>}
          </div>
          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-medium text-[color:var(--color-text)]">渲染后的 System Prompt</p>
              <CodeBlock>{previewResult.system_prompt}</CodeBlock>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-[color:var(--color-text)]">渲染后的 User Prompt</p>
              <CodeBlock>{previewResult.user_prompt}</CodeBlock>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-[color:var(--color-text)]">Messages</p>
              <CodeBlock>{previewResult.messages}</CodeBlock>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-[color:var(--color-text)]">解析变量</p>
              <CodeBlock>{previewResult.resolved_variables}</CodeBlock>
            </div>
          </div>
          {previewResult.warnings.length ? (
            <div className="mt-4 rounded-[1.25rem] border border-[rgba(193,109,58,0.18)] bg-[rgba(193,109,58,0.08)] p-4 text-sm text-[color:var(--color-text-soft)]">
              {previewResult.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card className="p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">Version History</p>
            <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-[color:var(--color-text)]">历史版本</h2>
          </div>
          {canManage ? (
            <Button variant="ghost" onClick={() => void handleRelease(prompt?.current_version)}>
              <RotateCcw className="mr-2 h-4 w-4" />
              发布当前版本
            </Button>
          ) : null}
        </div>
        <div className="mt-5">
          <Table
            columns={versionColumns}
            data={versions}
            loading={loading}
            emptyMessage="暂无版本记录"
          />
        </div>
      </Card>

      <Modal
        open={versionModalOpen}
        onClose={() => !savingVersion && setVersionModalOpen(false)}
        title="创建新版本"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setVersionModalOpen(false)} disabled={savingVersion}>
              取消
            </Button>
            <Button onClick={() => void handleCreateVersion()} loading={savingVersion}>
              创建版本
            </Button>
          </>
        )}
      >
        <div className="grid gap-4">
          <p className="text-sm text-[color:var(--color-text-soft)]">基于当前 Prompt 内容生成一个新的可追踪版本。</p>
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
