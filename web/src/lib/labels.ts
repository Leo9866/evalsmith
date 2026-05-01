import type { EvaluatorType, ExperimentStatus, ProjectRole, SpanType, TraceStatus } from '@/types'

export function formatStatus(status: string | undefined | null): string {
  switch (status) {
    case 'active':
      return '启用中'
    case 'draft':
      return '草稿'
    case 'archived':
      return '已归档'
    case 'paused':
      return '已暂停'
    case 'ok':
      return '成功'
    case 'error':
      return '异常'
    case 'pending':
      return '等待中'
    case 'running':
      return '运行中'
    case 'completed':
      return '已完成'
    case 'failed':
      return '失败'
    case 'cancel_requested':
      return '取消中'
    case 'canceled':
      return '已取消'
    case 'in_progress':
      return '处理中'
    case 'open':
      return '未处理'
    case 'resolved':
      return '已解决'
    default:
      return status || '未知'
  }
}

export function formatTraceStatus(status: TraceStatus | string): string {
  return formatStatus(status)
}

export function formatExperimentStatus(status: ExperimentStatus | string): string {
  return formatStatus(status)
}

export function formatEvaluatorType(type: EvaluatorType | string): string {
  switch (type) {
    case 'rule':
      return '规则'
    case 'llm_judge':
      return 'LLM Judge'
    case 'code':
      return '代码'
    case 'statistical':
      return '统计'
    default:
      return type
  }
}

export function formatRuleKind(kind: string): string {
  switch (kind) {
    case 'exact_match':
      return '精确匹配'
    case 'contains':
      return '包含'
    case 'regex_match':
      return '正则匹配'
    case 'json_schema_valid':
      return 'JSON Schema 校验'
    case 'not_empty':
      return '非空'
    default:
      return kind
  }
}

export function formatSplit(split: string): string {
  switch (split) {
    case 'default':
      return '默认'
    case 'all':
      return '全部'
    default:
      return split
  }
}

export function formatExampleSource(source: string): string {
  switch (source) {
    case 'manual':
      return '手动'
    case 'import':
      return '导入'
    case 'trace_backfill':
      return 'Trace 回流'
    case 'synthetic':
      return '合成'
    default:
      return source
  }
}

export function formatSpanType(type: SpanType | string): string {
  switch (type) {
    case 'llm':
      return 'LLM'
    case 'tool':
      return 'Tool'
    case 'retrieval':
      return 'Retrieval'
    case 'chain':
      return 'Chain'
    case 'agent':
      return 'Agent'
    case 'custom':
      return 'Custom'
    default:
      return type
  }
}

export function formatProjectRole(role: ProjectRole | string | undefined | null): string {
  switch (role) {
    case 'owner':
      return 'Owner'
    case 'admin':
      return 'Admin'
    case 'developer':
      return 'Developer'
    case 'annotator':
      return 'Annotator'
    case 'viewer':
      return 'Viewer'
    default:
      return role || '未知'
  }
}

export function formatMonitorSeverity(severity: string | undefined | null): string {
  switch (severity) {
    case 'info':
      return '信息'
    case 'warning':
      return '警告'
    case 'critical':
      return '严重'
    default:
      return severity || '未知'
  }
}
