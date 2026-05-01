from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class EvaluatorType(str, Enum):
    RULE = "rule"
    LLM_JUDGE = "llm_judge"
    CODE = "code"
    STATISTICAL = "statistical"


class RuleEvaluatorKind(str, Enum):
    EXACT_MATCH = "exact_match"
    CONTAINS = "contains"
    REGEX_MATCH = "regex_match"
    JSON_SCHEMA_VALID = "json_schema_valid"
    NOT_EMPTY = "not_empty"
    LENGTH_IN_RANGE = "length_in_range"
    LATENCY_THRESHOLD = "latency_threshold"
    COST_THRESHOLD = "cost_threshold"


class ContainsMode(str, Enum):
    ANY = "any"
    ALL = "all"


class ExperimentStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCEL_REQUESTED = "cancel_requested"
    CANCELED = "canceled"


class PromptStatus(str, Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    ARCHIVED = "archived"


class HTTPMethod(str, Enum):
    GET = "GET"
    POST = "POST"
    PUT = "PUT"
    PATCH = "PATCH"


# ---------------------------------------------------------------------------
# Core eval models
# ---------------------------------------------------------------------------

class Score(BaseModel):
    value: float = Field(..., ge=0.0, le=1.0, description="Score between 0 and 1")
    label: str | None = Field(default=None, description="Optional human-readable label")


class EvalInput(BaseModel):
    input: Any = Field(..., description="The input sent to the agent / model")
    output: Any = Field(..., description="The output produced by the agent / model")
    expected: Any | None = Field(default=None, description="The expected / reference output")
    context: Any | None = Field(default=None, description="Additional context")
    trace: dict | None = Field(default=None, description="Execution trace data")
    metadata: dict = Field(default_factory=dict)


class EvalResult(BaseModel):
    score: float = Field(..., ge=0.0, le=1.0)
    reasoning: str | None = None
    metadata: dict = Field(default_factory=dict)
    evaluator_name: str = ""
    evaluator_type: str = ""
    latency_ms: int = 0


# ---------------------------------------------------------------------------
# Evaluator configuration
# ---------------------------------------------------------------------------

class RuleConfig(BaseModel):
    kind: RuleEvaluatorKind
    case_sensitive: bool = True
    strip: bool = True
    keywords: list[str] = Field(default_factory=list)
    mode: ContainsMode = ContainsMode.ANY
    pattern: str | None = None
    schema_def: dict | None = Field(default=None, alias="schema")
    min_length: int | None = None
    max_length: int | None = None
    threshold_ms: int | None = None
    threshold: float | None = None

    model_config = {"populate_by_name": True}


class LLMProtocolConfig(BaseModel):
    base_url: str | None = None
    api_key: str | None = None
    model: str | None = None


class LLMJudgeConfig(BaseModel):
    protocol: str = "openai"
    protocol_config: LLMProtocolConfig | None = None
    project_model_id: str | None = None
    use_project_default_model: bool = False
    system_prompt: str = ""
    user_prompt_template: str = ""
    model: str | None = None
    temperature: float = 0.0
    few_shot_examples: list[dict] = Field(default_factory=list)
    jury_models: list[str] = Field(default_factory=list)
    rubric_mode: bool = False


class CodeConfig(BaseModel):
    language: str = "python"
    code: str = ""
    timeout_seconds: int = 30
    dependencies: list[str] = Field(default_factory=list)


class StatisticalConfig(BaseModel):
    kind: str = "levenshtein"  # bleu, rouge_l, levenshtein, semantic_similarity


class EvaluatorConfig(BaseModel):
    type: EvaluatorType
    rule_config: RuleConfig | None = None
    llm_judge_config: LLMJudgeConfig | None = None
    code_config: CodeConfig | None = None
    statistical_config: StatisticalConfig | None = None


# ---------------------------------------------------------------------------
# Evaluator CRUD
# ---------------------------------------------------------------------------

class EvaluatorCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    description: str = ""
    config: EvaluatorConfig


class EvaluatorUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    config: EvaluatorConfig | None = None


class EvaluatorResponse(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    type: EvaluatorType
    description: str = ""
    config: EvaluatorConfig
    is_builtin: bool = False
    version: int = 1
    project_id: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class EvaluatorTestRequest(BaseModel):
    eval_input: EvalInput


class EvaluatorVersionDiffEntry(BaseModel):
    path: str
    change_type: str
    before: Any = None
    after: Any = None


class EvaluatorVersionDiffResponse(BaseModel):
    evaluator_id: str
    base_version: int
    target_version: int
    base_is_current: bool = False
    target_is_current: bool = False
    changes: list[EvaluatorVersionDiffEntry] = Field(default_factory=list)


class EvaluatorRegressionSample(BaseModel):
    label: str | None = None
    eval_input: EvalInput


class EvaluatorRegressionTestRequest(BaseModel):
    versions: list[int] = Field(default_factory=list)
    samples: list[EvaluatorRegressionSample] = Field(..., min_length=1, max_length=10)


class EvaluatorRegressionSampleResult(BaseModel):
    index: int
    label: str | None = None
    result: EvalResult | None = None
    error: str | None = None


class EvaluatorRegressionVersionResult(BaseModel):
    version: int
    is_current: bool = False
    avg_score: float | None = None
    passed: int = 0
    failed: int = 0
    sample_results: list[EvaluatorRegressionSampleResult] = Field(default_factory=list)


class EvaluatorRegressionTestResponse(BaseModel):
    evaluator_id: str
    sample_count: int
    versions: list[EvaluatorRegressionVersionResult] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Prompt models
# ---------------------------------------------------------------------------


class PromptRenderMessage(BaseModel):
    role: str
    content: str


class PromptRenderPreview(BaseModel):
    resolved_variables: dict[str, Any] = Field(default_factory=dict)
    system_prompt: str = ""
    user_prompt: str = ""
    messages: list[PromptRenderMessage] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class PromptVersionPayload(BaseModel):
    system_prompt: str = ""
    user_prompt_template: str = ""
    variables_schema: dict[str, Any] = Field(default_factory=dict)
    render_config: dict[str, Any] = Field(default_factory=dict)


class PromptCreate(PromptVersionPayload):
    name: str = Field(..., min_length=1, max_length=128)
    description: str = ""
    status: PromptStatus = PromptStatus.DRAFT
    template_engine: str = "mustache"
    labels: list[str] = Field(default_factory=list)
    change_note: str = ""


class PromptUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = None
    status: PromptStatus | None = None
    template_engine: str | None = None
    labels: list[str] | None = None


class PromptVersionCreate(PromptVersionPayload):
    change_note: str = ""


class PromptVersionResponse(PromptVersionPayload):
    id: str
    prompt_id: str
    version: int
    change_note: str = ""
    created_by: str | None = None
    created_at: datetime | None = None
    is_current: bool = False


class PromptResponse(BaseModel):
    id: str
    project_id: str
    name: str
    description: str = ""
    status: PromptStatus = PromptStatus.DRAFT
    kind: str = "chat"
    template_engine: str = "mustache"
    current_version: int = 1
    labels: list[str] = Field(default_factory=list)
    created_by: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    current_version_detail: PromptVersionResponse | None = None


class PromptRenderSample(BaseModel):
    inputs: Any = None
    expected_outputs: Any | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    split: str = "default"


class PromptRenderPreviewRequest(BaseModel):
    version: int | None = Field(default=None, ge=1)
    sample: PromptRenderSample


class PromptRollbackRequest(BaseModel):
    version: int = Field(..., ge=1)
    change_note: str = ""


class PromptReleaseRequest(BaseModel):
    version: int | None = Field(default=None, ge=1)
    note: str = ""


class ExperimentPromptRef(BaseModel):
    prompt_id: str = Field(..., min_length=1)
    version: int | None = Field(default=None, ge=1)


class ExperimentPromptSnapshot(PromptVersionPayload):
    prompt_id: str
    prompt_name: str
    version: int
    template_engine: str = "mustache"


# ---------------------------------------------------------------------------
# Experiment models
# ---------------------------------------------------------------------------


class ExperimentPreviewExample(BaseModel):
    id: str | None = None
    inputs: Any = None
    expected_outputs: Any | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    split: str = "default"


class ExperimentTargetPreviewRequest(BaseModel):
    target_url: str = Field(..., description="URL of the agent / model endpoint to test")
    target_method: HTTPMethod = HTTPMethod.POST
    target_headers: dict[str, str] = Field(default_factory=dict)
    target_body_template: str = Field(
        default='{"input": {{inputs.input}}}',
        description="JSON template for the target API body",
    )
    target_response_path: str | None = Field(
        default=None,
        description="Optional dotted path used to extract the evaluated output from the JSON response",
    )
    target_timeout_ms: int = Field(default=120000, ge=1000, le=600000)
    prompt_ref: ExperimentPromptRef | None = None
    example: ExperimentPreviewExample


class ExperimentTargetPreviewResponse(BaseModel):
    request_method: HTTPMethod
    request_url: str
    request_body: Any = None
    response_status_code: int
    response_path_used: str | None = None
    latency_ms: int = 0
    trace_id: str | None = None
    output: Any = None
    raw_response: Any = None
    prompt_preview: PromptRenderPreview | None = None

class ExperimentCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=256)
    description: str = ""
    dataset_id: str = Field(..., description="ID of the dataset in dataset-service")
    dataset_version: int | None = Field(default=None, ge=1)
    split: str = "default"
    evaluator_ids: list[str] = Field(..., min_length=1)
    target_url: str = Field(..., description="URL of the agent / model endpoint to evaluate")
    target_method: HTTPMethod = HTTPMethod.POST
    target_headers: dict[str, str] = Field(default_factory=dict)
    target_body_template: str = Field(
        default='{"input": {{inputs.input}}}',
        description="JSON template for the target API body",
    )
    target_response_path: str | None = Field(
        default=None,
        description="Optional dotted path used to extract the evaluated output from the JSON response",
    )
    target_timeout_ms: int = Field(default=120000, ge=1000, le=600000)
    concurrency: int = Field(default=5, ge=1, le=50)
    prompt_ref: ExperimentPromptRef | None = None


class ExperimentSummary(BaseModel):
    total_examples: int = 0
    completed: int = 0
    failed: int = 0
    avg_scores: dict[str, float] = Field(default_factory=dict)
    pass_rates: dict[str, float] = Field(default_factory=dict)
    latency_p50_ms: float = 0.0
    latency_p90_ms: float = 0.0
    latency_p99_ms: float = 0.0


class ExperimentResponse(BaseModel):
    id: str
    name: str
    description: str = ""
    dataset_id: str
    dataset_version: int | None = None
    split: str = "default"
    evaluator_ids: list[str]
    target_url: str
    target_method: HTTPMethod = HTTPMethod.POST
    target_headers: dict[str, str] = Field(default_factory=dict)
    target_body_template: str = ""
    target_response_path: str | None = None
    target_timeout_ms: int = 120000
    concurrency: int = 5
    prompt_ref: ExperimentPromptRef | None = None
    prompt_snapshot: ExperimentPromptSnapshot | None = None
    status: ExperimentStatus = ExperimentStatus.PENDING
    project_id: str | None = None
    summary: ExperimentSummary | None = None
    job_status: str | None = None
    last_error: str | None = None
    is_baseline: bool = False
    created_at: datetime | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None


class ExperimentResultResponse(BaseModel):
    id: str
    experiment_id: str
    example_id: str
    input: Any = None
    expected_output: Any = None
    metadata: dict = Field(default_factory=dict)
    split: str = "default"
    actual_output: Any = None
    trace_id: str | None = None
    latency_ms: int = 0
    scores: list[EvalResult] = Field(default_factory=list)
    error: str | None = None
    created_at: datetime | None = None


class ExperimentCompareRequest(BaseModel):
    experiment_ids: list[str] = Field(..., min_length=2)
    baseline_experiment_id: str | None = None


class ExperimentCompareItem(BaseModel):
    experiment_id: str
    name: str
    summary: ExperimentSummary
    dataset_id: str | None = None
    status: ExperimentStatus | None = None


class ExperimentCompareDelta(BaseModel):
    evaluator_name: str
    baseline_score: float = 0.0
    candidate_score: float = 0.0
    delta: float = 0.0
    improved: int = 0
    regressed: int = 0
    unchanged: int = 0


class ExperimentCompareSample(BaseModel):
    example_id: str
    input: Any = None
    expected_output: Any = None
    baseline_output: Any = None
    candidate_output: Any = None
    baseline_trace_id: str | None = None
    candidate_trace_id: str | None = None
    score_deltas: dict[str, float] = Field(default_factory=dict)
    verdict: str = "unchanged"


class ExperimentCompareResponse(BaseModel):
    experiments: list[ExperimentCompareItem]
    baseline_experiment_id: str | None = None
    evaluator_deltas: list[ExperimentCompareDelta] = Field(default_factory=list)
    sample_diffs: list[ExperimentCompareSample] = Field(default_factory=list)


class ExperimentBaselineSetRequest(BaseModel):
    dataset_id: str = Field(..., min_length=1)


class ExperimentBaselineResponse(BaseModel):
    project_id: str
    dataset_id: str
    experiment_id: str
    created_at: datetime | None = None
    updated_at: datetime | None = None
