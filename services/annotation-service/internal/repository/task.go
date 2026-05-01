package repository

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/evalsmith/annotation-service/internal/model"
)

type TaskRepository struct {
	db *sql.DB
}

func NewTaskRepository(db *sql.DB) *TaskRepository {
	return &TaskRepository{db: db}
}

func (r *TaskRepository) BatchCreate(tasks []*model.AnnotationTask) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`
		INSERT INTO annotation_tasks (
			id, project_id, source_type, source_id, mode, status, trace_id, experiment_id, example_id,
			input_payload, candidate_output, reference_output, metadata, annotation, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	now := time.Now().UTC()
	for _, task := range tasks {
		task.CreatedAt = now
		task.UpdatedAt = now
		task.Status = normalizeStatus(task.Status)
		if _, err := stmt.Exec(
			task.ID,
			task.ProjectID,
			task.SourceType,
			task.SourceID,
			normalizeMode(task.Mode),
			task.Status,
			task.TraceID,
			task.ExperimentID,
			task.ExampleID,
			string(task.InputPayload),
			jsonOrNull(task.CandidateOutput),
			jsonOrNull(task.ReferenceOutput),
			jsonOrNull(task.Metadata),
			jsonOrNull(task.Annotation),
			task.CreatedAt,
			task.UpdatedAt,
		); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (r *TaskRepository) List(projectID, status, query string, page, pageSize int) ([]*model.AnnotationTask, int, error) {
	filters := []string{"project_id = $1"}
	args := []interface{}{projectID}
	nextArg := 2

	if status != "" && status != "all" {
		filters = append(filters, fmt.Sprintf("status = $%d", nextArg))
		args = append(args, status)
		nextArg++
	}
	if strings.TrimSpace(query) != "" {
		filters = append(filters, fmt.Sprintf(
			"(id ILIKE $%d OR source_id ILIKE $%d OR COALESCE(trace_id, '') ILIKE $%d OR COALESCE(experiment_id, '') ILIKE $%d OR COALESCE(example_id, '') ILIKE $%d)",
			nextArg, nextArg, nextArg, nextArg, nextArg,
		))
		args = append(args, "%"+strings.TrimSpace(query)+"%")
		nextArg++
	}

	whereClause := strings.Join(filters, " AND ")

	var total int
	countQuery := fmt.Sprintf(`SELECT COUNT(*) FROM annotation_tasks WHERE %s`, whereClause)
	err := r.db.QueryRow(countQuery, args...).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * pageSize
	querySQL := fmt.Sprintf(`
		SELECT id, project_id, source_type, source_id, mode, status, trace_id, experiment_id, example_id,
		       input_payload, candidate_output, reference_output, metadata, annotation, created_at, updated_at, completed_at
		FROM annotation_tasks
		WHERE %s
		ORDER BY created_at DESC
		LIMIT $%d OFFSET $%d
	`, whereClause, nextArg, nextArg+1)
	rows, err := r.db.Query(querySQL, append(args, pageSize, offset)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	items := make([]*model.AnnotationTask, 0)
	for rows.Next() {
		task, err := scanTask(rows)
		if err != nil {
			return nil, 0, err
		}
		items = append(items, task)
	}
	return items, total, nil
}

func (r *TaskRepository) GetByID(projectID, id string) (*model.AnnotationTask, error) {
	row := r.db.QueryRow(`
		SELECT id, project_id, source_type, source_id, mode, status, trace_id, experiment_id, example_id,
		       input_payload, candidate_output, reference_output, metadata, annotation, created_at, updated_at, completed_at
		FROM annotation_tasks
		WHERE project_id = $1 AND id = $2
	`, projectID, id)
	return scanTask(row)
}

func (r *TaskRepository) Submit(projectID, id string, annotation json.RawMessage, setPending bool) error {
	status := "completed"
	var completedAt interface{} = time.Now().UTC()
	if setPending {
		status = "pending"
		completedAt = nil
	}
	_, err := r.db.Exec(`
		UPDATE annotation_tasks
		SET status = $1, annotation = $2, updated_at = $3, completed_at = $4
		WHERE project_id = $5 AND id = $6
	`, status, string(annotation), time.Now().UTC(), completedAt, projectID, id)
	return err
}

func (r *TaskRepository) MarkInProgress(projectID, id string) error {
	_, err := r.db.Exec(`
		UPDATE annotation_tasks
		SET status = 'in_progress', updated_at = $1
		WHERE project_id = $2 AND id = $3 AND status = 'pending'
	`, time.Now().UTC(), projectID, id)
	return err
}

func (r *TaskRepository) Stats(projectID string) (*model.AnnotationStats, error) {
	stats := &model.AnnotationStats{}
	row := r.db.QueryRow(`
		SELECT
			COUNT(*) AS total,
			COUNT(*) FILTER (WHERE status = 'pending') AS pending,
			COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
			COUNT(*) FILTER (WHERE status = 'completed') AS completed
		FROM annotation_tasks
		WHERE project_id = $1
	`, projectID)
	if err := row.Scan(&stats.Total, &stats.Pending, &stats.InProgress, &stats.Completed); err != nil {
		return nil, err
	}
	return stats, nil
}

func scanTask(scanner interface {
	Scan(dest ...interface{}) error
}) (*model.AnnotationTask, error) {
	task := &model.AnnotationTask{}
	var (
		candidate    sql.NullString
		reference    sql.NullString
		metadata     sql.NullString
		annotation   sql.NullString
		completed    sql.NullTime
		traceID      sql.NullString
		experimentID sql.NullString
		exampleID    sql.NullString
	)
	err := scanner.Scan(
		&task.ID,
		&task.ProjectID,
		&task.SourceType,
		&task.SourceID,
		&task.Mode,
		&task.Status,
		&traceID,
		&experimentID,
		&exampleID,
		&task.InputPayload,
		&candidate,
		&reference,
		&metadata,
		&annotation,
		&task.CreatedAt,
		&task.UpdatedAt,
		&completed,
	)
	if err != nil {
		return nil, err
	}
	if traceID.Valid {
		task.TraceID = &traceID.String
	}
	if experimentID.Valid {
		task.ExperimentID = &experimentID.String
	}
	if exampleID.Valid {
		task.ExampleID = &exampleID.String
	}
	if candidate.Valid {
		task.CandidateOutput = json.RawMessage(candidate.String)
	}
	if reference.Valid {
		task.ReferenceOutput = json.RawMessage(reference.String)
	}
	if metadata.Valid {
		task.Metadata = json.RawMessage(metadata.String)
		var metadataMap map[string]any
		if err := json.Unmarshal(task.Metadata, &metadataMap); err == nil {
			if value, ok := metadataMap["backfill_action_id"].(string); ok && value != "" {
				task.BackfillActionID = &value
			}
			if value, ok := metadataMap["source_trace_id"].(string); ok && value != "" {
				task.SourceTraceID = &value
			}
		}
	}
	if annotation.Valid {
		task.Annotation = json.RawMessage(annotation.String)
	}
	if completed.Valid {
		task.CompletedAt = &completed.Time
	}
	return task, nil
}

func normalizeStatus(status string) string {
	switch status {
	case "in_progress", "completed":
		return status
	default:
		return "pending"
	}
}

func normalizeMode(mode string) string {
	if mode == "pairwise" {
		return mode
	}
	return "single_run"
}

func jsonOrNull(raw json.RawMessage) interface{} {
	if len(raw) == 0 {
		return nil
	}
	return string(raw)
}
