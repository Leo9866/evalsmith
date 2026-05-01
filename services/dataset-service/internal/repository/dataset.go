package repository

import (
	"database/sql"
	"encoding/json"
	"time"

	"github.com/evalsmith/dataset-service/internal/model"
)

type DatasetRepository struct {
	db *sql.DB
}

func NewDatasetRepository(db *sql.DB) *DatasetRepository {
	return &DatasetRepository{db: db}
}

func (r *DatasetRepository) Create(d *model.Dataset) error {
	now := time.Now()
	d.CreatedAt = now
	d.UpdatedAt = now
	d.CurrentVersion = 1
	d.ExampleCount = 0

	schemaDef := jsonOrNull(d.SchemaDef)
	_, err := r.db.Exec(`
		INSERT INTO datasets (id, project_id, name, description, schema_def, current_version, example_count, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		d.ID, d.ProjectID, d.Name, d.Description, schemaDef, d.CurrentVersion, d.ExampleCount, d.CreatedAt, d.UpdatedAt,
	)
	return err
}

func (r *DatasetRepository) GetByID(id, projectID string) (*model.Dataset, error) {
	d := &model.Dataset{}
	var schemaDef sql.NullString
	var description sql.NullString
	err := r.db.QueryRow(`
		SELECT id, project_id, name, description, schema_def, current_version, example_count, created_at, updated_at
		FROM datasets WHERE id = $1 AND project_id = $2`, id, projectID,
	).Scan(&d.ID, &d.ProjectID, &d.Name, &description, &schemaDef, &d.CurrentVersion, &d.ExampleCount, &d.CreatedAt, &d.UpdatedAt)
	if err != nil {
		return nil, err
	}
	d.Description = description.String
	if schemaDef.Valid {
		d.SchemaDef = json.RawMessage(schemaDef.String)
	}
	return d, nil
}

func (r *DatasetRepository) List(projectID, name string, page, pageSize int) ([]*model.Dataset, int, error) {
	var (
		total int
		err   error
	)
	filtered := name != ""
	offset := (page - 1) * pageSize

	if filtered {
		pattern := "%" + name + "%"
		err = r.db.QueryRow(
			`SELECT COUNT(*) FROM datasets WHERE project_id = $1 AND name ILIKE $2`,
			projectID,
			pattern,
		).Scan(&total)
	} else {
		err = r.db.QueryRow(`SELECT COUNT(*) FROM datasets WHERE project_id = $1`, projectID).Scan(&total)
	}
	if err != nil {
		return nil, 0, err
	}

	var rows *sql.Rows
	if filtered {
		pattern := "%" + name + "%"
		rows, err = r.db.Query(`
			SELECT id, project_id, name, description, schema_def, current_version, example_count, created_at, updated_at
			FROM datasets
			WHERE project_id = $1 AND name ILIKE $2
			ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
			projectID, pattern, pageSize, offset,
		)
	} else {
		rows, err = r.db.Query(`
			SELECT id, project_id, name, description, schema_def, current_version, example_count, created_at, updated_at
			FROM datasets WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
			projectID, pageSize, offset,
		)
	}
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var datasets []*model.Dataset
	for rows.Next() {
		d := &model.Dataset{}
		var schemaDef sql.NullString
		var description sql.NullString
		if err := rows.Scan(&d.ID, &d.ProjectID, &d.Name, &description, &schemaDef, &d.CurrentVersion, &d.ExampleCount, &d.CreatedAt, &d.UpdatedAt); err != nil {
			return nil, 0, err
		}
		d.Description = description.String
		if schemaDef.Valid {
			d.SchemaDef = json.RawMessage(schemaDef.String)
		}
		datasets = append(datasets, d)
	}
	return datasets, total, nil
}

func (r *DatasetRepository) Update(d *model.Dataset) error {
	d.UpdatedAt = time.Now()
	schemaDef := jsonOrNull(d.SchemaDef)
	_, err := r.db.Exec(`
		UPDATE datasets SET name=$1, description=$2, schema_def=$3, updated_at=$4
		WHERE id=$5 AND project_id=$6`,
		d.Name, d.Description, schemaDef, d.UpdatedAt, d.ID, d.ProjectID,
	)
	return err
}

func (r *DatasetRepository) Delete(id, projectID string) error {
	_, err := r.db.Exec(`DELETE FROM datasets WHERE id = $1 AND project_id = $2`, id, projectID)
	return err
}

func (r *DatasetRepository) IncrementVersionAndCount(id string, addedCount int) (int, error) {
	var newVersion int
	err := r.db.QueryRow(`
		UPDATE datasets
		SET current_version = current_version + 1, example_count = example_count + $1, updated_at = $2
		WHERE id = $3
		RETURNING current_version`,
		addedCount, time.Now(), id,
	).Scan(&newVersion)
	return newVersion, err
}

func (r *DatasetRepository) BumpVersion(id string) (int, error) {
	var newVersion int
	err := r.db.QueryRow(`
		UPDATE datasets SET current_version = current_version + 1, updated_at = $1 WHERE id = $2
		RETURNING current_version`, time.Now(), id,
	).Scan(&newVersion)
	return newVersion, err
}

func (r *DatasetRepository) AdjustExampleCount(id string, delta int) error {
	_, err := r.db.Exec(`
		UPDATE datasets SET example_count = example_count + $1, updated_at = $2 WHERE id = $3`,
		delta, time.Now(), id,
	)
	return err
}

func (r *DatasetRepository) SetExampleCount(id string, count int) error {
	_, err := r.db.Exec(`
		UPDATE datasets SET example_count = $1, updated_at = $2 WHERE id = $3`,
		count, time.Now(), id,
	)
	return err
}

func jsonOrNull(raw json.RawMessage) interface{} {
	if len(raw) == 0 {
		return nil
	}
	return string(raw)
}
