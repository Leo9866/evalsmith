from __future__ import annotations

import logging

import asyncpg

from app.settings import settings

logger = logging.getLogger(__name__)

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        raise RuntimeError("Database pool not initialized. Call init_db() first.")
    return _pool


async def init_db() -> None:
    """Create the connection pool and run schema migrations."""
    global _pool
    logger.info("Connecting to PostgreSQL at %s:%s/%s", settings.pg_host, settings.pg_port, settings.pg_database)
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
        min_size=2,
        max_size=10,
    )
    await _run_migrations()
    logger.info("Database initialized successfully.")


async def close_db() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
        logger.info("Database pool closed.")


async def _run_migrations() -> None:
    """Create or upgrade the shared eval tables to the repository schema."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS evaluators (
                id          TEXT PRIMARY KEY,
                project_id  TEXT,
                name        TEXT NOT NULL,
                type        TEXT NOT NULL DEFAULT 'rule',
                description TEXT DEFAULT '',
                config      JSONB NOT NULL DEFAULT '{}',
                is_builtin  BOOLEAN NOT NULL DEFAULT FALSE,
                version     INT NOT NULL DEFAULT 1,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS evaluator_versions (
                id              TEXT PRIMARY KEY,
                evaluator_id    TEXT NOT NULL REFERENCES evaluators(id) ON DELETE CASCADE,
                version         INT NOT NULL,
                config          JSONB NOT NULL DEFAULT '{}',
                changelog       TEXT DEFAULT '',
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(evaluator_id, version)
            );

            CREATE TABLE IF NOT EXISTS prompts (
                id              TEXT PRIMARY KEY,
                project_id      TEXT NOT NULL,
                name            TEXT NOT NULL,
                description     TEXT DEFAULT '',
                status          TEXT NOT NULL DEFAULT 'draft',
                kind            TEXT NOT NULL DEFAULT 'chat',
                template_engine TEXT NOT NULL DEFAULT 'mustache',
                current_version INT NOT NULL DEFAULT 1,
                labels          JSONB NOT NULL DEFAULT '[]',
                created_by      TEXT,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(project_id, name)
            );

            CREATE TABLE IF NOT EXISTS prompt_versions (
                id                  TEXT PRIMARY KEY,
                prompt_id           TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
                version             INT NOT NULL,
                system_prompt       TEXT NOT NULL DEFAULT '',
                user_prompt_template TEXT NOT NULL DEFAULT '',
                variables_schema    JSONB NOT NULL DEFAULT '{}',
                render_config       JSONB NOT NULL DEFAULT '{}',
                change_note         TEXT DEFAULT '',
                created_by          TEXT,
                created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(prompt_id, version)
            );

            CREATE TABLE IF NOT EXISTS prompt_releases (
                id          TEXT PRIMARY KEY,
                prompt_id   TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
                version     INT NOT NULL,
                channel     TEXT NOT NULL DEFAULT 'active',
                note        TEXT DEFAULT '',
                released_by TEXT,
                released_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS experiments (
                id                  TEXT PRIMARY KEY,
                project_id          TEXT NOT NULL DEFAULT 'proj_default',
                name                TEXT NOT NULL,
                description         TEXT DEFAULT '',
                dataset_id          TEXT NOT NULL,
                dataset_version     INT,
                split               TEXT DEFAULT 'default',
                status              TEXT NOT NULL DEFAULT 'pending',
                target_config       JSONB NOT NULL DEFAULT '{}',
                evaluator_configs   JSONB NOT NULL DEFAULT '[]',
                run_config          JSONB NOT NULL DEFAULT '{}',
                prompt_ref          JSONB,
                prompt_snapshot     JSONB,
                summary             JSONB DEFAULT '{}',
                started_at          TIMESTAMPTZ,
                completed_at        TIMESTAMPTZ,
                created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS experiment_jobs (
                id              TEXT PRIMARY KEY,
                experiment_id   TEXT NOT NULL UNIQUE REFERENCES experiments(id) ON DELETE CASCADE,
                project_id      TEXT NOT NULL DEFAULT 'proj_default',
                payload         JSONB NOT NULL DEFAULT '{}',
                status          TEXT NOT NULL DEFAULT 'pending',
                attempts        INT NOT NULL DEFAULT 0,
                max_attempts    INT NOT NULL DEFAULT 3,
                last_error      TEXT,
                locked_by       TEXT,
                locked_at       TIMESTAMPTZ,
                started_at      TIMESTAMPTZ,
                finished_at     TIMESTAMPTZ,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS experiment_baselines (
                project_id      TEXT NOT NULL,
                dataset_id      TEXT NOT NULL,
                experiment_id   TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (project_id, dataset_id)
            );

            CREATE TABLE IF NOT EXISTS experiment_results (
                id              TEXT PRIMARY KEY,
                experiment_id   TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
                example_id      TEXT,
                actual_output   JSONB,
                trace_id        TEXT,
                scores          JSONB NOT NULL DEFAULT '[]',
                latency_ms      INT,
                error           TEXT,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            ALTER TABLE evaluators ADD COLUMN IF NOT EXISTS project_id TEXT;
            ALTER TABLE evaluators ADD COLUMN IF NOT EXISTS type TEXT;
            ALTER TABLE evaluators ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
            ALTER TABLE evaluators ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}';
            ALTER TABLE evaluators ADD COLUMN IF NOT EXISTS is_builtin BOOLEAN NOT NULL DEFAULT FALSE;
            ALTER TABLE evaluators ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
            ALTER TABLE evaluators ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
            ALTER TABLE evaluators ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
            UPDATE evaluators
            SET type = COALESCE(NULLIF(type, ''), COALESCE(config->>'type', 'rule'))
            WHERE type IS NULL OR type = '';

            ALTER TABLE experiments ADD COLUMN IF NOT EXISTS project_id TEXT;
            ALTER TABLE experiments ADD COLUMN IF NOT EXISTS dataset_version INT;
            ALTER TABLE experiments ADD COLUMN IF NOT EXISTS split TEXT DEFAULT 'default';
            ALTER TABLE experiments ADD COLUMN IF NOT EXISTS target_config JSONB NOT NULL DEFAULT '{}';
            ALTER TABLE experiments ADD COLUMN IF NOT EXISTS evaluator_configs JSONB NOT NULL DEFAULT '[]';
            ALTER TABLE experiments ADD COLUMN IF NOT EXISTS run_config JSONB NOT NULL DEFAULT '{}';
            ALTER TABLE experiments ADD COLUMN IF NOT EXISTS prompt_ref JSONB;
            ALTER TABLE experiments ADD COLUMN IF NOT EXISTS prompt_snapshot JSONB;
            ALTER TABLE experiments ADD COLUMN IF NOT EXISTS summary JSONB DEFAULT '{}';
            ALTER TABLE experiments ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
            ALTER TABLE experiments ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
            ALTER TABLE experiments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
            UPDATE experiments
            SET project_id = COALESCE(project_id, 'proj_default')
            WHERE project_id IS NULL;

            ALTER TABLE experiment_jobs ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}';
            ALTER TABLE experiment_jobs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
            ALTER TABLE experiment_jobs ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;
            ALTER TABLE experiment_jobs ADD COLUMN IF NOT EXISTS max_attempts INT NOT NULL DEFAULT 3;
            ALTER TABLE experiment_jobs ADD COLUMN IF NOT EXISTS last_error TEXT;
            ALTER TABLE experiment_jobs ADD COLUMN IF NOT EXISTS locked_by TEXT;
            ALTER TABLE experiment_jobs ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
            ALTER TABLE experiment_jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
            ALTER TABLE experiment_jobs ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
            ALTER TABLE experiment_jobs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
            ALTER TABLE experiment_jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

            ALTER TABLE experiment_results ADD COLUMN IF NOT EXISTS example_id TEXT;
            ALTER TABLE experiment_results ADD COLUMN IF NOT EXISTS actual_output JSONB;
            ALTER TABLE experiment_results ADD COLUMN IF NOT EXISTS trace_id TEXT;
            ALTER TABLE experiment_results ADD COLUMN IF NOT EXISTS scores JSONB NOT NULL DEFAULT '[]';
            ALTER TABLE experiment_results ADD COLUMN IF NOT EXISTS latency_ms INT;
            ALTER TABLE experiment_results ADD COLUMN IF NOT EXISTS error TEXT;
            ALTER TABLE experiment_results ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

            DELETE FROM experiment_results older
            USING experiment_results newer
            WHERE older.experiment_id = newer.experiment_id
              AND older.example_id IS NOT NULL
              AND newer.example_id IS NOT NULL
              AND older.example_id = newer.example_id
              AND (
                    older.created_at < newer.created_at
                    OR (older.created_at = newer.created_at AND older.id < newer.id)
                );

            CREATE INDEX IF NOT EXISTS idx_evaluators_project ON evaluators(project_id);
            CREATE INDEX IF NOT EXISTS idx_prompts_project ON prompts(project_id, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt ON prompt_versions(prompt_id, version DESC);
            CREATE INDEX IF NOT EXISTS idx_experiments_project ON experiments(project_id);
            CREATE INDEX IF NOT EXISTS idx_experiments_status ON experiments(status);
            CREATE INDEX IF NOT EXISTS idx_experiment_jobs_status ON experiment_jobs(status, created_at);
            CREATE INDEX IF NOT EXISTS idx_experiment_baselines_experiment ON experiment_baselines(experiment_id);
            CREATE INDEX IF NOT EXISTS idx_experiment_results_exp ON experiment_results(experiment_id);
            CREATE UNIQUE INDEX IF NOT EXISTS uq_experiment_results_example
                ON experiment_results(experiment_id, example_id)
                WHERE example_id IS NOT NULL;
            """
        )

        await conn.execute(
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_name = 'experiments' AND column_name = 'target_url'
                ) THEN
                    UPDATE experiments
                    SET
                        target_config = CASE
                            WHEN target_config = '{}'::jsonb OR target_config IS NULL THEN
                                jsonb_build_object(
                                    'url', target_url,
                                    'headers', COALESCE(target_headers, '{}'::jsonb),
                                    'body_template', COALESCE(target_body_template, '{"input": {{inputs.input}}}')
                                )
                            ELSE target_config
                        END,
                        evaluator_configs = CASE
                            WHEN evaluator_configs = '[]'::jsonb OR evaluator_configs IS NULL THEN
                                COALESCE(evaluator_ids, '[]'::jsonb)
                            ELSE evaluator_configs
                        END,
                        run_config = CASE
                            WHEN run_config = '{}'::jsonb OR run_config IS NULL THEN
                                jsonb_build_object('concurrency', COALESCE(concurrency, 5))
                            ELSE run_config
                        END
                    WHERE
                        (target_config = '{}'::jsonb OR target_config IS NULL)
                        OR (evaluator_configs = '[]'::jsonb OR evaluator_configs IS NULL)
                        OR (run_config = '{}'::jsonb OR run_config IS NULL);
                END IF;

                IF EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_name = 'experiment_results' AND column_name = 'target_output'
                ) THEN
                    UPDATE experiment_results
                    SET
                        actual_output = COALESCE(actual_output, target_output),
                        latency_ms = COALESCE(latency_ms, target_latency_ms),
                        scores = CASE
                            WHEN scores = '[]'::jsonb OR scores IS NULL THEN COALESCE(eval_results, '[]'::jsonb)
                            ELSE scores
                        END
                    WHERE
                        actual_output IS NULL
                        OR latency_ms IS NULL
                        OR scores = '[]'::jsonb
                        OR scores IS NULL;
                END IF;
            END $$;
            """
        )
