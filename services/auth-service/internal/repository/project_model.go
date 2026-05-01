package repository

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/evalsmith/auth-service/internal/model"
)

func (r *ProjectRepository) ensureProjectModelSchema() error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS project_model_configs (
			id                TEXT PRIMARY KEY,
			project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			name              TEXT NOT NULL,
			provider          TEXT NOT NULL DEFAULT 'openai_compatible',
			protocol          TEXT NOT NULL DEFAULT 'openai',
			base_url          TEXT NOT NULL DEFAULT '',
			model             TEXT NOT NULL,
			api_key_ciphertext TEXT NOT NULL DEFAULT '',
			api_key_masked    TEXT NOT NULL DEFAULT '',
			extra_config      JSONB NOT NULL DEFAULT '{}'::jsonb,
			capabilities      JSONB NOT NULL DEFAULT '[]'::jsonb,
			is_default_judge  BOOLEAN NOT NULL DEFAULT FALSE,
			status            TEXT NOT NULL DEFAULT 'active',
			created_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
			created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_project_model_configs_project_name
			ON project_model_configs(project_id, name)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_project_model_configs_default_judge
			ON project_model_configs(project_id)
			WHERE is_default_judge = TRUE AND status = 'active'`,
		`CREATE INDEX IF NOT EXISTS idx_project_model_configs_project_updated
			ON project_model_configs(project_id, updated_at DESC)`,
	}

	for _, statement := range statements {
		if _, err := r.db.Exec(statement); err != nil {
			return fmt.Errorf("ensure project model schema: %w", err)
		}
	}
	return nil
}

func (r *ProjectRepository) HasProjectModels(projectID string) (bool, error) {
	var found bool
	err := r.db.QueryRow(
		`SELECT EXISTS(SELECT 1 FROM project_model_configs WHERE project_id = $1)`,
		projectID,
	).Scan(&found)
	if err != nil {
		return false, fmt.Errorf("check project models: %w", err)
	}
	return found, nil
}

func (r *ProjectRepository) ListProjectModels(projectID string) ([]model.ProjectModelConfig, error) {
	rows, err := r.db.Query(
		`SELECT id, project_id, name, provider, protocol, base_url, model,
		        api_key_ciphertext, api_key_masked, extra_config::text, capabilities::text,
		        is_default_judge, status, COALESCE(created_by, ''), created_at, updated_at
		   FROM project_model_configs
		  WHERE project_id = $1
		  ORDER BY is_default_judge DESC, updated_at DESC, created_at DESC`,
		projectID,
	)
	if err != nil {
		return nil, fmt.Errorf("list project models: %w", err)
	}
	defer rows.Close()

	items := make([]model.ProjectModelConfig, 0)
	for rows.Next() {
		record, err := scanProjectModel(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, record.ProjectModelConfig)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate project models: %w", err)
	}
	return items, nil
}

func (r *ProjectRepository) GetProjectModel(projectID, modelID string) (*model.ProjectModelSecret, error) {
	row := r.db.QueryRow(
		`SELECT id, project_id, name, provider, protocol, base_url, model,
		        api_key_ciphertext, api_key_masked, extra_config::text, capabilities::text,
		        is_default_judge, status, COALESCE(created_by, ''), created_at, updated_at
		   FROM project_model_configs
		  WHERE project_id = $1 AND id = $2`,
		projectID,
		modelID,
	)
	record, err := scanProjectModel(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get project model: %w", err)
	}
	return record, nil
}

func (r *ProjectRepository) GetDefaultProjectModel(projectID string) (*model.ProjectModelSecret, error) {
	row := r.db.QueryRow(
		`SELECT id, project_id, name, provider, protocol, base_url, model,
		        api_key_ciphertext, api_key_masked, extra_config::text, capabilities::text,
		        is_default_judge, status, COALESCE(created_by, ''), created_at, updated_at
		   FROM project_model_configs
		  WHERE project_id = $1 AND is_default_judge = TRUE AND status = 'active'
		  ORDER BY updated_at DESC
		  LIMIT 1`,
		projectID,
	)
	record, err := scanProjectModel(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get default project model: %w", err)
	}
	return record, nil
}

func (r *ProjectRepository) CreateProjectModel(record *model.ProjectModelSecret) (*model.ProjectModelConfig, error) {
	createdAt := time.Now().UTC()
	record.CreatedAt = createdAt
	record.UpdatedAt = createdAt

	configJSON, capabilitiesJSON, err := marshalProjectModelJSON(record.ExtraConfig, record.Capabilities)
	if err != nil {
		return nil, err
	}

	tx, err := r.db.Begin()
	if err != nil {
		return nil, fmt.Errorf("begin create project model: %w", err)
	}
	defer tx.Rollback()

	if record.IsDefaultJudge {
		if _, err := tx.Exec(
			`UPDATE project_model_configs
			    SET is_default_judge = FALSE, updated_at = $2
			  WHERE project_id = $1`,
			record.ProjectID,
			record.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("clear default project model: %w", err)
		}
	}

	if _, err := tx.Exec(
		`INSERT INTO project_model_configs (
			id, project_id, name, provider, protocol, base_url, model,
			api_key_ciphertext, api_key_masked, extra_config, capabilities,
			is_default_judge, status, created_by, created_at, updated_at
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7,
			$8, $9, $10::jsonb, $11::jsonb,
			$12, $13, NULLIF($14, ''), $15, $16
		)`,
		record.ID,
		record.ProjectID,
		record.Name,
		record.Provider,
		record.Protocol,
		record.BaseURL,
		record.Model,
		record.APIKeyCiphertext,
		record.APIKeyMasked,
		configJSON,
		capabilitiesJSON,
		record.IsDefaultJudge,
		record.Status,
		record.CreatedBy,
		record.CreatedAt,
		record.UpdatedAt,
	); err != nil {
		return nil, fmt.Errorf("insert project model: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit create project model: %w", err)
	}
	result := record.ProjectModelConfig
	return &result, nil
}

func (r *ProjectRepository) UpdateProjectModel(record *model.ProjectModelSecret) (*model.ProjectModelConfig, error) {
	record.UpdatedAt = time.Now().UTC()
	configJSON, capabilitiesJSON, err := marshalProjectModelJSON(record.ExtraConfig, record.Capabilities)
	if err != nil {
		return nil, err
	}

	tx, err := r.db.Begin()
	if err != nil {
		return nil, fmt.Errorf("begin update project model: %w", err)
	}
	defer tx.Rollback()

	if record.IsDefaultJudge {
		if _, err := tx.Exec(
			`UPDATE project_model_configs
			    SET is_default_judge = FALSE, updated_at = $2
			  WHERE project_id = $1 AND id <> $3`,
			record.ProjectID,
			record.UpdatedAt,
			record.ID,
		); err != nil {
			return nil, fmt.Errorf("clear project model defaults: %w", err)
		}
	}

	result, err := tx.Exec(
		`UPDATE project_model_configs
		    SET name = $3,
		        provider = $4,
		        protocol = $5,
		        base_url = $6,
		        model = $7,
		        api_key_ciphertext = $8,
		        api_key_masked = $9,
		        extra_config = $10::jsonb,
		        capabilities = $11::jsonb,
		        is_default_judge = $12,
		        status = $13,
		        updated_at = $14
		  WHERE project_id = $1 AND id = $2`,
		record.ProjectID,
		record.ID,
		record.Name,
		record.Provider,
		record.Protocol,
		record.BaseURL,
		record.Model,
		record.APIKeyCiphertext,
		record.APIKeyMasked,
		configJSON,
		capabilitiesJSON,
		record.IsDefaultJudge,
		record.Status,
		record.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("update project model: %w", err)
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return nil, fmt.Errorf("project model rows affected: %w", err)
	}
	if rowsAffected == 0 {
		return nil, nil
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit update project model: %w", err)
	}
	resultRecord := record.ProjectModelConfig
	return &resultRecord, nil
}

func (r *ProjectRepository) DeleteProjectModel(projectID, modelID string) (bool, error) {
	result, err := r.db.Exec(
		`DELETE FROM project_model_configs WHERE project_id = $1 AND id = $2`,
		projectID,
		modelID,
	)
	if err != nil {
		return false, fmt.Errorf("delete project model: %w", err)
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("delete project model rows affected: %w", err)
	}
	return rowsAffected > 0, nil
}

func (r *ProjectRepository) SetDefaultProjectModel(projectID, modelID string) (*model.ProjectModelConfig, error) {
	tx, err := r.db.Begin()
	if err != nil {
		return nil, fmt.Errorf("begin set default project model: %w", err)
	}
	defer tx.Rollback()

	updatedAt := time.Now().UTC()
	if _, err := tx.Exec(
		`UPDATE project_model_configs
		    SET is_default_judge = FALSE, updated_at = $2
		  WHERE project_id = $1`,
		projectID,
		updatedAt,
	); err != nil {
		return nil, fmt.Errorf("clear project model defaults: %w", err)
	}

	result, err := tx.Exec(
		`UPDATE project_model_configs
		    SET is_default_judge = TRUE, status = 'active', updated_at = $3
		  WHERE project_id = $1 AND id = $2`,
		projectID,
		modelID,
		updatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("set default project model: %w", err)
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return nil, fmt.Errorf("set default project model rows affected: %w", err)
	}
	if rowsAffected == 0 {
		return nil, nil
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit default project model: %w", err)
	}
	record, err := r.GetProjectModel(projectID, modelID)
	if err != nil {
		return nil, err
	}
	if record == nil {
		return nil, nil
	}
	resultConfig := record.ProjectModelConfig
	return &resultConfig, nil
}

func scanProjectModel(scanner interface{ Scan(dest ...any) error }) (*model.ProjectModelSecret, error) {
	var (
		record           model.ProjectModelSecret
		extraConfigRaw   string
		capabilitiesRaw  string
		apiKeyCiphertext string
		apiKeyMasked     string
		createdBy        string
	)

	err := scanner.Scan(
		&record.ID,
		&record.ProjectID,
		&record.Name,
		&record.Provider,
		&record.Protocol,
		&record.BaseURL,
		&record.Model,
		&apiKeyCiphertext,
		&apiKeyMasked,
		&extraConfigRaw,
		&capabilitiesRaw,
		&record.IsDefaultJudge,
		&record.Status,
		&createdBy,
		&record.CreatedAt,
		&record.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	record.APIKeyCiphertext = apiKeyCiphertext
	record.APIKeyMasked = apiKeyMasked
	record.HasAPIKey = strings.TrimSpace(apiKeyCiphertext) != ""
	record.CreatedBy = createdBy
	record.ExtraConfig = map[string]any{}
	record.Capabilities = []string{}

	if strings.TrimSpace(extraConfigRaw) != "" {
		if err := json.Unmarshal([]byte(extraConfigRaw), &record.ExtraConfig); err != nil {
			return nil, fmt.Errorf("decode project model extra_config: %w", err)
		}
	}
	if strings.TrimSpace(capabilitiesRaw) != "" {
		if err := json.Unmarshal([]byte(capabilitiesRaw), &record.Capabilities); err != nil {
			return nil, fmt.Errorf("decode project model capabilities: %w", err)
		}
	}

	return &record, nil
}

func marshalProjectModelJSON(extraConfig map[string]any, capabilities []string) (string, string, error) {
	if extraConfig == nil {
		extraConfig = map[string]any{}
	}
	if capabilities == nil {
		capabilities = []string{}
	}

	extraConfigBytes, err := json.Marshal(extraConfig)
	if err != nil {
		return "", "", fmt.Errorf("marshal project model extra_config: %w", err)
	}
	capabilitiesBytes, err := json.Marshal(capabilities)
	if err != nil {
		return "", "", fmt.Errorf("marshal project model capabilities: %w", err)
	}
	return string(extraConfigBytes), string(capabilitiesBytes), nil
}
