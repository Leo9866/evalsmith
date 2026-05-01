package service

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/evalsmith/auth-service/internal/model"
	"github.com/evalsmith/auth-service/internal/repository"
	"golang.org/x/crypto/bcrypt"
)

const (
	defaultProjectID = "proj_default"
	sessionTTL       = 7 * 24 * time.Hour
)

var (
	ErrEmailExists        = errors.New("email already exists")
	ErrInvalidCredentials = errors.New("invalid email or password")
	ErrSessionNotFound    = errors.New("session not found")
	ErrSessionExpired     = errors.New("session expired")
)

type AuthService struct {
	userRepo    *repository.UserRepository
	sessionRepo *repository.SessionRepository
	projectRepo *repository.ProjectRepository
	memberRepo  *repository.ProjectMemberRepository
}

func NewAuthService(
	userRepo *repository.UserRepository,
	sessionRepo *repository.SessionRepository,
	projectRepo *repository.ProjectRepository,
	memberRepo *repository.ProjectMemberRepository,
) *AuthService {
	return &AuthService{
		userRepo:    userRepo,
		sessionRepo: sessionRepo,
		projectRepo: projectRepo,
		memberRepo:  memberRepo,
	}
}

func (s *AuthService) Register(req *model.CreateUserRequest) (*model.AuthSessionResponse, string, error) {
	email := strings.ToLower(strings.TrimSpace(req.Email))
	name := strings.TrimSpace(req.Name)
	password := strings.TrimSpace(req.Password)

	if email == "" || name == "" || password == "" {
		return nil, "", fmt.Errorf("name, email and password are required")
	}
	if len(password) < 8 {
		return nil, "", fmt.Errorf("password must be at least 8 characters")
	}

	existing, err := s.userRepo.GetByEmail(email)
	if err != nil {
		return nil, "", err
	}
	if existing != nil {
		return nil, "", ErrEmailExists
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, "", fmt.Errorf("hash password: %w", err)
	}

	user, err := s.userRepo.Create(email, name, string(passwordHash))
	if err != nil {
		return nil, "", err
	}

	if err := s.ensureBootstrapMembership(user.ID); err != nil {
		return nil, "", err
	}

	token, err := s.createSession(user.ID)
	if err != nil {
		return nil, "", err
	}

	profile, err := s.BuildSessionProfile(user.ID)
	if err != nil {
		return nil, "", err
	}
	return profile, token, nil
}

func (s *AuthService) Login(req *model.LoginRequest) (*model.AuthSessionResponse, string, error) {
	email := strings.ToLower(strings.TrimSpace(req.Email))
	password := strings.TrimSpace(req.Password)
	if email == "" || password == "" {
		return nil, "", fmt.Errorf("email and password are required")
	}

	user, err := s.userRepo.GetByEmail(email)
	if err != nil {
		return nil, "", err
	}
	if user == nil {
		return nil, "", ErrInvalidCredentials
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return nil, "", ErrInvalidCredentials
	}

	if err := s.ensureBootstrapMembership(user.ID); err != nil {
		return nil, "", err
	}

	token, err := s.createSession(user.ID)
	if err != nil {
		return nil, "", err
	}

	profile, err := s.BuildSessionProfile(user.ID)
	if err != nil {
		return nil, "", err
	}
	return profile, token, nil
}

func (s *AuthService) BuildSessionProfile(userID string) (*model.AuthSessionResponse, error) {
	user, err := s.userRepo.GetByID(userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, ErrSessionNotFound
	}

	projects, err := s.projectRepo.ListByUser(userID)
	if err != nil {
		return nil, err
	}
	if projects == nil {
		projects = []model.Project{}
	}

	return &model.AuthSessionResponse{
		User:     user,
		Projects: projects,
	}, nil
}

func (s *AuthService) ValidateSession(token string) (*model.UserSession, error) {
	tokenHash := hashToken(token)
	session, err := s.sessionRepo.GetByHash(tokenHash)
	if err != nil {
		return nil, err
	}
	if session == nil {
		return nil, ErrSessionNotFound
	}
	if session.ExpiresAt.Before(time.Now()) {
		_ = s.sessionRepo.DeleteByHash(tokenHash)
		return nil, ErrSessionExpired
	}
	_ = s.sessionRepo.Touch(session.ID)
	return session, nil
}

func (s *AuthService) Logout(token string) error {
	return s.sessionRepo.DeleteByHash(hashToken(token))
}

func (s *AuthService) createSession(userID string) (string, error) {
	rawToken, err := generateToken(32)
	if err != nil {
		return "", err
	}
	if _, err := s.sessionRepo.Create(userID, hashToken(rawToken), time.Now().Add(sessionTTL)); err != nil {
		return "", err
	}
	return rawToken, nil
}

func (s *AuthService) ensureBootstrapMembership(userID string) error {
	count, err := s.memberRepo.CountByUserID(userID)
	if err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	project, err := s.projectRepo.GetByID(defaultProjectID)
	if err != nil {
		return err
	}
	if project == nil {
		return nil
	}

	_, err = s.memberRepo.Upsert(defaultProjectID, userID, model.ProjectRoleOwner, &userID)
	return err
}

func hashToken(raw string) string {
	hash := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(hash[:])
}

func generateToken(length int) (string, error) {
	buf := make([]byte, length)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate session token: %w", err)
	}
	return hex.EncodeToString(buf), nil
}
