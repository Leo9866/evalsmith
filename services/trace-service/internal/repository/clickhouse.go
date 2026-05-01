package repository

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"

	"github.com/evalsmith/trace-service/internal/model"
)

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
		`CREATE TABLE IF NOT EXISTS trace_feedback_actions (
			id               String,
			project_id       String,
			trace_id         String,
			action_type      String,
			source_type      String,
			source_ref_id    String,
			target_type      String,
			target_id        String,
			target_version   Nullable(Int32),
			status           String,
			request_payload  String,
			result_payload   String,
			error_message    String,
			created_by       String,
			created_at       DateTime64(3),
			updated_at       DateTime64(3)
		) ENGINE = ReplacingMergeTree(updated_at)
		PARTITION BY toYYYYMM(created_at)
		ORDER BY (project_id, trace_id, id)`,
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

// InsertTraces batch-inserts traces into ClickHouse.
func (r *ClickHouseRepo) InsertTraces(ctx context.Context, traces []model.Trace) error {
	batch, err := r.conn.PrepareBatch(ctx, `INSERT INTO traces (
		trace_id, project_id, name, status, start_time, end_time,
		duration_ms, total_tokens, total_cost_usd, span_count,
		tags, metadata, input_preview, output_preview, payload_key, created_at
	)`)
	if err != nil {
		return fmt.Errorf("prepare batch traces: %w", err)
	}
	for _, t := range traces {
		if err := batch.Append(
			t.TraceID, t.ProjectID, t.Name, t.Status, t.StartTime, t.EndTime,
			t.DurationMs, t.TotalTokens, t.TotalCostUSD, t.SpanCount,
			t.Tags, t.Metadata, t.InputPreview, t.OutputPreview, t.PayloadKey, t.CreatedAt,
		); err != nil {
			return fmt.Errorf("append trace %s: %w", t.TraceID, err)
		}
	}
	return batch.Send()
}

// InsertSpans batch-inserts spans into ClickHouse.
func (r *ClickHouseRepo) InsertSpans(ctx context.Context, spans []model.Span) error {
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

func (r *ClickHouseRepo) UpsertAction(ctx context.Context, action *model.TraceFeedbackAction) error {
	batch, err := r.conn.PrepareBatch(ctx, `INSERT INTO trace_feedback_actions (
		id, project_id, trace_id, action_type, source_type, source_ref_id,
		target_type, target_id, target_version, status, request_payload,
		result_payload, error_message, created_by, created_at, updated_at
	)`)
	if err != nil {
		return fmt.Errorf("prepare batch actions: %w", err)
	}

	var targetVersion any
	if action.TargetVersion != nil {
		targetVersion = int32(*action.TargetVersion)
	}

	if err := batch.Append(
		action.ID,
		action.ProjectID,
		action.TraceID,
		action.ActionType,
		action.SourceType,
		action.SourceRefID,
		action.TargetType,
		action.TargetID,
		targetVersion,
		action.Status,
		string(action.RequestPayload),
		string(action.ResultPayload),
		action.ErrorMessage,
		action.CreatedBy,
		action.CreatedAt,
		action.UpdatedAt,
	); err != nil {
		return fmt.Errorf("append action %s: %w", action.ID, err)
	}
	return batch.Send()
}

func (r *ClickHouseRepo) GetAction(ctx context.Context, projectID, actionID string) (*model.TraceFeedbackAction, error) {
	row := r.conn.QueryRow(ctx, `
		SELECT
			id, project_id, trace_id, action_type, source_type, source_ref_id,
			target_type, target_id, target_version, status, request_payload,
			result_payload, error_message, created_by, created_at, updated_at
		FROM trace_feedback_actions FINAL
		WHERE project_id = ? AND id = ?
		LIMIT 1
	`, projectID, actionID)
	return scanAction(row)
}

func (r *ClickHouseRepo) ListTraceActions(ctx context.Context, projectID, traceID string) ([]model.TraceFeedbackAction, error) {
	rows, err := r.conn.Query(ctx, `
		SELECT
			id, project_id, trace_id, action_type, source_type, source_ref_id,
			target_type, target_id, target_version, status, request_payload,
			result_payload, error_message, created_by, created_at, updated_at
		FROM trace_feedback_actions FINAL
		WHERE project_id = ? AND trace_id = ?
		ORDER BY created_at DESC, updated_at DESC
	`, projectID, traceID)
	if err != nil {
		return nil, fmt.Errorf("query trace actions: %w", err)
	}
	defer rows.Close()

	items := make([]model.TraceFeedbackAction, 0)
	for rows.Next() {
		action, err := scanAction(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, *action)
	}
	return items, nil
}

// ListTraces queries traces with pagination and filters.
func (r *ClickHouseRepo) ListTraces(ctx context.Context, projectID string, q model.TraceListQuery) (*model.TraceListResult, error) {
	var conditions []string
	var args []interface{}

	conditions = append(conditions, "project_id = ?")
	args = append(args, projectID)

	if q.StartTime != "" {
		conditions = append(conditions, "start_time >= ?")
		t, _ := time.Parse(time.RFC3339, q.StartTime)
		args = append(args, t)
	}
	if q.EndTime != "" {
		conditions = append(conditions, "start_time <= ?")
		t, _ := time.Parse(time.RFC3339, q.EndTime)
		args = append(args, t)
	}
	if q.Status != "" {
		conditions = append(conditions, "status = ?")
		args = append(args, q.Status)
	}
	if q.Tags != "" {
		tagList := strings.Split(q.Tags, ",")
		for _, tag := range tagList {
			conditions = append(conditions, "has(tags, ?)")
			args = append(args, strings.TrimSpace(tag))
		}
	}
	if q.MinDurationMs != nil {
		conditions = append(conditions, "duration_ms >= ?")
		args = append(args, *q.MinDurationMs)
	}
	if q.MaxDurationMs != nil {
		conditions = append(conditions, "duration_ms <= ?")
		args = append(args, *q.MaxDurationMs)
	}
	if search := strings.TrimSpace(q.Search); search != "" {
		conditions = append(conditions, `(
			positionCaseInsensitiveUTF8(trace_id, ?) > 0 OR
			positionCaseInsensitiveUTF8(name, ?) > 0 OR
			positionCaseInsensitiveUTF8(input_preview, ?) > 0 OR
			positionCaseInsensitiveUTF8(output_preview, ?) > 0 OR
			positionCaseInsensitiveUTF8(metadata, ?) > 0 OR
			arrayExists(tag -> positionCaseInsensitiveUTF8(tag, ?) > 0, tags)
		)`)
		for range 6 {
			args = append(args, search)
		}
	}

	where := strings.Join(conditions, " AND ")

	// Count total.
	var total uint64
	countQuery := fmt.Sprintf("SELECT count() FROM traces WHERE %s", where)
	if err := r.conn.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count traces: %w", err)
	}

	// Validate sort column against allowlist to prevent injection.
	sortCol := "start_time"
	switch q.SortBy {
	case "start_time", "duration_ms", "total_tokens", "total_cost_usd":
		sortCol = q.SortBy
	}
	sortDir := "DESC"
	if q.SortOrder == "asc" {
		sortDir = "ASC"
	}

	offset := (q.Page - 1) * q.PageSize
	dataQuery := fmt.Sprintf(`SELECT
		trace_id, project_id, name, status, start_time, end_time,
		duration_ms, total_tokens, total_cost_usd, span_count,
		tags, metadata, input_preview, output_preview, payload_key, created_at
		FROM traces WHERE %s ORDER BY %s %s LIMIT ? OFFSET ?`,
		where, sortCol, sortDir)

	dataArgs := append(args, q.PageSize, offset)
	rows, err := r.conn.Query(ctx, dataQuery, dataArgs...)
	if err != nil {
		return nil, fmt.Errorf("query traces: %w", err)
	}
	defer rows.Close()

	var traces []model.Trace
	for rows.Next() {
		var t model.Trace
		if err := rows.Scan(
			&t.TraceID, &t.ProjectID, &t.Name, &t.Status, &t.StartTime, &t.EndTime,
			&t.DurationMs, &t.TotalTokens, &t.TotalCostUSD, &t.SpanCount,
			&t.Tags, &t.Metadata, &t.InputPreview, &t.OutputPreview, &t.PayloadKey, &t.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan trace: %w", err)
		}
		traces = append(traces, t)
	}

	return &model.TraceListResult{
		Traces:   traces,
		Total:    total,
		Page:     q.Page,
		PageSize: q.PageSize,
	}, nil
}

func scanAction(scanner interface {
	Scan(dest ...any) error
}) (*model.TraceFeedbackAction, error) {
	action := &model.TraceFeedbackAction{}
	var (
		targetVersion sql.NullInt32
		requestJSON   string
		resultJSON    string
	)
	if err := scanner.Scan(
		&action.ID,
		&action.ProjectID,
		&action.TraceID,
		&action.ActionType,
		&action.SourceType,
		&action.SourceRefID,
		&action.TargetType,
		&action.TargetID,
		&targetVersion,
		&action.Status,
		&requestJSON,
		&resultJSON,
		&action.ErrorMessage,
		&action.CreatedBy,
		&action.CreatedAt,
		&action.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if targetVersion.Valid {
		value := int(targetVersion.Int32)
		action.TargetVersion = &value
	}
	action.RequestPayload = model.JSON(requestJSON)
	action.ResultPayload = model.JSON(resultJSON)
	return action, nil
}

// GetTrace retrieves a single trace by ID.
func (r *ClickHouseRepo) GetTrace(ctx context.Context, projectID, traceID string) (*model.Trace, error) {
	var t model.Trace
	err := r.conn.QueryRow(ctx, `SELECT
		trace_id, project_id, name, status, start_time, end_time,
		duration_ms, total_tokens, total_cost_usd, span_count,
		tags, metadata, input_preview, output_preview, payload_key, created_at
		FROM traces WHERE project_id = ? AND trace_id = ?`, projectID, traceID).Scan(
		&t.TraceID, &t.ProjectID, &t.Name, &t.Status, &t.StartTime, &t.EndTime,
		&t.DurationMs, &t.TotalTokens, &t.TotalCostUSD, &t.SpanCount,
		&t.Tags, &t.Metadata, &t.InputPreview, &t.OutputPreview, &t.PayloadKey, &t.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// GetSpansByTraceID retrieves all spans for a trace.
func (r *ClickHouseRepo) GetSpansByTraceID(ctx context.Context, projectID, traceID string) ([]model.Span, error) {
	rows, err := r.conn.Query(ctx, `SELECT
		span_id, trace_id, parent_span_id, project_id, name, span_type,
		status, start_time, end_time, duration_ms, model, token_input, token_output,
		cost_usd, error_message, input_preview, output_preview, payload_key, metadata, created_at
		FROM spans WHERE project_id = ? AND trace_id = ? ORDER BY start_time ASC`,
		projectID, traceID)
	if err != nil {
		return nil, fmt.Errorf("query spans: %w", err)
	}
	defer rows.Close()

	var spans []model.Span
	for rows.Next() {
		var s model.Span
		if err := rows.Scan(
			&s.SpanID, &s.TraceID, &s.ParentSpanID, &s.ProjectID, &s.Name, &s.SpanType,
			&s.Status, &s.StartTime, &s.EndTime, &s.DurationMs, &s.Model, &s.TokenInput, &s.TokenOutput,
			&s.CostUSD, &s.ErrorMessage, &s.InputPreview, &s.OutputPreview, &s.PayloadKey, &s.Metadata, &s.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan span: %w", err)
		}
		spans = append(spans, s)
	}
	return spans, nil
}

// GetStats returns aggregated trace statistics for a time period.
func (r *ClickHouseRepo) GetStats(ctx context.Context, projectID, period string) (*model.TraceStats, error) {
	var interval string
	switch period {
	case "1h":
		interval = "1 HOUR"
	case "24h":
		interval = "24 HOUR"
	case "7d":
		interval = "7 DAY"
	case "30d":
		interval = "30 DAY"
	default:
		interval = "24 HOUR"
	}

	query := fmt.Sprintf(`SELECT
		count() AS trace_count,
		countIf(status = 'error') AS error_count,
		avg(duration_ms) AS avg_duration,
		quantile(0.5)(duration_ms) AS p50_duration,
		quantile(0.95)(duration_ms) AS p95_duration,
		quantile(0.99)(duration_ms) AS p99_duration,
		sum(total_tokens) AS total_tokens,
		sum(total_cost_usd) AS total_cost
		FROM traces
		WHERE project_id = ? AND start_time >= now() - INTERVAL %s`, interval)

	var stats model.TraceStats
	err := r.conn.QueryRow(ctx, query, projectID).Scan(
		&stats.TraceCount, &stats.ErrorCount, &stats.AvgDuration,
		&stats.P50Duration, &stats.P95Duration, &stats.P99Duration,
		&stats.TotalTokens, &stats.TotalCostUSD,
	)
	if err != nil {
		return nil, fmt.Errorf("query stats: %w", err)
	}
	return &stats, nil
}

// InsertFeedback inserts user feedback for a trace.
func (r *ClickHouseRepo) InsertFeedback(ctx context.Context, fb model.Feedback) error {
	return r.conn.Exec(ctx, `INSERT INTO trace_feedback (
		trace_id, project_id, score, comment, tags, created_at
	) VALUES (?, ?, ?, ?, ?, ?)`,
		fb.TraceID, fb.ProjectID, fb.Score, fb.Comment, fb.Tags, fb.CreatedAt,
	)
}
