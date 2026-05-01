package service

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/evalsmith/auth-service/internal/model"
	"github.com/evalsmith/auth-service/internal/repository"
)

type ProjectService struct {
	repo         *repository.ProjectRepository
	memberRepo   *repository.ProjectMemberRepository
	userRepo     *repository.UserRepository
	secretCipher *SecretCipher
}

var ErrProjectAccessDenied = errors.New("project access denied")

func NewProjectService(
	repo *repository.ProjectRepository,
	memberRepo *repository.ProjectMemberRepository,
	userRepo *repository.UserRepository,
	secretKey string,
) (*ProjectService, error) {
	secretCipher, err := NewSecretCipher(secretKey)
	if err != nil {
		return nil, err
	}
	return &ProjectService{
		repo:         repo,
		memberRepo:   memberRepo,
		userRepo:     userRepo,
		secretCipher: secretCipher,
	}, nil
}

func (s *ProjectService) Create(userID string, req *model.CreateProjectRequest) (*model.Project, error) {
	if req.Name == "" {
		return nil, fmt.Errorf("project name is required")
	}
	project, err := s.repo.Create(req)
	if err != nil {
		return nil, err
	}
	if _, err := s.memberRepo.Upsert(project.ID, userID, model.ProjectRoleOwner, &userID); err != nil {
		return nil, err
	}
	project.Role = model.ProjectRoleOwner
	return project, nil
}

func (s *ProjectService) GetByID(userID, id string) (*model.Project, error) {
	project, err := s.repo.GetByIDForUser(id, userID)
	if err != nil {
		return nil, err
	}
	if project == nil {
		return nil, nil
	}
	return project, nil
}

func (s *ProjectService) List(userID string) ([]model.Project, error) {
	return s.repo.ListByUser(userID)
}

func (s *ProjectService) Update(userID, id string, req *model.UpdateProjectRequest) (*model.Project, error) {
	existing, err := s.repo.GetByIDForUser(id, userID)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, nil
	}
	if !canManageProject(existing.Role) {
		return nil, ErrProjectAccessDenied
	}
	return s.repo.Update(id, req)
}

func (s *ProjectService) Delete(userID, id string) error {
	existing, err := s.repo.GetByIDForUser(id, userID)
	if err != nil {
		return err
	}
	if existing == nil {
		return sql.ErrNoRows
	}
	if !canManageProject(existing.Role) {
		return ErrProjectAccessDenied
	}
	return s.repo.Delete(id)
}

func (s *ProjectService) GetLLMConfig(userID, id string) (*model.ProjectLLMConfig, error) {
	existing, err := s.repo.GetByIDForUser(id, userID)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, nil
	}
	if !canManageLLMConfig(existing.Role) {
		return nil, ErrProjectAccessDenied
	}
	if err := s.ensureLegacyModelMigrated(id, userID); err != nil {
		return nil, err
	}

	defaultModel, err := s.repo.GetDefaultProjectModel(id)
	if err != nil {
		return nil, err
	}
	if defaultModel != nil {
		return &model.ProjectLLMConfig{
			Protocol: defaultModel.Protocol,
			ProtocolConfig: model.LLMProtocolConfig{
				BaseURL: defaultModel.BaseURL,
				APIKey:  defaultModel.APIKeyMasked,
				Model:   defaultModel.Model,
			},
		}, nil
	}

	return s.repo.GetLLMConfig(id)
}

func (s *ProjectService) UpdateLLMConfig(userID, id string, req *model.UpdateProjectLLMConfigRequest) (*model.ProjectLLMConfig, error) {
	existing, err := s.repo.GetByIDForUser(id, userID)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, nil
	}
	if !canManageLLMConfig(existing.Role) {
		return nil, ErrProjectAccessDenied
	}

	protocol := strings.TrimSpace(req.Protocol)
	if protocol == "" {
		req.Protocol = "openai"
	} else if protocol != "openai" {
		return nil, fmt.Errorf("unsupported llm protocol: %s", protocol)
	}

	req.ProtocolConfig.BaseURL = strings.TrimSpace(req.ProtocolConfig.BaseURL)
	req.ProtocolConfig.APIKey = strings.TrimSpace(req.ProtocolConfig.APIKey)
	req.ProtocolConfig.Model = strings.TrimSpace(req.ProtocolConfig.Model)

	if err := s.ensureLegacyModelMigrated(id, userID); err != nil {
		return nil, err
	}

	defaultModel, err := s.repo.GetDefaultProjectModel(id)
	if err != nil {
		return nil, err
	}

	if defaultModel == nil {
		created, err := s.CreateModel(userID, id, &model.CreateProjectModelRequest{
			Name:           defaultProjectModelName,
			Provider:       "openai_compatible",
			Protocol:       req.Protocol,
			BaseURL:        req.ProtocolConfig.BaseURL,
			Model:          req.ProtocolConfig.Model,
			APIKey:         req.ProtocolConfig.APIKey,
			Capabilities:   model.DefaultProjectModelCapabilities(),
			IsDefaultJudge: true,
		})
		if err != nil {
			return nil, err
		}
		return &model.ProjectLLMConfig{
			Protocol: created.Protocol,
			ProtocolConfig: model.LLMProtocolConfig{
				BaseURL: created.BaseURL,
				APIKey:  created.APIKeyMasked,
				Model:   created.Model,
			},
		}, nil
	}

	updated, err := s.UpdateModel(userID, id, defaultModel.ID, &model.UpdateProjectModelRequest{
		Name:           defaultModel.Name,
		Provider:       defaultModel.Provider,
		Protocol:       req.Protocol,
		BaseURL:        req.ProtocolConfig.BaseURL,
		Model:          req.ProtocolConfig.Model,
		APIKey:         req.ProtocolConfig.APIKey,
		PreserveAPIKey: req.ProtocolConfig.APIKey == "",
		ExtraConfig:    defaultModel.ExtraConfig,
		Capabilities:   defaultModel.Capabilities,
		IsDefaultJudge: true,
		Status:         "active",
	})
	if err != nil {
		return nil, err
	}
	if updated == nil {
		return nil, nil
	}
	return &model.ProjectLLMConfig{
		Protocol: updated.Protocol,
		ProtocolConfig: model.LLMProtocolConfig{
			BaseURL: updated.BaseURL,
			APIKey:  updated.APIKeyMasked,
			Model:   updated.Model,
		},
	}, nil
}

func (s *ProjectService) ListMembers(userID, projectID string) ([]model.ProjectMember, error) {
	project, err := s.repo.GetByIDForUser(projectID, userID)
	if err != nil {
		return nil, err
	}
	if project == nil {
		return nil, nil
	}
	return s.memberRepo.ListByProjectID(projectID)
}

func (s *ProjectService) AddMember(userID, projectID string, req *model.AddProjectMemberRequest) (*model.ProjectMember, error) {
	project, err := s.repo.GetByIDForUser(projectID, userID)
	if err != nil {
		return nil, err
	}
	if project == nil {
		return nil, nil
	}
	if !canManageMembers(project.Role) {
		return nil, ErrProjectAccessDenied
	}
	role := strings.ToLower(strings.TrimSpace(req.Role))
	if !model.IsValidProjectRole(role) {
		return nil, fmt.Errorf("invalid role: %s", req.Role)
	}
	user, err := s.userRepo.GetByEmail(strings.TrimSpace(req.Email))
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, sql.ErrNoRows
	}
	return s.memberRepo.Upsert(projectID, user.ID, role, &userID)
}

func (s *ProjectService) UpdateMemberRole(userID, projectID, memberUserID string, req *model.UpdateProjectMemberRequest) (*model.ProjectMember, error) {
	project, err := s.repo.GetByIDForUser(projectID, userID)
	if err != nil {
		return nil, err
	}
	if project == nil {
		return nil, nil
	}
	if !canManageMembers(project.Role) {
		return nil, ErrProjectAccessDenied
	}
	role := strings.ToLower(strings.TrimSpace(req.Role))
	if !model.IsValidProjectRole(role) {
		return nil, fmt.Errorf("invalid role: %s", req.Role)
	}
	return s.memberRepo.UpdateRole(projectID, memberUserID, role)
}

func (s *ProjectService) RemoveMember(userID, projectID, memberUserID string) error {
	project, err := s.repo.GetByIDForUser(projectID, userID)
	if err != nil {
		return err
	}
	if project == nil {
		return sql.ErrNoRows
	}
	if !canManageMembers(project.Role) {
		return ErrProjectAccessDenied
	}
	if userID == memberUserID && project.Role == model.ProjectRoleOwner {
		return fmt.Errorf("owner cannot remove themselves")
	}
	return s.memberRepo.Delete(projectID, memberUserID)
}

func (s *ProjectService) GetUserRole(userID, projectID string) (string, error) {
	member, err := s.memberRepo.Get(projectID, userID)
	if err != nil {
		return "", err
	}
	if member == nil {
		return "", nil
	}
	return member.Role, nil
}

func canManageProject(role string) bool {
	return role == model.ProjectRoleOwner || role == model.ProjectRoleAdmin
}

func canManageMembers(role string) bool {
	return role == model.ProjectRoleOwner || role == model.ProjectRoleAdmin
}

func canManageLLMConfig(role string) bool {
	return role == model.ProjectRoleOwner || role == model.ProjectRoleAdmin || role == model.ProjectRoleDeveloper
}
