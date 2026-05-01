"""Evaluation API for running experiments from the SDK."""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from typing import Any, Callable

import httpx


def _env_first(*names: str) -> str:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return ""


def _service_base_url(service_env: str, fallback: str) -> str:
    return (
        _env_first(service_env)
        or _env_first("EVALSMITH_BASE_URL")
        or fallback
    ).rstrip("/")


def _dataset_base_url() -> str:
    return _service_base_url("EVALSMITH_DATASET_URL", "http://127.0.0.1:8003")


def _eval_base_url() -> str:
    return _service_base_url("EVALSMITH_EVAL_URL", "http://127.0.0.1:8002")


def _project_id() -> str:
    return _env_first("EVALSMITH_PROJECT") or "proj_default"


def _request_headers() -> dict[str, str]:
    headers = {"X-Project-ID": _project_id()}
    api_key = _env_first("EVALSMITH_API_KEY")
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def _extract_data(payload: dict) -> Any:
    if payload.get("code") != 0:
        raise RuntimeError(payload.get("message", "request failed"))
    return payload.get("data")


@dataclass
class Score:
    """Evaluation score result."""

    value: float
    reasoning: str = ""
    metadata: dict = field(default_factory=dict)


@dataclass
class Evaluator:
    """Base class for custom evaluators."""

    name: str = "custom"

    def evaluate(self, input: Any, output: Any, expected: Any = None, trace: dict | None = None) -> Score:
        raise NotImplementedError


@dataclass
class ExperimentSummary:
    """Summary of an experiment run."""

    experiment_id: str
    name: str
    total_examples: int
    completed: int
    failed: int
    avg_scores: dict[str, float]
    pass_rates: dict[str, float]
    latency_p50_ms: float = 0.0
    latency_p90_ms: float = 0.0
    latency_p99_ms: float = 0.0

    def __str__(self) -> str:
        lines = [
            f"Experiment: {self.name}",
            f"Examples: {self.total_examples} | Completed: {self.completed} | Failed: {self.failed}",
        ]
        for name, avg in self.avg_scores.items():
            pr = self.pass_rates.get(name, 0.0)
            lines.append(f"  {name}: avg={avg:.3f}  pass_rate={pr:.1%}")
        lines.append(
            "  Latency: "
            f"p50={self.latency_p50_ms:.0f}ms  "
            f"p90={self.latency_p90_ms:.0f}ms  "
            f"p99={self.latency_p99_ms:.0f}ms"
        )
        return "\n".join(lines)


@dataclass
class TargetPreview:
    request_method: str
    request_url: str
    request_body: Any = None
    response_status_code: int = 0
    response_path_used: str | None = None
    latency_ms: int = 0
    trace_id: str | None = None
    output: Any = None
    raw_response: Any = None


class Dataset:
    """Reference to a remote dataset."""

    def __init__(self, dataset_id: str, version: str | int = "latest"):
        self.dataset_id = dataset_id
        self.version = version

    @classmethod
    def from_name(cls, name: str, version: str | int = "latest", project: str | None = None) -> Dataset:
        """Look up a dataset by name."""

        project_id = project or _project_id()
        resp = httpx.get(
            f"{_dataset_base_url()}/api/v1/datasets",
            params={"name": name, "page_size": 100},
            headers={**_request_headers(), "X-Project-ID": project_id},
            timeout=30.0,
        )
        resp.raise_for_status()
        payload = _extract_data(resp.json()) or {}
        items = payload.get("items", [])
        for item in items:
            if item.get("name") == name:
                return cls(dataset_id=item["id"], version=version)
        if items:
            return cls(dataset_id=items[0]["id"], version=version)
        raise ValueError(f"Dataset '{name}' not found")


def evaluate(
    target: str | Callable[..., Any],
    dataset: Dataset,
    evaluators: list[str | Evaluator],
    experiment_name: str = "",
    max_concurrency: int = 5,
    timeout_seconds: int = 60,
    split: str = "default",
    target_headers: dict[str, str] | None = None,
    target_body_template: str = '{"input": {{inputs.input}}}',
) -> ExperimentSummary:
    """Run an evaluation experiment against a reachable target URL."""

    del timeout_seconds  # Reserved for a future backend run-config extension.

    if isinstance(target, str):
        target_url = target
    else:
        target_url = os.environ.get("EVALSMITH_TARGET_URL", "").strip()
        if not target_url:
            target_url = _env_first("EVALSMITH_TARGET_URL")
        if not target_url:
            raise ValueError(
                "EvalSmith SDK experiments need a reachable target URL. "
                "Pass a target URL string or set EVALSMITH_TARGET_URL."
            )

    evaluator_ids: list[str] = []
    for ev in evaluators:
        if isinstance(ev, str):
            evaluator_ids.append(ev if ev.startswith("builtin:") else f"builtin:{ev}")
            continue
        raise ValueError(
            "Inline custom evaluators are not supported by the remote API yet. "
            "Create a remote evaluator first, then pass its evaluator ID."
        )

    payload = {
        "name": experiment_name or "sdk-experiment",
        "dataset_id": dataset.dataset_id,
        "dataset_version": dataset.version if isinstance(dataset.version, int) else None,
        "split": split,
        "evaluator_ids": evaluator_ids,
        "target_url": target_url,
        "target_headers": target_headers or {},
        "target_body_template": target_body_template,
        "concurrency": max_concurrency,
    }

    resp = httpx.post(
        f"{_eval_base_url()}/api/v1/experiments",
        json=payload,
        headers=_request_headers(),
        timeout=120.0,
    )
    resp.raise_for_status()
    experiment = _extract_data(resp.json()) or {}
    experiment_id = experiment.get("id")
    if not experiment_id:
        raise RuntimeError("Experiment creation response did not include an experiment ID")

    for _ in range(300):
        time.sleep(1)
        poll = httpx.get(
            f"{_eval_base_url()}/api/v1/experiments/{experiment_id}",
            headers=_request_headers(),
            timeout=30.0,
        )
        poll.raise_for_status()
        experiment_data = _extract_data(poll.json()) or {}
        if experiment_data.get("status") in ("completed", "failed"):
            summary = experiment_data.get("summary") or {}
            return ExperimentSummary(
                experiment_id=experiment_id,
                name=experiment_data.get("name", experiment_name or "sdk-experiment"),
                total_examples=summary.get("total_examples", 0),
                completed=summary.get("completed", 0),
                failed=summary.get("failed", 0),
                avg_scores=summary.get("avg_scores", {}),
                pass_rates=summary.get("pass_rates", {}),
                latency_p50_ms=summary.get("latency_p50_ms", 0.0),
                latency_p90_ms=summary.get("latency_p90_ms", 0.0),
                latency_p99_ms=summary.get("latency_p99_ms", 0.0),
            )

    raise TimeoutError(f"Experiment {experiment_id} did not complete within 300 seconds")


def preview_target(
    target_url: str,
    example: dict[str, Any],
    *,
    target_method: str = "POST",
    target_headers: dict[str, str] | None = None,
    target_body_template: str = '{"input": {{inputs.input}}}',
    target_response_path: str | None = None,
    target_timeout_ms: int = 120000,
) -> TargetPreview:
    """Preview how an endpoint will be invoked for a single dataset example."""

    payload = {
        "target_url": target_url,
        "target_method": target_method,
        "target_headers": target_headers or {},
        "target_body_template": target_body_template,
        "target_response_path": target_response_path,
        "target_timeout_ms": target_timeout_ms,
        "example": {
            "id": example.get("id"),
            "inputs": example.get("inputs"),
            "expected_outputs": example.get("expected_outputs"),
            "metadata": example.get("metadata") or {},
            "split": example.get("split", "default"),
        },
    }

    resp = httpx.post(
        f"{_eval_base_url()}/api/v1/experiments/target-preview",
        json=payload,
        headers=_request_headers(),
        timeout=120.0,
    )
    resp.raise_for_status()
    data = _extract_data(resp.json()) or {}
    return TargetPreview(**data)
