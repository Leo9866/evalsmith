package model

import (
	"time"
)

// --- Request/Response types ---

type BatchIngestRequest struct {
	Traces []TraceIngestItem `json:"traces" binding:"required,min=1,max=100,dive"`
}

type SpanBatchIngestRequest struct {
	TraceID  string           `json:"trace_id" binding:"required"`
	Name     string           `json:"name"`
	Tags     []string         `json:"tags"`
	Metadata JSON             `json:"metadata"`
	Spans    []SpanIngestItem `json:"spans" binding:"required,min=1,max=100,dive"`
}

type TraceIngestItem struct {
	TraceID  string           `json:"trace_id"`
	Name     string           `json:"name" binding:"required"`
	Tags     []string         `json:"tags"`
	Metadata JSON             `json:"metadata"`
	Spans    []SpanIngestItem `json:"spans" binding:"required,min=1,dive"`
}

type SpanIngestItem struct {
	SpanID       string  `json:"span_id"`
	ParentSpanID *string `json:"parent_span_id"`
	Name         string  `json:"name" binding:"required"`
	SpanType     string  `json:"span_type" binding:"required,oneof=llm tool retrieval chain agent custom"`
	Status       string  `json:"status" binding:"required,oneof=ok error"`
	StartTime    string  `json:"start_time" binding:"required"`
	EndTime      string  `json:"end_time" binding:"required"`
	Input        JSON    `json:"input"`
	Output       JSON    `json:"output"`
	Metrics      JSON    `json:"metrics"`
	Metadata     JSON    `json:"metadata"`
	Events       []JSON  `json:"events"`
}

type BatchIngestResponse struct {
	TraceIDs []string `json:"trace_ids"`
	Accepted int      `json:"accepted"`
}

type FeedbackRequest struct {
	Score   *float64 `json:"score" binding:"omitempty,min=0,max=1"`
	Comment string   `json:"comment"`
	Tags    []string `json:"tags"`
}

type TraceBackfillDatasetRequest struct {
	DatasetID   string   `json:"dataset_id" binding:"required"`
	TraceIDs    []string `json:"trace_ids" binding:"required,min=1,max=100"`
	Split       string   `json:"split"`
	SourceType  string   `json:"source_type"`
	SourceRefID string   `json:"source_ref_id"`
}

type TraceBackfillDatasetResponse struct {
	DatasetID  string                `json:"dataset_id"`
	TraceIDs   []string              `json:"trace_ids"`
	Added      int                   `json:"added"`
	NewVersion int                   `json:"new_version"`
	ExampleIDs []string              `json:"example_ids"`
	Actions    []TraceFeedbackAction `json:"actions"`
}

type TraceBackfillAnnotationRequest struct {
	TraceIDs    []string `json:"trace_ids" binding:"required,min=1,max=100"`
	Mode        string   `json:"mode"`
	SourceType  string   `json:"source_type"`
	SourceRefID string   `json:"source_ref_id"`
}

type TraceBackfillAnnotationResponse struct {
	TraceIDs []string              `json:"trace_ids"`
	Added    int                   `json:"added"`
	TaskIDs  []string              `json:"task_ids"`
	Actions  []TraceFeedbackAction `json:"actions"`
}

type TraceFeedbackAction struct {
	ID             string    `json:"id"`
	ProjectID      string    `json:"project_id"`
	TraceID        string    `json:"trace_id"`
	ActionType     string    `json:"action_type"`
	SourceType     string    `json:"source_type"`
	SourceRefID    string    `json:"source_ref_id"`
	TargetType     string    `json:"target_type"`
	TargetID       string    `json:"target_id"`
	TargetVersion  *int      `json:"target_version,omitempty"`
	Status         string    `json:"status"`
	RequestPayload JSON      `json:"request_payload,omitempty"`
	ResultPayload  JSON      `json:"result_payload,omitempty"`
	ErrorMessage   string    `json:"error_message"`
	CreatedBy      string    `json:"created_by"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// --- Query types ---

type TraceListQuery struct {
	Page          int    `form:"page" binding:"omitempty,min=1"`
	PageSize      int    `form:"page_size" binding:"omitempty,min=1,max=100"`
	StartTime     string `form:"start_time"`
	EndTime       string `form:"end_time"`
	Status        string `form:"status" binding:"omitempty,oneof=ok error"`
	Tags          string `form:"tags"`
	MinDurationMs *int64 `form:"min_duration_ms"`
	MaxDurationMs *int64 `form:"max_duration_ms"`
	Search        string `form:"search"`
	SortBy        string `form:"sort_by" binding:"omitempty,oneof=start_time duration_ms total_tokens total_cost_usd"`
	SortOrder     string `form:"sort_order" binding:"omitempty,oneof=asc desc"`
}

func (q *TraceListQuery) Defaults() {
	if q.Page <= 0 {
		q.Page = 1
	}
	if q.PageSize <= 0 {
		q.PageSize = 20
	}
	if q.SortBy == "" {
		q.SortBy = "start_time"
	}
	if q.SortOrder == "" {
		q.SortOrder = "desc"
	}
}

type StatsQuery struct {
	Period string `form:"period" binding:"omitempty,oneof=1h 24h 7d 30d"`
}

func (q *StatsQuery) Defaults() {
	if q.Period == "" {
		q.Period = "24h"
	}
}

// --- DB/Domain models ---

type Trace struct {
	TraceID       string    `json:"trace_id" ch:"trace_id"`
	ProjectID     string    `json:"project_id" ch:"project_id"`
	Name          string    `json:"name" ch:"name"`
	Status        string    `json:"status" ch:"status"`
	StartTime     time.Time `json:"start_time" ch:"start_time"`
	EndTime       time.Time `json:"end_time" ch:"end_time"`
	DurationMs    uint64    `json:"duration_ms" ch:"duration_ms"`
	TotalTokens   uint32    `json:"total_tokens" ch:"total_tokens"`
	TotalCostUSD  float64   `json:"total_cost_usd" ch:"total_cost_usd"`
	SpanCount     uint16    `json:"span_count" ch:"span_count"`
	Tags          []string  `json:"tags" ch:"tags"`
	Metadata      string    `json:"metadata" ch:"metadata"`
	InputPreview  string    `json:"input_preview" ch:"input_preview"`
	OutputPreview string    `json:"output_preview" ch:"output_preview"`
	PayloadKey    string    `json:"payload_key" ch:"payload_key"`
	CreatedAt     time.Time `json:"created_at" ch:"created_at"`
}

type Span struct {
	SpanID        string    `json:"span_id" ch:"span_id"`
	TraceID       string    `json:"trace_id" ch:"trace_id"`
	ParentSpanID  *string   `json:"parent_span_id" ch:"parent_span_id"`
	ProjectID     string    `json:"project_id" ch:"project_id"`
	Name          string    `json:"name" ch:"name"`
	SpanType      string    `json:"span_type" ch:"span_type"`
	Status        string    `json:"status" ch:"status"`
	StartTime     time.Time `json:"start_time" ch:"start_time"`
	EndTime       time.Time `json:"end_time" ch:"end_time"`
	DurationMs    uint64    `json:"duration_ms" ch:"duration_ms"`
	Model         *string   `json:"model" ch:"model"`
	TokenInput    uint32    `json:"token_input" ch:"token_input"`
	TokenOutput   uint32    `json:"token_output" ch:"token_output"`
	CostUSD       float64   `json:"cost_usd" ch:"cost_usd"`
	ErrorMessage  *string   `json:"error_message" ch:"error_message"`
	InputPreview  string    `json:"input_preview" ch:"input_preview"`
	OutputPreview string    `json:"output_preview" ch:"output_preview"`
	PayloadKey    string    `json:"payload_key" ch:"payload_key"`
	Metadata      string    `json:"metadata" ch:"metadata"`
	Input         JSON      `json:"input,omitempty"`
	Output        JSON      `json:"output,omitempty"`
	Metrics       JSON      `json:"metrics,omitempty"`
	MetadataJSON  JSON      `json:"metadata_json,omitempty"`
	Events        []JSON    `json:"events,omitempty"`
	CreatedAt     time.Time `json:"created_at" ch:"created_at"`
}

type SpanTree struct {
	Span
	Children []*SpanTree `json:"children"`
}

type TraceDetail struct {
	Trace
	Input        JSON        `json:"input,omitempty"`
	Output       JSON        `json:"output,omitempty"`
	MetadataJSON JSON        `json:"metadata_json,omitempty"`
	Spans        []*SpanTree `json:"spans"`
}

type TraceStats struct {
	TraceCount   uint64  `json:"trace_count" ch:"trace_count"`
	ErrorCount   uint64  `json:"error_count" ch:"error_count"`
	AvgDuration  float64 `json:"avg_duration_ms" ch:"avg_duration"`
	P50Duration  float64 `json:"p50_duration_ms" ch:"p50_duration"`
	P95Duration  float64 `json:"p95_duration_ms" ch:"p95_duration"`
	P99Duration  float64 `json:"p99_duration_ms" ch:"p99_duration"`
	TotalTokens  uint64  `json:"total_tokens" ch:"total_tokens"`
	TotalCostUSD float64 `json:"total_cost_usd" ch:"total_cost"`
}

type TraceListResult struct {
	Traces   []Trace `json:"traces"`
	Total    uint64  `json:"total"`
	Page     int     `json:"page"`
	PageSize int     `json:"page_size"`
}

type Feedback struct {
	TraceID   string    `json:"trace_id" ch:"trace_id"`
	ProjectID string    `json:"project_id" ch:"project_id"`
	Score     *float64  `json:"score" ch:"score"`
	Comment   string    `json:"comment" ch:"comment"`
	Tags      []string  `json:"tags" ch:"tags"`
	CreatedAt time.Time `json:"created_at" ch:"created_at"`
}

type TracePayloadEnvelope struct {
	ProjectID  string       `json:"project_id"`
	Trace      TracePayload `json:"trace"`
	IngestedAt string       `json:"ingested_at"`
}

type TracePayload struct {
	TraceID  string             `json:"trace_id"`
	Name     string             `json:"name"`
	Tags     []string           `json:"tags"`
	Metadata JSON               `json:"metadata"`
	Spans    []TracePayloadSpan `json:"spans"`
}

type TracePayloadSpan struct {
	SpanID       string  `json:"span_id"`
	ParentSpanID *string `json:"parent_span_id"`
	Name         string  `json:"name"`
	SpanType     string  `json:"span_type"`
	Status       string  `json:"status"`
	StartTime    string  `json:"start_time"`
	EndTime      string  `json:"end_time"`
	Input        JSON    `json:"input"`
	Output       JSON    `json:"output"`
	Metrics      JSON    `json:"metrics"`
	Metadata     JSON    `json:"metadata"`
	Events       []JSON  `json:"events"`
}
