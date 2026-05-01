package repository

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/evalsmith/auth-service/internal/model"
)

type APIKeyRepository struct {
	db *sql.DB
}

func NewAPIKeyRepository(db *sql.DB) *APIKeyRepository {
	return &APIKeyRepository{db: db}
}

func (r *APIKeyRepository) Create(projectID, keyHash, keyPrefix, name string) (*model.APIKey, error) {
	apiKey := &model.APIKey{}
	err := r.db.QueryRow(
		`INSERT INTO api_keys (project_id, key_hash, key_prefix, name)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, project_id, key_hash, key_prefix, name, is_active, created_at, last_used_at`,
		projectID, keyHash, keyPrefix, name,
	).Scan(
		&apiKey.ID, &apiKey.ProjectID, &apiKey.KeyHash, &apiKey.KeyPrefix,
		&apiKey.Name, &apiKey.IsActive, &apiKey.CreatedAt, &apiKey.LastUsedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("create api key: %w", err)
	}
	return apiKey, nil
}

func (r *APIKeyRepository) GetByHash(keyHash string) (*model.APIKey, error) {
	apiKey := &model.APIKey{}
	err := r.db.QueryRow(
		`SELECT id, project_id, key_hash, key_prefix, name, is_active, created_at, last_used_at
		 FROM api_keys WHERE key_hash = $1`,
		keyHash,
	).Scan(
		&apiKey.ID, &apiKey.ProjectID, &apiKey.KeyHash, &apiKey.KeyPrefix,
		&apiKey.Name, &apiKey.IsActive, &apiKey.CreatedAt, &apiKey.LastUsedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get api key by hash: %w", err)
	}
	return apiKey, nil
}

func (r *APIKeyRepository) GetByID(id string) (*model.APIKey, error) {
	apiKey := &model.APIKey{}
	err := r.db.QueryRow(
		`SELECT id, project_id, key_hash, key_prefix, name, is_active, created_at, last_used_at
		 FROM api_keys WHERE id = $1`,
		id,
	).Scan(
		&apiKey.ID, &apiKey.ProjectID, &apiKey.KeyHash, &apiKey.KeyPrefix,
		&apiKey.Name, &apiKey.IsActive, &apiKey.CreatedAt, &apiKey.LastUsedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get api key by id: %w", err)
	}
	return apiKey, nil
}

func (r *APIKeyRepository) ListByProjectID(projectID string) ([]model.APIKey, error) {
	rows, err := r.db.Query(
		`SELECT id, project_id, key_hash, key_prefix, name, is_active, created_at, last_used_at
		 FROM api_keys WHERE project_id = $1 ORDER BY created_at DESC`,
		projectID,
	)
	if err != nil {
		return nil, fmt.Errorf("list api keys: %w", err)
	}
	defer rows.Close()

	var keys []model.APIKey
	for rows.Next() {
		var k model.APIKey
		if err := rows.Scan(
			&k.ID, &k.ProjectID, &k.KeyHash, &k.KeyPrefix,
			&k.Name, &k.IsActive, &k.CreatedAt, &k.LastUsedAt,
		); err != nil {
			return nil, fmt.Errorf("scan api key: %w", err)
		}
		keys = append(keys, k)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate api keys: %w", err)
	}
	return keys, nil
}

func (r *APIKeyRepository) Revoke(id string) error {
	result, err := r.db.Exec(
		`UPDATE api_keys SET is_active = false WHERE id = $1`, id,
	)
	if err != nil {
		return fmt.Errorf("revoke api key: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("revoke api key rows affected: %w", err)
	}
	if rows == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (r *APIKeyRepository) UpdateLastUsed(id string) error {
	_, err := r.db.Exec(
		`UPDATE api_keys SET last_used_at = $1 WHERE id = $2`,
		time.Now(), id,
	)
	if err != nil {
		return fmt.Errorf("update last used: %w", err)
	}
	return nil
}
