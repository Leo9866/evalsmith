import { api } from './client'
import type { AnnotationStats, AnnotationTask, PaginatedData } from '@/types'

export function listAnnotationTasks(params?: { page?: number; page_size?: number; status?: string; query?: string }) {
  return api.get<PaginatedData<AnnotationTask>>('/annotation/tasks', params)
}

export function getAnnotationTask(id: string) {
  return api.get<AnnotationTask>(`/annotation/tasks/${id}`)
}

export function claimAnnotationTask(id: string) {
  return api.post<void>(`/annotation/tasks/${id}/claim`)
}

export function submitAnnotationTask(
  id: string,
  payload: { label: string; score?: number; note?: string; metadata?: unknown; set_pending?: boolean }
) {
  return api.post<void>(`/annotation/tasks/${id}/submit`, payload)
}

export function getAnnotationStats() {
  return api.get<AnnotationStats>('/annotation/stats')
}
