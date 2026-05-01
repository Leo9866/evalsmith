import { api } from './client'
import type {
  CompareResponse,
  Example,
  Experiment,
  ExperimentBaseline,
  ExperimentPromptRef,
  ExperimentResult,
  ExperimentTargetPreview,
  HTTPMethod,
  PaginatedData,
} from '@/types'

export function listExperiments(params?: {
  page?: number
  page_size?: number
  query?: string
  status?: Experiment['status'] | string
}) {
  return api.get<PaginatedData<Experiment>>('/experiments', params)
}

export function getExperiment(id: string) {
  return api.get<Experiment>(`/experiments/${id}`)
}

export function createExperiment(data: {
  name: string
  description: string
  dataset_id: string
  dataset_version?: number | null
  split?: string
  evaluator_ids: string[]
  target_url: string
  target_method?: HTTPMethod
  target_headers?: Record<string, string>
  target_body_template?: string
  target_response_path?: string | null
  target_timeout_ms?: number
  concurrency?: number
  prompt_ref?: ExperimentPromptRef | null
}) {
  return api.post<Experiment>('/experiments', data)
}

export function previewExperimentTarget(data: {
  target_url: string
  target_method?: HTTPMethod
  target_headers?: Record<string, string>
  target_body_template?: string
  target_response_path?: string | null
  target_timeout_ms?: number
  prompt_ref?: ExperimentPromptRef | null
  example: Pick<Example, 'id' | 'inputs' | 'expected_outputs' | 'metadata' | 'split'>
}) {
  return api.post<ExperimentTargetPreview>('/experiments/target-preview', data)
}

export function getExperimentResults(
  id: string,
  params?: {
    page?: number
    page_size?: number
    sort_by?: 'created_at' | 'latency_ms' | 'score'
    sort_order?: 'asc' | 'desc'
    max_score?: number
  }
) {
  return api.get<PaginatedData<ExperimentResult>>(`/experiments/${id}/results`, params)
}

export function compareExperiments(experimentIds: string[], baselineExperimentId?: string) {
  return api.post<CompareResponse>('/experiments/compare', {
    experiment_ids: experimentIds,
    baseline_experiment_id: baselineExperimentId,
  })
}

export function setExperimentBaseline(experimentId: string, datasetId: string) {
  return api.post<ExperimentBaseline>(`/experiments/${experimentId}/baseline`, { dataset_id: datasetId })
}

export function getExperimentBaseline(datasetId: string) {
  return api.get<ExperimentBaseline | null>('/experiments/baselines', { dataset_id: datasetId })
}

export function cancelExperiment(experimentId: string) {
  return api.post<void>(`/experiments/${experimentId}/cancel`)
}
