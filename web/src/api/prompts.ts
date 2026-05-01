import { api } from './client'
import type {
  ExperimentPromptRef,
  PaginatedData,
  Prompt,
  PromptRenderPreview,
  PromptVersion,
} from '@/types'

export function listPrompts(params?: {
  page?: number
  page_size?: number
  query?: string
  status?: string
}) {
  return api.get<PaginatedData<Prompt>>('/prompts', params)
}

export function getPrompt(id: string) {
  return api.get<Prompt>(`/prompts/${id}`)
}

export function createPrompt(data: {
  name: string
  description?: string
  status?: string
  template_engine?: string
  labels?: string[]
  system_prompt?: string
  user_prompt_template?: string
  variables_schema?: Record<string, unknown>
  render_config?: Record<string, unknown>
  change_note?: string
}) {
  return api.post<Prompt>('/prompts', data)
}

export function updatePrompt(
  id: string,
  data: {
    name?: string
    description?: string
    status?: string
    template_engine?: string
    labels?: string[]
  }
) {
  return api.put<Prompt>(`/prompts/${id}`, data)
}

export function listPromptVersions(id: string) {
  return api.get<PromptVersion[]>(`/prompts/${id}/versions`)
}

export function createPromptVersion(
  id: string,
  data: {
    system_prompt?: string
    user_prompt_template?: string
    variables_schema?: Record<string, unknown>
    render_config?: Record<string, unknown>
    change_note?: string
  }
) {
  return api.post<PromptVersion>(`/prompts/${id}/versions`, data)
}

export function renderPromptPreview(
  id: string,
  data: {
    version?: number
    sample: {
      inputs?: unknown
      expected_outputs?: unknown
      metadata?: Record<string, unknown>
      split?: string
    }
  }
) {
  return api.post<PromptRenderPreview>(`/prompts/${id}/render-preview`, data)
}

export function rollbackPrompt(id: string, version: number, changeNote?: string) {
  return api.post<PromptVersion>(`/prompts/${id}/rollback`, {
    version,
    change_note: changeNote,
  })
}

export function releasePrompt(id: string, data?: { version?: number; note?: string }) {
  return api.post<Prompt>(`/prompts/${id}/release`, data ?? {})
}

export type { ExperimentPromptRef }
