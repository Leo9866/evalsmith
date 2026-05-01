export type SpanType = 'llm' | 'tool' | 'retrieval' | 'chain' | 'agent' | 'custom'
export type TraceStatus = 'ok' | 'error'
export type ExperimentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancel_requested' | 'canceled'
export type EvaluatorType = 'rule' | 'llm_judge' | 'code' | 'statistical'
export type PromptStatus = 'draft' | 'active' | 'archived'
export type LLMProtocol = 'openai'
export type ProjectRole = 'owner' | 'admin' | 'developer' | 'annotator' | 'viewer'
export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'PATCH'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export interface ApiEnvelope<T> {
  code: number
  message: string
  data: T
}

export interface PaginatedData<T> {
  items: T[]
  total: number
  page: number
  page_size: number
  total_pages?: number
}

export interface User {
  id: string
  email: string
  name: string
  created_at: string
  updated_at: string
}

export interface Project {
  id: string
  name: string
  description: string
  role?: ProjectRole | string
  created_at: string
  updated_at: string
}

export interface AuthSession {
  user: User
  projects: Project[]
}

export interface ProjectMember {
  project_id: string
  user_id: string
  email: string
  name: string
  role: ProjectRole | string
  added_by?: string | null
  created_at: string
}

export interface ApiKey {
  id: string
  project_id: string
  key_prefix: string
  name: string
  is_active: boolean
  created_at: string
  last_used_at?: string | null
}

export interface ApiKeyWithRaw extends ApiKey {
  raw_key: string
}

export interface TraceListItem {
  trace_id: string
  project_id: string
  name: string
  status: TraceStatus
  start_time: string
  end_time: string
  duration_ms: number
  total_tokens: number
  total_cost_usd: number
  span_count: number
  tags: string[]
  metadata: string
  input_preview: string
  output_preview: string
  payload_key: string
  created_at: string
}

export interface SpanNode {
  span_id: string
  trace_id: string
  parent_span_id?: string | null
  project_id: string
  name: string
  span_type: SpanType
  status: TraceStatus
  start_time: string
  end_time: string
  duration_ms: number
  model?: string | null
  token_input: number
  token_output: number
  cost_usd: number
  error_message?: string | null
  input_preview: string
  output_preview: string
  payload_key: string
  metadata: string
  input?: JsonValue
  output?: JsonValue
  metrics?: JsonValue
  metadata_json?: JsonValue
  events?: JsonValue[]
  created_at: string
  children: SpanNode[]
}

export interface TraceDetail extends TraceListItem {
  input?: JsonValue
  output?: JsonValue
  metadata_json?: JsonValue
  spans: SpanNode[]
}

export interface TraceFeedbackAction {
  id: string
  project_id: string
  trace_id: string
  action_type: 'dataset_backfill' | 'annotation_create' | string
  source_type: 'manual' | 'monitor_rule' | 'experiment_result' | string
  source_ref_id: string
  target_type: 'dataset' | 'annotation_task' | string
  target_id: string
  target_version?: number | null
  status: 'pending' | 'succeeded' | 'failed' | 'deduped' | string
  request_payload?: JsonValue
  result_payload?: JsonValue
  error_message: string
  created_by: string
  created_at: string
  updated_at: string
}

export interface TraceListResult {
  traces: TraceListItem[]
  total: number
  page: number
  page_size: number
}

export interface TraceStats {
  trace_count: number
  error_count: number
  avg_duration_ms: number
  p50_duration_ms: number
  p95_duration_ms: number
  p99_duration_ms: number
  total_tokens: number
  total_cost_usd: number
}

export interface Dataset {
  id: string
  project_id: string
  name: string
  description: string
  schema_def?: JsonValue
  current_version: number
  example_count: number
  created_at: string
  updated_at: string
}

export interface DatasetVersion {
  id: string
  dataset_id: string
  version: number
  description: string
  created_at: string
}

export interface DatasetDiffEntry {
  example_id: string
  inputs: JsonValue
  expected_outputs?: JsonValue
  metadata?: JsonValue
  split: string
  source: 'manual' | 'import' | 'trace_backfill' | 'synthetic'
}

export interface DatasetChangedPair {
  example_id: string
  before: DatasetDiffEntry
  after: DatasetDiffEntry
}

export interface DatasetVersionDiff {
  dataset_id: string
  base_version: number
  target_version: number
  added_count: number
  removed_count: number
  changed_count: number
  added: DatasetDiffEntry[]
  removed: DatasetDiffEntry[]
  changed: DatasetChangedPair[]
}

export interface DatasetVersionRollbackResult {
  dataset_id: string
  restored_from_version: number
  new_version: number
  active_example_count: number
}

export interface DatasetImportDuplicate {
  row: number
  scope: 'file' | 'dataset' | string
  message: string
  inputs_preview?: string
  duplicate_of_row?: number
  existing_example_id?: string
}

export interface DatasetImportInvalidExample {
  row: number
  message: string
  raw_preview?: string
}

export interface DatasetImportResult {
  total_rows: number
  added: number
  duplicate_count: number
  invalid_count: number
  duplicates: DatasetImportDuplicate[]
  invalid_examples: DatasetImportInvalidExample[]
  new_version?: number
  example_ids?: string[]
  version_description?: string
}

export interface SplitSummary {
  split: string
  count: number
}

export interface Example {
  id: string
  dataset_id: string
  inputs: JsonValue
  expected_outputs?: JsonValue
  metadata?: JsonValue
  source: 'manual' | 'import' | 'trace_backfill' | 'synthetic'
  split: string
  version_added: number
  created_at: string
  updated_at: string
}

export interface RuleConfig {
  kind: 'exact_match' | 'contains' | 'regex_match' | 'json_schema_valid' | 'not_empty' | 'length_in_range' | 'latency_threshold' | 'cost_threshold'
  case_sensitive?: boolean
  strip?: boolean
  keywords?: string[]
  mode?: 'any' | 'all'
  pattern?: string | null
  schema?: Record<string, JsonValue>
  min_length?: number | null
  max_length?: number | null
  threshold_ms?: number | null
  threshold?: number | null
}

export interface LLMProtocolConfig {
  base_url?: string | null
  api_key?: string | null
  model?: string | null
}

export interface ProjectLLMConfig {
  protocol: LLMProtocol | string
  protocol_config: LLMProtocolConfig
}

export interface ProjectModelConfig {
  id: string
  project_id: string
  name: string
  provider: string
  protocol: LLMProtocol | string
  base_url: string
  model: string
  api_key_masked: string
  has_api_key: boolean
  extra_config: Record<string, JsonValue>
  capabilities: string[]
  is_default_judge: boolean
  status: 'active' | 'archived' | string
  created_by?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface ProjectModelTestResult {
  success: boolean
  message: string
  latency_ms: number
  endpoint: string
}

export interface LLMJudgeConfig {
  protocol?: LLMProtocol | string
  protocol_config?: LLMProtocolConfig | null
  project_model_id?: string | null
  use_project_default_model?: boolean
  system_prompt: string
  user_prompt_template: string
  model?: string | null
  temperature?: number
  few_shot_examples?: Record<string, JsonValue>[]
  jury_models?: string[]
  rubric_mode?: boolean
}

export interface CodeConfig {
  language: string
  code: string
  timeout_seconds: number
  dependencies?: string[]
}

export interface StatisticalConfig {
  kind: 'bleu' | 'rouge_l' | 'levenshtein' | 'semantic_similarity'
}

export interface EvaluatorConfig {
  type: EvaluatorType
  rule_config?: RuleConfig | null
  llm_judge_config?: LLMJudgeConfig | null
  code_config?: CodeConfig | null
  statistical_config?: StatisticalConfig | null
}

export interface Evaluator {
  id: string
  name: string
  type: EvaluatorType
  description: string
  config: EvaluatorConfig
  is_builtin: boolean
  version: number
  project_id?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface EvaluatorVersion {
  id: string
  evaluator_id: string
  version: number
  config: EvaluatorConfig
  description?: string | null
  changelog?: string | null
  created_at?: string | null
  is_current: boolean
}

export interface EvaluatorVersionDiffEntry {
  path: string
  change_type: 'added' | 'removed' | 'changed' | string
  before?: JsonValue
  after?: JsonValue
}

export interface EvaluatorVersionDiff {
  evaluator_id: string
  base_version: number
  target_version: number
  base_is_current: boolean
  target_is_current: boolean
  changes: EvaluatorVersionDiffEntry[]
}

export interface EvaluatorRegressionSample {
  label?: string | null
  eval_input: {
    input: JsonValue
    output: JsonValue
    expected?: JsonValue
    context?: JsonValue
    metadata?: Record<string, JsonValue>
    trace?: Record<string, JsonValue>
  }
}

export interface EvaluatorRegressionSampleResult {
  index: number
  label?: string | null
  result?: EvalScore | null
  error?: string | null
}

export interface EvaluatorRegressionVersionResult {
  version: number
  is_current: boolean
  avg_score?: number | null
  passed: number
  failed: number
  sample_results: EvaluatorRegressionSampleResult[]
}

export interface EvaluatorRegressionResponse {
  evaluator_id: string
  sample_count: number
  versions: EvaluatorRegressionVersionResult[]
}

export interface EvalScore {
  score: number
  reasoning?: string | null
  metadata: Record<string, JsonValue>
  evaluator_name: string
  evaluator_type: string
  latency_ms: number
}

export interface PromptRenderMessage {
  role: string
  content: string
}

export interface PromptRenderPreview {
  resolved_variables: Record<string, JsonValue | unknown>
  system_prompt: string
  user_prompt: string
  messages: PromptRenderMessage[]
  warnings: string[]
}

export interface PromptVersion {
  id: string
  prompt_id: string
  version: number
  system_prompt: string
  user_prompt_template: string
  variables_schema: Record<string, JsonValue | unknown>
  render_config: Record<string, JsonValue | unknown>
  change_note: string
  created_by?: string | null
  created_at?: string | null
  is_current: boolean
}

export interface Prompt {
  id: string
  project_id: string
  name: string
  description: string
  status: PromptStatus
  kind: string
  template_engine: string
  current_version: number
  labels: string[]
  created_by?: string | null
  created_at?: string | null
  updated_at?: string | null
  current_version_detail?: PromptVersion | null
}

export interface ExperimentPromptRef {
  prompt_id: string
  version?: number | null
}

export interface ExperimentPromptSnapshot {
  prompt_id: string
  prompt_name: string
  version: number
  template_engine: string
  system_prompt: string
  user_prompt_template: string
  variables_schema: Record<string, JsonValue | unknown>
  render_config: Record<string, JsonValue | unknown>
}

export interface ExperimentSummary {
  total_examples: number
  completed: number
  failed: number
  avg_scores: Record<string, number>
  pass_rates: Record<string, number>
  latency_p50_ms: number
  latency_p90_ms: number
  latency_p99_ms: number
}

export interface Experiment {
  id: string
  name: string
  description: string
  dataset_id: string
  dataset_version?: number | null
  split: string
  evaluator_ids: string[]
  target_url: string
  target_method: HTTPMethod
  target_headers: Record<string, string>
  target_body_template: string
  target_response_path?: string | null
  target_timeout_ms: number
  concurrency: number
  prompt_ref?: ExperimentPromptRef | null
  prompt_snapshot?: ExperimentPromptSnapshot | null
  status: ExperimentStatus
  project_id?: string | null
  summary?: ExperimentSummary | null
  job_status?: string | null
  last_error?: string | null
  is_baseline?: boolean
  created_at?: string | null
  started_at?: string | null
  completed_at?: string | null
}

export interface ExperimentResult {
  id: string
  experiment_id: string
  example_id: string
  input?: JsonValue
  expected_output?: JsonValue
  metadata: Record<string, JsonValue>
  split: string
  actual_output?: JsonValue
  trace_id?: string | null
  latency_ms: number
  scores: EvalScore[]
  error?: string | null
  created_at?: string | null
}

export interface CompareResponse {
  experiments: Array<{
    experiment_id: string
    name: string
    summary: ExperimentSummary
    dataset_id?: string | null
    status?: ExperimentStatus | null
  }>
  baseline_experiment_id?: string | null
  evaluator_deltas: Array<{
    evaluator_name: string
    baseline_score: number
    candidate_score: number
    delta: number
    improved: number
    regressed: number
    unchanged: number
  }>
  sample_diffs: Array<{
    example_id: string
    input?: JsonValue
    expected_output?: JsonValue
    baseline_output?: JsonValue
    candidate_output?: JsonValue
    baseline_trace_id?: string | null
    candidate_trace_id?: string | null
    score_deltas: Record<string, number>
    verdict: 'improved' | 'regressed' | 'unchanged' | string
  }>
}

export interface ExperimentTargetPreview {
  request_method: HTTPMethod
  request_url: string
  request_body?: JsonValue | Record<string, unknown> | string | number | boolean | null
  response_status_code: number
  response_path_used?: string | null
  latency_ms: number
  trace_id?: string | null
  output?: JsonValue | Record<string, unknown> | string | number | boolean | null
  raw_response?: JsonValue | Record<string, unknown> | string | number | boolean | null
  prompt_preview?: PromptRenderPreview | null
}

export interface ExperimentBaseline {
  project_id: string
  dataset_id: string
  experiment_id: string
  created_at?: string | null
  updated_at?: string | null
}

export interface AnnotationTask {
  id: string
  project_id: string
  source_type: string
  source_id: string
  mode: 'single_run' | 'pairwise' | string
  status: 'pending' | 'in_progress' | 'completed' | string
  trace_id?: string | null
  source_trace_id?: string | null
  backfill_action_id?: string | null
  experiment_id?: string | null
  example_id?: string | null
  input_payload: JsonValue
  candidate_output?: JsonValue
  reference_output?: JsonValue
  metadata?: JsonValue
  annotation?: JsonValue
  created_at: string
  updated_at: string
  completed_at?: string | null
}

export interface AnnotationStats {
  total: number
  pending: number
  in_progress: number
  completed: number
}

export interface GuardrailConfig {
  blocked_keywords: string[]
  blocked_regexes: string[]
  max_output_chars?: number | null
  require_non_empty_output: boolean
}

export interface MonitoringRule {
  id: string
  project_id: string
  name: string
  description: string
  status: 'active' | 'paused' | string
  sampling_rate: number
  evaluator_ids: string[]
  threshold: number
  severity: 'info' | 'warning' | 'critical' | string
  backfill_dataset_id?: string | null
  backfill_split: string
  auto_annotation: boolean
  guardrail_config: GuardrailConfig
  last_checked_at?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface MonitorScore {
  evaluator_id: string
  evaluator_name: string
  score: number
  reasoning?: string | null
  latency_ms: number
  metadata: Record<string, JsonValue>
}

export interface MonitorRun {
  id: string
  rule_id: string
  project_id: string
  trace_id: string
  trace_status: string
  avg_score?: number | null
  evaluator_scores: MonitorScore[]
  guardrail_hits: string[]
  alert_triggered: boolean
  dataset_backfilled: boolean
  annotation_created: boolean
  dataset_action_id?: string | null
  annotation_action_id?: string | null
  backfill_error_message?: string | null
  error_message?: string | null
  created_at?: string | null
}

export interface MonitorAlert {
  id: string
  rule_id: string
  run_id?: string | null
  project_id: string
  trace_id?: string | null
  kind: 'score' | 'trace_error' | 'guardrail' | string
  severity: 'info' | 'warning' | 'critical' | string
  status: 'open' | 'resolved' | string
  title: string
  summary: string
  details: Record<string, JsonValue>
  created_at?: string | null
  resolved_at?: string | null
}

export interface MonitoringOverview {
  rule_count: number
  active_rule_count: number
  open_alert_count: number
  recent_run_count: number
  alert_rate: number
  avg_score?: number | null
  latest_alerts: MonitorAlert[]
  latest_runs: MonitorRun[]
}

export interface MonitorRuleRunResult {
  processed: number
  alerts: number
  runs: MonitorRun[]
}

export interface TimeSeriesPoint {
  name: string
  value: number
  [key: string]: string | number
}
