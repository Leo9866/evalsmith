package service

import (
	"bytes"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/evalsmith/auth-service/internal/model"
)

const defaultProjectModelName = "默认 Judge 模型"

func (s *ProjectService) ListModels(userID, projectID string) ([]model.ProjectModelConfig, error) {
	project, err := s.repo.GetByIDForUser(projectID, userID)
	if err != nil {
		return nil, err
	}
	if project == nil {
		return nil, nil
	}
	if !canManageLLMConfig(project.Role) {
		return nil, ErrProjectAccessDenied
	}
	if err := s.ensureLegacyModelMigrated(projectID, userID); err != nil {
		return nil, err
	}
	return s.repo.ListProjectModels(projectID)
}

func (s *ProjectService) GetModel(userID, projectID, modelID string) (*model.ProjectModelConfig, error) {
	project, err := s.repo.GetByIDForUser(projectID, userID)
	if err != nil {
		return nil, err
	}
	if project == nil {
		return nil, nil
	}
	if !canManageLLMConfig(project.Role) {
		return nil, ErrProjectAccessDenied
	}
	if err := s.ensureLegacyModelMigrated(projectID, userID); err != nil {
		return nil, err
	}
	record, err := s.repo.GetProjectModel(projectID, modelID)
	if err != nil {
		return nil, err
	}
	if record == nil {
		return nil, nil
	}
	result := record.ProjectModelConfig
	return &result, nil
}

func (s *ProjectService) CreateModel(userID, projectID string, req *model.CreateProjectModelRequest) (*model.ProjectModelConfig, error) {
	project, err := s.repo.GetByIDForUser(projectID, userID)
	if err != nil {
		return nil, err
	}
	if project == nil {
		return nil, nil
	}
	if !canManageLLMConfig(project.Role) {
		return nil, ErrProjectAccessDenied
	}
	if err := s.ensureLegacyModelMigrated(projectID, userID); err != nil {
		return nil, err
	}

	record, err := s.buildProjectModelRecord(projectID, userID, req)
	if err != nil {
		return nil, err
	}
	return s.repo.CreateProjectModel(record)
}

func (s *ProjectService) UpdateModel(userID, projectID, modelID string, req *model.UpdateProjectModelRequest) (*model.ProjectModelConfig, error) {
	project, err := s.repo.GetByIDForUser(projectID, userID)
	if err != nil {
		return nil, err
	}
	if project == nil {
		return nil, nil
	}
	if !canManageLLMConfig(project.Role) {
		return nil, ErrProjectAccessDenied
	}
	if err := s.ensureLegacyModelMigrated(projectID, userID); err != nil {
		return nil, err
	}

	existing, err := s.repo.GetProjectModel(projectID, modelID)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, nil
	}

	normalizedName := strings.TrimSpace(req.Name)
	normalizedModel := strings.TrimSpace(req.Model)
	if normalizedName == "" {
		return nil, fmt.Errorf("model name is required")
	}
	if normalizedModel == "" {
		return nil, fmt.Errorf("model is required")
	}

	normalizedProvider := normalizeProvider(req.Provider)
	normalizedProtocol, err := normalizeProtocol(req.Protocol)
	if err != nil {
		return nil, err
	}

	apiKeyCiphertext := existing.APIKeyCiphertext
	apiKeyMasked := existing.APIKeyMasked
	hasAPIKey := existing.HasAPIKey
	if !req.PreserveAPIKey || strings.TrimSpace(req.APIKey) != "" {
		apiKeyCiphertext, err = s.secretCipher.Encrypt(strings.TrimSpace(req.APIKey))
		if err != nil {
			return nil, err
		}
		apiKeyMasked = maskSecret(req.APIKey)
		hasAPIKey = strings.TrimSpace(req.APIKey) != ""
	}

	extraConfig := req.ExtraConfig
	if extraConfig == nil {
		extraConfig = map[string]any{}
	}
	capabilities := normalizeCapabilities(req.Capabilities)
	status := normalizeModelStatus(req.Status)

	record := &model.ProjectModelSecret{
		ProjectModelConfig: model.ProjectModelConfig{
			ID:             existing.ID,
			ProjectID:      projectID,
			Name:           normalizedName,
			Provider:       normalizedProvider,
			Protocol:       normalizedProtocol,
			BaseURL:        strings.TrimSpace(req.BaseURL),
			Model:          normalizedModel,
			APIKeyMasked:   apiKeyMasked,
			HasAPIKey:      hasAPIKey,
			ExtraConfig:    extraConfig,
			Capabilities:   capabilities,
			IsDefaultJudge: req.IsDefaultJudge,
			Status:         status,
			CreatedBy:      existing.CreatedBy,
			CreatedAt:      existing.CreatedAt,
		},
		APIKeyCiphertext: apiKeyCiphertext,
	}
	return s.repo.UpdateProjectModel(record)
}

func (s *ProjectService) DeleteModel(userID, projectID, modelID string) error {
	project, err := s.repo.GetByIDForUser(projectID, userID)
	if err != nil {
		return err
	}
	if project == nil {
		return sql.ErrNoRows
	}
	if !canManageLLMConfig(project.Role) {
		return ErrProjectAccessDenied
	}
	deleted, err := s.repo.DeleteProjectModel(projectID, modelID)
	if err != nil {
		return err
	}
	if !deleted {
		return sql.ErrNoRows
	}
	return nil
}

func (s *ProjectService) SetDefaultModel(userID, projectID, modelID string) (*model.ProjectModelConfig, error) {
	project, err := s.repo.GetByIDForUser(projectID, userID)
	if err != nil {
		return nil, err
	}
	if project == nil {
		return nil, nil
	}
	if !canManageLLMConfig(project.Role) {
		return nil, ErrProjectAccessDenied
	}
	if err := s.ensureLegacyModelMigrated(projectID, userID); err != nil {
		return nil, err
	}
	return s.repo.SetDefaultProjectModel(projectID, modelID)
}

func (s *ProjectService) TestModel(userID, projectID, modelID string) (*model.ProjectModelTestResponse, error) {
	project, err := s.repo.GetByIDForUser(projectID, userID)
	if err != nil {
		return nil, err
	}
	if project == nil {
		return nil, nil
	}
	if !canManageLLMConfig(project.Role) {
		return nil, ErrProjectAccessDenied
	}
	if err := s.ensureLegacyModelMigrated(projectID, userID); err != nil {
		return nil, err
	}

	record, err := s.repo.GetProjectModel(projectID, modelID)
	if err != nil {
		return nil, err
	}
	if record == nil {
		return nil, nil
	}
	if record.Status != "active" {
		return &model.ProjectModelTestResponse{
			Success: false,
			Message: "归档模型不能进行连接测试",
		}, nil
	}

	apiKey, err := s.secretCipher.Decrypt(record.APIKeyCiphertext)
	if err != nil {
		return nil, err
	}
	return testProjectModelConnection(record.Protocol, record.BaseURL, record.Model, apiKey)
}

func (s *ProjectService) ResolveModel(projectID, modelID string, useDefault bool) (*model.ResolvedProjectModelConfig, error) {
	if err := s.ensureLegacyModelMigrated(projectID, ""); err != nil {
		return nil, err
	}

	var (
		record *model.ProjectModelSecret
		err    error
	)
	if useDefault || strings.TrimSpace(modelID) == "" {
		record, err = s.repo.GetDefaultProjectModel(projectID)
	} else {
		record, err = s.repo.GetProjectModel(projectID, modelID)
	}
	if err != nil {
		return nil, err
	}
	if record == nil {
		legacy, err := s.repo.GetLLMConfig(projectID)
		if err != nil {
			return nil, err
		}
		if legacy == nil {
			return nil, nil
		}
		if strings.TrimSpace(legacy.ProtocolConfig.Model) == "" &&
			strings.TrimSpace(legacy.ProtocolConfig.BaseURL) == "" &&
			strings.TrimSpace(legacy.ProtocolConfig.APIKey) == "" {
			return nil, nil
		}
		return &model.ResolvedProjectModelConfig{
			ID:             "",
			Name:           defaultProjectModelName,
			Provider:       normalizeProvider("openai_compatible"),
			Protocol:       normalizeProtocolFallback(legacy.Protocol),
			BaseURL:        strings.TrimSpace(legacy.ProtocolConfig.BaseURL),
			Model:          strings.TrimSpace(legacy.ProtocolConfig.Model),
			APIKey:         strings.TrimSpace(legacy.ProtocolConfig.APIKey),
			ExtraConfig:    map[string]any{},
			Capabilities:   model.DefaultProjectModelCapabilities(),
			IsDefaultJudge: true,
		}, nil
	}
	if record.Status != "active" {
		return nil, fmt.Errorf("project model is archived")
	}

	apiKey, err := s.secretCipher.Decrypt(record.APIKeyCiphertext)
	if err != nil {
		return nil, err
	}

	return &model.ResolvedProjectModelConfig{
		ID:             record.ID,
		Name:           record.Name,
		Provider:       record.Provider,
		Protocol:       record.Protocol,
		BaseURL:        record.BaseURL,
		Model:          record.Model,
		APIKey:         apiKey,
		ExtraConfig:    record.ExtraConfig,
		Capabilities:   record.Capabilities,
		IsDefaultJudge: record.IsDefaultJudge,
	}, nil
}

func (s *ProjectService) buildProjectModelRecord(projectID, userID string, req *model.CreateProjectModelRequest) (*model.ProjectModelSecret, error) {
	normalizedName := strings.TrimSpace(req.Name)
	normalizedModel := strings.TrimSpace(req.Model)
	if normalizedName == "" {
		return nil, fmt.Errorf("model name is required")
	}
	if normalizedModel == "" {
		return nil, fmt.Errorf("model is required")
	}

	normalizedProtocol, err := normalizeProtocol(req.Protocol)
	if err != nil {
		return nil, err
	}
	apiKey := strings.TrimSpace(req.APIKey)
	apiKeyCiphertext, err := s.secretCipher.Encrypt(apiKey)
	if err != nil {
		return nil, err
	}

	return &model.ProjectModelSecret{
		ProjectModelConfig: model.ProjectModelConfig{
			ID:             generateProjectModelID(),
			ProjectID:      projectID,
			Name:           normalizedName,
			Provider:       normalizeProvider(req.Provider),
			Protocol:       normalizedProtocol,
			BaseURL:        strings.TrimSpace(req.BaseURL),
			Model:          normalizedModel,
			APIKeyMasked:   maskSecret(apiKey),
			HasAPIKey:      apiKey != "",
			ExtraConfig:    normalizeExtraConfig(req.ExtraConfig),
			Capabilities:   normalizeCapabilities(req.Capabilities),
			IsDefaultJudge: req.IsDefaultJudge,
			Status:         "active",
			CreatedBy:      userID,
		},
		APIKeyCiphertext: apiKeyCiphertext,
	}, nil
}

func (s *ProjectService) ensureLegacyModelMigrated(projectID, userID string) error {
	hasModels, err := s.repo.HasProjectModels(projectID)
	if err != nil {
		return err
	}
	if hasModels {
		return nil
	}

	legacy, err := s.repo.GetLLMConfig(projectID)
	if err != nil {
		return err
	}
	if legacy == nil {
		return nil
	}

	baseURL := strings.TrimSpace(legacy.ProtocolConfig.BaseURL)
	modelName := strings.TrimSpace(legacy.ProtocolConfig.Model)
	apiKey := strings.TrimSpace(legacy.ProtocolConfig.APIKey)
	if baseURL == "" && modelName == "" && apiKey == "" {
		return nil
	}

	record, err := s.buildProjectModelRecord(projectID, userID, &model.CreateProjectModelRequest{
		Name:           defaultProjectModelName,
		Provider:       "openai_compatible",
		Protocol:       legacy.Protocol,
		BaseURL:        baseURL,
		Model:          modelName,
		APIKey:         apiKey,
		Capabilities:   model.DefaultProjectModelCapabilities(),
		IsDefaultJudge: true,
	})
	if err != nil {
		return err
	}
	if _, err := s.repo.CreateProjectModel(record); err != nil {
		return err
	}

	_, err = s.repo.UpdateLLMConfig(projectID, &model.UpdateProjectLLMConfigRequest{
		Protocol: record.Protocol,
		ProtocolConfig: model.LLMProtocolConfig{
			BaseURL: record.BaseURL,
			APIKey:  "",
			Model:   record.Model,
		},
	})
	return err
}

func normalizeProtocol(value string) (string, error) {
	protocol := normalizeProtocolFallback(value)
	if protocol != "openai" {
		return "", fmt.Errorf("unsupported llm protocol: %s", protocol)
	}
	return protocol, nil
}

func normalizeProtocolFallback(value string) string {
	protocol := strings.ToLower(strings.TrimSpace(value))
	if protocol == "" {
		return "openai"
	}
	return protocol
}

func normalizeProvider(value string) string {
	provider := strings.ToLower(strings.TrimSpace(value))
	if provider == "" {
		return "openai_compatible"
	}
	return provider
}

func normalizeExtraConfig(value map[string]any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	return value
}

func normalizeCapabilities(values []string) []string {
	if len(values) == 0 {
		return model.DefaultProjectModelCapabilities()
	}

	deduped := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		normalized := strings.ToLower(strings.TrimSpace(value))
		if normalized == "" {
			continue
		}
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		deduped = append(deduped, normalized)
	}

	if len(deduped) == 0 {
		return model.DefaultProjectModelCapabilities()
	}
	return deduped
}

func normalizeModelStatus(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "archived" {
		return "archived"
	}
	return "active"
}

func generateProjectModelID() string {
	buffer := make([]byte, 6)
	if _, err := rand.Read(buffer); err != nil {
		return fmt.Sprintf("mdl_%d", time.Now().UnixNano())
	}
	return "mdl_" + hex.EncodeToString(buffer)
}

func testProjectModelConnection(protocol, baseURL, modelName, apiKey string) (*model.ProjectModelTestResponse, error) {
	if normalizeProtocolFallback(protocol) != "openai" {
		return &model.ProjectModelTestResponse{
			Success: false,
			Message: fmt.Sprintf("暂不支持 %s 协议连接测试", protocol),
		}, nil
	}
	if strings.TrimSpace(baseURL) == "" {
		return &model.ProjectModelTestResponse{Success: false, Message: "Base URL 不能为空"}, nil
	}
	if strings.TrimSpace(modelName) == "" {
		return &model.ProjectModelTestResponse{Success: false, Message: "模型名称不能为空"}, nil
	}
	if strings.TrimSpace(apiKey) == "" {
		return &model.ProjectModelTestResponse{Success: false, Message: "API Key 尚未配置"}, nil
	}

	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	startedAt := time.Now()
	client := &http.Client{Timeout: 20 * time.Second}

	req, err := http.NewRequest(http.MethodGet, base+"/models", nil)
	if err != nil {
		return nil, fmt.Errorf("build test request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err == nil {
		defer resp.Body.Close()
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return &model.ProjectModelTestResponse{
				Success:   true,
				Message:   "连接成功，/models 已返回可用响应",
				LatencyMS: time.Since(startedAt).Milliseconds(),
				Endpoint:  base + "/models",
			}, nil
		}
		if resp.StatusCode != http.StatusNotFound && resp.StatusCode != http.StatusMethodNotAllowed {
			return &model.ProjectModelTestResponse{
				Success:   false,
				Message:   fmt.Sprintf("连接失败：HTTP %d %s", resp.StatusCode, strings.TrimSpace(string(body))),
				LatencyMS: time.Since(startedAt).Milliseconds(),
				Endpoint:  base + "/models",
			}, nil
		}
	}

	payload := map[string]any{
		"model": modelName,
		"messages": []map[string]string{
			{"role": "system", "content": "Reply with OK."},
			{"role": "user", "content": "ping"},
		},
		"temperature": 0,
		"max_tokens":  1,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal model test payload: %w", err)
	}
	req, err = http.NewRequest(http.MethodPost, base+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build fallback test request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err = client.Do(req)
	if err != nil {
		return &model.ProjectModelTestResponse{
			Success:  false,
			Message:  fmt.Sprintf("连接失败：%v", err),
			Endpoint: base + "/chat/completions",
		}, nil
	}
	defer resp.Body.Close()

	responseBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &model.ProjectModelTestResponse{
			Success:   false,
			Message:   fmt.Sprintf("连接失败：HTTP %d %s", resp.StatusCode, strings.TrimSpace(string(responseBody))),
			LatencyMS: time.Since(startedAt).Milliseconds(),
			Endpoint:  base + "/chat/completions",
		}, nil
	}

	return &model.ProjectModelTestResponse{
		Success:   true,
		Message:   "连接成功，chat/completions 已返回可用响应",
		LatencyMS: time.Since(startedAt).Milliseconds(),
		Endpoint:  base + "/chat/completions",
	}, nil
}
