from __future__ import annotations

import asyncio
import hashlib
import json
import re
import uuid
from datetime import UTC, datetime
from typing import Any

import httpx

from app.auth import build_internal_headers
from app.db import get_pool
from app.schemas import (
    GuardrailConfig,
    MonitorAlertResponse,
    MonitoringOverview,
    MonitorRuleCreate,
    MonitorRuleResponse,
    MonitorRuleRunResult,
    MonitorRuleUpdate,
    MonitorRunResponse,
    MonitorScore,
)
from app.settings import settings


def _parse_json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value:
        try:
            parsed = json.loads(value)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            return {}
    return {}


def _parse_json_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value:
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            return []
    return []


def _row_to_rule(row: Any) -> MonitorRuleResponse:
    return MonitorRuleResponse(
        id=row["id"],
        project_id=row["project_id"],
        name=row["name"],
        description=row["description"],
        status=row["status"],
        sampling_rate=float(row["sampling_rate"]),
        evaluator_ids=[str(item) for item in _parse_json_list(row["evaluator_ids"])],
        threshold=float(row["threshold"]),
        severity=row["severity"],
        backfill_dataset_id=row["backfill_dataset_id"],
        backfill_split=row["backfill_split"],
        auto_annotation=bool(row["auto_annotation"]),
        guardrail_config=GuardrailConfig(**_parse_json_object(row["guardrail_config"])),
        last_checked_at=row["last_checked_at"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_run(row: Any) -> MonitorRunResponse:
    return MonitorRunResponse(
        id=row["id"],
        rule_id=row["rule_id"],
        project_id=row["project_id"],
        trace_id=row["trace_id"],
        trace_status=row["trace_status"] or "ok",
        avg_score=row["avg_score"],
        evaluator_scores=[MonitorScore(**item) for item in _parse_json_list(row["evaluator_scores"])],
        guardrail_hits=[str(item) for item in _parse_json_list(row["guardrail_hits"])],
        alert_triggered=bool(row["alert_triggered"]),
        dataset_backfilled=bool(row["dataset_backfilled"]),
        annotation_created=bool(row["annotation_created"]),
        dataset_action_id=row["dataset_action_id"],
        annotation_action_id=row["annotation_action_id"],
        backfill_error_message=row["backfill_error_message"],
        error_message=row["error_message"],
        created_at=row["created_at"],
    )


def _row_to_alert(row: Any) -> MonitorAlertResponse:
    return MonitorAlertResponse(
        id=row["id"],
        rule_id=row["rule_id"],
        run_id=row["run_id"],
        project_id=row["project_id"],
        trace_id=row["trace_id"],
        kind=row["kind"],
        severity=row["severity"],
        status=row["status"],
        title=row["title"],
        summary=row["summary"],
        details=_parse_json_object(row["details"]),
        created_at=row["created_at"],
        resolved_at=row["resolved_at"],
    )


class MonitorService:
    def __init__(self) -> None:
        self.http = httpx.AsyncClient(timeout=60.0)

    async def close(self) -> None:
        await self.http.aclose()

    async def list_rules(
        self,
        project_id: str,
        *,
        page: int = 1,
        page_size: int = 20,
        query: str | None = None,
        status: str | None = None,
    ) -> tuple[list[MonitorRuleResponse], int]:
        pool = await get_pool()
        offset = (page - 1) * page_size
        filters = ["project_id = $1"]
        params: list[Any] = [project_id]

        if status:
            filters.append(f"status = ${len(params) + 1}")
            params.append(status)
        if query:
            filters.append(f"(name ILIKE ${len(params) + 1} OR description ILIKE ${len(params) + 1})")
            params.append(f"%{query}%")

        where_clause = " AND ".join(filters)
        async with pool.acquire() as conn:
            total = await conn.fetchval(
                f"SELECT COUNT(*) FROM monitor_rules WHERE {where_clause}",
                *params,
            )
            rows = await conn.fetch(
                f"""
                SELECT * FROM monitor_rules
                WHERE {where_clause}
                ORDER BY updated_at DESC, created_at DESC
                LIMIT ${len(params) + 1} OFFSET ${len(params) + 2}
                """,
                *params,
                page_size,
                offset,
            )
        return [_row_to_rule(row) for row in rows], int(total or 0)

    async def get_rule(self, project_id: str, rule_id: str) -> MonitorRuleResponse | None:
        pool = await get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM monitor_rules WHERE project_id = $1 AND id = $2",
                project_id,
                rule_id,
            )
        return _row_to_rule(row) if row else None

    async def list_active_rules(self) -> list[MonitorRuleResponse]:
        pool = await get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM monitor_rules WHERE status = 'active' ORDER BY updated_at DESC, created_at DESC"
            )
        return [_row_to_rule(row) for row in rows]

    async def create_rule(self, project_id: str, body: MonitorRuleCreate) -> MonitorRuleResponse:
        pool = await get_pool()
        rule_id = f"mon_{uuid.uuid4()}"
        now = datetime.now(UTC)
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO monitor_rules (
                    id, project_id, name, description, status, sampling_rate, evaluator_ids,
                    threshold, severity, backfill_dataset_id, backfill_split, auto_annotation,
                    guardrail_config, created_at, updated_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13::jsonb, $14, $15)
                """,
                rule_id,
                project_id,
                body.name,
                body.description,
                body.status,
                body.sampling_rate,
                json.dumps(body.evaluator_ids),
                body.threshold,
                body.severity,
                body.backfill_dataset_id,
                body.backfill_split,
                body.auto_annotation,
                json.dumps(body.guardrail_config.model_dump(mode="json")),
                now,
                now,
            )
        rule = await self.get_rule(project_id, rule_id)
        if rule is None:
            raise RuntimeError("failed to create monitor rule")
        return rule

    async def update_rule(self, project_id: str, rule_id: str, body: MonitorRuleUpdate) -> MonitorRuleResponse | None:
        existing = await self.get_rule(project_id, rule_id)
        if existing is None:
            return None

        merged = existing.model_copy(
            update={
                "name": body.name if body.name is not None else existing.name,
                "description": body.description if body.description is not None else existing.description,
                "status": body.status if body.status is not None else existing.status,
                "sampling_rate": body.sampling_rate if body.sampling_rate is not None else existing.sampling_rate,
                "evaluator_ids": body.evaluator_ids if body.evaluator_ids is not None else existing.evaluator_ids,
                "threshold": body.threshold if body.threshold is not None else existing.threshold,
                "severity": body.severity if body.severity is not None else existing.severity,
                "backfill_dataset_id": body.backfill_dataset_id
                if body.backfill_dataset_id is not None
                else existing.backfill_dataset_id,
                "backfill_split": body.backfill_split if body.backfill_split is not None else existing.backfill_split,
                "auto_annotation": body.auto_annotation if body.auto_annotation is not None else existing.auto_annotation,
                "guardrail_config": body.guardrail_config if body.guardrail_config is not None else existing.guardrail_config,
            }
        )

        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE monitor_rules
                SET name = $3,
                    description = $4,
                    status = $5,
                    sampling_rate = $6,
                    evaluator_ids = $7::jsonb,
                    threshold = $8,
                    severity = $9,
                    backfill_dataset_id = $10,
                    backfill_split = $11,
                    auto_annotation = $12,
                    guardrail_config = $13::jsonb,
                    updated_at = NOW()
                WHERE project_id = $1 AND id = $2
                """,
                project_id,
                rule_id,
                merged.name,
                merged.description,
                merged.status,
                merged.sampling_rate,
                json.dumps(merged.evaluator_ids),
                merged.threshold,
                merged.severity,
                merged.backfill_dataset_id,
                merged.backfill_split,
                merged.auto_annotation,
                json.dumps(merged.guardrail_config.model_dump(mode="json")),
            )
        return await self.get_rule(project_id, rule_id)

    async def list_runs(
        self,
        project_id: str,
        *,
        rule_id: str | None = None,
        page: int = 1,
        page_size: int = 20,
        query: str | None = None,
    ) -> tuple[list[MonitorRunResponse], int]:
        pool = await get_pool()
        offset = (page - 1) * page_size
        filters = ["project_id = $1"]
        params: list[Any] = [project_id]

        if rule_id:
            filters.append(f"rule_id = ${len(params) + 1}")
            params.append(rule_id)
        if query:
            filters.append(
                f"(trace_id ILIKE ${len(params) + 1} OR id ILIKE ${len(params) + 1} OR COALESCE(error_message, '') ILIKE ${len(params) + 1} OR COALESCE(guardrail_hits::text, '') ILIKE ${len(params) + 1})"
            )
            params.append(f"%{query}%")

        where_clause = " AND ".join(filters)
        async with pool.acquire() as conn:
            total = await conn.fetchval(
                f"SELECT COUNT(*) FROM monitor_runs WHERE {where_clause}",
                *params,
            )
            rows = await conn.fetch(
                f"""
                SELECT * FROM monitor_runs
                WHERE {where_clause}
                ORDER BY created_at DESC
                LIMIT ${len(params) + 1} OFFSET ${len(params) + 2}
                """,
                *params,
                page_size,
                offset,
            )
        return [_row_to_run(row) for row in rows], int(total or 0)

    async def list_alerts(
        self,
        project_id: str,
        *,
        status: str | None = None,
        page: int = 1,
        page_size: int = 20,
        query: str | None = None,
    ) -> tuple[list[MonitorAlertResponse], int]:
        pool = await get_pool()
        offset = (page - 1) * page_size
        filters = ["project_id = $1"]
        params: list[Any] = [project_id]

        if status:
            filters.append(f"status = ${len(params) + 1}")
            params.append(status)
        if query:
            filters.append(
                f"(title ILIKE ${len(params) + 1} OR summary ILIKE ${len(params) + 1} OR COALESCE(trace_id, '') ILIKE ${len(params) + 1} OR COALESCE(run_id, '') ILIKE ${len(params) + 1} OR COALESCE(details::text, '') ILIKE ${len(params) + 1})"
            )
            params.append(f"%{query}%")

        where_clause = " AND ".join(filters)
        async with pool.acquire() as conn:
            total = await conn.fetchval(
                f"SELECT COUNT(*) FROM monitor_alerts WHERE {where_clause}",
                *params,
            )
            rows = await conn.fetch(
                f"""
                SELECT * FROM monitor_alerts
                WHERE {where_clause}
                ORDER BY created_at DESC
                LIMIT ${len(params) + 1} OFFSET ${len(params) + 2}
                """,
                *params,
                page_size,
                offset,
            )
        return [_row_to_alert(row) for row in rows], int(total or 0)

    async def resolve_alert(self, project_id: str, alert_id: str) -> MonitorAlertResponse | None:
        pool = await get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                UPDATE monitor_alerts
                SET status = 'resolved', resolved_at = NOW()
                WHERE project_id = $1 AND id = $2
                RETURNING *
                """,
                project_id,
                alert_id,
            )
        return _row_to_alert(row) if row else None

    async def get_overview(self, project_id: str) -> MonitoringOverview:
        pool = await get_pool()
        async with pool.acquire() as conn:
            rule_stats = await conn.fetchrow(
                """
                SELECT
                    COUNT(*) AS rule_count,
                    COUNT(*) FILTER (WHERE status = 'active') AS active_rule_count
                FROM monitor_rules
                WHERE project_id = $1
                """,
                project_id,
            )
            run_stats = await conn.fetchrow(
                """
                SELECT
                    COUNT(*) AS recent_run_count,
                    AVG(avg_score) AS avg_score,
                    AVG(CASE WHEN alert_triggered THEN 1.0 ELSE 0.0 END) AS alert_rate
                FROM monitor_runs
                WHERE project_id = $1
                  AND created_at >= NOW() - INTERVAL '7 days'
                """,
                project_id,
            )
            alert_stats = await conn.fetchrow(
                """
                SELECT COUNT(*) AS open_alert_count
                FROM monitor_alerts
                WHERE project_id = $1 AND status = 'open'
                """,
                project_id,
            )

        latest_alerts, _ = await self.list_alerts(project_id, page=1, page_size=5)
        latest_runs, _ = await self.list_runs(project_id, page=1, page_size=8)
        return MonitoringOverview(
            rule_count=int(rule_stats["rule_count"] or 0),
            active_rule_count=int(rule_stats["active_rule_count"] or 0),
            open_alert_count=int(alert_stats["open_alert_count"] or 0),
            recent_run_count=int(run_stats["recent_run_count"] or 0),
            alert_rate=float(run_stats["alert_rate"] or 0.0),
            avg_score=float(run_stats["avg_score"]) if run_stats["avg_score"] is not None else None,
            latest_alerts=latest_alerts,
            latest_runs=latest_runs,
        )

    async def process_all_active_rules(self) -> dict[str, MonitorRuleRunResult]:
        results: dict[str, MonitorRuleRunResult] = {}
        for rule in await self.list_active_rules():
            results[rule.id] = await self.process_rule(rule)
        return results

    async def process_rule_by_id(self, project_id: str, rule_id: str) -> MonitorRuleRunResult:
        rule = await self.get_rule(project_id, rule_id)
        if rule is None:
            raise ValueError("rule not found")
        return await self.process_rule(rule)

    async def process_rule(self, rule: MonitorRuleResponse) -> MonitorRuleRunResult:
        traces = await self._list_candidate_traces(rule.project_id, rule.last_checked_at)
        processed = 0
        alerts = 0
        runs: list[MonitorRunResponse] = []
        latest_seen: datetime | None = rule.last_checked_at

        for trace in traces:
            trace_created_at = self._parse_dt(trace.get("created_at")) or datetime.now(UTC)
            if latest_seen is None or trace_created_at > latest_seen:
                latest_seen = trace_created_at

            if not self._should_sample(rule.sampling_rate, str(trace.get("trace_id", ""))):
                continue
            if await self._run_exists(rule.id, str(trace.get("trace_id", ""))):
                continue

            run = await self._process_trace(rule, trace)
            processed += 1
            if run.alert_triggered:
                alerts += 1
            runs.append(run)

        await self._update_last_checked_at(rule.id, latest_seen or datetime.now(UTC))
        return MonitorRuleRunResult(processed=processed, alerts=alerts, runs=runs)

    async def _process_trace(self, rule: MonitorRuleResponse, trace: dict[str, Any]) -> MonitorRunResponse:
        trace_id = str(trace.get("trace_id"))
        detail = await self._get_trace_detail(rule.project_id, trace_id)
        eval_scores = await self._evaluate_trace(rule.project_id, rule.evaluator_ids, detail)
        guardrail_hits = self._check_guardrails(rule.guardrail_config, detail)

        avg_score = None
        if eval_scores:
            avg_score = sum(score.score for score in eval_scores) / len(eval_scores)

        score_alert = avg_score is not None and avg_score < rule.threshold
        trace_error = detail.get("status") == "error"
        alert_triggered = bool(score_alert or trace_error or guardrail_hits)

        run = await self._insert_run(
            rule=rule,
            trace_id=trace_id,
            trace_status=str(detail.get("status") or "ok"),
            avg_score=avg_score,
            evaluator_scores=eval_scores,
            guardrail_hits=guardrail_hits,
            alert_triggered=alert_triggered,
            error_message=None,
        )

        dataset_backfilled = False
        annotation_created = False
        dataset_action_id: str | None = None
        annotation_action_id: str | None = None
        backfill_errors: list[str] = []
        if alert_triggered and rule.backfill_dataset_id:
            dataset_backfilled, dataset_action_id, dataset_error = await self._backfill_dataset(
                rule.project_id,
                rule.backfill_dataset_id,
                trace_id,
                rule.backfill_split,
                run.id,
            )
            if dataset_error:
                backfill_errors.append(f"Dataset 回流失败：{dataset_error}")
        if alert_triggered and rule.auto_annotation:
            annotation_created, annotation_action_id, annotation_error = await self._backfill_annotation(
                rule.project_id,
                trace_id,
                run.id,
            )
            if annotation_error:
                backfill_errors.append(f"标注回流失败：{annotation_error}")

        if alert_triggered:
            kind = "guardrail" if guardrail_hits else ("trace_error" if trace_error else "score")
            title = f"{rule.name} 触发告警"
            if kind == "guardrail":
                summary = "检测到输出命中 Guardrail 规则。"
            elif kind == "trace_error":
                summary = "Trace 运行状态为 error。"
            else:
                summary = f"平均分 {avg_score:.2f} 低于阈值 {rule.threshold:.2f}。"
            await self._insert_alert(
                rule=rule,
                run_id=run.id,
                trace_id=trace_id,
                kind=kind,
                title=title,
                summary=summary,
                details={
                    "avg_score": avg_score,
                    "threshold": rule.threshold,
                    "guardrail_hits": guardrail_hits,
                    "trace_status": detail.get("status"),
                    "evaluator_scores": [score.model_dump(mode="json") for score in eval_scores],
                },
            )

        if dataset_action_id or annotation_action_id or backfill_errors:
            run = await self._mark_backfill(
                run.id,
                dataset_backfilled,
                annotation_created,
                dataset_action_id,
                annotation_action_id,
                "；".join(backfill_errors) if backfill_errors else None,
            )

        return run

    async def _run_exists(self, rule_id: str, trace_id: str) -> bool:
        pool = await get_pool()
        async with pool.acquire() as conn:
            found = await conn.fetchval(
                "SELECT 1 FROM monitor_runs WHERE rule_id = $1 AND trace_id = $2",
                rule_id,
                trace_id,
            )
        return found is not None

    async def _update_last_checked_at(self, rule_id: str, checked_at: datetime) -> None:
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE monitor_rules SET last_checked_at = $2, updated_at = NOW() WHERE id = $1",
                rule_id,
                checked_at,
            )

    async def _insert_run(
        self,
        *,
        rule: MonitorRuleResponse,
        trace_id: str,
        trace_status: str,
        avg_score: float | None,
        evaluator_scores: list[MonitorScore],
        guardrail_hits: list[str],
        alert_triggered: bool,
        error_message: str | None,
    ) -> MonitorRunResponse:
        pool = await get_pool()
        run_id = f"mrun_{uuid.uuid4()}"
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO monitor_runs (
                    id, rule_id, project_id, trace_id, trace_status, avg_score,
                    evaluator_scores, guardrail_hits, alert_triggered, error_message
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)
                RETURNING *
                """,
                run_id,
                rule.id,
                rule.project_id,
                trace_id,
                trace_status,
                avg_score,
                json.dumps([score.model_dump(mode="json") for score in evaluator_scores]),
                json.dumps(guardrail_hits),
                alert_triggered,
                error_message,
            )
        return _row_to_run(row)

    async def _mark_backfill(
        self,
        run_id: str,
        dataset_backfilled: bool,
        annotation_created: bool,
        dataset_action_id: str | None,
        annotation_action_id: str | None,
        backfill_error_message: str | None,
    ) -> MonitorRunResponse:
        pool = await get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                UPDATE monitor_runs
                SET dataset_backfilled = $2,
                    annotation_created = $3,
                    dataset_action_id = $4,
                    annotation_action_id = $5,
                    backfill_error_message = $6
                WHERE id = $1
                RETURNING *
                """,
                run_id,
                dataset_backfilled,
                annotation_created,
                dataset_action_id,
                annotation_action_id,
                backfill_error_message,
            )
        return _row_to_run(row)

    async def _insert_alert(
        self,
        *,
        rule: MonitorRuleResponse,
        run_id: str,
        trace_id: str,
        kind: str,
        title: str,
        summary: str,
        details: dict[str, Any],
    ) -> None:
        pool = await get_pool()
        alert_id = f"alert_{uuid.uuid4()}"
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO monitor_alerts (
                    id, rule_id, run_id, project_id, trace_id, kind, severity, title, summary, details
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
                """,
                alert_id,
                rule.id,
                run_id,
                rule.project_id,
                trace_id,
                kind,
                rule.severity,
                title,
                summary,
                json.dumps(details),
            )

    async def _list_candidate_traces(self, project_id: str, start_time: datetime | None) -> list[dict[str, Any]]:
        params: dict[str, Any] = {
            "page": 1,
            "page_size": settings.worker_trace_page_size,
            "sort_by": "start_time",
            "sort_order": "desc",
        }
        if start_time is not None:
            params["start_time"] = start_time.isoformat()
        payload = await self._get_trace_json(project_id, "/api/v1/traces", params=params)
        data = payload.get("data") or {}
        return list(data.get("traces") or [])

    async def _get_trace_detail(self, project_id: str, trace_id: str) -> dict[str, Any]:
        payload = await self._get_trace_json(project_id, f"/api/v1/traces/{trace_id}")
        return payload.get("data") or {}

    async def _get_trace_json(
        self,
        project_id: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        last_error: Exception | None = None
        for attempt in range(1, 4):
            try:
                response = await self.http.get(
                    f"{settings.trace_service_url}{path}",
                    params=params,
                    headers=build_internal_headers(project_id),
                )
                response.raise_for_status()
                return response.json()
            except (httpx.HTTPError, ValueError) as exc:
                last_error = exc
                if attempt < 3:
                    await asyncio.sleep(min(2 * attempt, 5))
        if last_error is not None:
            raise last_error
        raise RuntimeError(f"trace service request failed: {path}")

    async def _evaluate_trace(
        self,
        project_id: str,
        evaluator_ids: list[str],
        trace: dict[str, Any],
    ) -> list[MonitorScore]:
        scores: list[MonitorScore] = []
        eval_input = {
            "input": self._normalize_eval_value(trace.get("input") or trace.get("input_preview")),
            "output": self._normalize_eval_value(trace.get("output") or trace.get("output_preview")),
            "expected": self._normalize_eval_value(
                (trace.get("metadata_json") or {}).get("expected_output")
                if isinstance(trace.get("metadata_json"), dict)
                else None
            ),
            "context": trace.get("metadata_json") or {},
            "trace": trace,
            "metadata": {
                "trace_id": trace.get("trace_id"),
                "trace_status": trace.get("status"),
            },
        }

        for evaluator_id in evaluator_ids:
            response = await self.http.post(
                f"{settings.eval_engine_url}/api/v1/evaluators/{evaluator_id}/test",
                headers=build_internal_headers(project_id),
                json={"eval_input": eval_input},
            )
            response.raise_for_status()
            payload = response.json()
            result = payload.get("data") or {}
            scores.append(
                MonitorScore(
                    evaluator_id=evaluator_id,
                    evaluator_name=str(result.get("evaluator_name") or evaluator_id),
                    score=float(result.get("score") or 0.0),
                    reasoning=result.get("reasoning"),
                    latency_ms=int(result.get("latency_ms") or 0),
                    metadata=result.get("metadata") or {},
                )
            )
        return scores

    async def _backfill_dataset(
        self,
        project_id: str,
        dataset_id: str,
        trace_id: str,
        split: str,
        run_id: str,
    ) -> tuple[bool, str | None, str | None]:
        try:
            response = await self.http.post(
                f"{settings.trace_service_url}/api/v1/traces/batch/dataset",
                headers=build_internal_headers(project_id),
                json={
                    "dataset_id": dataset_id,
                    "trace_ids": [trace_id],
                    "split": split,
                    "source_type": "monitor_rule",
                    "source_ref_id": run_id,
                },
            )
            response.raise_for_status()
            payload = response.json().get("data") or {}
            action = next(iter(payload.get("actions") or []), None)
            if not isinstance(action, dict):
                return bool(payload.get("added")), None, None
            return action.get("status") == "succeeded", action.get("id"), action.get("error_message") or None
        except Exception as exc:  # pragma: no cover - network error branch
            return False, None, str(exc)

    async def _backfill_annotation(
        self,
        project_id: str,
        trace_id: str,
        run_id: str,
    ) -> tuple[bool, str | None, str | None]:
        try:
            response = await self.http.post(
                f"{settings.trace_service_url}/api/v1/traces/batch/annotation",
                headers=build_internal_headers(project_id),
                json={
                    "trace_ids": [trace_id],
                    "mode": "single_run",
                    "source_type": "monitor_rule",
                    "source_ref_id": run_id,
                },
            )
            response.raise_for_status()
            payload = response.json().get("data") or {}
            action = next(iter(payload.get("actions") or []), None)
            if not isinstance(action, dict):
                return bool(payload.get("added")), None, None
            return action.get("status") == "succeeded", action.get("id"), action.get("error_message") or None
        except Exception as exc:  # pragma: no cover - network error branch
            return False, None, str(exc)

    def _check_guardrails(self, config: GuardrailConfig, trace: dict[str, Any]) -> list[str]:
        output_text = self._stringify(self._normalize_eval_value(trace.get("output") or trace.get("output_preview")))
        hits: list[str] = []
        if config.require_non_empty_output and not output_text.strip():
            hits.append("输出为空")
        if config.max_output_chars is not None and len(output_text) > config.max_output_chars:
            hits.append(f"输出长度超过 {config.max_output_chars}")
        lowered = output_text.lower()
        for keyword in config.blocked_keywords:
            if keyword and keyword.lower() in lowered:
                hits.append(f"命中关键词：{keyword}")
        for pattern in config.blocked_regexes:
            try:
                if pattern and re.search(pattern, output_text, re.IGNORECASE):
                    hits.append(f"命中正则：{pattern}")
            except re.error:
                hits.append(f"非法正则：{pattern}")
        return hits

    def _should_sample(self, sampling_rate: float, trace_id: str) -> bool:
        if sampling_rate >= 1.0:
            return True
        if sampling_rate <= 0.0:
            return False
        digest = hashlib.sha1(trace_id.encode("utf-8")).hexdigest()[:8]
        ratio = int(digest, 16) / 0xFFFFFFFF
        return ratio <= sampling_rate

    def _stringify(self, value: Any) -> str:
        if value is None:
            return ""
        if isinstance(value, str):
            return value
        try:
            return json.dumps(value, ensure_ascii=False)
        except TypeError:
            return str(value)

    def _parse_dt(self, value: Any) -> datetime | None:
        if isinstance(value, datetime):
            return value.astimezone(UTC)
        if isinstance(value, str) and value:
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)
            except ValueError:
                return None
        return None

    def _normalize_eval_value(self, value: Any) -> Any:
        if isinstance(value, dict):
            for key in ("answer", "output", "content", "text", "message", "input", "question", "prompt", "reference"):
                if key in value:
                    return self._normalize_eval_value(value[key])
            if len(value) == 1:
                return self._normalize_eval_value(next(iter(value.values())))
        return value
