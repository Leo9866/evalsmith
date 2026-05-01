export interface EvalSmithConfig {
  apiKey?: string
  project?: string
  baseUrl?: string
  traceUrl?: string
  datasetUrl?: string
  evalUrl?: string
  authUrl?: string
}

export interface PreviewExample {
  id?: string
  inputs: unknown
  expected_outputs?: unknown
  metadata?: Record<string, unknown>
  split?: string
}

function envFirst(...names: string[]): string | undefined {
  for (const name of names) {
    const value = readEnv(name)
    if (value && value.trim()) {
      return value.trim()
    }
  }
  return undefined
}

export interface SpanPayload {
  span_id?: string
  parent_span_id?: string | null
  name: string
  span_type: 'llm' | 'tool' | 'retrieval' | 'chain' | 'agent' | 'custom'
  status: 'ok' | 'error'
  start_time: string
  end_time: string
  input?: unknown
  output?: unknown
  metrics?: Record<string, unknown>
  metadata?: Record<string, unknown>
  events?: Array<Record<string, unknown>>
}

export interface TracePayload {
  trace_id?: string
  name: string
  tags?: string[]
  metadata?: Record<string, unknown>
  spans: SpanPayload[]
}

export function buildOtlpHeaders(project: string, apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-protobuf',
    'X-Project-ID': project,
  }
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }
  return headers
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (value && value.trim()) {
      return value.trim()
    }
  }
  return ''
}

function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  return env?.[name]
}

export class TraceBuilder {
  traceId: string
  name: string
  tags: string[]
  metadata: Record<string, unknown>
  spans: SpanPayload[]

  constructor(name: string, options?: { tags?: string[]; metadata?: Record<string, unknown> }) {
    this.traceId = `tr_${Date.now()}`
    this.name = name
    this.tags = options?.tags ?? []
    this.metadata = options?.metadata ?? {}
    this.spans = []
  }

  addSpan(span: Omit<SpanPayload, 'start_time' | 'end_time'> & { start_time?: string; end_time?: string }) {
    const now = new Date().toISOString()
    this.spans.push({
      start_time: span.start_time ?? now,
      end_time: span.end_time ?? now,
      ...span,
    })
    return this
  }

  toJSON(): TracePayload {
    return {
      trace_id: this.traceId,
      name: this.name,
      tags: this.tags,
      metadata: this.metadata,
      spans: this.spans,
    }
  }
}

export class EvalSmithClient {
  apiKey?: string
  project: string
  traceUrl: string
  datasetUrl: string
  evalUrl: string
  authUrl: string

  constructor(config: EvalSmithConfig = {}) {
    const baseUrl = firstNonEmpty(config.baseUrl, envFirst('EVALSMITH_BASE_URL'))
    this.apiKey = firstNonEmpty(config.apiKey, envFirst('EVALSMITH_API_KEY')) || undefined
    this.project = firstNonEmpty(config.project, envFirst('EVALSMITH_PROJECT'), 'proj_default')
    this.traceUrl = firstNonEmpty(
      config.traceUrl,
      envFirst('EVALSMITH_TRACE_URL'),
      baseUrl,
      'http://127.0.0.1:8001'
    )
    this.datasetUrl = firstNonEmpty(
      config.datasetUrl,
      envFirst('EVALSMITH_DATASET_URL'),
      baseUrl,
      'http://127.0.0.1:8003'
    )
    this.evalUrl = firstNonEmpty(
      config.evalUrl,
      envFirst('EVALSMITH_EVAL_URL'),
      baseUrl,
      'http://127.0.0.1:8002'
    )
    this.authUrl = firstNonEmpty(
      config.authUrl,
      envFirst('EVALSMITH_AUTH_URL'),
      baseUrl,
      'http://127.0.0.1:8004'
    )
  }

  headers(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'X-Project-ID': this.project,
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
    }
  }

  async postJSON<T>(baseUrl: string, path: string, payload: unknown): Promise<T> {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      throw new Error(`request failed: ${response.status} ${response.statusText}`)
    }
    return (await response.json()) as T
  }

  async getJSON<T>(baseUrl: string, path: string): Promise<T> {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
      method: 'GET',
      headers: this.headers(),
    })
    if (!response.ok) {
      throw new Error(`request failed: ${response.status} ${response.statusText}`)
    }
    return (await response.json()) as T
  }

  async ingestTrace(trace: TracePayload) {
    return this.postJSON(this.traceUrl, '/api/v1/traces', {
      traces: [trace],
    })
  }

  async getDatasetByName(name: string): Promise<Dataset | null> {
    const resp = await this.getJSON<{ code: number; data: { items: Dataset[] } }>(
      this.datasetUrl,
      `/api/v1/datasets?name=${encodeURIComponent(name)}&page_size=10`
    )
    const match = resp.data.items.find((d) => d.name === name)
    return match ?? resp.data.items[0] ?? null
  }

  async evaluate(params: {
    name: string
    datasetId: string
    datasetVersion?: number
    split?: string
    evaluatorIds: string[]
    targetUrl: string
    targetMethod?: 'GET' | 'POST' | 'PUT' | 'PATCH'
    targetHeaders?: Record<string, string>
    bodyTemplate?: string
    targetResponsePath?: string
    targetTimeoutMs?: number
    concurrency?: number
  }): Promise<ExperimentDetail> {
    const createResp = await this.postJSON<{ code: number; data: { id: string; status: string } }>(
      this.evalUrl,
      '/api/v1/experiments',
      {
        name: params.name,
        dataset_id: params.datasetId,
        dataset_version: params.datasetVersion,
        split: params.split ?? 'default',
        evaluator_ids: params.evaluatorIds,
        target_url: params.targetUrl,
        target_method: params.targetMethod ?? 'POST',
        target_headers: params.targetHeaders,
        target_body_template: params.bodyTemplate,
        target_response_path: params.targetResponsePath,
        target_timeout_ms: params.targetTimeoutMs,
        concurrency: params.concurrency ?? 5,
      }
    )
    const expId = createResp.data.id
    for (let i = 0; i < 120; i++) {
      const detail = await this.getExperiment(expId)
      if (['completed', 'failed', 'canceled'].includes(detail.status)) {
        return detail
      }
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
    throw new Error(`Experiment ${expId} did not complete within timeout`)
  }

  async getExperiment(experimentId: string): Promise<ExperimentDetail> {
    const resp = await this.getJSON<{ code: number; data: ExperimentDetail }>(
      this.evalUrl,
      `/api/v1/experiments/${experimentId}`
    )
    return resp.data
  }

  async previewExperimentTarget(params: {
    targetUrl: string
    example: PreviewExample
    targetMethod?: 'GET' | 'POST' | 'PUT' | 'PATCH'
    targetHeaders?: Record<string, string>
    bodyTemplate?: string
    targetResponsePath?: string
    targetTimeoutMs?: number
  }): Promise<ExperimentTargetPreview> {
    const resp = await this.postJSON<{ code: number; data: ExperimentTargetPreview }>(
      this.evalUrl,
      '/api/v1/experiments/target-preview',
      {
        target_url: params.targetUrl,
        target_method: params.targetMethod ?? 'POST',
        target_headers: params.targetHeaders ?? {},
        target_body_template: params.bodyTemplate ?? '{"input": {{inputs.input}}}',
        target_response_path: params.targetResponsePath,
        target_timeout_ms: params.targetTimeoutMs ?? 120000,
        example: {
          id: params.example.id,
          inputs: params.example.inputs,
          expected_outputs: params.example.expected_outputs,
          metadata: params.example.metadata ?? {},
          split: params.example.split ?? 'default',
        },
      }
    )
    return resp.data
  }
}

export interface Dataset {
  id: string
  name: string
  description: string
  current_version: number
  example_count: number
}

export interface ExperimentSummary {
  total_examples: number
  completed: number
  failed: number
  avg_scores: Record<string, number>
  pass_rates: Record<string, number>
}

export interface ExperimentDetail {
  id: string
  name: string
  status: string
  summary?: ExperimentSummary | null
}

export interface ExperimentTargetPreview {
  request_method: 'GET' | 'POST' | 'PUT' | 'PATCH'
  request_url: string
  request_body?: unknown
  response_status_code: number
  response_path_used?: string | null
  latency_ms: number
  trace_id?: string | null
  output?: unknown
  raw_response?: unknown
}
