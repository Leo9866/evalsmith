package model

type AuthAccessResponse struct {
	UserID     string `json:"user_id,omitempty"`
	ProjectID  string `json:"project_id"`
	Role       string `json:"role"`
	AuthMethod string `json:"auth_method"`
	KeyID      string `json:"key_id,omitempty"`
	SessionID  string `json:"session_id,omitempty"`
}
