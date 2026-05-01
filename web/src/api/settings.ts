import { api } from './client'
import type {
  ApiKey,
  ApiKeyWithRaw,
  Project,
  ProjectLLMConfig,
  ProjectMember,
  ProjectModelConfig,
  ProjectModelTestResult,
  ProjectRole,
} from '@/types'

export function listProjects() {
  return api.get<Project[]>('/projects')
}

export function createProject(data: { name: string; description: string }) {
  return api.post<Project>('/projects', data)
}

export function updateProject(id: string, data: { name?: string; description?: string }) {
  return api.put<Project>(`/projects/${id}`, data)
}

export function listApiKeys(projectId: string) {
  return api.get<ApiKey[]>('/api-keys', { project_id: projectId })
}

export function createApiKey(projectId: string, data: { name: string }) {
  return api.post<ApiKeyWithRaw>('/api-keys', { ...data, project_id: projectId })
}

export function deleteApiKey(id: string) {
  return api.del<void>(`/api-keys/${id}`)
}

export function getProjectLLMConfig(projectId: string) {
  return api.get<ProjectLLMConfig>(`/projects/${projectId}/llm-config`)
}

export function updateProjectLLMConfig(projectId: string, data: ProjectLLMConfig) {
  return api.put<ProjectLLMConfig>(`/projects/${projectId}/llm-config`, data)
}

export function listProjectModels(projectId: string) {
  return api.get<ProjectModelConfig[]>(`/projects/${projectId}/models`)
}

export function getProjectModel(projectId: string, modelId: string) {
  return api.get<ProjectModelConfig>(`/projects/${projectId}/models/${modelId}`)
}

export function createProjectModel(
  projectId: string,
  data: {
    name: string
    provider: string
    protocol: string
    base_url: string
    model: string
    api_key?: string
    extra_config?: Record<string, unknown>
    capabilities?: string[]
    is_default_judge?: boolean
  }
) {
  return api.post<ProjectModelConfig>(`/projects/${projectId}/models`, data)
}

export function updateProjectModel(
  projectId: string,
  modelId: string,
  data: {
    name: string
    provider: string
    protocol: string
    base_url: string
    model: string
    api_key?: string
    preserve_api_key?: boolean
    extra_config?: Record<string, unknown>
    capabilities?: string[]
    is_default_judge?: boolean
    status?: string
  }
) {
  return api.put<ProjectModelConfig>(`/projects/${projectId}/models/${modelId}`, data)
}

export function deleteProjectModel(projectId: string, modelId: string) {
  return api.del<void>(`/projects/${projectId}/models/${modelId}`)
}

export function testProjectModel(projectId: string, modelId: string) {
  return api.post<ProjectModelTestResult>(`/projects/${projectId}/models/${modelId}/test`)
}

export function setDefaultProjectModel(projectId: string, modelId: string) {
  return api.post<ProjectModelConfig>(`/projects/${projectId}/models/${modelId}/set-default`)
}

export function listProjectMembers(projectId: string) {
  return api.get<ProjectMember[]>(`/projects/${projectId}/members`)
}

export function addProjectMember(projectId: string, data: { email: string; role: ProjectRole | string }) {
  return api.post<ProjectMember>(`/projects/${projectId}/members`, data)
}

export function updateProjectMember(projectId: string, userId: string, data: { role: ProjectRole | string }) {
  return api.put<ProjectMember>(`/projects/${projectId}/members/${userId}`, data)
}

export function removeProjectMember(projectId: string, userId: string) {
  return api.del<void>(`/projects/${projectId}/members/${userId}`)
}
