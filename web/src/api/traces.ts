import { api } from './client'
import type { TraceDetail, TraceFeedbackAction, TraceListResult, TraceStats } from '@/types'

export function listTraces(params?: {
  page?: number
  page_size?: number
  status?: string
  search?: string
  start_time?: string
  end_time?: string
  tags?: string
  min_duration_ms?: number
  max_duration_ms?: number
  sort_by?: string
  sort_order?: 'asc' | 'desc'
}) {
  return api.get<TraceListResult>('/traces', params)
}

export function getTrace(id: string) {
  return api.get<TraceDetail>(`/traces/${id}`)
}

export function getTraceStats(params?: { period?: '1h' | '24h' | '7d' | '30d' }) {
  return api.get<TraceStats>('/traces/stats', params)
}

export function submitTraceFeedback(
  id: string,
  payload: { score?: number; comment?: string; tags?: string[] }
) {
  return api.post<void>(`/traces/${id}/feedback`, payload)
}

export function backfillTracesToDataset(payload: {
  dataset_id: string
  trace_ids: string[]
  split?: string
  source_type?: string
  source_ref_id?: string
}) {
  return api.post<{
    dataset_id: string
    trace_ids: string[]
    added: number
    new_version: number
    example_ids: string[]
    actions: TraceFeedbackAction[]
  }>('/traces/batch/dataset', payload)
}

export function backfillTracesToAnnotation(payload: {
  trace_ids: string[]
  mode?: string
  source_type?: string
  source_ref_id?: string
}) {
  return api.post<{
    trace_ids: string[]
    added: number
    task_ids: string[]
    actions: TraceFeedbackAction[]
  }>('/traces/batch/annotation', payload)
}

export function listTraceActions(traceId: string) {
  return api.get<TraceFeedbackAction[]>(`/traces/${traceId}/actions`)
}

export function getTraceAction(actionId: string) {
  return api.get<TraceFeedbackAction>(`/actions/${actionId}`)
}

export function retryTraceAction(actionId: string) {
  return api.post<TraceFeedbackAction>(`/actions/${actionId}/retry`)
}
