package service

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/evalsmith/auth-service/internal/model"
	"github.com/evalsmith/auth-service/internal/repository"
)

const (
	keyPrefix    = "ae_prod_sk_"
	keyRandomLen = 32 // 32 hex chars = 16 bytes
)

type APIKeyService struct {
	keyRepo     *repository.APIKeyRepository
	projectRepo *repository.ProjectRepository
	memberRepo  *repository.ProjectMemberRepository
}

var ErrAPIKeyAccessDenied = errors.New("api key access denied")

func NewAPIKeyService(
	keyRepo *repository.APIKeyRepository,
	projectRepo *repository.ProjectRepository,
	memberRepo *repository.ProjectMemberRepository,
) *APIKeyService {
	return &APIKeyService{
		keyRepo:     keyRepo,
		projectRepo: projectRepo,
		memberRepo:  memberRepo,
	}
}

func (s *APIKeyService) Generate(userID string, req *model.CreateAPIKeyRequest) (*model.APIKeyWithRaw, error) {
	// Verify project exists
	project, err := s.projectRepo.GetByIDForUser(req.ProjectID, userID)
	if err != nil {
		return nil, fmt.Errorf("check project: %w", err)
	}
	if project == nil {
		return nil, fmt.Errorf("project not found")
	}
	if !canManageAPIKeys(project.Role) {
		return nil, ErrAPIKeyAccessDenied
	}

	// Generate random key
	randomBytes := make([]byte, keyRandomLen/2) // 16 bytes = 32 hex chars
	if _, err := rand.Read(randomBytes); err != nil {
		return nil, fmt.Errorf("generate random bytes: %w", err)
	}
	rawKey := keyPrefix + hex.EncodeToString(randomBytes)

	// Hash the key for storage
	hash := sha256.Sum256([]byte(rawKey))
	keyHash := hex.EncodeToString(hash[:])

	// Store the first few chars as prefix for identification
	storedPrefix := rawKey[:len(keyPrefix)+8]

	name := req.Name
	if name == "" {
		name = "Default"
	}

	apiKey, err := s.keyRepo.Create(req.ProjectID, keyHash, storedPrefix, name)
	if err != nil {
		return nil, err
	}

	return &model.APIKeyWithRaw{
		APIKey: *apiKey,
		RawKey: rawKey,
	}, nil
}

func (s *APIKeyService) ListByProjectID(userID, projectID string) ([]model.APIKey, error) {
	member, err := s.memberRepo.Get(projectID, userID)
	if err != nil {
		return nil, err
	}
	if member == nil || !canManageAPIKeys(member.Role) {
		return nil, ErrAPIKeyAccessDenied
	}
	return s.keyRepo.ListByProjectID(projectID)
}

func (s *APIKeyService) Revoke(userID, id string) error {
	key, err := s.keyRepo.GetByID(id)
	if err != nil {
		return err
	}
	if key == nil {
		return fmt.Errorf("api key not found")
	}

	member, err := s.memberRepo.Get(key.ProjectID, userID)
	if err != nil {
		return err
	}
	if member == nil || !canManageAPIKeys(member.Role) {
		return ErrAPIKeyAccessDenied
	}

	err = s.keyRepo.Revoke(id)
	if err == sql.ErrNoRows {
		return fmt.Errorf("api key not found")
	}
	return err
}

func (s *APIKeyService) Verify(rawKey string) (*model.VerifyAPIKeyResponse, error) {
	hash := sha256.Sum256([]byte(rawKey))
	keyHash := hex.EncodeToString(hash[:])

	apiKey, err := s.keyRepo.GetByHash(keyHash)
	if err != nil {
		return nil, fmt.Errorf("verify api key: %w", err)
	}
	if apiKey == nil {
		return &model.VerifyAPIKeyResponse{Valid: false}, nil
	}
	if !apiKey.IsActive {
		return &model.VerifyAPIKeyResponse{Valid: false}, nil
	}

	// Update last used timestamp asynchronously (best effort)
	go func() {
		_ = s.keyRepo.UpdateLastUsed(apiKey.ID)
	}()

	return &model.VerifyAPIKeyResponse{
		Valid:     true,
		ProjectID: apiKey.ProjectID,
		KeyID:     apiKey.ID,
	}, nil
}

func canManageAPIKeys(role string) bool {
	return role == model.ProjectRoleOwner || role == model.ProjectRoleAdmin || role == model.ProjectRoleDeveloper
}
