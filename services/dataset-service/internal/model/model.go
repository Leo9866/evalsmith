package model

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Dataset represents a dataset record.
type Dataset struct {
	ID             string          `json:"id"`
	ProjectID      string          `json:"project_id"`
	Name           string          `json:"name"`
	Description    string          `json:"description,omitempty"`
	SchemaDef      json.RawMessage `json:"schema_def,omitempty"`
	CurrentVersion int             `json:"current_version"`
	ExampleCount   int             `json:"example_count"`
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`
}

// DatasetVersion represents a versioned snapshot of a dataset.
type DatasetVersion struct {
	ID          string    `json:"id"`
	DatasetID   string    `json:"dataset_id"`
	Version     int       `json:"version"`
	Description string    `json:"description,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

type DatasetVersionSnapshot struct {
	DatasetID    string                   `json:"dataset_id"`
	Version      int                      `json:"version"`
	ExampleCount int                      `json:"example_count"`
	Examples     []DatasetSnapshotExample `json:"examples"`
	CreatedAt    time.Time                `json:"created_at"`
}

type DatasetSnapshotExample struct {
	ID              string          `json:"id"`
	Inputs          json.RawMessage `json:"inputs"`
	ExpectedOutputs json.RawMessage `json:"expected_outputs,omitempty"`
	Metadata        json.RawMessage `json:"metadata,omitempty"`
	Source          string          `json:"source"`
	Split           string          `json:"split"`
	VersionAdded    int             `json:"version_added"`
}

// Example represents a single test example in a dataset.
type Example struct {
	ID              string          `json:"id"`
	DatasetID       string          `json:"dataset_id"`
	Inputs          json.RawMessage `json:"inputs"`
	ExpectedOutputs json.RawMessage `json:"expected_outputs,omitempty"`
	Metadata        json.RawMessage `json:"metadata,omitempty"`
	Source          string          `json:"source"`
	Split           string          `json:"split"`
	VersionAdded    int             `json:"version_added"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
	ArchivedAt      *time.Time      `json:"archived_at,omitempty"`
}

type SplitSummary struct {
	Split string `json:"split"`
	Count int    `json:"count"`
}

// --- Request / Response types ---

type CreateDatasetRequest struct {
	Name        string          `json:"name" binding:"required"`
	Description string          `json:"description"`
	SchemaDef   json.RawMessage `json:"schema_def"`
}

type UpdateDatasetRequest struct {
	Name        *string          `json:"name"`
	Description *string          `json:"description"`
	SchemaDef   *json.RawMessage `json:"schema_def"`
}

type BatchAddExamplesRequest struct {
	Examples      []ExampleInput      `json:"examples" binding:"required,min=1"`
	Description   string              `json:"description"`
	SourceContext *BatchSourceContext `json:"source_context,omitempty"`
}

type ExampleInput struct {
	Inputs          json.RawMessage `json:"inputs" binding:"required"`
	ExpectedOutputs json.RawMessage `json:"expected_outputs"`
	Metadata        json.RawMessage `json:"metadata"`
	Split           string          `json:"split"`
	Source          string          `json:"source"`
}

type BatchSourceContext struct {
	SourceType         string   `json:"source_type"`
	TraceIDs           []string `json:"trace_ids,omitempty"`
	BackfillActionIDs  []string `json:"backfill_action_ids,omitempty"`
	BackfillSourceType string   `json:"backfill_source_type,omitempty"`
	SourceRefID        string   `json:"source_ref_id,omitempty"`
}

type UpdateExampleRequest struct {
	Inputs          *json.RawMessage `json:"inputs"`
	ExpectedOutputs *json.RawMessage `json:"expected_outputs"`
	Metadata        *json.RawMessage `json:"metadata"`
	Split           *string          `json:"split"`
}

type BatchAddExamplesResponse struct {
	Added      int      `json:"added"`
	NewVersion int      `json:"new_version"`
	ExampleIDs []string `json:"example_ids"`
}

type DatasetImportDuplicate struct {
	Row               int    `json:"row"`
	Scope             string `json:"scope"`
	Message           string `json:"message"`
	InputsPreview     string `json:"inputs_preview,omitempty"`
	DuplicateOfRow    *int   `json:"duplicate_of_row,omitempty"`
	ExistingExampleID string `json:"existing_example_id,omitempty"`
}

type DatasetImportInvalidExample struct {
	Row        int    `json:"row"`
	Message    string `json:"message"`
	RawPreview string `json:"raw_preview,omitempty"`
}

type DatasetImportResponse struct {
	TotalRows          int                           `json:"total_rows"`
	Added              int                           `json:"added"`
	DuplicateCount     int                           `json:"duplicate_count"`
	InvalidCount       int                           `json:"invalid_count"`
	Duplicates         []DatasetImportDuplicate      `json:"duplicates"`
	InvalidExamples    []DatasetImportInvalidExample `json:"invalid_examples"`
	NewVersion         *int                          `json:"new_version,omitempty"`
	ExampleIDs         []string                      `json:"example_ids,omitempty"`
	VersionDescription string                        `json:"version_description,omitempty"`
}

type DatasetVersionDiffRequest struct {
	BaseVersion int `form:"base_version" binding:"required,min=1"`
}

type DatasetVersionDiffResponse struct {
	DatasetID     string               `json:"dataset_id"`
	BaseVersion   int                  `json:"base_version"`
	TargetVersion int                  `json:"target_version"`
	AddedCount    int                  `json:"added_count"`
	RemovedCount  int                  `json:"removed_count"`
	ChangedCount  int                  `json:"changed_count"`
	Added         []DatasetDiffEntry   `json:"added"`
	Removed       []DatasetDiffEntry   `json:"removed"`
	Changed       []DatasetChangedPair `json:"changed"`
}

type DatasetDiffEntry struct {
	ExampleID       string          `json:"example_id"`
	Inputs          json.RawMessage `json:"inputs"`
	ExpectedOutputs json.RawMessage `json:"expected_outputs,omitempty"`
	Metadata        json.RawMessage `json:"metadata,omitempty"`
	Split           string          `json:"split"`
	Source          string          `json:"source"`
}

type DatasetChangedPair struct {
	ExampleID string           `json:"example_id"`
	Before    DatasetDiffEntry `json:"before"`
	After     DatasetDiffEntry `json:"after"`
}

type DatasetVersionRollbackRequest struct {
	Description string `json:"description"`
}

type UpdateDatasetVersionRequest struct {
	Description string `json:"description" binding:"required"`
}

type DatasetVersionRollbackResponse struct {
	DatasetID           string `json:"dataset_id"`
	RestoredFromVersion int    `json:"restored_from_version"`
	NewVersion          int    `json:"new_version"`
	ActiveExampleCount  int    `json:"active_example_count"`
}

type PaginatedResponse struct {
	Items      interface{} `json:"items"`
	Total      int         `json:"total"`
	Page       int         `json:"page"`
	PageSize   int         `json:"page_size"`
	TotalPages int         `json:"total_pages"`
}

// --- ID generation helpers ---

func NewDatasetID() string {
	return fmt.Sprintf("ds_%s", uuid.New().String()[:12])
}

func NewVersionID() string {
	return fmt.Sprintf("ver_%s", uuid.New().String()[:12])
}

func NewExampleID() string {
	return fmt.Sprintf("ex_%s", uuid.New().String()[:12])
}
