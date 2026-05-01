import { useEffect, useState } from 'react'
import { Bot, KeyRound, Settings, Shield, Users } from 'lucide-react'
import {
  addProjectMember,
  createApiKey,
  createProjectModel,
  createProject,
  deleteApiKey,
  deleteProjectModel,
  listApiKeys,
  listProjectModels,
  listProjectMembers,
  listProjects,
  removeProjectMember,
  setDefaultProjectModel,
  testProjectModel,
  updateProjectMember,
  updateProjectModel,
} from '@/api/settings'
import PageContainer from '@/components/layout/PageContainer'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import EmptyState from '@/components/ui/EmptyState'
import Input from '@/components/ui/Input'
import Modal from '@/components/ui/Modal'
import Select from '@/components/ui/Select'
import Tabs from '@/components/ui/Tabs'
import Textarea from '@/components/ui/Textarea'
import { useAsyncResource } from '@/hooks/useAsyncResource'
import { formatProjectRole } from '@/lib/labels'
import { canManageApiKeys, canManageLLMConfig, canManageProjectMembers } from '@/lib/permissions'
import { useAppStore } from '@/stores/app'
import { toast } from '@/stores/toast'
import { formatDate } from '@/lib/utils'
import type { ProjectModelConfig } from '@/types'

function createEmptyModelForm() {
  return {
    name: '',
    provider: 'openai_compatible',
    protocol: 'openai',
    base_url: '',
    model: '',
    api_key: '',
    is_default_judge: false,
  }
}

async function loadSettings(projectId: string) {
  const projects = await listProjects()
  const activeProject = projects.find((project) => project.id === projectId) ?? projects[0] ?? null
  const currentProjectRole = activeProject?.role ?? null

  const [members, apiKeys, models] = await Promise.all([
    activeProject ? listProjectMembers(activeProject.id) : Promise.resolve([]),
    activeProject && canManageApiKeys(currentProjectRole) ? listApiKeys(activeProject.id) : Promise.resolve([]),
    activeProject && canManageLLMConfig(currentProjectRole)
      ? listProjectModels(activeProject.id)
      : Promise.resolve([]),
  ])

  return {
    projects,
    members,
    apiKeys,
    models,
    currentProjectRole,
  }
}

export default function SettingsPage() {
  const currentProject = useAppStore((state) => state.currentProject)
  const currentProjectRole = useAppStore((state) => state.currentProjectRole)
  const currentUser = useAppStore((state) => state.currentUser)
  const setProject = useAppStore((state) => state.setProject)
  const setProjects = useAppStore((state) => state.setProjects)
  const [tab, setTab] = useState('projects')
  const [projectModalOpen, setProjectModalOpen] = useState(false)
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false)
  const [memberModalOpen, setMemberModalOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDescription, setNewProjectDescription] = useState('')
  const [newApiKeyName, setNewApiKeyName] = useState('前端 Key')
  const [newMemberEmail, setNewMemberEmail] = useState('')
  const [newMemberRole, setNewMemberRole] = useState('viewer')
  const [issuedKey, setIssuedKey] = useState<string | null>(null)
  const [modelModalOpen, setModelModalOpen] = useState(false)
  const [editingModelId, setEditingModelId] = useState<string | null>(null)
  const [modelForm, setModelForm] = useState(createEmptyModelForm())
  const [savingModel, setSavingModel] = useState(false)
  const [testingModelId, setTestingModelId] = useState<string | null>(null)
  const [defaultingModelId, setDefaultingModelId] = useState<string | null>(null)
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null)
  const [modelTestResult, setModelTestResult] = useState<{
    modelId: string
    success: boolean
    message: string
    latencyMs: number
    endpoint: string
  } | null>(null)
  const [memberActionLoading, setMemberActionLoading] = useState<string | null>(null)
  const { data, loading, error, reload } = useAsyncResource(() => loadSettings(currentProject), [currentProject])

  const projectRole = data?.currentProjectRole ?? currentProjectRole
  const canManageMembers = canManageProjectMembers(projectRole)
  const canCreateKeys = canManageApiKeys(projectRole)
  const canEditLLM = canManageLLMConfig(projectRole)
  const projectModels = data?.models ?? []
  const defaultJudgeModel = projectModels.find((item) => item.is_default_judge && item.status === 'active') ?? null

  useEffect(() => {
    if (data?.projects) {
      setProjects(data.projects)
    }
  }, [data?.projects, setProjects])

  const handleCreateProject = async () => {
    try {
      const project = await createProject({
        name: newProjectName,
        description: newProjectDescription,
      })
      setProjectModalOpen(false)
      setNewProjectName('')
      setNewProjectDescription('')
      setProject(project.id)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建项目失败', '创建项目失败')
    }
  }

  const handleCreateApiKey = async () => {
    try {
      const apiKey = await createApiKey(currentProject, { name: newApiKeyName })
      setIssuedKey(apiKey.raw_key)
      setApiKeyModalOpen(false)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建 API Key 失败', '创建 API Key 失败')
    }
  }

  const handleDeleteApiKey = async (id: string) => {
    try {
      await deleteApiKey(id)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '吊销 API Key 失败', '吊销 API Key 失败')
    }
  }

  const handleOpenCreateModel = () => {
    setEditingModelId(null)
    setModelForm(createEmptyModelForm())
    setModelModalOpen(true)
  }

  const handleOpenEditModel = (item: ProjectModelConfig) => {
    setEditingModelId(item.id)
    setModelForm({
      name: item.name,
      provider: item.provider || 'openai_compatible',
      protocol: String(item.protocol || 'openai'),
      base_url: item.base_url || '',
      model: item.model || '',
      api_key: '',
      is_default_judge: item.is_default_judge,
    })
    setModelModalOpen(true)
  }

  const handleSaveModel = async () => {
    setSavingModel(true)
    try {
      const payload = {
        name: modelForm.name.trim(),
        provider: modelForm.provider,
        protocol: modelForm.protocol,
        base_url: modelForm.base_url.trim(),
        model: modelForm.model.trim(),
        api_key: modelForm.api_key.trim(),
        preserve_api_key: editingModelId ? modelForm.api_key.trim() === '' : undefined,
        capabilities: ['judge'],
        is_default_judge: modelForm.is_default_judge,
        status: 'active',
      }

      if (editingModelId) {
        await updateProjectModel(currentProject, editingModelId, payload)
        toast.success('模型配置已更新')
      } else {
        await createProjectModel(currentProject, payload)
        toast.success('模型配置已创建')
      }

      setModelModalOpen(false)
      setEditingModelId(null)
      setModelForm(createEmptyModelForm())
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存模型配置失败', '保存模型配置失败')
    } finally {
      setSavingModel(false)
    }
  }

  const handleDeleteModel = async (modelId: string) => {
    setDeletingModelId(modelId)
    try {
      await deleteProjectModel(currentProject, modelId)
      if (modelTestResult?.modelId === modelId) {
        setModelTestResult(null)
      }
      await reload()
      toast.success('模型配置已删除')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除模型配置失败', '删除模型配置失败')
    } finally {
      setDeletingModelId(null)
    }
  }

  const handleTestModel = async (modelId: string) => {
    setTestingModelId(modelId)
    try {
      const result = await testProjectModel(currentProject, modelId)
      setModelTestResult({
        modelId,
        success: result.success,
        message: result.message,
        latencyMs: result.latency_ms,
        endpoint: result.endpoint,
      })
      if (result.success) {
        toast.success('连接测试通过')
      } else {
        toast.error(result.message, '连接测试失败')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '模型连接测试失败', '模型连接测试失败')
    } finally {
      setTestingModelId(null)
    }
  }

  const handleSetDefaultModel = async (modelId: string) => {
    setDefaultingModelId(modelId)
    try {
      await setDefaultProjectModel(currentProject, modelId)
      await reload()
      toast.success('默认 Judge 模型已更新')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '设置默认模型失败', '设置默认模型失败')
    } finally {
      setDefaultingModelId(null)
    }
  }

  const handleAddMember = async () => {
    setMemberActionLoading('create')
    try {
      await addProjectMember(currentProject, {
        email: newMemberEmail,
        role: newMemberRole,
      })
      setNewMemberEmail('')
      setNewMemberRole('viewer')
      setMemberModalOpen(false)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '添加成员失败', '添加成员失败')
    } finally {
      setMemberActionLoading(null)
    }
  }

  const handleUpdateMemberRole = async (userId: string, role: string) => {
    setMemberActionLoading(userId)
    try {
      await updateProjectMember(currentProject, userId, { role })
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新成员角色失败', '更新成员角色失败')
    } finally {
      setMemberActionLoading(null)
    }
  }

  const handleRemoveMember = async (userId: string) => {
    setMemberActionLoading(userId)
    try {
      await removeProjectMember(currentProject, userId)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '移除成员失败', '移除成员失败')
    } finally {
      setMemberActionLoading(null)
    }
  }

  return (
    <PageContainer
      title="设置"
      description="切换项目、管理团队角色、控制 API Key 与项目模型，把控制台从匿名状态升级成团队协作模式。"
    >
      {error ? (
        <EmptyState
          icon={<Settings className="h-6 w-6" />}
          title="无法加载工作区设置"
          description={error}
          action={<Button variant="secondary" onClick={() => void reload()}>重试</Button>}
        />
      ) : (
        <>
          <Tabs
            tabs={[
              { key: 'projects', label: '项目', count: data?.projects.length },
              { key: 'members', label: '成员与权限', count: data?.members.length },
              { key: 'api_keys', label: 'API Key', count: data?.apiKeys.length },
              { key: 'llm', label: '模型与 LLM', count: data?.models.length },
            ]}
            active={tab}
            onChange={setTab}
          />

	          {tab === 'projects' && (
            <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <Card className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">项目</p>
                    <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-[color:var(--color-text)]">
                      工作区选择
                    </h2>
                  </div>
                  <Button onClick={() => setProjectModalOpen(true)} disabled={!currentUser}>
                    新建项目
                  </Button>
                </div>
                <div className="mt-5 space-y-3">
                  {(data?.projects ?? []).map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => setProject(project.id)}
                      className={`w-full rounded-[22px] border px-4 py-4 text-left transition ${
                        project.id === currentProject
                          ? 'border-[color:rgba(186,91,42,0.28)] bg-[rgba(186,91,42,0.08)]'
                          : 'border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] hover:border-[color:var(--color-line-strong)]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium text-[color:var(--color-text)]">{project.name}</p>
                        <Badge variant={project.role === 'owner' || project.role === 'admin' ? 'warning' : 'info'}>
                          {formatProjectRole(project.role)}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-[color:var(--color-text-soft)]">
                        {project.description || '暂无描述'}
                      </p>
                    </button>
                  ))}
                </div>
              </Card>

	              <Card className="p-6">
                <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">当前项目</p>
                <div className="mt-4 space-y-3 text-sm leading-7 text-[color:var(--color-text-soft)]">
                  <p>当前选中的项目 ID 会用于所有前端 API 请求，以及通过网关发出的每个 SDK 请求。</p>
                  <p>
                    如果你要运行演示 bootstrap，请把项目保持为{' '}
                    <code className="rounded bg-[rgba(36,31,26,0.06)] px-2 py-1 font-mono">proj_default</code>.
                  </p>
	                  <p>当前项目下保存的默认 Judge 模型会自动带到“创建 Evaluator”的 LLM Judge 表单里。</p>
                  <p>
                    你在当前项目中的角色是{' '}
                    <span className="font-medium text-[color:var(--color-text)]">{formatProjectRole(projectRole)}</span>。
                  </p>
                </div>
              </Card>
            </div>
          )}

          {tab === 'members' && (
            <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
              <Card className="p-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">成员</p>
                    <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-[color:var(--color-text)]">
                      当前项目的角色分配
                    </h2>
                  </div>
                  <Button onClick={() => setMemberModalOpen(true)} disabled={!canManageMembers}>
                    添加成员
                  </Button>
                </div>

                <div className="mt-5 space-y-3">
                  {data?.members.length ? (
                    data.members.map((member) => {
                      const isSelf = member.user_id === currentUser?.id
                      const lockedOwner = isSelf && member.role === 'owner'
                      return (
                        <div
                          key={member.user_id}
                          className="rounded-[22px] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] px-4 py-4"
                        >
                          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                            <div>
                              <div className="flex items-center gap-3">
                                <p className="font-medium text-[color:var(--color-text)]">{member.name}</p>
                                {isSelf && <Badge variant="info">当前账号</Badge>}
                              </div>
                              <p className="mt-1 text-sm text-[color:var(--color-text-soft)]">{member.email}</p>
                              <p className="mt-1 text-xs uppercase tracking-[0.22em] text-[color:rgba(93,83,73,0.56)]">
                                加入于 {formatDate(member.created_at)}
                              </p>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="w-36">
                                <Select
                                  aria-label={`更新 ${member.name} 的角色`}
                                  value={member.role}
                                  onChange={(event) => void handleUpdateMemberRole(member.user_id, event.target.value)}
                                  options={[
                                    { value: 'owner', label: 'Owner' },
                                    { value: 'admin', label: 'Admin' },
                                    { value: 'developer', label: 'Developer' },
                                    { value: 'annotator', label: 'Annotator' },
                                    { value: 'viewer', label: 'Viewer' },
                                  ]}
                                  disabled={!canManageMembers || lockedOwner || memberActionLoading === member.user_id}
                                />
                              </div>
                              <Button
                                variant="danger"
                                onClick={() => void handleRemoveMember(member.user_id)}
                                disabled={!canManageMembers || lockedOwner || memberActionLoading === member.user_id}
                              >
                                移除
                              </Button>
                            </div>
                          </div>
                        </div>
                      )
                    })
                  ) : (
                    <EmptyState
                      icon={<Users className="h-6 w-6" />}
                      title="当前项目还没有成员"
                      description="先添加已经注册过的邮箱账号，再为他们分配角色。"
                    />
                  )}
                </div>
              </Card>

              <Card className="p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[rgba(193,109,58,0.1)] text-[color:var(--color-accent-strong)]">
                    <Shield className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">权限说明</p>
                    <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-[color:var(--color-text)]">
                      {formatProjectRole(projectRole)}
                    </h2>
                  </div>
                </div>

                <div className="mt-5 space-y-3 text-sm leading-7 text-[color:var(--color-text-soft)]">
                  <p>Owner / Admin 可以管理项目成员、修改项目设置，并控制 API Key 与项目模型。</p>
                  <p>Developer 可以继续使用评测、数据集和 Evaluator 能力，但不能调整团队成员。</p>
                  <p>Annotator 和 Viewer 当前以只读为主，后续标注工作台上线后会继续细分权限。</p>
                  {!canManageMembers && (
                    <p className="rounded-[18px] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] px-4 py-3 text-[color:var(--color-text)]">
                      你当前只能查看成员列表，不能直接修改角色或添加成员。
                    </p>
                  )}
                </div>
              </Card>
            </div>
          )}

          {tab === 'api_keys' && (
            <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <Card className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">API Key</p>
                    <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-[color:var(--color-text)]">
                      {currentProject} 的 Key
                    </h2>
                  </div>
                  <Button onClick={() => setApiKeyModalOpen(true)} disabled={!canCreateKeys}>
                    生成 Key
                  </Button>
                </div>
                <div className="mt-5 space-y-3">
                  {loading ? (
                    <div className="rounded-[22px] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] p-4 text-sm text-[color:var(--color-text-soft)]">
                      正在加载 API Key...
                    </div>
                  ) : data?.apiKeys.length ? (
                    data.apiKeys.map((key) => (
                      <div
                        key={key.id}
                        className="flex items-center justify-between gap-3 rounded-[22px] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] px-4 py-4"
                      >
                        <div>
                          <p className="font-medium text-[color:var(--color-text)]">{key.name}</p>
                          <p className="mt-1 font-mono text-sm text-[color:var(--color-text-soft)]">{key.key_prefix}</p>
                          <p className="mt-1 text-sm text-[color:var(--color-text-soft)]">{formatDate(key.created_at)}</p>
                        </div>
	                        <Button variant="danger" onClick={() => void handleDeleteApiKey(key.id)} disabled={!canCreateKeys}>
                          吊销
                        </Button>
                      </div>
                    ))
                  ) : (
                    <EmptyState
                      icon={<KeyRound className="h-6 w-6" />}
                      title={canCreateKeys ? '暂无 API Key' : '当前角色不能管理 API Key'}
                      description={
                        canCreateKeys
                          ? '如果你要从需要 Bearer Auth 的客户端发送 SDK Trace，可以先生成一个 Key。'
                          : '当前项目的 API Key 仅对 Owner / Admin / Developer 可见和可管理。'
                      }
                    />
                  )}
                </div>
              </Card>

              <Card className="p-6">
                <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">最新签发 Key</p>
                {issuedKey ? (
                  <div className="mt-4 space-y-3">
                    <p className="text-sm text-[color:var(--color-text-soft)]">这里只展示一次原始 Key，请立即复制。平台只保存哈希值。</p>
                    <code className="block break-all rounded-[22px] bg-[#1e1916] px-4 py-4 font-mono text-sm text-[#f3ede3]">
                      {issuedKey}
                    </code>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-[color:var(--color-text-soft)]">
                    生成新的 API Key 后，原始凭证会在这里显示一次。
                  </p>
                )}
              </Card>
            </div>
          )}

          {tab === 'llm' && (
            <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
              <Card className="p-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">项目模型注册表</p>
                    <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-[color:var(--color-text)]">
                      管理多个 Judge 模型配置
                    </h2>
                  </div>
                  <Button onClick={handleOpenCreateModel} disabled={!canEditLLM}>新增模型</Button>
                </div>

                <div className="mt-5 space-y-3">
                  {projectModels.length ? (
                    projectModels.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-[22px] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] px-4 py-4"
                      >
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-base font-semibold text-[color:var(--color-text)]">{item.name}</p>
                              {item.is_default_judge ? <Badge variant="success">默认 Judge</Badge> : null}
                              <Badge variant="default">{item.provider || 'openai_compatible'}</Badge>
                              <Badge variant="default">{item.model}</Badge>
                              {item.status !== 'active' ? <Badge variant="warning">{item.status}</Badge> : null}
                            </div>
                            <p className="mt-2 break-all text-sm text-[color:var(--color-text-soft)]">{item.base_url || '未配置 Base URL'}</p>
                            <div className="mt-2 flex flex-wrap gap-4 text-sm text-[color:var(--color-text-soft)]">
                              <span>协议 {item.protocol || 'openai'}</span>
                              <span>密钥 {item.api_key_masked || '未配置'}</span>
                              <span>更新时间 {formatDate(item.updated_at)}</span>
                            </div>
                            {modelTestResult?.modelId === item.id && (
                              <div
                                className={`mt-3 rounded-[18px] border px-4 py-3 text-sm leading-7 ${
                                  modelTestResult.success
                                    ? 'border-[rgba(61,126,88,0.18)] bg-[rgba(61,126,88,0.08)] text-[color:var(--color-text-soft)]'
                                    : 'border-[rgba(186,63,54,0.24)] bg-[rgba(186,63,54,0.06)] text-[color:var(--color-text-soft)]'
                                }`}
                              >
                                <p>{modelTestResult.message}</p>
                                {modelTestResult.endpoint ? <p>检测端点：{modelTestResult.endpoint}</p> : null}
                                {modelTestResult.latencyMs > 0 ? <p>耗时：{modelTestResult.latencyMs} ms</p> : null}
                              </div>
                            )}
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="secondary"
                              onClick={() => void handleTestModel(item.id)}
                              loading={testingModelId === item.id}
                              disabled={!canEditLLM}
                            >
                              测试连接
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => handleOpenEditModel(item)}
                              disabled={!canEditLLM}
                            >
                              编辑
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => void handleSetDefaultModel(item.id)}
                              loading={defaultingModelId === item.id}
                              disabled={!canEditLLM || item.is_default_judge}
                            >
                              设为默认
                            </Button>
                            <Button
                              variant="danger"
                              onClick={() => void handleDeleteModel(item.id)}
                              loading={deletingModelId === item.id}
                              disabled={!canEditLLM}
                            >
                              删除
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <EmptyState
                      icon={<Bot className="h-6 w-6" />}
                      title={canEditLLM ? '当前项目还没有模型配置' : '当前角色不能查看模型配置'}
                      description={
                        canEditLLM
                          ? '先录入一个 OpenAI Compatible 模型，后续 LLM Judge 就能直接引用。'
                          : '只有 Owner / Admin / Developer 可以管理项目模型。'
                      }
                      action={canEditLLM ? <Button onClick={handleOpenCreateModel}>新增模型</Button> : undefined}
                    />
                  )}
                </div>
              </Card>

              <Card className="p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[rgba(193,109,58,0.1)] text-[color:var(--color-accent-strong)]">
                    <Bot className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">当前预览</p>
                    <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-[color:var(--color-text)]">
                      {defaultJudgeModel?.name || '尚未指定默认 Judge 模型'}
                    </h2>
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  <div className="rounded-[18px] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] px-4 py-3">
                    <p className="text-[0.72rem] uppercase tracking-[0.2em] text-[color:rgba(93,83,73,0.62)]">协议</p>
                    <p className="mt-1 text-sm font-medium text-[color:var(--color-text)]">{defaultJudgeModel?.protocol || 'openai'}</p>
                  </div>
                  <div className="rounded-[18px] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] px-4 py-3">
                    <p className="text-[0.72rem] uppercase tracking-[0.2em] text-[color:rgba(93,83,73,0.62)]">Base URL</p>
                    <p className="mt-1 break-all text-sm font-medium text-[color:var(--color-text)]">
                      {defaultJudgeModel?.base_url || '尚未配置'}
                    </p>
                  </div>
                  <div className="rounded-[18px] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] px-4 py-3">
                    <p className="text-[0.72rem] uppercase tracking-[0.2em] text-[color:rgba(93,83,73,0.62)]">API Key</p>
                    <p className="mt-1 text-sm font-medium text-[color:var(--color-text)]">{defaultJudgeModel?.api_key_masked || '未配置'}</p>
                  </div>
                  <div className="rounded-[18px] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] px-4 py-3">
                    <p className="text-[0.72rem] uppercase tracking-[0.2em] text-[color:rgba(93,83,73,0.62)]">模型</p>
                    <p className="mt-1 text-sm font-medium text-[color:var(--color-text)]">{defaultJudgeModel?.model || '未配置'}</p>
                  </div>
                </div>

                <div className="mt-5 space-y-2 text-sm leading-7 text-[color:var(--color-text-soft)]">
                  <p>这里的默认模型会作为新建 LLM Judge 时的优先引用对象，避免在每个 Evaluator 里重复录入 Base URL 和密钥。</p>
                  <p>模型密钥只会在服务端加密保存，业务页面不再回显原始 API Key。</p>
                  {!canEditLLM && <p>当前角色只能查看说明，不能管理项目模型。</p>}
                </div>
              </Card>
            </div>
          )}
        </>
      )}

      <Modal
        open={modelModalOpen}
        onClose={() => setModelModalOpen(false)}
        title={editingModelId ? '编辑模型配置' : '新增模型配置'}
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setModelModalOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void handleSaveModel()} loading={savingModel}>
              {editingModelId ? '保存模型' : '创建模型'}
            </Button>
          </div>
        }
      >
        <div className="grid gap-4">
          <Input
            label="配置名称"
            value={modelForm.name}
            onChange={(event) => setModelForm((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="默认 Judge 模型"
          />
          <div className="grid gap-4 md:grid-cols-2">
            <Select
              label="Provider"
              value={modelForm.provider}
              onChange={(event) => setModelForm((prev) => ({ ...prev, provider: event.target.value }))}
              options={[
                { value: 'openai_compatible', label: 'OpenAI Compatible' },
                { value: 'custom_openai', label: 'Custom OpenAI' },
                { value: 'openai', label: 'OpenAI' },
              ]}
            />
            <Select
              label="协议"
              value={modelForm.protocol}
              onChange={(event) => setModelForm((prev) => ({ ...prev, protocol: event.target.value }))}
              options={[{ value: 'openai', label: 'OpenAI Compatible' }]}
            />
          </div>
          <Input
            label="Base URL"
            value={modelForm.base_url}
            onChange={(event) => setModelForm((prev) => ({ ...prev, base_url: event.target.value }))}
            placeholder="https://api.openai.com/v1"
          />
          <Input
            label="模型名称"
            value={modelForm.model}
            onChange={(event) => setModelForm((prev) => ({ ...prev, model: event.target.value }))}
            placeholder="gpt-4o-mini"
          />
          <Input
            label="API Key"
            type="password"
            value={modelForm.api_key}
            onChange={(event) => setModelForm((prev) => ({ ...prev, api_key: event.target.value }))}
            placeholder={editingModelId ? '留空则保留现有密钥' : '输入提供方 API Key'}
          />
          <label className="flex items-center gap-3 rounded-[18px] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] px-4 py-3 text-sm text-[color:var(--color-text)]">
            <input
              type="checkbox"
              checked={modelForm.is_default_judge}
              onChange={(event) => setModelForm((prev) => ({ ...prev, is_default_judge: event.target.checked }))}
              className="h-4 w-4 rounded border-[color:var(--color-line-strong)] accent-[color:var(--color-accent-strong)]"
            />
            <span>创建后设为默认 Judge 模型</span>
          </label>
          <div className="rounded-[18px] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] px-4 py-3 text-sm leading-7 text-[color:var(--color-text-soft)]">
            <p>项目模型会被新建 LLM Judge 直接引用，避免在多个 Evaluator 中重复维护密钥。</p>
            <p>编辑已有模型时，如果 API Key 保持为空，系统会继续沿用当前已保存的密钥。</p>
          </div>
        </div>
      </Modal>

      <Modal
        open={projectModalOpen}
        onClose={() => setProjectModalOpen(false)}
        title="创建项目"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setProjectModalOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void handleCreateProject()}>创建项目</Button>
          </div>
        }
      >
        <div className="grid gap-4">
          <Input label="项目名称" value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} />
          <Textarea
            label="描述"
            value={newProjectDescription}
            onChange={(event) => setNewProjectDescription(event.target.value)}
          />
        </div>
      </Modal>

      <Modal
        open={apiKeyModalOpen}
        onClose={() => setApiKeyModalOpen(false)}
        title="生成 API Key"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setApiKeyModalOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void handleCreateApiKey()}>生成 Key</Button>
          </div>
        }
      >
        <Input label="Key 名称" value={newApiKeyName} onChange={(event) => setNewApiKeyName(event.target.value)} />
      </Modal>

      <Modal
        open={memberModalOpen}
        onClose={() => setMemberModalOpen(false)}
        title="添加成员"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setMemberModalOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void handleAddMember()} loading={memberActionLoading === 'create'}>
              添加成员
            </Button>
          </div>
        }
      >
        <div className="grid gap-4">
          <Input
            label="已注册邮箱"
            value={newMemberEmail}
            onChange={(event) => setNewMemberEmail(event.target.value)}
            placeholder="member@company.com"
          />
          <Select
            label="角色"
            value={newMemberRole}
            onChange={(event) => setNewMemberRole(event.target.value)}
            options={[
              { value: 'owner', label: 'Owner' },
              { value: 'admin', label: 'Admin' },
              { value: 'developer', label: 'Developer' },
              { value: 'annotator', label: 'Annotator' },
              { value: 'viewer', label: 'Viewer' },
            ]}
          />
        </div>
      </Modal>
    </PageContainer>
  )
}
