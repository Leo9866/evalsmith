package model

import "time"

type APIKey struct {
	ID         string     `json:"id" db:"id"`
	ProjectID  string     `json:"project_id" db:"project_id"`
	KeyHash    string     `json:"-" db:"key_hash"`
	KeyPrefix  string     `json:"key_prefix" db:"key_prefix"`
	Name       string     `json:"name" db:"name"`
	IsActive   bool       `json:"is_active" db:"is_active"`
	CreatedAt  time.Time  `json:"created_at" db:"created_at"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty" db:"last_used_at"`
}

type APIKeyWithRaw struct {
	APIKey
	RawKey string `json:"raw_key"`
}

type CreateAPIKeyRequest struct {
	ProjectID string `json:"project_id" binding:"required"`
	Name      string `json:"name"`
}

type VerifyAPIKeyRequest struct {
	APIKey string `json:"api_key" binding:"required"`
}

type VerifyAPIKeyResponse struct {
	Valid     bool   `json:"valid"`
	ProjectID string `json:"project_id,omitempty"`
	KeyID     string `json:"key_id,omitempty"`
}
