from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from app.db.connection import get_pool
from app.models.schemas import (
    EvalResult,
    ExperimentBaselineResponse,
    ExperimentCreate,
    ExperimentPromptRef,
    ExperimentPromptSnapshot,
    ExperimentResponse,
    ExperimentResultResponse,
    ExperimentStatus,
    ExperimentSummary,
)


# ---------------------------------------------------------------------------
# Experiments
# ---------------------------------------------------------------------------

async def create_experiment(
    data: ExperimentCreate,
    project_id: str,
    *,
    prompt_ref: ExperimentPromptRef | None = None,
    prompt_snapshot: ExperimentPromptSnapshot | None = None,
) -> ExperimentResponse:
    pool = await get_pool()
    exp_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    target_config = {
        "url": data.target_url,
        "method": data.target_method,
        "headers": data.target_headers,
        "body_template": data.target_body_template,
        "response_path": data.target_response_path,
        "timeout_ms": data.target_timeout_ms,
    }
    evaluator_configs = [{"evaluator_id": evaluator_id} for evaluator_id in data.evaluator_ids]
    run_config = {"concurrency": data.concurrency}

    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO experiments
                (id, project_id, name, description, dataset_id, dataset_version, split,
                 status, target_config, evaluator_configs, run_config, prompt_ref, prompt_snapshot, summary, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15)
            """,
            exp_id,
            project_id,
            data.name,
            data.description,
            data.dataset_id,
            data.dataset_version,
            data.split,
            ExperimentStatus.PENDING.value,
            json.dumps(target_config),
            json.dumps(evaluator_configs),
            json.dumps(run_config),
            json.dumps((prompt_ref or data.prompt_ref).model_dump(mode="json")) if (prompt_ref or data.prompt_ref) else None,
            json.dumps(prompt_snapshot.model_dump(mode="json")) if prompt_snapshot else None,
            json.dumps({}),
            now,
        )

    return ExperimentResponse(
        id=exp_id,
        name=data.name,
        description=data.description,
        dataset_id=data.dataset_id,
        dataset_version=data.dataset_version,
        split=data.split,
        evaluator_ids=data.evaluator_ids,
        target_url=data.target_url,
        target_method=data.target_method,
        target_headers=data.target_headers,
        target_body_template=data.target_body_template,
        target_response_path=data.target_response_path,
        target_timeout_ms=data.target_timeout_ms,
        concurrency=data.concurrency,
        prompt_ref=prompt_ref or data.prompt_ref,
        prompt_snapshot=prompt_snapshot,
        status=ExperimentStatus.PENDING,
        project_id=project_id,
        created_at=now,
    )


async def get_experiment(exp_id: str, project_id: str | None = None) -> ExperimentResponse | None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        base_query = """
            SELECT
                e.*,
                ej.status AS job_status,
                ej.last_error AS last_error,
                EXISTS (
                    SELECT 1
                    FROM experiment_baselines eb
                    WHERE eb.experiment_id = e.id
                ) AS is_baseline
            FROM experiments e
            LEFT JOIN experiment_jobs ej ON ej.experiment_id = e.id
        """
        if project_id:
            row = await conn.fetchrow(
                base_query + " WHERE e.id = $1 AND e.project_id = $2",
                exp_id,
                project_id,
            )
        else:
            row = await conn.fetchrow(base_query + " WHERE e.id = $1", exp_id)
    if row is None:
        return None
    return _exp_row_to_response(row)


async def list_experiments(project_id: str | None = None) -> list[ExperimentResponse]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        if project_id:
            rows = await conn.fetch(
                """
                SELECT
                    e.*,
                    ej.status AS job_status,
                    ej.last_error AS last_error,
                    EXISTS (
                        SELECT 1
                        FROM experiment_baselines eb
                        WHERE eb.experiment_id = e.id
                    ) AS is_baseline
                FROM experiments e
                LEFT JOIN experiment_jobs ej ON ej.experiment_id = e.id
                WHERE e.project_id = $1
                ORDER BY e.created_at DESC
                """,
                project_id,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT
                    e.*,
                    ej.status AS job_status,
                    ej.last_error AS last_error,
                    EXISTS (
                        SELECT 1
                        FROM experiment_baselines eb
                        WHERE eb.experiment_id = e.id
                    ) AS is_baseline
                FROM experiments e
                LEFT JOIN experiment_jobs ej ON ej.experiment_id = e.id
                ORDER BY e.created_at DESC
                """
            )
    return [_exp_row_to_response(r) for r in rows]


async def list_experiments_paginated(
    project_id: str,
    *,
    page: int = 1,
    page_size: int = 20,
    query: str | None = None,
    status: str | None = None,
) -> tuple[list[ExperimentResponse], int]:
    pool = await get_pool()
    offset = (page - 1) * page_size
    filters = ["e.project_id = $1"]
    params: list[Any] = [project_id]

    if query:
        filters.append(
            f"(e.name ILIKE ${len(params) + 1} OR e.description ILIKE ${len(params) + 1} OR e.target_config::text ILIKE ${len(params) + 1})"
        )
        params.append(f"%{query}%")
    if status:
        filters.append(f"e.status = ${len(params) + 1}")
        params.append(status)

    where_clause = " AND ".join(filters)

    async with pool.acquire() as conn:
        total = await conn.fetchval(
            f"SELECT COUNT(*) FROM experiments e WHERE {where_clause}",
            *params,
        )
        rows = await conn.fetch(
            f"""
            SELECT
                e.*,
                ej.status AS job_status,
                ej.last_error AS last_error,
                EXISTS (
                    SELECT 1
                    FROM experiment_baselines eb
                    WHERE eb.experiment_id = e.id
                ) AS is_baseline
            FROM experiments e
            LEFT JOIN experiment_jobs ej ON ej.experiment_id = e.id
            WHERE {where_clause}
            ORDER BY e.created_at DESC
            LIMIT ${len(params) + 1} OFFSET ${len(params) + 2}
            """,
            *params,
            page_size,
            offset,
        )
    return [_exp_row_to_response(r) for r in rows], int(total or 0)


async def update_experiment_status(exp_id: str, status: ExperimentStatus) -> None:
    pool = await get_pool()
    now = datetime.now(timezone.utc)
    async with pool.acquire() as conn:
        if status == ExperimentStatus.RUNNING:
            await conn.execute(
                """
                UPDATE experiments
                SET status = $1, started_at = COALESCE(started_at, $2), completed_at = NULL
                WHERE id = $3
                """,
                status.value,
                now,
                exp_id,
            )
            return

        if status in (ExperimentStatus.COMPLETED, ExperimentStatus.FAILED):
            await conn.execute(
                """
                UPDATE experiments
                SET status = $1, completed_at = $2
                WHERE id = $3
                """,
                status.value,
                now,
                exp_id,
            )
            return

        if status == ExperimentStatus.PENDING:
            await conn.execute(
                """
                UPDATE experiments
                SET status = $1, completed_at = NULL
                WHERE id = $2
                """,
                status.value,
                exp_id,
            )
            return

        await conn.execute("UPDATE experiments SET status = $1 WHERE id = $2", status.value, exp_id)


async def update_experiment_summary(exp_id: str, summary: ExperimentSummary) -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE experiments SET summary = $1::jsonb WHERE id = $2",
            json.dumps(summary.model_dump(mode="json")), exp_id,
        )


async def delete_experiment(exp_id: str, project_id: str) -> bool:
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM experiments WHERE id = $1 AND project_id = $2",
            exp_id,
            project_id,
        )
    return result == "DELETE 1"


async def enqueue_experiment_job(
    experiment_id: str,
    project_id: str,
    payload: dict[str, Any],
    max_attempts: int = 3,
) -> str:
    pool = await get_pool()
    job_id = f"job_{uuid.uuid4()}"
    now = datetime.now(timezone.utc)
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO experiment_jobs
                (id, experiment_id, project_id, payload, status, attempts, max_attempts, created_at, updated_at)
            VALUES ($1,$2,$3,$4::jsonb,'pending',0,$5,$6,$6)
            ON CONFLICT (experiment_id) DO UPDATE
            SET payload = EXCLUDED.payload,
                status = 'pending',
                last_error = NULL,
                updated_at = EXCLUDED.updated_at
            """,
            job_id,
            experiment_id,
            project_id,
            json.dumps(payload),
            max_attempts,
            now,
        )
    return job_id


async def claim_next_job(worker_id: str) -> dict[str, Any] | None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                SELECT *
                FROM experiment_jobs
                WHERE status IN ('pending', 'cancel_requested')
                ORDER BY created_at ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 1
                """
            )
            if row is None:
                return None

            new_status = "canceled" if row["status"] == "cancel_requested" else "running"
            next_attempts = int(row["attempts"] or 0) + (1 if new_status == "running" else 0)
            now = datetime.now(timezone.utc)
            await conn.execute(
                """
                UPDATE experiment_jobs
                SET status = $1,
                    attempts = $2,
                    locked_by = $3,
                    locked_at = $4,
                    started_at = CASE
                        WHEN $1 = 'running' THEN COALESCE(started_at, $4)
                        ELSE started_at
                    END,
                    finished_at = CASE
                        WHEN $1 = 'running' THEN NULL
                        ELSE $4
                    END,
                    updated_at = $4
                WHERE id = $5
                """,
                new_status,
                next_attempts,
                worker_id if new_status == "running" else None,
                now,
                row["id"],
            )
            if new_status == "canceled":
                await conn.execute(
                    "UPDATE experiments SET status = $1, completed_at = $2 WHERE id = $3",
                    ExperimentStatus.CANCELED.value,
                    now,
                    row["experiment_id"],
                )
            payload = row["payload"] if isinstance(row["payload"], dict) else json.loads(row["payload"] or "{}")
            return {
                "id": row["id"],
                "experiment_id": row["experiment_id"],
                "project_id": row["project_id"],
                "payload": payload,
                "status": new_status,
                "attempts": next_attempts,
                "max_attempts": row["max_attempts"],
            }


async def complete_job(job_id: str) -> None:
    pool = await get_pool()
    now = datetime.now(timezone.utc)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT experiment_id, status FROM experiment_jobs WHERE id = $1",
            job_id,
        )
        if row is None:
            return
        await conn.execute(
            """
            UPDATE experiment_jobs
            SET status = 'completed',
                finished_at = $1,
                updated_at = $1,
                locked_by = NULL,
                locked_at = NULL,
                last_error = NULL
            WHERE id = $2
            """,
            now,
            job_id,
        )
        if row["status"] != "canceled":
            await conn.execute(
                """
                UPDATE experiments
                SET status = $1, completed_at = $2
                WHERE id = $3
                """,
                ExperimentStatus.COMPLETED.value,
                now,
                row["experiment_id"],
            )


async def cancel_job(job_id: str) -> None:
    pool = await get_pool()
    now = datetime.now(timezone.utc)
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT experiment_id FROM experiment_jobs WHERE id = $1", job_id)
        if row is None:
            return
        await conn.execute(
            """
            UPDATE experiment_jobs
            SET status = 'canceled', finished_at = $1, updated_at = $1, locked_by = NULL, locked_at = NULL
            WHERE id = $2
            """,
            now,
            job_id,
        )
        await conn.execute(
            "UPDATE experiments SET status = $1, completed_at = $2 WHERE id = $3",
            ExperimentStatus.CANCELED.value,
            now,
            row["experiment_id"],
        )


async def fail_job(job_id: str, error: str, retry: bool = False) -> None:
    pool = await get_pool()
    now = datetime.now(timezone.utc)
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT attempts, max_attempts, experiment_id FROM experiment_jobs WHERE id = $1", job_id)
        if row is None:
            return
        final_retry = retry and int(row["attempts"] or 0) < int(row["max_attempts"] or 0)
        status = "pending" if final_retry else "failed"
        finished_at = None if final_retry else now
        await conn.execute(
            """
            UPDATE experiment_jobs
            SET status = $1,
                last_error = $2,
                finished_at = $3,
                locked_by = NULL,
                locked_at = NULL,
                updated_at = $4
            WHERE id = $5
            """,
            status,
            error,
            finished_at,
            now,
            job_id,
        )
        if not final_retry:
            await conn.execute(
                "UPDATE experiments SET status = $1, completed_at = $2 WHERE id = $3",
                ExperimentStatus.FAILED.value,
                now,
                row["experiment_id"],
            )
            return

        await conn.execute(
            """
            UPDATE experiments
            SET status = $1, completed_at = NULL
            WHERE id = $2
            """,
            ExperimentStatus.PENDING.value,
            row["experiment_id"],
        )


async def request_cancel(experiment_id: str, project_id: str) -> bool:
    pool = await get_pool()
    now = datetime.now(timezone.utc)
    async with pool.acquire() as conn:
        result = await conn.execute(
            """
            UPDATE experiment_jobs
            SET status = 'cancel_requested', updated_at = $1
            WHERE experiment_id = $2 AND project_id = $3 AND status IN ('pending', 'running')
            """,
            now,
            experiment_id,
            project_id,
        )
        if result == "UPDATE 0":
            return False
        await conn.execute(
            "UPDATE experiments SET status = $1 WHERE id = $2 AND project_id = $3 AND status IN ($4, $5)",
            ExperimentStatus.CANCEL_REQUESTED.value,
            experiment_id,
            project_id,
            ExperimentStatus.PENDING.value,
            ExperimentStatus.RUNNING.value,
        )
        return True


async def get_job_status(experiment_id: str) -> str | None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        return await conn.fetchval("SELECT status FROM experiment_jobs WHERE experiment_id = $1", experiment_id)


async def set_baseline(project_id: str, dataset_id: str, experiment_id: str) -> ExperimentBaselineResponse:
    pool = await get_pool()
    now = datetime.now(timezone.utc)
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO experiment_baselines (project_id, dataset_id, experiment_id, created_at, updated_at)
            VALUES ($1,$2,$3,$4,$4)
            ON CONFLICT (project_id, dataset_id) DO UPDATE
            SET experiment_id = EXCLUDED.experiment_id,
                updated_at = EXCLUDED.updated_at
            """,
            project_id,
            dataset_id,
            experiment_id,
            now,
        )
    return ExperimentBaselineResponse(
        project_id=project_id,
        dataset_id=dataset_id,
        experiment_id=experiment_id,
        created_at=now,
        updated_at=now,
    )


async def get_baseline(project_id: str, dataset_id: str) -> ExperimentBaselineResponse | None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT project_id, dataset_id, experiment_id, created_at, updated_at
            FROM experiment_baselines
            WHERE project_id = $1 AND dataset_id = $2
            """,
            project_id,
            dataset_id,
        )
    if row is None:
        return None
    return ExperimentBaselineResponse(
        project_id=row["project_id"],
        dataset_id=row["dataset_id"],
        experiment_id=row["experiment_id"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


# ---------------------------------------------------------------------------
# Experiment results
# ---------------------------------------------------------------------------

async def save_result(
    experiment_id: str,
    example_id: str,
    input_value,
    expected_output,
    metadata: dict,
    split: str,
    actual_output,
    latency_ms: int,
    eval_results: list[EvalResult],
    trace_id: str | None = None,
    error: str | None = None,
 ) -> str | None:
    pool = await get_pool()
    result_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    async with pool.acquire() as conn:
        job_status = await conn.fetchval(
            "SELECT status FROM experiment_jobs WHERE experiment_id = $1",
            experiment_id,
        )
        if job_status in {"cancel_requested", "canceled"}:
            return None

        return await conn.fetchval(
            """
            INSERT INTO experiment_results
                (id, experiment_id, example_id, actual_output, trace_id, scores, latency_ms, error, created_at)
            VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7,$8,$9)
            ON CONFLICT (experiment_id, example_id) WHERE example_id IS NOT NULL DO UPDATE
            SET actual_output = EXCLUDED.actual_output,
                trace_id = EXCLUDED.trace_id,
                scores = EXCLUDED.scores,
                latency_ms = EXCLUDED.latency_ms,
                error = EXCLUDED.error
            RETURNING id
            """,
            result_id,
            experiment_id,
            example_id,
            json.dumps(actual_output),
            trace_id,
            json.dumps([r.model_dump(mode="json") for r in eval_results]),
            latency_ms,
            error,
            now,
        )


async def get_results(
    experiment_id: str,
    project_id: str,
    page: int = 1,
    page_size: int = 20,
    sort_by: str = "created_at",
    sort_order: str = "asc",
    max_score: float | None = None,
) -> tuple[list[ExperimentResultResponse], int]:
    pool = await get_pool()
    offset = (page - 1) * page_size
    score_expr = (
        "COALESCE(("
        "SELECT AVG((elem->>'score')::double precision) "
        "FROM jsonb_array_elements(COALESCE(er.scores, '[]'::jsonb)) AS elem"
        "), 0.0)"
    )
    sort_columns = {
        "created_at": "er.created_at",
        "latency_ms": "er.latency_ms",
        "score": "score_sort_value",
    }
    sort_column = sort_columns.get(sort_by, "er.created_at")
    sort_direction = "DESC" if sort_order == "desc" else "ASC"
    filters = [
        "er.experiment_id = $1",
        "e.project_id = $2",
    ]
    params: list[object] = [experiment_id, project_id]

    if max_score is not None:
        filters.append(f"{score_expr} <= ${len(params) + 1}")
        params.append(max_score)

    where_clause = " AND ".join(filters)

    async with pool.acquire() as conn:
        total = await conn.fetchval(
            f"""
            SELECT COUNT(*)
            FROM experiment_results er
            JOIN experiments e ON e.id = er.experiment_id
            WHERE {where_clause}
            """,
            *params,
        )
        rows = await conn.fetch(
            f"""
            SELECT
                er.id,
                er.experiment_id,
                er.example_id,
                er.actual_output,
                er.trace_id,
                er.scores,
                er.latency_ms,
                er.error,
                er.created_at,
                ex.inputs,
                ex.expected_outputs,
                ex.metadata,
                ex.split,
                {score_expr} AS score_sort_value
            FROM experiment_results er
            JOIN experiments e ON e.id = er.experiment_id
            LEFT JOIN examples ex ON ex.id = er.example_id
            WHERE {where_clause}
            ORDER BY {sort_column} {sort_direction}, er.id ASC
            LIMIT ${len(params) + 1} OFFSET ${len(params) + 2}
            """,
            *params,
            page_size,
            offset,
        )

    items = [_result_row_to_response(r) for r in rows]
    return items, total


async def list_all_results(experiment_id: str, project_id: str) -> list[ExperimentResultResponse]:
    items, _ = await get_results(experiment_id, project_id, page=1, page_size=10000)
    return items


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _exp_row_to_response(row) -> ExperimentResponse:
    evaluator_configs = row["evaluator_configs"] if isinstance(row["evaluator_configs"], list) else json.loads(row["evaluator_configs"])
    evaluator_ids = []
    for item in evaluator_configs:
        if isinstance(item, str):
            evaluator_ids.append(item)
        elif isinstance(item, dict) and item.get("evaluator_id"):
            evaluator_ids.append(str(item["evaluator_id"]))

    target_config = row["target_config"] if isinstance(row["target_config"], dict) else json.loads(row["target_config"])
    run_config = row["run_config"] if isinstance(row["run_config"], dict) else json.loads(row["run_config"])
    summary = None
    if row["summary"]:
        s = row["summary"] if isinstance(row["summary"], dict) else json.loads(row["summary"])
        summary = ExperimentSummary(**s)
    prompt_ref = None
    raw_prompt_ref = row["prompt_ref"] if "prompt_ref" in row else None
    if raw_prompt_ref:
        prompt_ref_data = raw_prompt_ref if isinstance(raw_prompt_ref, dict) else json.loads(raw_prompt_ref)
        prompt_ref = ExperimentPromptRef(**prompt_ref_data)
    prompt_snapshot = None
    raw_prompt_snapshot = row["prompt_snapshot"] if "prompt_snapshot" in row else None
    if raw_prompt_snapshot:
        prompt_snapshot_data = raw_prompt_snapshot if isinstance(raw_prompt_snapshot, dict) else json.loads(raw_prompt_snapshot)
        prompt_snapshot = ExperimentPromptSnapshot(**prompt_snapshot_data)

    return ExperimentResponse(
        id=row["id"],
        name=row["name"],
        description=row["description"],
        dataset_id=row["dataset_id"],
        dataset_version=row["dataset_version"],
        split=row["split"] or "default",
        evaluator_ids=evaluator_ids,
        target_url=target_config.get("url", ""),
        target_method=target_config.get("method", "POST"),
        target_headers=target_config.get("headers", {}),
        target_body_template=target_config.get("body_template", ""),
        target_response_path=target_config.get("response_path"),
        target_timeout_ms=int(target_config.get("timeout_ms", 120000)),
        concurrency=int(run_config.get("concurrency", 5)),
        prompt_ref=prompt_ref,
        prompt_snapshot=prompt_snapshot,
        status=ExperimentStatus(row["status"]),
        project_id=row["project_id"],
        summary=summary,
        job_status=row.get("job_status"),
        last_error=row.get("last_error"),
        is_baseline=bool(row.get("is_baseline", False)),
        created_at=row["created_at"],
        started_at=row["started_at"],
        completed_at=row["completed_at"],
    )


def _result_row_to_response(row) -> ExperimentResultResponse:
    actual_output = row["actual_output"]
    scores_data = row["scores"] if isinstance(row["scores"], list) else json.loads(row["scores"])
    metadata = {}
    if row["metadata"]:
        metadata = row["metadata"] if isinstance(row["metadata"], dict) else json.loads(row["metadata"])

    return ExperimentResultResponse(
        id=row["id"],
        experiment_id=row["experiment_id"],
        example_id=row["example_id"],
        input=row["inputs"],
        expected_output=row["expected_outputs"],
        metadata=metadata,
        split=row["split"] or "default",
        actual_output=actual_output,
        trace_id=row["trace_id"],
        latency_ms=row["latency_ms"] or 0,
        scores=[EvalResult(**r) for r in scores_data],
        error=row["error"],
        created_at=row["created_at"],
    )
