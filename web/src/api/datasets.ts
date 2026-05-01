import { api } from './client'
import type { Dataset, DatasetImportResult, DatasetVersion, DatasetVersionDiff, DatasetVersionRollbackResult, Example, PaginatedData, SplitSummary } from '@/types'

export function listDatasets(params?: { page?: number; page_size?: number; name?: string }) {
  return api.get<PaginatedData<Dataset>>('/datasets', params)
}

export function getDataset(id: string) {
  return api.get<Dataset>(`/datasets/${id}`)
}

export function createDataset(data: {
  name: string
  description: string
  schema_def?: Record<string, unknown>
}) {
  return api.post<Dataset>('/datasets', data)
}

export function updateDataset(
  id: string,
  data: {
    name?: string
    description?: string
    schema_def?: Record<string, unknown>
  }
) {
  return api.put<Dataset>(`/datasets/${id}`, data)
}

export function listExamples(
  datasetId: string,
  params?: { page?: number; page_size?: number; split?: string; version?: number; query?: string }
) {
  return api.get<PaginatedData<Example>>(`/datasets/${datasetId}/examples`, params)
}

export function addExamples(
  datasetId: string,
  examples: Array<{
      inputs: unknown
      expected_outputs?: unknown
      metadata?: unknown
      split?: string
      source?: string
    }>
) {
  return api.post<{ added: number; new_version: number; example_ids: string[] }>(
    `/datasets/${datasetId}/examples`,
    { examples }
  )
}

export function updateExample(
  datasetId: string,
  exampleId: string,
  data: { inputs?: unknown; expected_outputs?: unknown; metadata?: unknown; split?: string }
) {
  return api.put<Example>(`/datasets/${datasetId}/examples/${exampleId}`, data)
}

export function deleteExample(datasetId: string, exampleId: string) {
  return api.del<void>(`/datasets/${datasetId}/examples/${exampleId}`)
}

export function listVersions(datasetId: string) {
  return api.get<DatasetVersion[]>(`/datasets/${datasetId}/versions`)
}

export function updateDatasetVersion(datasetId: string, version: number, data: { description: string }) {
  return api.put<DatasetVersion>(`/datasets/${datasetId}/versions/${version}`, data)
}

export function getDatasetVersionDiff(datasetId: string, version: number, baseVersion: number) {
  return api.get<DatasetVersionDiff>(`/datasets/${datasetId}/versions/${version}/diff`, { base_version: baseVersion })
}

export function rollbackDatasetVersion(datasetId: string, version: number, data?: { description?: string }) {
  return api.post<DatasetVersionRollbackResult>(`/datasets/${datasetId}/versions/${version}/rollback`, data ?? {})
}

export function listDatasetSplits(datasetId: string) {
  return api.get<SplitSummary[]>(`/datasets/${datasetId}/splits`)
}

export function importDataset(datasetId: string, file: File, description?: string) {
  const formData = new FormData()
  formData.append('file', file)
  if (description?.trim()) {
    formData.append('description', description.trim())
  }
  return api.post<DatasetImportResult>(`/datasets/${datasetId}/import`, formData)
}
