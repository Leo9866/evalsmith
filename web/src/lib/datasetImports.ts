import type { DatasetImportResult } from '@/types'

export function formatDatasetImportSummary(result: DatasetImportResult) {
  const parts: string[] = []

  if (result.added > 0) {
    parts.push(`新增 ${result.added} 条样本`)
  } else {
    parts.push('未新增样本')
  }

  if (result.duplicate_count > 0) {
    parts.push(`跳过 ${result.duplicate_count} 条重复`)
  }

  if (result.invalid_count > 0) {
    parts.push(`发现 ${result.invalid_count} 条无效`)
  }

  if (result.new_version) {
    parts.push(`生成 v${result.new_version}`)
  }

  return parts.join('，')
}

export function hasDatasetImportIssues(result: DatasetImportResult) {
  return result.duplicate_count > 0 || result.invalid_count > 0
}
