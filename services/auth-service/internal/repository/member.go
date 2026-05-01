package repository

import (
	"database/sql"
	"fmt"

	"github.com/evalsmith/auth-service/internal/model"
)

type ProjectMemberRepository struct {
	db *sql.DB
}

func NewProjectMemberRepository(db *sql.DB) *ProjectMemberRepository {
	return &ProjectMemberRepository{db: db}
}

func (r *ProjectMemberRepository) EnsureSchema() error {
	_, err := r.db.Exec(`
		CREATE TABLE IF NOT EXISTS project_members (
			project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			role        TEXT NOT NULL DEFAULT 'developer',
			added_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
			created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
			PRIMARY KEY (project_id, user_id)
		)
	`)
	if err != nil {
		return fmt.Errorf("ensure project_members table: %w", err)
	}
	_, err = r.db.Exec(`CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id)`)
	if err != nil {
		return fmt.Errorf("ensure project_members index: %w", err)
	}
	return nil
}

func (r *ProjectMemberRepository) Upsert(projectID, userID, role string, addedBy *string) (*model.ProjectMember, error) {
	member := &model.ProjectMember{}
	err := r.db.QueryRow(
		`INSERT INTO project_members (project_id, user_id, role, added_by)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (project_id, user_id)
		 DO UPDATE SET role = EXCLUDED.role, added_by = EXCLUDED.added_by
		 RETURNING project_id, user_id, role, added_by, created_at`,
		projectID, userID, role, addedBy,
	).Scan(&member.ProjectID, &member.UserID, &member.Role, &member.AddedBy, &member.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("upsert project member: %w", err)
	}

	user, err := r.getUserSummary(userID)
	if err != nil {
		return nil, err
	}
	member.Email = user.Email
	member.Name = user.Name
	return member, nil
}

func (r *ProjectMemberRepository) Get(projectID, userID string) (*model.ProjectMember, error) {
	member := &model.ProjectMember{}
	err := r.db.QueryRow(
		`SELECT pm.project_id, pm.user_id, u.email, u.name, pm.role, pm.added_by, pm.created_at
		 FROM project_members pm
		 JOIN users u ON u.id = pm.user_id
		 WHERE pm.project_id = $1 AND pm.user_id = $2`,
		projectID, userID,
	).Scan(&member.ProjectID, &member.UserID, &member.Email, &member.Name, &member.Role, &member.AddedBy, &member.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get project member: %w", err)
	}
	return member, nil
}

func (r *ProjectMemberRepository) ListByProjectID(projectID string) ([]model.ProjectMember, error) {
	rows, err := r.db.Query(
		`SELECT pm.project_id, pm.user_id, u.email, u.name, pm.role, pm.added_by, pm.created_at
		 FROM project_members pm
		 JOIN users u ON u.id = pm.user_id
		 WHERE pm.project_id = $1
		 ORDER BY pm.created_at ASC`,
		projectID,
	)
	if err != nil {
		return nil, fmt.Errorf("list project members: %w", err)
	}
	defer rows.Close()

	var members []model.ProjectMember
	for rows.Next() {
		var member model.ProjectMember
		if err := rows.Scan(&member.ProjectID, &member.UserID, &member.Email, &member.Name, &member.Role, &member.AddedBy, &member.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan project member: %w", err)
		}
		members = append(members, member)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate project members: %w", err)
	}
	return members, nil
}

func (r *ProjectMemberRepository) UpdateRole(projectID, userID, role string) (*model.ProjectMember, error) {
	member := &model.ProjectMember{}
	err := r.db.QueryRow(
		`UPDATE project_members
		 SET role = $1
		 WHERE project_id = $2 AND user_id = $3
		 RETURNING project_id, user_id, role, added_by, created_at`,
		role, projectID, userID,
	).Scan(&member.ProjectID, &member.UserID, &member.Role, &member.AddedBy, &member.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("update project member role: %w", err)
	}

	user, err := r.getUserSummary(userID)
	if err != nil {
		return nil, err
	}
	member.Email = user.Email
	member.Name = user.Name
	return member, nil
}

func (r *ProjectMemberRepository) Delete(projectID, userID string) error {
	result, err := r.db.Exec(`DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`, projectID, userID)
	if err != nil {
		return fmt.Errorf("delete project member: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("delete project member rows affected: %w", err)
	}
	if rows == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (r *ProjectMemberRepository) CountByUserID(userID string) (int, error) {
	var count int
	err := r.db.QueryRow(`SELECT COUNT(*) FROM project_members WHERE user_id = $1`, userID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count project members by user: %w", err)
	}
	return count, nil
}

func (r *ProjectMemberRepository) getUserSummary(userID string) (*model.User, error) {
	user := &model.User{}
	err := r.db.QueryRow(`SELECT id, email, name, password_hash, created_at, updated_at FROM users WHERE id = $1`, userID).
		Scan(&user.ID, &user.Email, &user.Name, &user.PasswordHash, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get user summary for project member: %w", err)
	}
	return user, nil
}
