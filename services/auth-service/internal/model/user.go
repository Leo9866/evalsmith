package model

import "time"

const (
	ProjectRoleOwner     = "owner"
	ProjectRoleAdmin     = "admin"
	ProjectRoleDeveloper = "developer"
	ProjectRoleAnnotator = "annotator"
	ProjectRoleViewer    = "viewer"
)

type User struct {
	ID           string    `json:"id" db:"id"`
	Email        string    `json:"email" db:"email"`
	Name         string    `json:"name" db:"name"`
	PasswordHash string    `json:"-" db:"password_hash"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time `json:"updated_at" db:"updated_at"`
}

type UserSession struct {
	ID        string     `json:"id" db:"id"`
	UserID    string     `json:"user_id" db:"user_id"`
	TokenHash string     `json:"-" db:"token_hash"`
	ExpiresAt time.Time  `json:"expires_at" db:"expires_at"`
	CreatedAt time.Time  `json:"created_at" db:"created_at"`
	LastSeen  *time.Time `json:"last_seen_at,omitempty" db:"last_seen_at"`
}

type ProjectMember struct {
	ProjectID string    `json:"project_id" db:"project_id"`
	UserID    string    `json:"user_id" db:"user_id"`
	Email     string    `json:"email" db:"email"`
	Name      string    `json:"name" db:"name"`
	Role      string    `json:"role" db:"role"`
	AddedBy   *string   `json:"added_by,omitempty" db:"added_by"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

type CreateUserRequest struct {
	Email    string `json:"email" binding:"required"`
	Name     string `json:"name" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type LoginRequest struct {
	Email    string `json:"email" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type AuthSessionResponse struct {
	User     *User     `json:"user"`
	Projects []Project `json:"projects"`
}

type AddProjectMemberRequest struct {
	Email string `json:"email" binding:"required"`
	Role  string `json:"role" binding:"required"`
}

type UpdateProjectMemberRequest struct {
	Role string `json:"role" binding:"required"`
}

func IsValidProjectRole(role string) bool {
	switch role {
	case ProjectRoleOwner, ProjectRoleAdmin, ProjectRoleDeveloper, ProjectRoleAnnotator, ProjectRoleViewer:
		return true
	default:
		return false
	}
}
