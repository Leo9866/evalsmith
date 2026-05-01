package service

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/evalsmith/annotation-service/internal/model"
	"github.com/evalsmith/annotation-service/internal/repository"
)

type AnnotationService struct {
	repo *repository.TaskRepository
}

func NewAnnotationService(repo *repository.TaskRepository) *AnnotationService {
	return &AnnotationService{repo: repo}
}

func (s *AnnotationService) CreateTasks(projectID string, req *model.CreateAnnotationTasksRequest) (*model.CreateAnnotationTasksResponse, error) {
	tasks := make([]*model.AnnotationTask, 0, len(req.Tasks))
	ids := make([]string, 0, len(req.Tasks))
	for _, item := range req.Tasks {
		metadataMap := map[string]any{}
		if len(item.Metadata) > 0 {
			_ = json.Unmarshal(item.Metadata, &metadataMap)
		}
		if item.BackfillActionID != nil && *item.BackfillActionID != "" {
			metadataMap["backfill_action_id"] = *item.BackfillActionID
		}
		if item.SourceTraceID != nil && *item.SourceTraceID != "" {
			metadataMap["source_trace_id"] = *item.SourceTraceID
		}
		metadata, err := json.Marshal(metadataMap)
		if err != nil {
			return nil, fmt.Errorf("marshal annotation metadata: %w", err)
		}
		task := &model.AnnotationTask{
			ID:               model.NewTaskID(),
			ProjectID:        projectID,
			SourceType:       item.SourceType,
			SourceID:         item.SourceID,
			Mode:             item.Mode,
			Status:           "pending",
			TraceID:          item.TraceID,
			SourceTraceID:    item.SourceTraceID,
			BackfillActionID: item.BackfillActionID,
			ExperimentID:     item.ExperimentID,
			ExampleID:        item.ExampleID,
			InputPayload:     item.InputPayload,
			CandidateOutput:  item.CandidateOutput,
			ReferenceOutput:  item.ReferenceOutput,
			Metadata:         metadata,
			Annotation:       json.RawMessage(`{}`),
		}
		tasks = append(tasks, task)
		ids = append(ids, task.ID)
	}
	if err := s.repo.BatchCreate(tasks); err != nil {
		return nil, fmt.Errorf("create annotation tasks: %w", err)
	}
	return &model.CreateAnnotationTasksResponse{Added: len(ids), TaskIDs: ids}, nil
}

func (s *AnnotationService) ListTasks(projectID, status, query string, page, pageSize int) ([]*model.AnnotationTask, int, error) {
	return s.repo.List(projectID, status, query, page, pageSize)
}

func (s *AnnotationService) GetTask(projectID, id string) (*model.AnnotationTask, error) {
	task, err := s.repo.GetByID(projectID, id)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return task, err
}

func (s *AnnotationService) SubmitTask(projectID, id string, req *model.SubmitAnnotationRequest) error {
	_, err := s.repo.GetByID(projectID, id)
	if err == sql.ErrNoRows {
		return ErrNotFound
	}
	if err != nil {
		return err
	}

	payload := map[string]any{
		"label": req.Label,
		"note":  req.Note,
	}
	if req.Score != nil {
		payload["score"] = *req.Score
	}
	if len(req.Metadata) > 0 {
		var metadata any
		if err := json.Unmarshal(req.Metadata, &metadata); err == nil {
			payload["metadata"] = metadata
		}
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal annotation payload: %w", err)
	}
	return s.repo.Submit(projectID, id, raw, req.SetPending)
}

func (s *AnnotationService) ClaimTask(projectID, id string) error {
	if _, err := s.GetTask(projectID, id); err != nil {
		return err
	}
	return s.repo.MarkInProgress(projectID, id)
}

func (s *AnnotationService) Stats(projectID string) (*model.AnnotationStats, error) {
	return s.repo.Stats(projectID)
}

var ErrNotFound = fmt.Errorf("not found")
