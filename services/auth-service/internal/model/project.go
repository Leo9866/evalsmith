package model

import "time"

type Project struct {
	ID          string    `json:"id" db:"id"`
	Name        string    `json:"name" db:"name"`
	Description string    `json:"description" db:"description"`
	Role        string    `json:"role,omitempty" db:"role"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time `json:"updated_at" db:"updated_at"`
}

type LLMProtocolConfig struct {
	BaseURL string `json:"base_url"`
	APIKey  string `json:"api_key"`
	Model   string `json:"model"`
}

type ProjectLLMConfig struct {
	Protocol       string            `json:"protocol"`
	ProtocolConfig LLMProtocolConfig `json:"protocol_config"`
}

func DefaultProjectLLMConfig() *ProjectLLMConfig {
	return &ProjectLLMConfig{
		Protocol: "openai",
		ProtocolConfig: LLMProtocolConfig{
			BaseURL: "",
			APIKey:  "",
			Model:   "",
		},
	}
}

type CreateProjectRequest struct {
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
}

type UpdateProjectRequest struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
}

type UpdateProjectLLMConfigRequest struct {
	Protocol       string            `json:"protocol"`
	ProtocolConfig LLMProtocolConfig `json:"protocol_config"`
}
