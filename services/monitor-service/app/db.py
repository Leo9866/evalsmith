from __future__ import annotations

import logging

import asyncpg

from app.settings import settings

logger = logging.getLogger(__name__)

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        raise RuntimeError("Database pool not initialized")
    return _pool


async def init_db() -> None:
    global _pool
    if _pool is not None:
        return

    server_settings = None
    if settings.pg_schema and settings.pg_schema != "public":
        server_settings = {"search_path": f"{settings.pg_schema},public"}

    _pool = await asyncpg.create_pool(
        host=settings.pg_host,
        port=settings.pg_port,
        user=settings.pg_user,
        password=settings.pg_password,
        database=settings.pg_database,
        server_settings=server_settings,
        min_size=1,
        max_size=10,
    )
    await _run_migrations()
    logger.info("Monitor DB initialized.")


async def close_db() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def _run_migrations() -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS monitor_rules (
                id                  TEXT PRIMARY KEY,
                project_id          TEXT NOT NULL,
                name                TEXT NOT NULL,
                description         TEXT DEFAULT '',
                status              TEXT NOT NULL DEFAULT 'active',
                sampling_rate       DOUBLE PRECISION NOT NULL DEFAULT 1.0,
                evaluator_ids       JSONB NOT NULL DEFAULT '[]',
                threshold           DOUBLE PRECISION NOT NULL DEFAULT 0.7,
                severity            TEXT NOT NULL DEFAULT 'warning',
                backfill_dataset_id TEXT,
                backfill_split      TEXT NOT NULL DEFAULT 'regression',
                auto_annotation     BOOLEAN NOT NULL DEFAULT FALSE,
                guardrail_config    JSONB NOT NULL DEFAULT '{}',
                last_checked_at     TIMESTAMPTZ,
                created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS monitor_runs (
                id                  TEXT PRIMARY KEY,
                rule_id             TEXT NOT NULL REFERENCES monitor_rules(id) ON DELETE CASCADE,
                project_id          TEXT NOT NULL,
                trace_id            TEXT NOT NULL,
                trace_status        TEXT DEFAULT 'ok',
                avg_score           DOUBLE PRECISION,
                evaluator_scores    JSONB NOT NULL DEFAULT '[]',
                guardrail_hits      JSONB NOT NULL DEFAULT '[]',
                alert_triggered     BOOLEAN NOT NULL DEFAULT FALSE,
                dataset_backfilled  BOOLEAN NOT NULL DEFAULT FALSE,
                annotation_created  BOOLEAN NOT NULL DEFAULT FALSE,
                dataset_action_id   TEXT,
                annotation_action_id TEXT,
                backfill_error_message TEXT,
                error_message       TEXT,
                created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(rule_id, trace_id)
            );

            CREATE TABLE IF NOT EXISTS monitor_alerts (
                id             TEXT PRIMARY KEY,
                rule_id        TEXT NOT NULL REFERENCES monitor_rules(id) ON DELETE CASCADE,
                run_id         TEXT REFERENCES monitor_runs(id) ON DELETE SET NULL,
                project_id     TEXT NOT NULL,
                trace_id       TEXT,
                kind           TEXT NOT NULL DEFAULT 'score',
                severity       TEXT NOT NULL DEFAULT 'warning',
                status         TEXT NOT NULL DEFAULT 'open',
                title          TEXT NOT NULL,
                summary        TEXT DEFAULT '',
                details        JSONB NOT NULL DEFAULT '{}',
                created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                resolved_at    TIMESTAMPTZ
            );

            CREATE INDEX IF NOT EXISTS idx_monitor_rules_project ON monitor_rules(project_id, status, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_monitor_runs_rule ON monitor_runs(rule_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_monitor_runs_project ON monitor_runs(project_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_monitor_alerts_project ON monitor_alerts(project_id, status, created_at DESC);
            ALTER TABLE monitor_runs ADD COLUMN IF NOT EXISTS dataset_action_id TEXT;
            ALTER TABLE monitor_runs ADD COLUMN IF NOT EXISTS annotation_action_id TEXT;
            ALTER TABLE monitor_runs ADD COLUMN IF NOT EXISTS backfill_error_message TEXT;
            """
        )
