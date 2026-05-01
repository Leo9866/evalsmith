import { api } from './client'
import type {
  EvalScore,
  Evaluator,
  EvaluatorRegressionResponse,
  EvaluatorRegressionSample,
  EvaluatorVersion,
  EvaluatorVersionDiff,
  EvaluatorType,
  PaginatedData,
} from '@/types'

export function listEvaluators(params?: {
  page?: number
  page_size?: number
  query?: string
  type?: EvaluatorType
}) {
  return api.get<PaginatedData<Evaluator>>('/evaluators', params)
}

export function getEvaluator(id: string) {
  return api.get<Evaluator>(`/evaluators/${id}`)
}

export function listEvaluatorVersions(id: string) {
  return api.get<EvaluatorVersion[]>(`/evaluators/${id}/versions`)
}

export function getEvaluatorVersionDiff(id: string, version: number, baseVersion?: number) {
  return api.get<EvaluatorVersionDiff>(`/evaluators/${id}/versions/${version}/diff`, {
    base_version: baseVersion,
  })
}

export function createEvaluator(data: {
  name: string
  description: string
  config: Evaluator['config']
}) {
  return api.post<Evaluator>('/evaluators', data)
}

export function updateEvaluator(
  id: string,
  data: {
    name: string
    description: string
    config: Evaluator['config']
  }
) {
  return api.put<Evaluator>(`/evaluators/${id}`, data)
}

export function deleteEvaluator(id: string) {
  return api.del<void>(`/evaluators/${id}`)
}

export function testEvaluator(
  evaluatorId: string,
  payload: {
    eval_input: {
      input: unknown
      output: unknown
      expected?: unknown
      context?: unknown
      metadata?: Record<string, unknown>
    }
  }
) {
  return api.post<EvalScore>(`/evaluators/${evaluatorId}/test`, payload)
}

export function testEvaluatorConfig(payload: {
  config: Evaluator['config']
  eval_input: {
    input: unknown
    output: unknown
    expected?: unknown
    context?: unknown
    metadata?: Record<string, unknown>
  }
}) {
  return api.post<EvalScore>('/evaluators/test-config', payload)
}

export function runEvaluatorRegressionTest(
  evaluatorId: string,
  payload: {
    versions?: number[]
    samples: EvaluatorRegressionSample[]
  }
) {
  return api.post<EvaluatorRegressionResponse>(`/evaluators/${evaluatorId}/regression-test`, payload)
}
