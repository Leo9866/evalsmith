#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def console(event: str, payload: Any | None = None) -> None:
    prefix = f"[test-env-e2e] {event}"
    if payload is None:
        print(prefix, flush=True)
        return
    print(f"{prefix}: {json.dumps(payload, ensure_ascii=False)}", flush=True)


def detect_intent(query: str) -> str:
    normalized = query.lower()
    if any(keyword in normalized for keyword in ("bill", "invoice", "price", "plan")):
        return "billing"
    if any(keyword in normalized for keyword in ("slow", "latency", "timeout", "performance")):
        return "latency"
    if any(keyword in normalized for keyword in ("deploy", "release", "rollout", "production", "prompt version")):
        return "deployment"
    if any(keyword in normalized for keyword in ("safe", "security", "secret", "prompt injection", "leak")):
        return "safety"
    return "general"


def stable_answer(query: str) -> str:
    intent = detect_intent(query)
    if intent == "billing":
        return (
            "Recommended action: keep the current billing cycle stable and apply the plan change on the next invoice. "
            "Billing changes take effect at the next invoice. For urgent adjustments, create a support ticket with the workspace ID."
        )
    if intent == "latency":
        return (
            "Recommended action: inspect the slowest trace first, then reduce prompt size and retrieval breadth. "
            "High latency is usually caused by oversized prompts, slow retrieval, or a cold downstream model. "
            "Start by checking trace duration, retrieval fan-out, and model queue time."
        )
    if intent == "deployment":
        return (
            "Recommended action: gate the rollout behind a regression run and only promote the candidate if quality is stable. "
            "For production rollout, pin the prompt version, run a regression experiment, and compare exact-match plus not-empty scores before promoting traffic."
        )
    if intent == "safety":
        return (
            "Recommended action: stop the unsafe response path and escalate it for review before serving users. "
            "When a response might reveal secrets or unsafe guidance, block the final answer, log the trace, and hand the case to a human reviewer."
        )
    return (
        f"Recommended action: clarify the request, inspect recent traces, and define success criteria for '{query}'. "
        "Collect traces first, build a focused dataset from failures, and run an experiment before changing prompts or tools."
    )


def initial_examples() -> list[dict[str, Any]]:
    prompts = [
        "How should I handle a customer asking for a billing plan change?",
        "The agent feels slow in production. What should I check first?",
        "What is the safest way to deploy a new prompt version?",
        "What should we do if the model starts leaking secrets?",
    ]
    return [
        {
            "inputs": {"input": prompt},
            "expected_outputs": stable_answer(prompt),
            "metadata": {
                "source": "test-env-e2e",
                "suite": "standard",
                "topic": detect_intent(prompt),
            },
            "split": "default",
        }
        for prompt in prompts
    ]


def incremental_import_rows() -> list[dict[str, Any]]:
    duplicate = initial_examples()[0]
    extra_prompt = "How do I rotate an API key without breaking existing integrations?"
    valid = {
        "inputs": {"input": extra_prompt},
        "expected_outputs": stable_answer(extra_prompt),
        "metadata": {
            "source": "test-env-e2e",
            "suite": "incremental",
            "topic": detect_intent(extra_prompt),
        },
        "split": "default",
    }
    invalid = {"split": "default", "metadata": {"source": "test-env-e2e", "suite": "invalid"}}
    return [duplicate, valid, invalid]


def encode_jsonl(rows: list[dict[str, Any]]) -> bytes:
    return ("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n").encode("utf-8")


@dataclass
class E2EConfig:
    base_url: str
    target_url: str
    output_dir: Path
    password: str
    timeout_seconds: int
    poll_seconds: float


class GatewayClient:
    def __init__(self, config: E2EConfig) -> None:
        self.config = config
        self.http = httpx.Client(base_url=config.base_url, timeout=60.0, follow_redirects=True)

    def close(self) -> None:
        self.http.close()

    def _unwrap(self, response: httpx.Response) -> Any:
        try:
            payload = response.json()
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"non-json response from {response.request.method} {response.request.url}: {response.text[:300]}") from exc
        if response.status_code >= 400:
            raise RuntimeError(
                f"{response.request.method} {response.request.url} failed with HTTP {response.status_code}: "
                f"{json.dumps(payload, ensure_ascii=False)}"
            )
        if payload.get("code") != 0:
            raise RuntimeError(
                f"{response.request.method} {response.request.url} returned code={payload.get('code')}: "
                f"{json.dumps(payload, ensure_ascii=False)}"
            )
        return payload.get("data")

    def get(self, path: str, *, project_id: str | None = None, params: dict[str, Any] | None = None) -> Any:
        headers = {"X-Project-ID": project_id} if project_id else None
        last_error: Exception | None = None
        for attempt in range(1, 5):
            try:
                response = self.http.get(path, headers=headers, params=params)
                if response.status_code not in {502, 503, 504}:
                    return self._unwrap(response)
                last_error = RuntimeError(f"transient HTTP {response.status_code}: {response.text[:240]}")
            except httpx.RequestError as exc:
                last_error = exc
            if attempt < 4:
                time.sleep(min(2 * attempt, 6))
        if last_error is not None:
            raise last_error
        raise RuntimeError(f"GET {path} failed without response")

    def post(
        self,
        path: str,
        *,
        project_id: str | None = None,
        json_body: dict[str, Any] | None = None,
        files: dict[str, Any] | None = None,
        data: dict[str, Any] | None = None,
    ) -> Any:
        headers = {"X-Project-ID": project_id} if project_id else None
        return self._unwrap(self.http.post(path, headers=headers, json=json_body, files=files, data=data))

    def put(self, path: str, *, project_id: str | None = None, json_body: dict[str, Any] | None = None) -> Any:
        headers = {"X-Project-ID": project_id} if project_id else None
        return self._unwrap(self.http.put(path, headers=headers, json=json_body))

    def register(self, *, email: str, name: str, password: str) -> Any:
        return self.post("/api/v1/auth/register", json_body={"email": email, "name": name, "password": password})

    def wait_for_experiment(self, project_id: str, experiment_id: str) -> Any:
        deadline = time.time() + self.config.timeout_seconds
        last = None
        while time.time() < deadline:
            last = self.get(f"/api/v1/experiments/{experiment_id}", project_id=project_id)
            if last.get("status") in {"completed", "failed", "canceled"}:
                return last
            time.sleep(self.config.poll_seconds)
        raise RuntimeError(f"experiment {experiment_id} did not complete in time: last={json.dumps(last, ensure_ascii=False)}")

    def wait_for_trace(self, project_id: str, trace_id: str) -> Any:
        deadline = time.time() + self.config.timeout_seconds
        while time.time() < deadline:
            try:
                return self.get(f"/api/v1/traces/{trace_id}", project_id=project_id)
            except RuntimeError:
                time.sleep(self.config.poll_seconds)
        raise RuntimeError(f"trace {trace_id} was not queryable before timeout")


def build_urls(base_url: str, project_id: str, dataset_id: str, baseline_id: str, candidate_id: str, trace_id: str) -> dict[str, str]:
    base = base_url.rstrip("/")
    return {
        "dashboard": f"{base}/dashboard",
        "project_settings": f"{base}/settings",
        "dataset": f"{base}/datasets/{dataset_id}",
        "baseline_experiment": f"{base}/experiments/{baseline_id}",
        "candidate_experiment": f"{base}/experiments/{candidate_id}",
        "compare": f"{base}/experiments/compare",
        "trace": f"{base}/tracing/{trace_id}",
        "tracing_search": f"{base}/tracing?search={trace_id}",
        "annotation": f"{base}/annotation",
        "monitoring": f"{base}/monitoring",
        "project_header_hint": project_id,
    }


def parse_args() -> E2EConfig:
    parser = argparse.ArgumentParser(description="Run a full EvalSmith test-environment E2E validation against the gateway.")
    parser.add_argument("--base-url", default=os.environ.get("EVALSMITH_BASE_URL", "http://127.0.0.1:8080"))
    parser.add_argument("--target-url", default=os.environ.get("EVALSMITH_TARGET_URL", "http://verification-agent:8010/answer"))
    parser.add_argument("--output-dir", default=os.environ.get("EVALSMITH_E2E_OUTPUT_DIR", "logs/e2e-runs"))
    parser.add_argument("--password", default=os.environ.get("EVALSMITH_E2E_PASSWORD", "__REDACTED_SECRET__"))
    parser.add_argument("--timeout-seconds", type=int, default=int(os.environ.get("EVALSMITH_E2E_TIMEOUT", "300")))
    parser.add_argument("--poll-seconds", type=float, default=float(os.environ.get("EVALSMITH_E2E_POLL", "2")))
    args = parser.parse_args()
    return E2EConfig(
        base_url=args.base_url.rstrip("/"),
        target_url=args.target_url,
        output_dir=ensure_dir(Path(args.output_dir)),
        password=args.password,
        timeout_seconds=args.timeout_seconds,
        poll_seconds=args.poll_seconds,
    )


def main() -> int:
    config = parse_args()
    run_id = utc_stamp()
    artifact_path = config.output_dir / f"test-env-e2e-{run_id}.json"
    latest_path = config.output_dir / "test-env-e2e-latest.json"
    email = f"test-env-e2e-{run_id.lower()}@evalsmith.local"
    client = GatewayClient(config)
    artifact: dict[str, Any] = {
        "run_id": run_id,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "base_url": config.base_url,
        "target_url": config.target_url,
        "steps": {},
        "user": {"email": email, "password_redacted": True},
    }
    console(
        "starting",
        {
            "run_id": run_id,
            "base_url": config.base_url,
            "target_url": config.target_url,
            "artifact": str(artifact_path),
        },
    )

    try:
        session = client.register(email=email, name="Test Env E2E", password=config.password)
        artifact["steps"]["register"] = {"user_id": session["user"]["id"], "bootstrap_projects": [p["id"] for p in session["projects"]]}
        console("registered user", {"email": email, "user_id": session["user"]["id"], "bootstrap_projects": artifact["steps"]["register"]["bootstrap_projects"]})

        me = client.get("/api/v1/auth/me")
        artifact["steps"]["session"] = {"project_count": len(me["projects"])}
        console("session ready", artifact["steps"]["session"])

        project = client.post(
            "/api/v1/projects",
            json_body={
                "name": f"Test Env E2E {run_id}",
                "description": "Strict end-to-end validation flow generated by scripts/run_test_env_e2e.py",
            },
        )
        project_id = project["id"]
        artifact["project"] = project
        console("created project", {"project_id": project_id, "name": project["name"]})

        dataset = client.post(
            "/api/v1/datasets",
            project_id=project_id,
            json_body={
                "name": f"Test Env Validation Dataset {run_id}",
                "description": "Regression dataset for strict test-environment validation.",
                "schema_def": {
                    "inputs": {"type": "object"},
                    "expected_outputs": {"type": "string"},
                    "metadata": {"type": "object"},
                },
            },
        )
        dataset_id = dataset["id"]
        artifact["dataset"] = dataset
        console("created dataset", {"dataset_id": dataset_id, "name": dataset["name"]})

        initial_import = client.post(
            f"/api/v1/datasets/{dataset_id}/import",
            project_id=project_id,
            files={
                "file": (
                    "initial-regression.jsonl",
                    encode_jsonl(initial_examples()),
                    "application/jsonl",
                )
            },
            data={"description": "Initial regression seed for strict E2E validation."},
        )
        artifact["steps"]["initial_import"] = initial_import
        initial_version = initial_import.get("new_version")
        if not initial_version:
            raise RuntimeError(f"initial import did not create a dataset version: {json.dumps(initial_import, ensure_ascii=False)}")
        console(
            "initial import completed",
            {
                "added": initial_import["added"],
                "duplicates": initial_import["duplicate_count"],
                "invalid": initial_import["invalid_count"],
                "new_version": initial_version,
            },
        )

        examples_after_initial = client.get(
            f"/api/v1/datasets/{dataset_id}/examples",
            project_id=project_id,
            params={"page_size": 50},
        )
        versions_after_initial = client.get(f"/api/v1/datasets/{dataset_id}/versions", project_id=project_id)
        artifact["steps"]["dataset_after_initial_import"] = {
            "example_total": examples_after_initial["total"],
            "versions": [item["version"] for item in versions_after_initial],
        }
        console("dataset state after initial import", artifact["steps"]["dataset_after_initial_import"])

        incremental_import = client.post(
            f"/api/v1/datasets/{dataset_id}/import",
            project_id=project_id,
            files={
                "file": (
                    "incremental-validation.jsonl",
                    encode_jsonl(incremental_import_rows()),
                    "application/jsonl",
                )
            },
            data={"description": "Incremental import validation with one duplicate, one new row, and one invalid row."},
        )
        artifact["steps"]["incremental_import"] = incremental_import
        incremental_version = incremental_import.get("new_version")
        if not incremental_version:
            raise RuntimeError(f"incremental import did not create a dataset version: {json.dumps(incremental_import, ensure_ascii=False)}")
        console(
            "incremental import completed",
            {
                "added": incremental_import["added"],
                "duplicates": incremental_import["duplicate_count"],
                "invalid": incremental_import["invalid_count"],
                "new_version": incremental_version,
            },
        )

        versions_after_incremental = client.get(f"/api/v1/datasets/{dataset_id}/versions", project_id=project_id)
        version_diff_v3_v2 = client.get(
            f"/api/v1/datasets/{dataset_id}/versions/{incremental_version}/diff",
            project_id=project_id,
            params={"base_version": initial_version},
        )
        examples_page = client.get(
            f"/api/v1/datasets/{dataset_id}/examples",
            project_id=project_id,
            params={"page_size": 50, "version": incremental_version},
        )
        preview_example = examples_page["items"][0]
        artifact["steps"]["dataset_after_incremental_import"] = {
            "example_total": examples_page["total"],
            "versions": [item["version"] for item in versions_after_incremental],
            "diff_v3_v2": version_diff_v3_v2,
        }
        console(
            "dataset state after incremental import",
            {
                "example_total": examples_page["total"],
                "versions": artifact["steps"]["dataset_after_incremental_import"]["versions"],
                "added_in_diff": version_diff_v3_v2["added_count"],
                "changed_in_diff": version_diff_v3_v2["changed_count"],
            },
        )

        preview = client.post(
            "/api/v1/experiments/target-preview",
            project_id=project_id,
            json_body={
                "target_url": config.target_url,
                "target_method": "POST",
                "target_headers": {
                    "X-EvalSmith-Project-ID": project_id,
                    "X-EvalSmith-Agent-Variant": "stable",
                },
                "target_body_template": '{"input": {{inputs.input}}}',
                "target_timeout_ms": 30000,
                "example": preview_example,
            },
        )
        artifact["steps"]["target_preview"] = preview
        console(
            "target preview succeeded",
            {
                "trace_id": preview["trace_id"],
                "status_code": preview["response_status_code"],
                "latency_ms": preview["latency_ms"],
            },
        )

        baseline_experiment = client.post(
            "/api/v1/experiments",
            project_id=project_id,
            json_body={
                "name": f"E2E Baseline Stable {run_id}",
                "description": "Stable baseline run against the verification agent.",
                "dataset_id": dataset_id,
                "dataset_version": incremental_version,
                "split": "default",
                "evaluator_ids": ["builtin:exact_match", "builtin:not_empty"],
                "target_url": config.target_url,
                "target_method": "POST",
                "target_headers": {
                    "X-EvalSmith-Project-ID": project_id,
                    "X-EvalSmith-Agent-Variant": "stable",
                },
                "target_body_template": '{"input": {{inputs.input}}}',
                "target_timeout_ms": 30000,
                "concurrency": 2,
            },
        )
        baseline_experiment = client.wait_for_experiment(project_id, baseline_experiment["id"])
        if baseline_experiment["status"] != "completed":
            raise RuntimeError(f"baseline experiment ended in unexpected status: {json.dumps(baseline_experiment, ensure_ascii=False)}")
        artifact["baseline_experiment"] = baseline_experiment
        console(
            "baseline experiment completed",
            {
                "experiment_id": baseline_experiment["id"],
                "status": baseline_experiment["status"],
                "avg_scores": baseline_experiment["summary"]["avg_scores"],
            },
        )

        baseline_results = client.get(
            f"/api/v1/experiments/{baseline_experiment['id']}/results",
            project_id=project_id,
            params={"page_size": 50},
        )
        if baseline_results["total"] < 5:
            raise RuntimeError(f"baseline results missing samples: {json.dumps(baseline_results, ensure_ascii=False)}")
        baseline_trace_id = baseline_results["items"][0]["trace_id"]
        if not baseline_trace_id:
            raise RuntimeError("baseline result did not carry a trace_id")
        client.wait_for_trace(project_id, baseline_trace_id)
        artifact["steps"]["baseline_results"] = {
            "total": baseline_results["total"],
            "trace_ids": [item["trace_id"] for item in baseline_results["items"]],
        }
        console("baseline results available", artifact["steps"]["baseline_results"])

        baseline_marker = client.post(
            f"/api/v1/experiments/{baseline_experiment['id']}/baseline",
            project_id=project_id,
            json_body={"dataset_id": dataset_id},
        )
        artifact["steps"]["baseline_marker"] = baseline_marker
        console("baseline marker updated", {"experiment_id": baseline_experiment["id"], "dataset_id": dataset_id})

        manual_backfill = client.post(
            "/api/v1/traces/batch/dataset",
            project_id=project_id,
            json_body={"dataset_id": dataset_id, "trace_ids": [baseline_trace_id], "split": "trace_backfill"},
        )
        manual_annotation = client.post(
            "/api/v1/traces/batch/annotation",
            project_id=project_id,
            json_body={"trace_ids": [baseline_trace_id], "mode": "single_run"},
        )
        versions_after_trace_backfill = client.get(f"/api/v1/datasets/{dataset_id}/versions", project_id=project_id)
        trace_backfill_version = manual_backfill.get("new_version")
        if not trace_backfill_version:
            raise RuntimeError(f"manual trace backfill did not create a dataset version: {json.dumps(manual_backfill, ensure_ascii=False)}")
        version_diff_v4_v3 = client.get(
            f"/api/v1/datasets/{dataset_id}/versions/{trace_backfill_version}/diff",
            project_id=project_id,
            params={"base_version": incremental_version},
        )
        artifact["steps"]["manual_trace_backfill"] = {
            "dataset": manual_backfill,
            "annotation": manual_annotation,
            "versions": [item["version"] for item in versions_after_trace_backfill],
            "diff_v4_v3": version_diff_v4_v3,
        }
        console(
            "manual trace backfill completed",
            {
                "trace_id": baseline_trace_id,
                "dataset_version": trace_backfill_version,
                "annotation_task_ids": manual_annotation["task_ids"],
            },
        )

        annotation_task_id = manual_annotation["task_ids"][0]
        claimed_task = client.post(f"/api/v1/annotation/tasks/{annotation_task_id}/claim", project_id=project_id)
        if claimed_task is None:
            claimed_task = client.get(f"/api/v1/annotation/tasks/{annotation_task_id}", project_id=project_id)
        submitted_task = client.post(
            f"/api/v1/annotation/tasks/{annotation_task_id}/submit",
            project_id=project_id,
            json_body={
                "label": "needs_revision",
                "score": 0.2,
                "note": "Baseline trace was manually backfilled and reviewed through the strict E2E flow.",
                "metadata": {"source": "test-env-e2e", "run_id": run_id},
            },
        )
        if submitted_task is None:
            submitted_task = client.get(f"/api/v1/annotation/tasks/{annotation_task_id}", project_id=project_id)
        annotation_tasks = client.get(
            "/api/v1/annotation/tasks",
            project_id=project_id,
            params={"page_size": 20},
        )
        artifact["steps"]["annotation_review"] = {
            "claimed": claimed_task,
            "submitted": submitted_task,
            "task_total": annotation_tasks["total"],
        }
        console(
            "annotation review completed",
            {
                "task_id": annotation_task_id,
                "label": (submitted_task.get("annotation") or {}).get("label"),
                "task_total": annotation_tasks["total"],
            },
        )

        monitoring_rule = client.post(
            "/api/v1/monitoring/rules",
            project_id=project_id,
            json_body={
                "name": f"E2E Monitoring Rule {run_id}",
                "description": "Detect candidate regressions in the strict E2E flow.",
                "status": "active",
                "sampling_rate": 1.0,
                "evaluator_ids": ["builtin:exact_match", "builtin:not_empty"],
                "threshold": 0.9,
                "severity": "warning",
                "backfill_dataset_id": dataset_id,
                "backfill_split": "monitoring_alerts",
                "auto_annotation": True,
                "guardrail_config": {
                    "blocked_keywords": ["secret token", "disable review"],
                    "blocked_regexes": [],
                    "max_output_chars": 500,
                    "require_non_empty_output": True,
                },
            },
        )
        first_monitor_run = client.post(f"/api/v1/monitoring/rules/{monitoring_rule['id']}/run", project_id=project_id)
        artifact["monitoring_rule"] = monitoring_rule
        artifact["steps"]["monitor_baseline_run"] = first_monitor_run
        console(
            "monitoring rule baseline run completed",
            {
                "rule_id": monitoring_rule["id"],
                "rule_name": monitoring_rule["name"],
                "processed": first_monitor_run.get("processed"),
                "alerts": first_monitor_run.get("alerts"),
                "run_ids": [item.get("id") for item in first_monitor_run.get("runs", [])],
            },
        )

        candidate_experiment = client.post(
            "/api/v1/experiments",
            project_id=project_id,
            json_body={
                "name": f"E2E Candidate Degraded {run_id}",
                "description": "Degraded candidate run for regression and monitoring validation.",
                "dataset_id": dataset_id,
                "dataset_version": trace_backfill_version,
                "split": "default",
                "evaluator_ids": ["builtin:exact_match", "builtin:not_empty"],
                "target_url": config.target_url,
                "target_method": "POST",
                "target_headers": {
                    "X-EvalSmith-Project-ID": project_id,
                    "X-EvalSmith-Agent-Variant": "candidate",
                },
                "target_body_template": '{"input": {{inputs.input}}}',
                "target_timeout_ms": 30000,
                "concurrency": 2,
            },
        )
        candidate_experiment = client.wait_for_experiment(project_id, candidate_experiment["id"])
        if candidate_experiment["status"] != "completed":
            raise RuntimeError(f"candidate experiment ended in unexpected status: {json.dumps(candidate_experiment, ensure_ascii=False)}")
        artifact["candidate_experiment"] = candidate_experiment
        console(
            "candidate experiment completed",
            {
                "experiment_id": candidate_experiment["id"],
                "status": candidate_experiment["status"],
                "avg_scores": candidate_experiment["summary"]["avg_scores"],
            },
        )

        candidate_results = client.get(
            f"/api/v1/experiments/{candidate_experiment['id']}/results",
            project_id=project_id,
            params={"page_size": 50},
        )
        candidate_trace_id = candidate_results["items"][0]["trace_id"]
        if not candidate_trace_id:
            raise RuntimeError("candidate result did not carry a trace_id")
        client.wait_for_trace(project_id, candidate_trace_id)
        artifact["steps"]["candidate_results"] = {
            "total": candidate_results["total"],
            "trace_ids": [item["trace_id"] for item in candidate_results["items"]],
        }
        console("candidate results available", artifact["steps"]["candidate_results"])

        compare = client.post(
            "/api/v1/experiments/compare",
            project_id=project_id,
            json_body={
                "experiment_ids": [baseline_experiment["id"], candidate_experiment["id"]],
                "baseline_experiment_id": baseline_experiment["id"],
            },
        )
        artifact["steps"]["compare"] = {
            "evaluator_deltas": compare["evaluator_deltas"],
            "sample_diff_count": len(compare["sample_diffs"]),
        }
        console("experiment comparison completed", artifact["steps"]["compare"])

        second_monitor_run = client.post(f"/api/v1/monitoring/rules/{monitoring_rule['id']}/run", project_id=project_id)
        monitoring_alerts = client.get(
            "/api/v1/monitoring/alerts",
            project_id=project_id,
            params={"page_size": 50},
        )
        monitoring_runs = client.get(
            "/api/v1/monitoring/runs",
            project_id=project_id,
            params={"page_size": 50, "rule_id": monitoring_rule["id"]},
        )
        if not monitoring_alerts["items"]:
            raise RuntimeError("expected monitoring alerts after candidate regression, but none were created")
        resolved_alert = client.post(
            f"/api/v1/monitoring/alerts/{monitoring_alerts['items'][0]['id']}/resolve",
            project_id=project_id,
        )
        versions_after_monitoring = client.get(f"/api/v1/datasets/{dataset_id}/versions", project_id=project_id)
        annotation_after_monitor = client.get(
            "/api/v1/annotation/tasks",
            project_id=project_id,
            params={"page_size": 50},
        )
        artifact["steps"]["monitor_candidate_run"] = {
            "run": second_monitor_run,
            "alert_total": monitoring_alerts["total"],
            "run_total": monitoring_runs["total"],
            "resolved_alert_id": resolved_alert["id"],
            "versions": [item["version"] for item in versions_after_monitoring],
            "annotation_total": annotation_after_monitor["total"],
        }
        console(
            "monitoring candidate run completed",
            {
                "processed": second_monitor_run.get("processed"),
                "alerts": second_monitor_run.get("alerts"),
                "run_ids": [item.get("id") for item in second_monitor_run.get("runs", [])],
                "alert_total": monitoring_alerts["total"],
                "resolved_alert_id": resolved_alert["id"],
                "annotation_total": annotation_after_monitor["total"],
            },
        )

        artifact["urls"] = build_urls(
            config.base_url,
            project_id,
            dataset_id,
            baseline_experiment["id"],
            candidate_experiment["id"],
            candidate_trace_id,
        )
        artifact["completed_at"] = datetime.now(timezone.utc).isoformat()

    except Exception as exc:
        artifact["completed_at"] = datetime.now(timezone.utc).isoformat()
        artifact["error"] = str(exc)
        artifact_path.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")
        latest_path.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")
        console("failed", {"artifact": str(artifact_path), "error": str(exc)})
        print(json.dumps({"status": "failed", "artifact": str(artifact_path), "error": str(exc)}, ensure_ascii=False))
        return 1
    finally:
        client.close()

    artifact_path.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")
    latest_path.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")
    console(
        "completed",
        {
            "artifact": str(artifact_path),
            "user": artifact["user"],
            "project_id": artifact["project"]["id"],
            "dataset_id": artifact["dataset"]["id"],
            "baseline_experiment_id": artifact["baseline_experiment"]["id"],
            "candidate_experiment_id": artifact["candidate_experiment"]["id"],
            "urls": artifact["urls"],
        },
    )
    print(json.dumps({"status": "ok", "artifact": str(artifact_path), "project_id": artifact["project"]["id"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
