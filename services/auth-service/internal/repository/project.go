package repository

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/evalsmith/auth-service/internal/model"
)

type ProjectRepository struct {
	db *sql.DB
}

func NewProjectRepository(db *sql.DB) *ProjectRepository {
	return &ProjectRepository{db: db}
}

func (r *ProjectRepository) EnsureSchema() error {
	_, err := r.db.Exec(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS llm_config JSONB NOT NULL DEFAULT '{}'::jsonb`)
	if err != nil {
		return fmt.Errorf("ensure projects llm_config column: %w", err)
	}
	if err := r.ensureProjectModelSchema(); err != nil {
		return err
	}
	return nil
}

func (r *ProjectRepository) Create(req *model.CreateProjectRequest) (*model.Project, error) {
	project := &model.Project{}
	err := r.db.QueryRow(
		`INSERT INTO projects (name, description) VALUES ($1, $2)
		 RETURNING id, name, description, created_at, updated_at`,
		req.Name, req.Description,
	).Scan(&project.ID, &project.Name, &project.Description, &project.CreatedAt, &project.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create project: %w", err)
	}
	return project, nil
}

func (r *ProjectRepository) GetByID(id string) (*model.Project, error) {
	project := &model.Project{}
	err := r.db.QueryRow(
		`SELECT id, name, description, created_at, updated_at FROM projects WHERE id = $1`,
		id,
	).Scan(&project.ID, &project.Name, &project.Description, &project.CreatedAt, &project.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get project: %w", err)
	}
	return project, nil
}

func (r *ProjectRepository) GetByIDForUser(id, userID string) (*model.Project, error) {
	project := &model.Project{}
	err := r.db.QueryRow(
		`SELECT p.id, p.name, p.description, pm.role, p.created_at, p.updated_at
		 FROM projects p
		 JOIN project_members pm ON pm.project_id = p.id
		 WHERE p.id = $1 AND pm.user_id = $2`,
		id, userID,
	).Scan(&project.ID, &project.Name, &project.Description, &project.Role, &project.CreatedAt, &project.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get project for user: %w", err)
	}
	return project, nil
}

func (r *ProjectRepository) List() ([]model.Project, error) {
	rows, err := r.db.Query(
		`SELECT id, name, description, created_at, updated_at FROM projects ORDER BY created_at DESC`,
	)
	if err != nil {
		return nil, fmt.Errorf("list projects: %w", err)
	}
	defer rows.Close()

	var projects []model.Project
	for rows.Next() {
		var p model.Project
		if err := rows.Scan(&p.ID, &p.Name, &p.Description, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan project: %w", err)
		}
		projects = append(projects, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate projects: %w", err)
	}
	return projects, nil
}

func (r *ProjectRepository) ListByUser(userID string) ([]model.Project, error) {
	rows, err := r.db.Query(
		`SELECT p.id, p.name, p.description, pm.role, p.created_at, p.updated_at
		 FROM projects p
		 JOIN project_members pm ON pm.project_id = p.id
		 WHERE pm.user_id = $1
		 ORDER BY p.created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("list projects by user: %w", err)
	}
	defer rows.Close()

	var projects []model.Project
	for rows.Next() {
		var p model.Project
		if err := rows.Scan(&p.ID, &p.Name, &p.Description, &p.Role, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan project by user: %w", err)
		}
		projects = append(projects, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate projects by user: %w", err)
	}
	return projects, nil
}

func (r *ProjectRepository) Update(id string, req *model.UpdateProjectRequest) (*model.Project, error) {
	setClauses := []string{}
	args := []interface{}{}
	argIdx := 1

	if req.Name != nil {
		setClauses = append(setClauses, fmt.Sprintf("name = $%d", argIdx))
		args = append(args, *req.Name)
		argIdx++
	}
	if req.Description != nil {
		setClauses = append(setClauses, fmt.Sprintf("description = $%d", argIdx))
		args = append(args, *req.Description)
		argIdx++
	}

	if len(setClauses) == 0 {
		return r.GetByID(id)
	}

	setClauses = append(setClauses, fmt.Sprintf("updated_at = $%d", argIdx))
	args = append(args, time.Now())
	argIdx++

	args = append(args, id)
	query := fmt.Sprintf(
		`UPDATE projects SET %s WHERE id = $%d
		 RETURNING id, name, description, created_at, updated_at`,
		strings.Join(setClauses, ", "), argIdx,
	)

	project := &model.Project{}
	err := r.db.QueryRow(query, args...).Scan(
		&project.ID, &project.Name, &project.Description, &project.CreatedAt, &project.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("update project: %w", err)
	}
	return project, nil
}

func (r *ProjectRepository) Delete(id string) error {
	result, err := r.db.Exec(`DELETE FROM projects WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete project: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("delete project rows affected: %w", err)
	}
	if rows == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (r *ProjectRepository) GetLLMConfig(id string) (*model.ProjectLLMConfig, error) {
	var raw string
	err := r.db.QueryRow(
		`SELECT COALESCE(llm_config, '{}'::jsonb)::text FROM projects WHERE id = $1`,
		id,
	).Scan(&raw)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get project llm config: %w", err)
	}

	config := model.DefaultProjectLLMConfig()
	if raw != "" && raw != "{}" {
		if err := json.Unmarshal([]byte(raw), config); err != nil {
			return nil, fmt.Errorf("decode project llm config: %w", err)
		}
	}
	if config.Protocol == "" {
		config.Protocol = "openai"
	}
	return config, nil
}

func (r *ProjectRepository) UpdateLLMConfig(id string, req *model.UpdateProjectLLMConfigRequest) (*model.ProjectLLMConfig, error) {
	config := model.DefaultProjectLLMConfig()
	if req.Protocol != "" {
		config.Protocol = req.Protocol
	}
	config.ProtocolConfig = req.ProtocolConfig

	payload, err := json.Marshal(config)
	if err != nil {
		return nil, fmt.Errorf("marshal project llm config: %w", err)
	}

	var stored string
	err = r.db.QueryRow(
		`UPDATE projects
		 SET llm_config = $1::jsonb, updated_at = $2
		 WHERE id = $3
		 RETURNING llm_config::text`,
		string(payload),
		time.Now(),
		id,
	).Scan(&stored)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("update project llm config: %w", err)
	}

	result := model.DefaultProjectLLMConfig()
	if stored != "" && stored != "{}" {
		if err := json.Unmarshal([]byte(stored), result); err != nil {
			return nil, fmt.Errorf("decode updated project llm config: %w", err)
		}
	}
	if result.Protocol == "" {
		result.Protocol = "openai"
	}
	return result, nil
}
