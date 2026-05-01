package model

import "time"

type ProjectModelConfig struct {
	ID             string         `json:"id"`
	ProjectID      string         `json:"project_id"`
	Name           string         `json:"name"`
	Provider       string         `json:"provider"`
	Protocol       string         `json:"protocol"`
	BaseURL        string         `json:"base_url"`
	Model          string         `json:"model"`
	APIKeyMasked   string         `json:"api_key_masked"`
	HasAPIKey      bool           `json:"has_api_key"`
	ExtraConfig    map[string]any `json:"extra_config"`
	Capabilities   []string       `json:"capabilities"`
	IsDefaultJudge bool           `json:"is_default_judge"`
	Status         string         `json:"status"`
	CreatedBy      string         `json:"created_by,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
}

type ProjectModelSecret struct {
	ProjectModelConfig
	APIKeyCiphertext string `json:"-"`
}

type CreateProjectModelRequest struct {
	Name           string         `json:"name" binding:"required"`
	Provider       string         `json:"provider"`
	Protocol       string         `json:"protocol"`
	BaseURL        string         `json:"base_url"`
	Model          string         `json:"model" binding:"required"`
	APIKey         string         `json:"api_key"`
	ExtraConfig    map[string]any `json:"extra_config"`
	Capabilities   []string       `json:"capabilities"`
	IsDefaultJudge bool           `json:"is_default_judge"`
}

type UpdateProjectModelRequest struct {
	Name           string         `json:"name" binding:"required"`
	Provider       string         `json:"provider"`
	Protocol       string         `json:"protocol"`
	BaseURL        string         `json:"base_url"`
	Model          string         `json:"model" binding:"required"`
	APIKey         string         `json:"api_key"`
	PreserveAPIKey bool           `json:"preserve_api_key"`
	ExtraConfig    map[string]any `json:"extra_config"`
	Capabilities   []string       `json:"capabilities"`
	IsDefaultJudge bool           `json:"is_default_judge"`
	Status         string         `json:"status"`
}

type ProjectModelTestResponse struct {
	Success   bool   `json:"success"`
	Message   string `json:"message"`
	LatencyMS int64  `json:"latency_ms"`
	Endpoint  string `json:"endpoint"`
}

type ResolvedProjectModelConfig struct {
	ID             string         `json:"id"`
	Name           string         `json:"name"`
	Provider       string         `json:"provider"`
	Protocol       string         `json:"protocol"`
	BaseURL        string         `json:"base_url"`
	Model          string         `json:"model"`
	APIKey         string         `json:"api_key"`
	ExtraConfig    map[string]any `json:"extra_config"`
	Capabilities   []string       `json:"capabilities"`
	IsDefaultJudge bool           `json:"is_default_judge"`
}

func DefaultProjectModelCapabilities() []string {
	return []string{"judge"}
}
