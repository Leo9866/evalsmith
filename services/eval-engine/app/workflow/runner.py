from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass
from typing import Any

import httpx

from app.auth import build_internal_headers
from app.core.base import BaseEvaluator
from app.core.factory import build_evaluator, build_project_evaluator
from app.core.registry import registry
from app.db import evaluator_repo, experiment_repo
from app.models.schemas import (
    EvalInput,
    EvalResult,
    ExperimentStatus,
    ExperimentSummary,
)
from app.prompting import attach_prompt_context, render_template
from app.settings import settings

logger = logging.getLogger(__name__)
_PATH_NOT_FOUND = object()


class ExperimentCanceled(Exception):
    pass


class TargetInvocationError(Exception):
    pass


class TargetConfigError(TargetInvocationError, ValueError):
    pass


class TargetEndpointUnavailableError(TargetInvocationError):
    def __init__(self, message: str, *, reason: str) -> None:
        super().__init__(message)
        self.reason = reason


class TargetEndpointHTTPError(TargetInvocationError):
    def __init__(self, status_code: int, response_body: Any) -> None:
        message = f"Target endpoint returned HTTP {status_code}"
        super().__init__(message)
        self.status_code = status_code
        self.response_body = response_body


@dataclass
class PreparedTargetRequest:
    method: str
    url: str
    headers: dict[str, str]
    body: Any


@dataclass
class TargetInvocationResult:
    request_method: str
    request_url: str
    request_body: Any
    response_status_code: int
    response_path_used: str | None
    latency_ms: int
    trace_id: str | None
    output: Any
    raw_response: Any
    prompt_preview: dict[str, Any] | None = None


def _normalize_json_path(path: str | None) -> str | None:
    if path is None:
        return None
    normalized = path.strip()
    if normalized.startswith("$."):
        normalized = normalized[2:]
    if normalized.startswith("$"):
        normalized = normalized[1:]
    return normalized or None


def _tokenize_json_path(path: str) -> list[str | int]:
    tokens: list[str | int] = []
    idx = 0
    while idx < len(path):
        char = path[idx]
        if char == ".":
            idx += 1
            continue
        if char == "[":
            end = path.find("]", idx)
            if end == -1:
                raise TargetConfigError(f"Invalid response path: {path}")
            segment = path[idx + 1:end].strip()
            if not segment.isdigit():
                raise TargetConfigError(f"Invalid response path: {path}")
            tokens.append(int(segment))
            idx = end + 1
            continue

        end = idx
        while end < len(path) and path[end] not in ".[":
            end += 1
        tokens.append(path[idx:end])
        idx = end

    return tokens


def _lookup_json_path(payload: Any, path: str | None) -> Any:
    normalized = _normalize_json_path(path)
    if not normalized:
        return _PATH_NOT_FOUND

    current: Any = payload
    for token in _tokenize_json_path(normalized):
        if isinstance(token, int):
            if isinstance(current, list) and 0 <= token < len(current):
                current = current[token]
                continue
            return _PATH_NOT_FOUND
        if isinstance(current, dict) and token in current:
            current = current[token]
            continue
        return _PATH_NOT_FOUND

    return current


def _extract_trace_id(payload: Any) -> str | None:
    candidates = (
        "trace_id",
        "data.trace_id",
        "data.trace.id",
        "meta.trace_id",
        "metadata.trace_id",
    )
    for candidate in candidates:
        value = _lookup_json_path(payload, candidate)
        if value is not _PATH_NOT_FOUND and value is not None:
            return str(value)
    return None


def _extract_target_output(payload: Any, response_path: str | None) -> Any:
    normalized_path = _normalize_json_path(response_path)
    if normalized_path:
        value = _lookup_json_path(payload, normalized_path)
        if value is _PATH_NOT_FOUND:
            raise TargetConfigError(f"Configured response path '{normalized_path}' was not found in target response")
        return value

    for candidate in (
        "output",
        "result",
        "text",
        "content",
        "answer",
        "data.output",
        "data.result",
        "data.text",
        "data.content",
        "data.answer",
        "response.output",
        "response.result",
        "response.text",
        "response.content",
        "response.answer",
        "data",
        "response",
    ):
        value = _lookup_json_path(payload, candidate)
        if value is not _PATH_NOT_FOUND and value is not None:
            return value
    return payload


def _decode_response_payload(response: httpx.Response) -> Any:
    try:
        return response.json()
    except Exception:
        return response.text


def _body_to_query_params(body: Any) -> dict[str, str]:
    if body is None:
        return {}
    if isinstance(body, dict):
        params: dict[str, str] = {}
        for key, value in body.items():
            if value is None:
                continue
            if isinstance(value, (str, int, float, bool)):
                params[key] = str(value)
            else:
                params[key] = json.dumps(value, ensure_ascii=False)
        return params

    if isinstance(body, str):
        return {"input": body}

    return {"input": json.dumps(body, ensure_ascii=False)}


def validate_target_config(
    *,
    target_url: str,
    target_method: str,
    target_headers: dict[str, str] | None,
    target_body_template: str,
    target_response_path: str | None,
    target_timeout_ms: int,
) -> None:
    method = target_method.upper()
    if method not in {"GET", "POST", "PUT", "PATCH"}:
        raise TargetConfigError(f"Unsupported target method: {target_method}")

    try:
        parsed_url = httpx.URL(target_url)
    except Exception as exc:
        raise TargetConfigError(f"Invalid target URL: {target_url}") from exc

    if parsed_url.scheme not in {"http", "https"}:
        raise TargetConfigError("Target URL must use http or https")
    if not parsed_url.host:
        raise TargetConfigError("Target URL is missing a host")

    for key, value in (target_headers or {}).items():
        if not str(key).strip():
            raise TargetConfigError("Target headers contain an empty header name")
        if "\n" in str(key) or "\r" in str(key):
            raise TargetConfigError(f"Target header '{key}' contains an invalid newline")
        if "\n" in str(value) or "\r" in str(value):
            raise TargetConfigError(f"Target header '{key}' contains an invalid newline in its value")

    if not target_body_template.strip():
        raise TargetConfigError("Target body template cannot be empty")

    if target_timeout_ms < 1000 or target_timeout_ms > 600000:
        raise TargetConfigError("Target timeout must be between 1000 and 600000 milliseconds")

    normalized_path = _normalize_json_path(target_response_path)
    if normalized_path:
        _tokenize_json_path(normalized_path)


def build_target_request(
    *,
    target_url: str,
    target_method: str,
    target_headers: dict[str, str] | None,
    target_body_template: str,
    example: dict[str, Any],
) -> PreparedTargetRequest:
    body_str = render_template(target_body_template, example)
    try:
        body = json.loads(body_str)
    except json.JSONDecodeError:
        body = {"input": body_str}

    headers = dict(target_headers or {})
    if target_method.upper() != "GET" and not any(key.lower() == "content-type" for key in headers):
        headers["Content-Type"] = "application/json"

    return PreparedTargetRequest(
        method=target_method.upper(),
        url=target_url,
        headers=headers,
        body=body,
    )


async def invoke_target_endpoint(
    *,
    target_url: str,
    target_method: str = "POST",
    target_headers: dict[str, str] | None = None,
    target_body_template: str = '{"input": {{inputs.input}}}',
    target_response_path: str | None = None,
    target_timeout_ms: int = 120000,
    prompt_snapshot: dict[str, Any] | None = None,
    example: dict[str, Any],
) -> TargetInvocationResult:
    validate_target_config(
        target_url=target_url,
        target_method=target_method,
        target_headers=target_headers,
        target_body_template=target_body_template,
        target_response_path=target_response_path,
        target_timeout_ms=target_timeout_ms,
    )
    example_payload, prompt_preview = attach_prompt_context(example, prompt_snapshot)
    prepared = build_target_request(
        target_url=target_url,
        target_method=target_method,
        target_headers=target_headers,
        target_body_template=target_body_template,
        example=example_payload,
    )

    request_kwargs: dict[str, Any] = {"headers": prepared.headers}
    if prepared.method == "GET":
        request_kwargs["params"] = _body_to_query_params(prepared.body)
    else:
        request_kwargs["json"] = prepared.body

    async with httpx.AsyncClient(timeout=httpx.Timeout(target_timeout_ms / 1000.0)) as client:
        start = time.perf_counter_ns()
        try:
            response = await client.request(prepared.method, prepared.url, **request_kwargs)
        except httpx.TimeoutException as exc:
            raise TargetEndpointUnavailableError("Target endpoint timed out", reason="timeout") from exc
        except httpx.ConnectError as exc:
            raise TargetEndpointUnavailableError("Target endpoint connection failed", reason="connect_error") from exc
        except httpx.NetworkError as exc:
            raise TargetEndpointUnavailableError("Target endpoint network is unavailable", reason="network_error") from exc
        except httpx.HTTPError as exc:
            raise TargetEndpointUnavailableError("Target endpoint request failed", reason="http_error") from exc
        latency_ms = int((time.perf_counter_ns() - start) / 1_000_000)

    if response.is_error:
        raise TargetEndpointHTTPError(
            status_code=response.status_code,
            response_body=_decode_response_payload(response),
        )

    raw_response = _decode_response_payload(response)
    trace_id = _extract_trace_id(raw_response)
    output = _extract_target_output(raw_response, target_response_path)

    return TargetInvocationResult(
        request_method=prepared.method,
        request_url=prepared.url,
        request_body=prepared.body,
        response_status_code=response.status_code,
        response_path_used=_normalize_json_path(target_response_path),
        latency_ms=latency_ms,
        trace_id=trace_id,
        output=output,
        raw_response=raw_response,
        prompt_preview=prompt_preview,
    )


class ExperimentRunner:
    """Runs an experiment: fetch dataset, call target, evaluate, save results."""

    def __init__(
        self,
        experiment_id: str,
        project_id: str,
        dataset_id: str,
        dataset_version: int | None,
        split: str,
        evaluator_ids: list[str],
        target_url: str,
        target_method: str = "POST",
        target_headers: dict[str, str] | None = None,
        target_body_template: str = '{"input": {{inputs.input}}}',
        target_response_path: str | None = None,
        target_timeout_ms: int = 120000,
        concurrency: int = 5,
        prompt_snapshot: dict[str, Any] | None = None,
        job_id: str | None = None,
    ) -> None:
        self.experiment_id = experiment_id
        self.job_id = job_id
        self.project_id = project_id
        self.dataset_id = dataset_id
        self.dataset_version = dataset_version
        self.split = split
        self.evaluator_ids = evaluator_ids
        self.target_url = target_url
        self.target_method = target_method
        self.target_headers = target_headers or {}
        self.target_body_template = target_body_template
        self.target_response_path = target_response_path
        self.target_timeout_ms = target_timeout_ms
        self.concurrency = concurrency
        self.prompt_snapshot = prompt_snapshot

    async def run(self) -> None:
        """Main entry point for the durable worker."""
        logger.info("Starting experiment %s", self.experiment_id)
        try:
            await experiment_repo.update_experiment_status(self.experiment_id, ExperimentStatus.RUNNING)

            # 1. Resolve evaluators
            evaluators = await self._resolve_evaluators()
            if not evaluators:
                raise ValueError("No valid evaluators found")

            # 2. Fetch dataset examples
            examples = await self._fetch_dataset()

            # 3. Process examples with concurrency control
            semaphore = asyncio.Semaphore(self.concurrency)
            all_latencies: list[int] = []
            all_eval_results: list[list[EvalResult]] = []
            completed = 0
            failed = 0

            async def process_example(idx: int, example: dict) -> None:
                nonlocal completed, failed
                async with semaphore:
                    try:
                        await self._ensure_not_canceled()
                        target_output, trace_id, target_latency = await self._call_target(example)
                        all_latencies.append(target_latency)

                        eval_input = EvalInput(
                            input=example.get("inputs"),
                            output=target_output,
                            expected=example.get("expected_outputs"),
                            context=example.get("metadata"),
                            metadata={
                                "example_id": example.get("id"),
                                "split": example.get("split", "default"),
                                "dataset_version": self.dataset_version,
                            },
                        )

                        results = await self._run_evaluators(evaluators, eval_input)
                        all_eval_results.append(results)
                        await self._ensure_not_canceled()

                        saved_result_id = await experiment_repo.save_result(
                            experiment_id=self.experiment_id,
                            example_id=example["id"],
                            input_value=example.get("inputs"),
                            expected_output=example.get("expected_outputs"),
                            metadata=example.get("metadata") or {},
                            split=example.get("split", "default"),
                            actual_output=target_output,
                            latency_ms=target_latency,
                            eval_results=results,
                            trace_id=trace_id,
                        )
                        if saved_result_id is None:
                            raise ExperimentCanceled()
                        completed += 1
                        await self._ensure_not_canceled()
                    except Exception as e:
                        if isinstance(e, ExperimentCanceled):
                            raise
                        failed += 1
                        logger.error("Error processing example %d: %s", idx, e)
                        await self._ensure_not_canceled()
                        saved_result_id = await experiment_repo.save_result(
                            experiment_id=self.experiment_id,
                            example_id=example["id"],
                            input_value=example.get("inputs"),
                            expected_output=example.get("expected_outputs"),
                            metadata=example.get("metadata") or {},
                            split=example.get("split", "default"),
                            actual_output=None,
                            latency_ms=0,
                            eval_results=[],
                            error=str(e),
                        )
                        if saved_result_id is None:
                            raise ExperimentCanceled()

            tasks = [process_example(idx, ex) for idx, ex in enumerate(examples)]
            await asyncio.gather(*tasks)

            # 4. Compute summary
            summary = self._compute_summary(
                total=len(examples),
                completed=completed,
                failed=failed,
                all_eval_results=all_eval_results,
                all_latencies=all_latencies,
            )
            await experiment_repo.update_experiment_summary(self.experiment_id, summary)
            await experiment_repo.update_experiment_status(self.experiment_id, ExperimentStatus.COMPLETED)
            logger.info("Experiment %s completed: %d/%d succeeded", self.experiment_id, completed, len(examples))

        except ExperimentCanceled:
            logger.info("Experiment %s canceled", self.experiment_id)
            await experiment_repo.update_experiment_status(self.experiment_id, ExperimentStatus.CANCELED)
        except Exception as e:
            logger.error("Experiment %s failed: %s", self.experiment_id, e)
            raise

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _resolve_evaluators(self) -> list[BaseEvaluator]:
        evaluators: list[BaseEvaluator] = []
        for eid in self.evaluator_ids:
            # Try built-in registry first
            if eid.startswith("builtin:"):
                name = eid.removeprefix("builtin:")
                ev = registry.get(name)
                if ev:
                    evaluators.append(ev)
                    continue
                logger.warning("Built-in evaluator %s not found", name)
                continue

            # Try DB
            db_eval = await evaluator_repo.get_evaluator(eid, self.project_id)
            if db_eval:
                try:
                    ev = await build_project_evaluator(db_eval.name, db_eval.config, self.project_id)
                    evaluators.append(ev)
                except ValueError as e:
                    logger.warning("Could not build evaluator %s: %s", eid, e)
            else:
                logger.warning("Evaluator %s not found", eid)

        return evaluators

    async def _fetch_dataset(self) -> list[dict]:
        """Fetch dataset examples from the dataset-service."""
        url = f"{settings.dataset_service_url}/api/v1/datasets/{self.dataset_id}/examples"
        headers = build_internal_headers(self.project_id)
        examples: list[dict] = []
        page = 1

        async with httpx.AsyncClient(timeout=30.0) as client:
            while True:
                resp = await client.get(
                    url,
                    headers=headers,
                    params={"page": page, "page_size": 100, "version": self.dataset_version},
                )
                resp.raise_for_status()
                data = resp.json()

                payload = data.get("data") if isinstance(data, dict) else data
                if not isinstance(payload, dict) or "items" not in payload:
                    raise ValueError(f"Unexpected dataset response format from {url}")

                page_items = payload.get("items") or []
                examples.extend(page_items)
                if len(page_items) < 100:
                    break
                page += 1

        if self.split and self.split != "all":
            examples = [example for example in examples if example.get("split", "default") == self.split]

        return examples

    async def _call_target(self, example: dict) -> tuple[Any, str | None, int]:
        """Call the target API and return (output, latency_ms)."""
        result = await invoke_target_endpoint(
            target_url=self.target_url,
            target_method=self.target_method,
            target_headers=self.target_headers,
            target_body_template=self.target_body_template,
            target_response_path=self.target_response_path,
            target_timeout_ms=self.target_timeout_ms,
            prompt_snapshot=self.prompt_snapshot,
            example=example,
        )
        return result.output, result.trace_id, result.latency_ms

    async def _ensure_not_canceled(self) -> None:
        job_status = await experiment_repo.get_job_status(self.experiment_id)
        if job_status == "cancel_requested":
            raise ExperimentCanceled()

    async def _run_evaluators(
        self,
        evaluators: list[BaseEvaluator],
        eval_input: EvalInput,
    ) -> list[EvalResult]:
        results: list[EvalResult] = []
        for ev in evaluators:
            try:
                result = await ev.run(eval_input)
                results.append(result)
            except Exception as e:
                logger.error("Evaluator %s failed: %s", ev.name, e)
                results.append(EvalResult(
                    score=0.0,
                    reasoning=f"Evaluator error: {e}",
                    evaluator_name=ev.name,
                    evaluator_type=ev.type,
                ))
        return results

    def _compute_summary(
        self,
        total: int,
        completed: int,
        failed: int,
        all_eval_results: list[list[EvalResult]],
        all_latencies: list[int],
    ) -> ExperimentSummary:
        # Aggregate scores by evaluator
        scores_by_evaluator: dict[str, list[float]] = {}
        for results in all_eval_results:
            for r in results:
                scores_by_evaluator.setdefault(r.evaluator_name, []).append(r.score)

        avg_scores: dict[str, float] = {}
        pass_rates: dict[str, float] = {}
        for name, scores in scores_by_evaluator.items():
            avg_scores[name] = round(sum(scores) / len(scores), 4) if scores else 0.0
            pass_rates[name] = round(sum(1 for s in scores if s >= 0.5) / len(scores), 4) if scores else 0.0

        # Latency percentiles
        sorted_lat = sorted(all_latencies) if all_latencies else [0]
        p50 = self._percentile(sorted_lat, 50)
        p90 = self._percentile(sorted_lat, 90)
        p99 = self._percentile(sorted_lat, 99)

        return ExperimentSummary(
            total_examples=total,
            completed=completed,
            failed=failed,
            avg_scores=avg_scores,
            pass_rates=pass_rates,
            latency_p50_ms=p50,
            latency_p90_ms=p90,
            latency_p99_ms=p99,
        )

    @staticmethod
    def _percentile(sorted_values: list[int], p: float) -> float:
        if not sorted_values:
            return 0.0
        k = (len(sorted_values) - 1) * (p / 100.0)
        f = int(k)
        c = f + 1
        if c >= len(sorted_values):
            return float(sorted_values[-1])
        d = k - f
        return sorted_values[f] + d * (sorted_values[c] - sorted_values[f])
