from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class GuardrailConfig(BaseModel):
    blocked_keywords: list[str] = Field(default_factory=list)
    blocked_regexes: list[str] = Field(default_factory=list)
    max_output_chars: int | None = None
    require_non_empty_output: bool = False


class MonitorRuleCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    description: str = ""
    status: str = "active"
    sampling_rate: float = Field(default=1.0, ge=0.0, le=1.0)
    evaluator_ids: list[str] = Field(default_factory=list)
    threshold: float = Field(default=0.7, ge=0.0, le=1.0)
    severity: str = "warning"
    backfill_dataset_id: str | None = None
    backfill_split: str = "regression"
    auto_annotation: bool = False
    guardrail_config: GuardrailConfig = Field(default_factory=GuardrailConfig)


class MonitorRuleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = None
    status: str | None = None
    sampling_rate: float | None = Field(default=None, ge=0.0, le=1.0)
    evaluator_ids: list[str] | None = None
    threshold: float | None = Field(default=None, ge=0.0, le=1.0)
    severity: str | None = None
    backfill_dataset_id: str | None = None
    backfill_split: str | None = None
    auto_annotation: bool | None = None
    guardrail_config: GuardrailConfig | None = None


class MonitorRuleResponse(BaseModel):
    id: str
    project_id: str
    name: str
    description: str = ""
    status: str = "active"
    sampling_rate: float = 1.0
    evaluator_ids: list[str] = Field(default_factory=list)
    threshold: float = 0.7
    severity: str = "warning"
    backfill_dataset_id: str | None = None
    backfill_split: str = "regression"
    auto_annotation: bool = False
    guardrail_config: GuardrailConfig = Field(default_factory=GuardrailConfig)
    last_checked_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class MonitorScore(BaseModel):
    evaluator_id: str
    evaluator_name: str
    score: float
    reasoning: str | None = None
    latency_ms: int = 0
    metadata: dict[str, Any] = Field(default_factory=dict)


class MonitorRunResponse(BaseModel):
    id: str
    rule_id: str
    project_id: str
    trace_id: str
    trace_status: str = "ok"
    avg_score: float | None = None
    evaluator_scores: list[MonitorScore] = Field(default_factory=list)
    guardrail_hits: list[str] = Field(default_factory=list)
    alert_triggered: bool = False
    dataset_backfilled: bool = False
    annotation_created: bool = False
    dataset_action_id: str | None = None
    annotation_action_id: str | None = None
    backfill_error_message: str | None = None
    error_message: str | None = None
    created_at: datetime | None = None


class MonitorAlertResponse(BaseModel):
    id: str
    rule_id: str
    run_id: str | None = None
    project_id: str
    trace_id: str | None = None
    kind: str = "score"
    severity: str = "warning"
    status: str = "open"
    title: str
    summary: str = ""
    details: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None
    resolved_at: datetime | None = None


class MonitoringOverview(BaseModel):
    rule_count: int = 0
    active_rule_count: int = 0
    open_alert_count: int = 0
    recent_run_count: int = 0
    alert_rate: float = 0.0
    avg_score: float | None = None
    latest_alerts: list[MonitorAlertResponse] = Field(default_factory=list)
    latest_runs: list[MonitorRunResponse] = Field(default_factory=list)


class MonitorRuleRunResult(BaseModel):
    processed: int = 0
    alerts: int = 0
    runs: list[MonitorRunResponse] = Field(default_factory=list)
