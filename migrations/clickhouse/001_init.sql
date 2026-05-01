-- EvalSmith ClickHouse Schema

CREATE DATABASE IF NOT EXISTS evalsmith;

-- Trace 主表
CREATE TABLE IF NOT EXISTS evalsmith.traces (
    trace_id          String,
    project_id        String,
    name              String,
    status            Enum8('ok' = 0, 'error' = 1),
    start_time        DateTime64(3),
    end_time          DateTime64(3),
    duration_ms       UInt64,
    total_tokens      UInt32,
    total_cost_usd    Float64,
    span_count        UInt16,
    tags              Array(String),
    metadata          String,
    input_preview     String,
    output_preview    String,
    payload_key       String,
    created_at        DateTime64(3) DEFAULT now64(3)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(start_time)
ORDER BY (project_id, start_time, trace_id)
TTL toDateTime(start_time) + INTERVAL 90 DAY;

-- Span 主表
CREATE TABLE IF NOT EXISTS evalsmith.spans (
    span_id           String,
    trace_id          String,
    parent_span_id    Nullable(String),
    project_id        String,
    name              String,
    span_type         Enum8('llm'=0, 'tool'=1, 'retrieval'=2, 'chain'=3, 'agent'=4, 'custom'=5),
    status            Enum8('ok' = 0, 'error' = 1),
    start_time        DateTime64(3),
    end_time          DateTime64(3),
    duration_ms       UInt64,
    model             Nullable(String),
    token_input       UInt32 DEFAULT 0,
    token_output      UInt32 DEFAULT 0,
    cost_usd          Float64 DEFAULT 0,
    error_message     Nullable(String),
    input_preview     String,
    output_preview    String,
    payload_key       String,
    metadata          String,
    created_at        DateTime64(3) DEFAULT now64(3)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(start_time)
ORDER BY (project_id, trace_id, start_time, span_id)
TTL toDateTime(start_time) + INTERVAL 90 DAY;

-- 评分表
CREATE TABLE IF NOT EXISTS evalsmith.scores (
    score_id          String,
    trace_id          String,
    span_id           Nullable(String),
    project_id        String,
    evaluator_name    String,
    score_value       Float64,
    reasoning         Nullable(String),
    source            Enum8('online_eval'=0, 'experiment'=1, 'annotation'=2, 'user_feedback'=3),
    evaluator_type    Enum8('rule'=0, 'llm_judge'=1, 'code'=2, 'statistical'=3, 'human'=4),
    metadata          String,
    created_at        DateTime64(3) DEFAULT now64(3)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (project_id, trace_id, evaluator_name, created_at);

-- 用户反馈表
CREATE TABLE IF NOT EXISTS evalsmith.trace_feedback (
    trace_id          String,
    project_id        String,
    score             Nullable(Float64),
    comment           String,
    tags              Array(String),
    created_at        DateTime64(3) DEFAULT now64(3)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (project_id, created_at, trace_id);

-- 物化视图：按小时聚合 Trace 统计
CREATE MATERIALIZED VIEW IF NOT EXISTS evalsmith.trace_stats_hourly
ENGINE = SummingMergeTree()
ORDER BY (project_id, hour)
AS SELECT
    project_id,
    toStartOfHour(start_time) AS hour,
    count() AS trace_count,
    countIf(status = 'error') AS error_count,
    avg(duration_ms) AS avg_duration,
    sum(total_tokens) AS total_tokens,
    sum(total_cost_usd) AS total_cost
FROM evalsmith.traces
GROUP BY project_id, hour;

-- 物化视图：按模型聚合 Span 统计
CREATE MATERIALIZED VIEW IF NOT EXISTS evalsmith.span_stats_by_model
ENGINE = SummingMergeTree()
ORDER BY (project_id, model, hour)
SETTINGS allow_nullable_key = 1
AS SELECT
    project_id,
    model,
    toStartOfHour(start_time) AS hour,
    count() AS call_count,
    avg(duration_ms) AS avg_duration,
    sum(token_input) AS total_input_tokens,
    sum(token_output) AS total_output_tokens,
    sum(cost_usd) AS total_cost
FROM evalsmith.spans
WHERE span_type = 'llm' AND model IS NOT NULL
GROUP BY project_id, model, hour;
