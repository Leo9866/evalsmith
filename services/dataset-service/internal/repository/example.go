package repository

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/evalsmith/dataset-service/internal/model"
	"github.com/lib/pq"
)

type ExampleRepository struct {
	db *sql.DB
}

func NewExampleRepository(db *sql.DB) *ExampleRepository {
	return &ExampleRepository{db: db}
}

func (r *ExampleRepository) BatchCreate(examples []*model.Example) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`
		INSERT INTO examples (id, dataset_id, inputs, expected_outputs, metadata, source, split, version_added, created_at, updated_at, archived_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	now := time.Now()
	for _, ex := range examples {
		ex.CreatedAt = now
		ex.UpdatedAt = now
		_, err := stmt.Exec(
			ex.ID, ex.DatasetID,
			string(ex.Inputs),
			jsonOrNull(ex.ExpectedOutputs),
			jsonOrNull(ex.Metadata),
			ex.Source, ex.Split, ex.VersionAdded,
			ex.CreatedAt, ex.UpdatedAt,
		)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (r *ExampleRepository) List(datasetID, split, query string, page, pageSize int) ([]*model.Example, int, error) {
	filters := []string{"dataset_id = $1", "archived_at IS NULL"}
	args := []interface{}{datasetID}
	nextArg := 2

	if split != "" && split != "all" {
		filters = append(filters, fmt.Sprintf("split = $%d", nextArg))
		args = append(args, split)
		nextArg++
	}
	if strings.TrimSpace(query) != "" {
		filters = append(filters, fmt.Sprintf(
			"(id ILIKE $%d OR inputs::text ILIKE $%d OR COALESCE(expected_outputs::text, '') ILIKE $%d OR COALESCE(metadata::text, '') ILIKE $%d OR source ILIKE $%d OR split ILIKE $%d)",
			nextArg, nextArg, nextArg, nextArg, nextArg, nextArg,
		))
		args = append(args, "%"+strings.TrimSpace(query)+"%")
		nextArg++
	}

	whereClause := strings.Join(filters, " AND ")

	var total int
	countQuery := fmt.Sprintf(`SELECT COUNT(*) FROM examples WHERE %s`, whereClause)
	err := r.db.QueryRow(countQuery, args...).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * pageSize
	querySQL := fmt.Sprintf(`
		SELECT id, dataset_id, inputs, expected_outputs, metadata, source, split, version_added, created_at, updated_at, archived_at
		FROM examples
		WHERE %s
		ORDER BY created_at ASC
		LIMIT $%d OFFSET $%d`,
		whereClause,
		nextArg,
		nextArg+1,
	)
	rows, err := r.db.Query(querySQL, append(args, pageSize, offset)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var examples []*model.Example
	for rows.Next() {
		ex := &model.Example{}
		var expectedOutputs, metadata sql.NullString
		var archivedAt sql.NullTime
		if err := rows.Scan(&ex.ID, &ex.DatasetID, &ex.Inputs, &expectedOutputs, &metadata, &ex.Source, &ex.Split, &ex.VersionAdded, &ex.CreatedAt, &ex.UpdatedAt, &archivedAt); err != nil {
			return nil, 0, err
		}
		if expectedOutputs.Valid {
			ex.ExpectedOutputs = json.RawMessage(expectedOutputs.String)
		}
		if metadata.Valid {
			ex.Metadata = json.RawMessage(metadata.String)
		}
		if archivedAt.Valid {
			ex.ArchivedAt = &archivedAt.Time
		}
		examples = append(examples, ex)
	}
	return examples, total, nil
}

func (r *ExampleRepository) SplitSummary(datasetID string) ([]*model.SplitSummary, error) {
	rows, err := r.db.Query(`
		SELECT split, COUNT(*)
		FROM examples
		WHERE dataset_id = $1 AND archived_at IS NULL
		GROUP BY split
		ORDER BY COUNT(*) DESC, split ASC`,
		datasetID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	summaries := make([]*model.SplitSummary, 0)
	for rows.Next() {
		summary := &model.SplitSummary{}
		if err := rows.Scan(&summary.Split, &summary.Count); err != nil {
			return nil, err
		}
		summaries = append(summaries, summary)
	}
	return summaries, nil
}

func (r *ExampleRepository) GetByID(id, datasetID string) (*model.Example, error) {
	ex := &model.Example{}
	var expectedOutputs, metadata sql.NullString
	var archivedAt sql.NullTime
	err := r.db.QueryRow(`
		SELECT id, dataset_id, inputs, expected_outputs, metadata, source, split, version_added, created_at, updated_at, archived_at
		FROM examples WHERE id = $1 AND dataset_id = $2 AND archived_at IS NULL`, id, datasetID,
	).Scan(&ex.ID, &ex.DatasetID, &ex.Inputs, &expectedOutputs, &metadata, &ex.Source, &ex.Split, &ex.VersionAdded, &ex.CreatedAt, &ex.UpdatedAt, &archivedAt)
	if err != nil {
		return nil, err
	}
	if expectedOutputs.Valid {
		ex.ExpectedOutputs = json.RawMessage(expectedOutputs.String)
	}
	if metadata.Valid {
		ex.Metadata = json.RawMessage(metadata.String)
	}
	if archivedAt.Valid {
		ex.ArchivedAt = &archivedAt.Time
	}
	return ex, nil
}

func (r *ExampleRepository) Update(ex *model.Example) error {
	ex.UpdatedAt = time.Now()
	_, err := r.db.Exec(`
		UPDATE examples SET inputs=$1, expected_outputs=$2, metadata=$3, split=$4, updated_at=$5
		WHERE id=$6 AND dataset_id=$7`,
		string(ex.Inputs),
		jsonOrNull(ex.ExpectedOutputs),
		jsonOrNull(ex.Metadata),
		ex.Split, ex.UpdatedAt, ex.ID, ex.DatasetID,
	)
	return err
}

func (r *ExampleRepository) Delete(id, datasetID string) error {
	_, err := r.db.Exec(`UPDATE examples SET archived_at = $1, updated_at = $1 WHERE id = $2 AND dataset_id = $3 AND archived_at IS NULL`, time.Now(), id, datasetID)
	return err
}

func (r *ExampleRepository) DeleteByDataset(datasetID string) error {
	_, err := r.db.Exec(`DELETE FROM examples WHERE dataset_id = $1`, datasetID)
	return err
}

func (r *ExampleRepository) ListActiveAll(datasetID string) ([]*model.Example, error) {
	rows, err := r.db.Query(`
		SELECT id, dataset_id, inputs, expected_outputs, metadata, source, split, version_added, created_at, updated_at, archived_at
		FROM examples
		WHERE dataset_id = $1 AND archived_at IS NULL
		ORDER BY created_at ASC, id ASC`,
		datasetID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	examples := make([]*model.Example, 0)
	for rows.Next() {
		ex := &model.Example{}
		var expectedOutputs, metadata sql.NullString
		var archivedAt sql.NullTime
		if err := rows.Scan(&ex.ID, &ex.DatasetID, &ex.Inputs, &expectedOutputs, &metadata, &ex.Source, &ex.Split, &ex.VersionAdded, &ex.CreatedAt, &ex.UpdatedAt, &archivedAt); err != nil {
			return nil, err
		}
		if expectedOutputs.Valid {
			ex.ExpectedOutputs = json.RawMessage(expectedOutputs.String)
		}
		if metadata.Valid {
			ex.Metadata = json.RawMessage(metadata.String)
		}
		if archivedAt.Valid {
			ex.ArchivedAt = &archivedAt.Time
		}
		examples = append(examples, ex)
	}
	return examples, nil
}

func (r *ExampleRepository) ReplaceActiveSet(datasetID string, examples []*model.Example) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	now := time.Now()
	ids := make([]string, 0, len(examples))
	for _, ex := range examples {
		ids = append(ids, ex.ID)
	}

	if len(ids) == 0 {
		if _, err := tx.Exec(`UPDATE examples SET archived_at = $1, updated_at = $1 WHERE dataset_id = $2 AND archived_at IS NULL`, now, datasetID); err != nil {
			return err
		}
		return tx.Commit()
	}

	if _, err := tx.Exec(`
		UPDATE examples
		SET archived_at = $1, updated_at = $1
		WHERE dataset_id = $2
		  AND archived_at IS NULL
		  AND NOT (id = ANY($3))`,
		now, datasetID, pq.Array(ids),
	); err != nil {
		return err
	}

	stmt, err := tx.Prepare(`
		INSERT INTO examples (id, dataset_id, inputs, expected_outputs, metadata, source, split, version_added, created_at, updated_at, archived_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, $11), $10, NULL)
		ON CONFLICT (id) DO UPDATE
		SET dataset_id = EXCLUDED.dataset_id,
			inputs = EXCLUDED.inputs,
			expected_outputs = EXCLUDED.expected_outputs,
			metadata = EXCLUDED.metadata,
			source = EXCLUDED.source,
			split = EXCLUDED.split,
			version_added = EXCLUDED.version_added,
			updated_at = EXCLUDED.updated_at,
			archived_at = NULL`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, ex := range examples {
		ex.DatasetID = datasetID
		if ex.CreatedAt.IsZero() {
			ex.CreatedAt = now
		}
		ex.UpdatedAt = now
		if _, err := stmt.Exec(
			ex.ID,
			ex.DatasetID,
			string(ex.Inputs),
			jsonOrNull(ex.ExpectedOutputs),
			jsonOrNull(ex.Metadata),
			ex.Source,
			ex.Split,
			ex.VersionAdded,
			ex.CreatedAt,
			ex.UpdatedAt,
			now,
		); err != nil {
			return err
		}
	}

	return tx.Commit()
}
