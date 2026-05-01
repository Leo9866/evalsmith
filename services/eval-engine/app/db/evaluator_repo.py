from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from app.db.connection import get_pool
from app.models.schemas import EvaluatorConfig, EvaluatorResponse, EvaluatorType


async def create_evaluator(
    name: str,
    description: str,
    config: EvaluatorConfig,
    project_id: str,
) -> EvaluatorResponse:
    pool = await get_pool()
    evaluator_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    config_json = config.model_dump(mode="json")

    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO evaluators (id, name, type, description, config, project_id, is_builtin, version, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5::jsonb, $6, FALSE, 1, $7, $8)
            """,
            evaluator_id, name, config.type.value, description, json.dumps(config_json), project_id, now, now,
        )

    return EvaluatorResponse(
        id=evaluator_id,
        name=name,
        type=config.type,
        description=description,
        config=config,
        is_builtin=False,
        version=1,
        project_id=project_id,
        created_at=now,
        updated_at=now,
    )


async def get_evaluator(evaluator_id: str, project_id: str | None = None) -> EvaluatorResponse | None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        if project_id:
            row = await conn.fetchrow(
                "SELECT * FROM evaluators WHERE id = $1 AND (project_id = $2 OR is_builtin = TRUE)",
                evaluator_id,
                project_id,
            )
        else:
            row = await conn.fetchrow("SELECT * FROM evaluators WHERE id = $1", evaluator_id)
    if row is None:
        return None
    return _row_to_response(row)


async def list_evaluators(
    project_id: str,
    *,
    offset: int = 0,
    limit: int = 20,
    query: str | None = None,
    evaluator_type: str | None = None,
) -> tuple[list[EvaluatorResponse], int]:
    pool = await get_pool()
    filters = ["project_id = $1", "is_builtin = FALSE"]
    params: list[Any] = [project_id]

    if query:
        filters.append(f"(name ILIKE ${len(params) + 1} OR description ILIKE ${len(params) + 1})")
        params.append(f"%{query}%")
    if evaluator_type:
        filters.append(f"type = ${len(params) + 1}")
        params.append(evaluator_type)

    where_clause = " AND ".join(filters)

    async with pool.acquire() as conn:
        total = await conn.fetchval(
            f"SELECT COUNT(*) FROM evaluators WHERE {where_clause}",
            *params,
        )
        rows = await conn.fetch(
            f"""
            SELECT * FROM evaluators
            WHERE {where_clause}
            ORDER BY updated_at DESC NULLS LAST, created_at DESC
            LIMIT ${len(params) + 1} OFFSET ${len(params) + 2}
            """,
            *params,
            limit,
            offset,
        )
    return [_row_to_response(r) for r in rows], int(total or 0)


async def update_evaluator(
    evaluator_id: str,
    project_id: str,
    name: str | None = None,
    description: str | None = None,
    config: EvaluatorConfig | None = None,
) -> EvaluatorResponse | None:
    pool = await get_pool()
    now = datetime.now(timezone.utc)

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM evaluators WHERE id = $1 AND project_id = $2 AND is_builtin = FALSE",
            evaluator_id,
            project_id,
        )
        if row is None:
            return None

        old_version = int(row["version"] or 1)
        new_version = old_version + 1
        old_config = json.dumps(row["config"]) if isinstance(row["config"], dict) else row["config"]

        # Save current version snapshot
        version_id = str(uuid.uuid4())
        await conn.execute(
            """
            INSERT INTO evaluator_versions (id, evaluator_id, version, config, changelog, created_at)
            VALUES ($1, $2, $3, $4::jsonb, $5, $6)
            ON CONFLICT (evaluator_id, version) DO NOTHING
            """,
            version_id, evaluator_id, old_version, old_config, f"Superseded by v{new_version}", now,
        )

        new_name = name if name is not None else row["name"]
        new_desc = description if description is not None else row["description"]
        new_config = json.dumps(config.model_dump(mode="json")) if config is not None else old_config

        await conn.execute(
            """
            UPDATE evaluators SET name = $1, description = $2, config = $3::jsonb, version = $4, updated_at = $5
            WHERE id = $6 AND project_id = $7 AND is_builtin = FALSE
            """,
            new_name,
            new_desc,
            new_config,
            new_version,
            now,
            evaluator_id,
            project_id,
        )

        updated = await conn.fetchrow(
            "SELECT * FROM evaluators WHERE id = $1 AND project_id = $2 AND is_builtin = FALSE",
            evaluator_id,
            project_id,
        )
    return _row_to_response(updated) if updated else None


async def list_evaluator_versions(evaluator_id: str, project_id: str) -> list[dict]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT ev.*
            FROM evaluator_versions ev
            JOIN evaluators e ON e.id = ev.evaluator_id
            WHERE ev.evaluator_id = $1 AND e.project_id = $2 AND e.is_builtin = FALSE
            ORDER BY ev.version DESC
            """,
            evaluator_id,
            project_id,
        )
    return [
        {
            "id": r["id"],
            "evaluator_id": r["evaluator_id"],
            "version": r["version"],
            "config": r["config"] if isinstance(r["config"], dict) else json.loads(r["config"]),
            "changelog": r["changelog"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in rows
    ]


async def delete_evaluator(evaluator_id: str, project_id: str) -> bool:
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM evaluators WHERE id = $1 AND project_id = $2 AND is_builtin = FALSE",
            evaluator_id,
            project_id,
        )
    return result == "DELETE 1"


def _row_to_response(row) -> EvaluatorResponse:
    config_data = row["config"] if isinstance(row["config"], dict) else json.loads(row["config"])
    return EvaluatorResponse(
        id=row["id"],
        name=row["name"],
        type=EvaluatorType(row["type"]),
        description=row["description"],
        config=EvaluatorConfig(**config_data),
        is_builtin=row["is_builtin"],
        version=row["version"],
        project_id=row["project_id"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )
