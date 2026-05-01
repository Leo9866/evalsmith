package repository

import (
	"database/sql"
	"encoding/json"
	"time"

	"github.com/evalsmith/dataset-service/internal/model"
)

type VersionRepository struct {
	db *sql.DB
}

func NewVersionRepository(db *sql.DB) *VersionRepository {
	return &VersionRepository{db: db}
}

func (r *VersionRepository) Create(v *model.DatasetVersion) error {
	v.CreatedAt = time.Now()
	_, err := r.db.Exec(`
		INSERT INTO dataset_versions (id, dataset_id, version, description, created_at)
		VALUES ($1, $2, $3, $4, $5)`,
		v.ID, v.DatasetID, v.Version, v.Description, v.CreatedAt,
	)
	return err
}

func (r *VersionRepository) ListByDataset(datasetID string) ([]*model.DatasetVersion, error) {
	rows, err := r.db.Query(`
		SELECT id, dataset_id, version, description, created_at
		FROM dataset_versions WHERE dataset_id = $1 ORDER BY version DESC`, datasetID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var versions []*model.DatasetVersion
	for rows.Next() {
		v := &model.DatasetVersion{}
		var description sql.NullString
		if err := rows.Scan(&v.ID, &v.DatasetID, &v.Version, &description, &v.CreatedAt); err != nil {
			return nil, err
		}
		v.Description = description.String
		versions = append(versions, v)
	}
	return versions, nil
}

func (r *VersionRepository) GetByDatasetAndVersion(datasetID string, version int) (*model.DatasetVersion, error) {
	item := &model.DatasetVersion{}
	var description sql.NullString
	err := r.db.QueryRow(`
		SELECT id, dataset_id, version, description, created_at
		FROM dataset_versions
		WHERE dataset_id = $1 AND version = $2`,
		datasetID,
		version,
	).Scan(&item.ID, &item.DatasetID, &item.Version, &description, &item.CreatedAt)
	if err != nil {
		return nil, err
	}
	item.Description = description.String
	return item, nil
}

func (r *VersionRepository) UpdateDescription(datasetID string, version int, description string) error {
	_, err := r.db.Exec(`
		UPDATE dataset_versions
		SET description = $1
		WHERE dataset_id = $2 AND version = $3`,
		description,
		datasetID,
		version,
	)
	return err
}

func (r *VersionRepository) SaveSnapshot(datasetID string, version int, examples []*model.Example) error {
	snapshotExamples := make([]model.DatasetSnapshotExample, 0, len(examples))
	for _, ex := range examples {
		snapshotExamples = append(snapshotExamples, model.DatasetSnapshotExample{
			ID:              ex.ID,
			Inputs:          ex.Inputs,
			ExpectedOutputs: ex.ExpectedOutputs,
			Metadata:        ex.Metadata,
			Source:          ex.Source,
			Split:           ex.Split,
			VersionAdded:    ex.VersionAdded,
		})
	}

	payload, err := json.Marshal(snapshotExamples)
	if err != nil {
		return err
	}

	now := time.Now()
	_, err = r.db.Exec(`
		INSERT INTO dataset_version_snapshots (dataset_id, version, example_count, examples, created_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (dataset_id, version) DO UPDATE
		SET example_count = EXCLUDED.example_count,
			examples = EXCLUDED.examples,
			created_at = EXCLUDED.created_at`,
		datasetID,
		version,
		len(snapshotExamples),
		string(payload),
		now,
	)
	return err
}

func (r *VersionRepository) GetSnapshot(datasetID string, version int) (*model.DatasetVersionSnapshot, error) {
	snapshot := &model.DatasetVersionSnapshot{}
	var examplesRaw string
	err := r.db.QueryRow(`
		SELECT dataset_id, version, example_count, examples, created_at
		FROM dataset_version_snapshots
		WHERE dataset_id = $1 AND version = $2`,
		datasetID,
		version,
	).Scan(&snapshot.DatasetID, &snapshot.Version, &snapshot.ExampleCount, &examplesRaw, &snapshot.CreatedAt)
	if err != nil {
		return nil, err
	}

	if examplesRaw != "" {
		if err := json.Unmarshal([]byte(examplesRaw), &snapshot.Examples); err != nil {
			return nil, err
		}
	}

	return snapshot, nil
}
