package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
)

// Trace is the ClickHouse row model for the traces table.
type Trace struct {
	TraceID       string
	ProjectID     string
	Name          string
	Status        string
	StartTime     time.Time
	EndTime       time.Time
	DurationMs    uint64
	TotalTokens   uint32
	TotalCostUSD  float64
	SpanCount     uint16
	Tags          []string
	Metadata      string
	InputPreview  string
	OutputPreview string
	PayloadKey    string
	CreatedAt     time.Time
}

// Span is the ClickHouse row model for the spans table.
type Span struct {
	SpanID        string
	TraceID       string
	ParentSpanID  *string
	ProjectID     string
	Name          string
	SpanType      string
	Status        string
	StartTime     time.Time
	EndTime       time.Time
	DurationMs    uint64
	Model         *string
	TokenInput    uint32
	TokenOutput   uint32
	CostUSD       float64
	ErrorMessage  *string
	InputPreview  string
	OutputPreview string
	PayloadKey    string
	Metadata      string
	CreatedAt     time.Time
}

type ClickHouseRepo struct {
	conn driver.Conn
}

func NewClickHouseRepo(addr, database, username, password string) (*ClickHouseRepo, error) {
	conn, err := openConn(addr, database, username, password)
	if err != nil {
		return nil, fmt.Errorf("clickhouse open: %w", err)
	}
	if err := conn.Ping(context.Background()); err != nil {
		if database == "" {
			return nil, fmt.Errorf("clickhouse ping: %w", err)
		}
		adminConn, adminErr := openConn(addr, "default", username, password)
		if adminErr != nil {
			return nil, fmt.Errorf("clickhouse admin open: %w", adminErr)
		}
		defer adminConn.Close()
		if pingErr := adminConn.Ping(context.Background()); pingErr != nil {
			return nil, fmt.Errorf("clickhouse admin ping: %w", pingErr)
		}
		if execErr := adminConn.Exec(context.Background(), fmt.Sprintf("CREATE DATABASE IF NOT EXISTS %s", database)); execErr != nil {
			return nil, fmt.Errorf("clickhouse create database: %w", execErr)
		}
		_ = conn.Close()
		conn, err = openConn(addr, database, username, password)
		if err != nil {
			return nil, fmt.Errorf("clickhouse reopen: %w", err)
		}
		if pingErr := conn.Ping(context.Background()); pingErr != nil {
			return nil, fmt.Errorf("clickhouse ping after create: %w", pingErr)
		}
	}
	repo := &ClickHouseRepo{conn: conn}
	if err := repo.ensureSchema(context.Background()); err != nil {
		return nil, err
	}
	return repo, nil
}

func openConn(addr, database, username, password string) (driver.Conn, error) {
	return clickhouse.Open(&clickhouse.Options{
		Addr: []string{addr},
		Auth: clickhouse.Auth{
			Database: database,
			Username: username,
			Password: password,
		},
		Settings: clickhouse.Settings{
			"max_execution_time": 60,
		},
		DialTimeout: 5 * time.Second,
		ReadTimeout: 30 * time.Second,
	})
}

func (r *ClickHouseRepo) Close() error {
	return r.conn.Close()
}

func (r *ClickHouseRepo) ensureSchema(ctx context.Context) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS traces (
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
		TTL start_time + INTERVAL 90 DAY`,
		`CREATE TABLE IF NOT EXISTS spans (
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
		TTL start_time + INTERVAL 90 DAY`,
		`CREATE TABLE IF NOT EXISTS scores (
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
		ORDER BY (project_id, trace_id, evaluator_name, created_at)`,
		`CREATE TABLE IF NOT EXISTS trace_feedback (
			trace_id    String,
			project_id  String,
			score       Nullable(Float64),
			comment     String,
			tags        Array(String),
			created_at  DateTime64(3) DEFAULT now64(3)
		) ENGINE = MergeTree()
		PARTITION BY toYYYYMM(created_at)
		ORDER BY (project_id, created_at, trace_id)`,
		`CREATE MATERIALIZED VIEW IF NOT EXISTS trace_stats_hourly
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
		FROM traces
		GROUP BY project_id, hour`,
		`CREATE MATERIALIZED VIEW IF NOT EXISTS span_stats_by_model
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
		FROM spans
		WHERE span_type = 'llm' AND model IS NOT NULL
		GROUP BY project_id, model, hour`,
	}
	for _, statement := range statements {
		if err := r.conn.Exec(ctx, statement); err != nil {
			return fmt.Errorf("ensure clickhouse schema: %w", err)
		}
	}
	return nil
}

// InsertTrace inserts a single trace row.
func (r *ClickHouseRepo) InsertTrace(ctx context.Context, t Trace) error {
	return r.conn.Exec(ctx, `INSERT INTO traces (
		trace_id, project_id, name, status, start_time, end_time,
		duration_ms, total_tokens, total_cost_usd, span_count,
		tags, metadata, input_preview, output_preview, payload_key, created_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		t.TraceID, t.ProjectID, t.Name, t.Status, t.StartTime, t.EndTime,
		t.DurationMs, t.TotalTokens, t.TotalCostUSD, t.SpanCount,
		t.Tags, t.Metadata, t.InputPreview, t.OutputPreview, t.PayloadKey, t.CreatedAt,
	)
}

// InsertSpans batch-inserts spans.
func (r *ClickHouseRepo) InsertSpans(ctx context.Context, spans []Span) error {
	batch, err := r.conn.PrepareBatch(ctx, `INSERT INTO spans (
		span_id, trace_id, parent_span_id, project_id, name, span_type,
		status, start_time, end_time, duration_ms, model, token_input, token_output,
		cost_usd, error_message, input_preview, output_preview, payload_key, metadata, created_at
	)`)
	if err != nil {
		return fmt.Errorf("prepare batch spans: %w", err)
	}
	for _, s := range spans {
		if err := batch.Append(
			s.SpanID, s.TraceID, s.ParentSpanID, s.ProjectID, s.Name, s.SpanType,
			s.Status, s.StartTime, s.EndTime, s.DurationMs, s.Model, s.TokenInput, s.TokenOutput,
			s.CostUSD, s.ErrorMessage, s.InputPreview, s.OutputPreview, s.PayloadKey, s.Metadata, s.CreatedAt,
		); err != nil {
			return fmt.Errorf("append span %s: %w", s.SpanID, err)
		}
	}
	return batch.Send()
}
