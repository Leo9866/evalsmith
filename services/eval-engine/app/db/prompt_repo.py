from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from app.db.connection import get_pool
from app.models.schemas import (
    ExperimentPromptSnapshot,
    PromptCreate,
    PromptResponse,
    PromptStatus,
    PromptUpdate,
    PromptVersionCreate,
    PromptVersionResponse,
)


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _json_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value:
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return []
        if isinstance(parsed, list):
            return parsed
    return []


def _json_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value:
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        if isinstance(parsed, dict):
            return parsed
    return {}


def _row_to_prompt_version(row) -> PromptVersionResponse:
    return PromptVersionResponse(
        id=row["version_id"] if "version_id" in row else row["id"],
        prompt_id=row["prompt_id"],
        version=row["version"],
        system_prompt=row["system_prompt"] or "",
        user_prompt_template=row["user_prompt_template"] or "",
        variables_schema=_json_dict(row["variables_schema"]),
        render_config=_json_dict(row["render_config"]),
        change_note=row["change_note"] or "",
        created_by=row["created_by"],
        created_at=row["version_created_at"] if "version_created_at" in row else row["created_at"],
        is_current=bool(row["is_current"]) if "is_current" in row else False,
    )


def _row_to_prompt(row) -> PromptResponse:
    current_version_detail = None
    if "version_id" in row and row["version_id"]:
        current_version_detail = PromptVersionResponse(
            id=row["version_id"],
            prompt_id=row["id"],
            version=row["current_version"],
            system_prompt=row["system_prompt"] or "",
            user_prompt_template=row["user_prompt_template"] or "",
            variables_schema=_json_dict(row["variables_schema"]),
            render_config=_json_dict(row["render_config"]),
            change_note=row["change_note"] or "",
            created_by=row["version_created_by"],
            created_at=row["version_created_at"],
            is_current=True,
        )

    return PromptResponse(
        id=row["id"],
        project_id=row["project_id"],
        name=row["name"],
        description=row["description"] or "",
        status=PromptStatus(row["status"]),
        kind=row["kind"] or "chat",
        template_engine=row["template_engine"] or "mustache",
        current_version=row["current_version"] or 1,
        labels=[str(item) for item in _json_list(row["labels"])],
        created_by=row["created_by"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        current_version_detail=current_version_detail,
    )


async def create_prompt(body: PromptCreate, project_id: str, created_by: str | None) -> PromptResponse:
    pool = await get_pool()
    prompt_id = _new_id("prm")
    version_id = _new_id("prmv")
    now = datetime.now(timezone.utc)

    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO prompts (
                    id, project_id, name, description, status, kind, template_engine,
                    current_version, labels, created_by, created_at, updated_at
                )
                VALUES ($1, $2, $3, $4, $5, 'chat', $6, 1, $7::jsonb, $8, $9, $9)
                """,
                prompt_id,
                project_id,
                body.name,
                body.description,
                body.status.value,
                body.template_engine,
                json.dumps(body.labels),
                created_by,
                now,
            )
            await conn.execute(
                """
                INSERT INTO prompt_versions (
                    id, prompt_id, version, system_prompt, user_prompt_template,
                    variables_schema, render_config, change_note, created_by, created_at
                )
                VALUES ($1, $2, 1, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9)
                """,
                version_id,
                prompt_id,
                body.system_prompt,
                body.user_prompt_template,
                json.dumps(body.variables_schema),
                json.dumps(body.render_config),
                body.change_note,
                created_by,
                now,
            )
            if body.status == PromptStatus.ACTIVE:
                await conn.execute(
                    """
                    INSERT INTO prompt_releases (id, prompt_id, version, channel, note, released_by, released_at)
                    VALUES ($1, $2, 1, 'active', $3, $4, $5)
                    """,
                    _new_id("prmr"),
                    prompt_id,
                    body.change_note,
                    created_by,
                    now,
                )

    prompt = await get_prompt(prompt_id, project_id)
    if prompt is None:  # pragma: no cover
        raise RuntimeError("failed to load prompt after creation")
    return prompt


async def list_prompts(
    project_id: str,
    *,
    page: int = 1,
    page_size: int = 20,
    query: str | None = None,
    status: str | None = None,
) -> tuple[list[PromptResponse], int]:
    pool = await get_pool()
    offset = (page - 1) * page_size
    filters = ["p.project_id = $1"]
    params: list[Any] = [project_id]

    if query:
        filters.append(f"(p.name ILIKE ${len(params) + 1} OR p.description ILIKE ${len(params) + 1})")
        params.append(f"%{query}%")
    if status:
        filters.append(f"p.status = ${len(params) + 1}")
        params.append(status)

    where_clause = " AND ".join(filters)

    async with pool.acquire() as conn:
        total = await conn.fetchval(f"SELECT COUNT(*) FROM prompts p WHERE {where_clause}", *params)
        rows = await conn.fetch(
            f"""
            SELECT
                p.*,
                pv.id AS version_id,
                pv.system_prompt,
                pv.user_prompt_template,
                pv.variables_schema,
                pv.render_config,
                pv.change_note,
                pv.created_by AS version_created_by,
                pv.created_at AS version_created_at
            FROM prompts p
            LEFT JOIN prompt_versions pv
                ON pv.prompt_id = p.id AND pv.version = p.current_version
            WHERE {where_clause}
            ORDER BY p.updated_at DESC, p.created_at DESC
            LIMIT ${len(params) + 1} OFFSET ${len(params) + 2}
            """,
            *params,
            page_size,
            offset,
        )

    return [_row_to_prompt(row) for row in rows], int(total or 0)


async def get_prompt(prompt_id: str, project_id: str) -> PromptResponse | None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT
                p.*,
                pv.id AS version_id,
                pv.system_prompt,
                pv.user_prompt_template,
                pv.variables_schema,
                pv.render_config,
                pv.change_note,
                pv.created_by AS version_created_by,
                pv.created_at AS version_created_at
            FROM prompts p
            LEFT JOIN prompt_versions pv
                ON pv.prompt_id = p.id AND pv.version = p.current_version
            WHERE p.id = $1 AND p.project_id = $2
            """,
            prompt_id,
            project_id,
        )
    if row is None:
        return None
    return _row_to_prompt(row)


async def update_prompt(prompt_id: str, project_id: str, body: PromptUpdate) -> PromptResponse | None:
    pool = await get_pool()
    now = datetime.now(timezone.utc)
    updates: list[str] = []
    params: list[Any] = []

    if body.name is not None:
        updates.append(f"name = ${len(params) + 1}")
        params.append(body.name)
    if body.description is not None:
        updates.append(f"description = ${len(params) + 1}")
        params.append(body.description)
    if body.status is not None:
        updates.append(f"status = ${len(params) + 1}")
        params.append(body.status.value)
    if body.template_engine is not None:
        updates.append(f"template_engine = ${len(params) + 1}")
        params.append(body.template_engine)
    if body.labels is not None:
        updates.append(f"labels = ${len(params) + 1}::jsonb")
        params.append(json.dumps(body.labels))

    if not updates:
        return await get_prompt(prompt_id, project_id)

    updates.append(f"updated_at = ${len(params) + 1}")
    params.append(now)
    params.extend([prompt_id, project_id])

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"""
            UPDATE prompts
            SET {", ".join(updates)}
            WHERE id = ${len(params) - 1} AND project_id = ${len(params)}
            RETURNING id
            """,
            *params,
        )
    if row is None:
        return None
    return await get_prompt(prompt_id, project_id)


async def list_prompt_versions(prompt_id: str, project_id: str) -> list[PromptVersionResponse]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                pv.*,
                CASE WHEN pv.version = p.current_version THEN TRUE ELSE FALSE END AS is_current
            FROM prompt_versions pv
            JOIN prompts p ON p.id = pv.prompt_id
            WHERE pv.prompt_id = $1 AND p.project_id = $2
            ORDER BY pv.version DESC
            """,
            prompt_id,
            project_id,
        )
    return [_row_to_prompt_version(row) for row in rows]


async def get_prompt_version(prompt_id: str, project_id: str, version: int | None = None) -> PromptVersionResponse | None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        if version is None:
            row = await conn.fetchrow(
                """
                SELECT
                    pv.*,
                    TRUE AS is_current
                FROM prompts p
                JOIN prompt_versions pv
                    ON pv.prompt_id = p.id AND pv.version = p.current_version
                WHERE p.id = $1 AND p.project_id = $2
                """,
                prompt_id,
                project_id,
            )
        else:
            row = await conn.fetchrow(
                """
                SELECT
                    pv.*,
                    CASE WHEN pv.version = p.current_version THEN TRUE ELSE FALSE END AS is_current
                FROM prompt_versions pv
                JOIN prompts p ON p.id = pv.prompt_id
                WHERE pv.prompt_id = $1 AND p.project_id = $2 AND pv.version = $3
                """,
                prompt_id,
                project_id,
                version,
            )
    if row is None:
        return None
    return _row_to_prompt_version(row)


async def create_prompt_version(
    prompt_id: str,
    project_id: str,
    body: PromptVersionCreate,
    created_by: str | None,
) -> PromptVersionResponse | None:
    pool = await get_pool()
    now = datetime.now(timezone.utc)

    async with pool.acquire() as conn:
        async with conn.transaction():
            prompt = await conn.fetchrow(
                "SELECT current_version FROM prompts WHERE id = $1 AND project_id = $2 FOR UPDATE",
                prompt_id,
                project_id,
            )
            if prompt is None:
                return None
            next_version = int(prompt["current_version"] or 0) + 1
            await conn.execute(
                """
                INSERT INTO prompt_versions (
                    id, prompt_id, version, system_prompt, user_prompt_template,
                    variables_schema, render_config, change_note, created_by, created_at
                )
                VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)
                """,
                _new_id("prmv"),
                prompt_id,
                next_version,
                body.system_prompt,
                body.user_prompt_template,
                json.dumps(body.variables_schema),
                json.dumps(body.render_config),
                body.change_note,
                created_by,
                now,
            )
            await conn.execute(
                """
                UPDATE prompts
                SET current_version = $1, updated_at = $2
                WHERE id = $3 AND project_id = $4
                """,
                next_version,
                now,
                prompt_id,
                project_id,
            )
    return await get_prompt_version(prompt_id, project_id, next_version)


async def rollback_prompt(
    prompt_id: str,
    project_id: str,
    version: int,
    change_note: str,
    created_by: str | None,
) -> PromptVersionResponse | None:
    pool = await get_pool()
    now = datetime.now(timezone.utc)

    async with pool.acquire() as conn:
        async with conn.transaction():
            prompt = await conn.fetchrow(
                "SELECT current_version FROM prompts WHERE id = $1 AND project_id = $2 FOR UPDATE",
                prompt_id,
                project_id,
            )
            if prompt is None:
                return None
            source = await conn.fetchrow(
                """
                SELECT system_prompt, user_prompt_template, variables_schema, render_config
                FROM prompt_versions
                WHERE prompt_id = $1 AND version = $2
                """,
                prompt_id,
                version,
            )
            if source is None:
                return None
            next_version = int(prompt["current_version"] or 0) + 1
            note = change_note or f"Rolled back to v{version}"
            await conn.execute(
                """
                INSERT INTO prompt_versions (
                    id, prompt_id, version, system_prompt, user_prompt_template,
                    variables_schema, render_config, change_note, created_by, created_at
                )
                VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)
                """,
                _new_id("prmv"),
                prompt_id,
                next_version,
                source["system_prompt"] or "",
                source["user_prompt_template"] or "",
                json.dumps(_json_dict(source["variables_schema"])),
                json.dumps(_json_dict(source["render_config"])),
                note,
                created_by,
                now,
            )
            await conn.execute(
                "UPDATE prompts SET current_version = $1, updated_at = $2 WHERE id = $3 AND project_id = $4",
                next_version,
                now,
                prompt_id,
                project_id,
            )
    return await get_prompt_version(prompt_id, project_id, next_version)


async def release_prompt(
    prompt_id: str,
    project_id: str,
    version: int | None,
    note: str,
    released_by: str | None,
) -> PromptResponse | None:
    pool = await get_pool()
    now = datetime.now(timezone.utc)

    async with pool.acquire() as conn:
        async with conn.transaction():
            prompt = await conn.fetchrow(
                "SELECT current_version FROM prompts WHERE id = $1 AND project_id = $2 FOR UPDATE",
                prompt_id,
                project_id,
            )
            if prompt is None:
                return None
            target_version = version or int(prompt["current_version"] or 1)
            exists = await conn.fetchval(
                "SELECT 1 FROM prompt_versions WHERE prompt_id = $1 AND version = $2",
                prompt_id,
                target_version,
            )
            if not exists:
                return None
            await conn.execute(
                """
                UPDATE prompts
                SET status = $1, current_version = $2, updated_at = $3
                WHERE id = $4 AND project_id = $5
                """,
                PromptStatus.ACTIVE.value,
                target_version,
                now,
                prompt_id,
                project_id,
            )
            await conn.execute(
                """
                INSERT INTO prompt_releases (id, prompt_id, version, channel, note, released_by, released_at)
                VALUES ($1, $2, $3, 'active', $4, $5, $6)
                """,
                _new_id("prmr"),
                prompt_id,
                target_version,
                note,
                released_by,
                now,
            )
    return await get_prompt(prompt_id, project_id)


async def get_prompt_snapshot(
    prompt_id: str,
    project_id: str,
    version: int | None = None,
) -> ExperimentPromptSnapshot | None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        if version is None:
            row = await conn.fetchrow(
                """
                SELECT
                    p.id AS prompt_id,
                    p.name AS prompt_name,
                    p.template_engine,
                    pv.version,
                    pv.system_prompt,
                    pv.user_prompt_template,
                    pv.variables_schema,
                    pv.render_config
                FROM prompts p
                JOIN prompt_versions pv
                    ON pv.prompt_id = p.id AND pv.version = p.current_version
                WHERE p.id = $1 AND p.project_id = $2
                """,
                prompt_id,
                project_id,
            )
        else:
            row = await conn.fetchrow(
                """
                SELECT
                    p.id AS prompt_id,
                    p.name AS prompt_name,
                    p.template_engine,
                    pv.version,
                    pv.system_prompt,
                    pv.user_prompt_template,
                    pv.variables_schema,
                    pv.render_config
                FROM prompts p
                JOIN prompt_versions pv ON pv.prompt_id = p.id
                WHERE p.id = $1 AND p.project_id = $2 AND pv.version = $3
                """,
                prompt_id,
                project_id,
                version,
            )
    if row is None:
        return None
    return ExperimentPromptSnapshot(
        prompt_id=row["prompt_id"],
        prompt_name=row["prompt_name"],
        version=row["version"],
        template_engine=row["template_engine"] or "mustache",
        system_prompt=row["system_prompt"] or "",
        user_prompt_template=row["user_prompt_template"] or "",
        variables_schema=_json_dict(row["variables_schema"]),
        render_config=_json_dict(row["render_config"]),
    )
