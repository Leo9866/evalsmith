package model

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

type AnnotationTask struct {
	ID               string          `json:"id"`
	ProjectID        string          `json:"project_id"`
	SourceType       string          `json:"source_type"`
	SourceID         string          `json:"source_id"`
	Mode             string          `json:"mode"`
	Status           string          `json:"status"`
	TraceID          *string         `json:"trace_id,omitempty"`
	SourceTraceID    *string         `json:"source_trace_id,omitempty"`
	BackfillActionID *string         `json:"backfill_action_id,omitempty"`
	ExperimentID     *string         `json:"experiment_id,omitempty"`
	ExampleID        *string         `json:"example_id,omitempty"`
	InputPayload     json.RawMessage `json:"input_payload"`
	CandidateOutput  json.RawMessage `json:"candidate_output,omitempty"`
	ReferenceOutput  json.RawMessage `json:"reference_output,omitempty"`
	Metadata         json.RawMessage `json:"metadata,omitempty"`
	Annotation       json.RawMessage `json:"annotation,omitempty"`
	CreatedAt        time.Time       `json:"created_at"`
	UpdatedAt        time.Time       `json:"updated_at"`
	CompletedAt      *time.Time      `json:"completed_at,omitempty"`
}

type AnnotationStats struct {
	Total      int `json:"total"`
	Pending    int `json:"pending"`
	InProgress int `json:"in_progress"`
	Completed  int `json:"completed"`
}

type CreateAnnotationTasksRequest struct {
	Tasks []AnnotationTaskInput `json:"tasks" binding:"required,min=1"`
}

type AnnotationTaskInput struct {
	SourceType       string          `json:"source_type" binding:"required"`
	SourceID         string          `json:"source_id" binding:"required"`
	Mode             string          `json:"mode"`
	TraceID          *string         `json:"trace_id"`
	SourceTraceID    *string         `json:"source_trace_id"`
	BackfillActionID *string         `json:"backfill_action_id"`
	ExperimentID     *string         `json:"experiment_id"`
	ExampleID        *string         `json:"example_id"`
	InputPayload     json.RawMessage `json:"input_payload" binding:"required"`
	CandidateOutput  json.RawMessage `json:"candidate_output"`
	ReferenceOutput  json.RawMessage `json:"reference_output"`
	Metadata         json.RawMessage `json:"metadata"`
}

type CreateAnnotationTasksResponse struct {
	Added   int      `json:"added"`
	TaskIDs []string `json:"task_ids"`
}

type SubmitAnnotationRequest struct {
	Label      string          `json:"label" binding:"required"`
	Score      *float64        `json:"score"`
	Note       string          `json:"note"`
	Metadata   json.RawMessage `json:"metadata"`
	SetPending bool            `json:"set_pending"`
}

type PaginatedResponse struct {
	Items      interface{} `json:"items"`
	Total      int         `json:"total"`
	Page       int         `json:"page"`
	PageSize   int         `json:"page_size"`
	TotalPages int         `json:"total_pages"`
}

func NewTaskID() string {
	return fmt.Sprintf("ann_%s", uuid.New().String()[:12])
}
