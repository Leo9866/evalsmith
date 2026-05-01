-- EvalSmith PostgreSQL Schema
-- Projects, API Keys, Datasets, Examples, Evaluators, Experiments

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ========== Users ==========
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY DEFAULT 'usr_' || gen_random_uuid()::text,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========== User Sessions ==========
CREATE TABLE IF NOT EXISTS user_sessions (
    id            TEXT PRIMARY KEY DEFAULT 'sess_' || gen_random_uuid()::text,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash    TEXT NOT NULL UNIQUE,
    expires_at    TIMESTAMPTZ NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);

-- ========== Projects ==========
CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY DEFAULT 'proj_' || gen_random_uuid()::text,
    name        TEXT NOT NULL,
    description TEXT DEFAULT '',
    llm_config  JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS llm_config JSONB NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS project_model_configs (
    id                 TEXT PRIMARY KEY,
    project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name               TEXT NOT NULL,
    provider           TEXT NOT NULL DEFAULT 'openai_compatible',
    protocol           TEXT NOT NULL DEFAULT 'openai',
    base_url           TEXT NOT NULL DEFAULT '',
    model              TEXT NOT NULL,
    api_key_ciphertext TEXT NOT NULL DEFAULT '',
    api_key_masked     TEXT NOT NULL DEFAULT '',
    extra_config       JSONB NOT NULL DEFAULT '{}'::jsonb,
    capabilities       JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_default_judge   BOOLEAN NOT NULL DEFAULT FALSE,
    status             TEXT NOT NULL DEFAULT 'active',
    created_by         TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_model_configs_project_name
    ON project_model_configs(project_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_model_configs_default_judge
    ON project_model_configs(project_id)
    WHERE is_default_judge = TRUE AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_project_model_configs_project_updated
    ON project_model_configs(project_id, updated_at DESC);

-- ========== Project Members ==========
CREATE TABLE IF NOT EXISTS project_members (
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'developer',
    added_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);

-- ========== API Keys ==========
CREATE TABLE IF NOT EXISTS api_keys (
    id          TEXT PRIMARY KEY DEFAULT 'ak_' || gen_random_uuid()::text,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    key_hash    TEXT NOT NULL UNIQUE,
    key_prefix  TEXT NOT NULL,          -- "ae_prod_sk_xxxx" first 12 chars for display
    name        TEXT NOT NULL DEFAULT 'Default',
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_project ON api_keys(project_id);

-- ========== Datasets ==========
CREATE TABLE IF NOT EXISTS datasets (
    id              TEXT PRIMARY KEY DEFAULT 'ds_' || gen_random_uuid()::text,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT DEFAULT '',
    schema_def      JSONB DEFAULT '{}',
    current_version INT NOT NULL DEFAULT 1,
    example_count   INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_datasets_project ON datasets(project_id);

-- ========== Dataset Versions ==========
CREATE TABLE IF NOT EXISTS dataset_versions (
    id          TEXT PRIMARY KEY DEFAULT 'dsv_' || gen_random_uuid()::text,
    dataset_id  TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    version     INT NOT NULL,
    description TEXT DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(dataset_id, version)
);

CREATE TABLE IF NOT EXISTS dataset_version_snapshots (
    dataset_id    TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    version       INT NOT NULL,
    example_count INT NOT NULL DEFAULT 0,
    examples      JSONB NOT NULL DEFAULT '[]',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (dataset_id, version)
);

-- ========== Examples ==========
CREATE TABLE IF NOT EXISTS examples (
    id              TEXT PRIMARY KEY DEFAULT 'ex_' || gen_random_uuid()::text,
    dataset_id      TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    inputs          JSONB NOT NULL,
    expected_outputs JSONB DEFAULT '{}',
    metadata        JSONB DEFAULT '{}',
    source          TEXT NOT NULL DEFAULT 'manual',  -- manual, import, trace_backfill, synthetic
    split           TEXT DEFAULT 'default',           -- default, train, test, validation
    version_added   INT NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_examples_dataset ON examples(dataset_id);
CREATE INDEX IF NOT EXISTS idx_examples_split ON examples(dataset_id, split);
CREATE INDEX IF NOT EXISTS idx_dataset_version_snapshots_dataset ON dataset_version_snapshots(dataset_id, version);

-- ========== Evaluators ==========
CREATE TABLE IF NOT EXISTS evaluators (
    id          TEXT PRIMARY KEY DEFAULT 'ev_' || gen_random_uuid()::text,
    project_id  TEXT,                   -- NULL for built-in evaluators
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,          -- rule, llm_judge, code, statistical
    description TEXT DEFAULT '',
    config      JSONB NOT NULL DEFAULT '{}',
    is_builtin  BOOLEAN NOT NULL DEFAULT false,
    version     INT NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evaluators_project ON evaluators(project_id);
CREATE INDEX IF NOT EXISTS idx_evaluators_builtin ON evaluators(is_builtin);

-- ========== Experiments ==========
CREATE TABLE IF NOT EXISTS experiments (
    id              TEXT PRIMARY KEY DEFAULT 'exp_' || gen_random_uuid()::text,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT DEFAULT '',
    dataset_id      TEXT NOT NULL REFERENCES datasets(id),
    dataset_version INT,
    split           TEXT DEFAULT 'default',
    status          TEXT NOT NULL DEFAULT 'pending', -- pending, running, completed, failed
    target_config   JSONB NOT NULL DEFAULT '{}',
    evaluator_configs JSONB NOT NULL DEFAULT '[]',
    run_config      JSONB NOT NULL DEFAULT '{}',
    summary         JSONB DEFAULT '{}',
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_experiments_project ON experiments(project_id);
CREATE INDEX IF NOT EXISTS idx_experiments_status ON experiments(status);

-- ========== Experiment Jobs ==========
CREATE TABLE IF NOT EXISTS experiment_jobs (
    id              TEXT PRIMARY KEY DEFAULT 'job_' || gen_random_uuid()::text,
    experiment_id   TEXT NOT NULL UNIQUE REFERENCES experiments(id) ON DELETE CASCADE,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    payload         JSONB NOT NULL DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'pending', -- pending, running, completed, failed, cancel_requested, canceled
    attempts        INT NOT NULL DEFAULT 0,
    max_attempts    INT NOT NULL DEFAULT 3,
    last_error      TEXT,
    locked_by       TEXT,
    locked_at       TIMESTAMPTZ,
    started_at      TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_experiment_jobs_status ON experiment_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_experiment_jobs_project ON experiment_jobs(project_id);

-- ========== Experiment Baselines ==========
CREATE TABLE IF NOT EXISTS experiment_baselines (
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    dataset_id      TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    experiment_id   TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, dataset_id)
);

CREATE INDEX IF NOT EXISTS idx_experiment_baselines_experiment ON experiment_baselines(experiment_id);

-- ========== Experiment Results ==========
CREATE TABLE IF NOT EXISTS experiment_results (
    id              TEXT PRIMARY KEY DEFAULT 'er_' || gen_random_uuid()::text,
    experiment_id   TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    example_id      TEXT NOT NULL REFERENCES examples(id),
    actual_output   JSONB,
    trace_id        TEXT,
    scores          JSONB NOT NULL DEFAULT '[]',
    latency_ms      INT,
    error           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exp_results_experiment ON experiment_results(experiment_id);

-- ========== Annotation Tasks ==========
CREATE TABLE IF NOT EXISTS annotation_tasks (
    id               TEXT PRIMARY KEY DEFAULT 'ann_' || gen_random_uuid()::text,
    project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_type      TEXT NOT NULL DEFAULT 'trace', -- trace, experiment_result
    source_id        TEXT NOT NULL,
    mode             TEXT NOT NULL DEFAULT 'single_run', -- single_run, pairwise
    status           TEXT NOT NULL DEFAULT 'pending', -- pending, in_progress, completed
    trace_id         TEXT,
    experiment_id    TEXT,
    example_id       TEXT,
    input_payload    JSONB NOT NULL DEFAULT '{}',
    candidate_output JSONB,
    reference_output JSONB,
    metadata         JSONB NOT NULL DEFAULT '{}',
    annotation       JSONB NOT NULL DEFAULT '{}',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_annotation_tasks_project ON annotation_tasks(project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_annotation_tasks_trace ON annotation_tasks(trace_id);

-- ========== Monitoring Rules ==========
CREATE TABLE IF NOT EXISTS monitor_rules (
    id                 TEXT PRIMARY KEY DEFAULT 'mon_' || gen_random_uuid()::text,
    project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name               TEXT NOT NULL,
    description        TEXT DEFAULT '',
    status             TEXT NOT NULL DEFAULT 'active', -- active, paused
    sampling_rate      DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    evaluator_ids      JSONB NOT NULL DEFAULT '[]',
    threshold          DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    severity           TEXT NOT NULL DEFAULT 'warning', -- info, warning, critical
    backfill_dataset_id TEXT,
    backfill_split     TEXT NOT NULL DEFAULT 'regression',
    auto_annotation    BOOLEAN NOT NULL DEFAULT false,
    guardrail_config   JSONB NOT NULL DEFAULT '{}',
    last_checked_at    TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_monitor_rules_project ON monitor_rules(project_id, status, updated_at DESC);

-- ========== Monitoring Runs ==========
CREATE TABLE IF NOT EXISTS monitor_runs (
    id                 TEXT PRIMARY KEY DEFAULT 'mrun_' || gen_random_uuid()::text,
    rule_id            TEXT NOT NULL REFERENCES monitor_rules(id) ON DELETE CASCADE,
    project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    trace_id           TEXT NOT NULL,
    trace_status       TEXT DEFAULT 'ok',
    avg_score          DOUBLE PRECISION,
    evaluator_scores   JSONB NOT NULL DEFAULT '[]',
    guardrail_hits     JSONB NOT NULL DEFAULT '[]',
    alert_triggered    BOOLEAN NOT NULL DEFAULT false,
    dataset_backfilled BOOLEAN NOT NULL DEFAULT false,
    annotation_created BOOLEAN NOT NULL DEFAULT false,
    error_message      TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(rule_id, trace_id)
);

CREATE INDEX IF NOT EXISTS idx_monitor_runs_rule ON monitor_runs(rule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_monitor_runs_project ON monitor_runs(project_id, created_at DESC);

-- ========== Monitoring Alerts ==========
CREATE TABLE IF NOT EXISTS monitor_alerts (
    id             TEXT PRIMARY KEY DEFAULT 'alert_' || gen_random_uuid()::text,
    rule_id        TEXT NOT NULL REFERENCES monitor_rules(id) ON DELETE CASCADE,
    run_id         TEXT REFERENCES monitor_runs(id) ON DELETE SET NULL,
    project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    trace_id       TEXT,
    kind           TEXT NOT NULL DEFAULT 'score', -- score, trace_error, guardrail
    severity       TEXT NOT NULL DEFAULT 'warning',
    status         TEXT NOT NULL DEFAULT 'open', -- open, resolved
    title          TEXT NOT NULL,
    summary        TEXT DEFAULT '',
    details        JSONB NOT NULL DEFAULT '{}',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_monitor_alerts_project ON monitor_alerts(project_id, status, created_at DESC);

-- ========== Seed default project ==========
INSERT INTO projects (id, name, description) VALUES
    ('proj_default', 'Default Project', 'Default project for getting started')
ON CONFLICT (id) DO NOTHING;
