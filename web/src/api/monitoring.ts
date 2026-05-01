import { api } from './client'
import type {
  MonitoringOverview,
  MonitoringRule,
  MonitorAlert,
  MonitorRuleRunResult,
  MonitorRun,
  PaginatedData,
} from '@/types'

export function getMonitoringOverview() {
  return api.get<MonitoringOverview>('/monitoring/overview')
}

export function listMonitoringRules(params?: {
  page?: number
  page_size?: number
  query?: string
  status?: string
}) {
  return api.get<PaginatedData<MonitoringRule>>('/monitoring/rules', params)
}

export function createMonitoringRule(payload: {
  name: string
  description: string
  status?: string
  sampling_rate: number
  evaluator_ids: string[]
  threshold: number
  severity: string
  backfill_dataset_id?: string | null
  backfill_split?: string
  auto_annotation?: boolean
  guardrail_config: {
    blocked_keywords: string[]
    blocked_regexes: string[]
    max_output_chars?: number | null
    require_non_empty_output: boolean
  }
}) {
  return api.post<MonitoringRule>('/monitoring/rules', payload)
}

export function updateMonitoringRule(
  id: string,
  payload: Partial<{
    name: string
    description: string
    status: string
    sampling_rate: number
    evaluator_ids: string[]
    threshold: number
    severity: string
    backfill_dataset_id: string | null
    backfill_split: string
    auto_annotation: boolean
    guardrail_config: {
      blocked_keywords: string[]
      blocked_regexes: string[]
      max_output_chars?: number | null
      require_non_empty_output: boolean
    }
  }>
) {
  return api.put<MonitoringRule>(`/monitoring/rules/${id}`, payload)
}

export function runMonitoringRule(id: string) {
  return api.post<MonitorRuleRunResult>(`/monitoring/rules/${id}/run`)
}

export function listMonitoringRuns(params?: {
  rule_id?: string
  page?: number
  page_size?: number
  query?: string
}) {
  return api.get<PaginatedData<MonitorRun>>('/monitoring/runs', params)
}

export function listMonitoringAlerts(params?: {
  status?: string
  page?: number
  page_size?: number
  query?: string
}) {
  return api.get<PaginatedData<MonitorAlert>>('/monitoring/alerts', params)
}

export function resolveMonitoringAlert(id: string) {
  return api.post<MonitorAlert>(`/monitoring/alerts/${id}/resolve`)
}
