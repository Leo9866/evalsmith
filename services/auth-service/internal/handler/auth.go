package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/evalsmith/auth-service/internal/middleware"
	"github.com/evalsmith/auth-service/internal/model"
	"github.com/evalsmith/auth-service/internal/repository"
	"github.com/evalsmith/auth-service/internal/service"
	"github.com/gin-gonic/gin"
)

const (
	sessionCookieName = "evalsmith_session"
	sessionMaxAge     = 7 * 24 * 60 * 60
)

type AuthHandler struct {
	svc        *service.AuthService
	keyRepo    *repository.APIKeyRepository
	memberRepo *repository.ProjectMemberRepository
}

func NewAuthHandler(
	svc *service.AuthService,
	keyRepo *repository.APIKeyRepository,
	memberRepo *repository.ProjectMemberRepository,
) *AuthHandler {
	return &AuthHandler{
		svc:        svc,
		keyRepo:    keyRepo,
		memberRepo: memberRepo,
	}
}

func (h *AuthHandler) Register(c *gin.Context) {
	var req model.CreateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(
			model.ErrCodeBadRequest, "invalid request body", map[string]string{"error": err.Error()},
		))
		return
	}

	profile, token, err := h.svc.Register(&req)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrEmailExists):
			c.JSON(http.StatusConflict, model.ErrorResponse(model.ErrCodeConflict, "email already exists", nil))
		default:
			c.JSON(http.StatusBadRequest, model.ErrorResponse(model.ErrCodeBadRequest, err.Error(), nil))
		}
		return
	}

	setSessionCookie(c, token)
	c.JSON(http.StatusCreated, model.SuccessResponse(profile))
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req model.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(
			model.ErrCodeBadRequest, "invalid request body", map[string]string{"error": err.Error()},
		))
		return
	}

	profile, token, err := h.svc.Login(&req)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrInvalidCredentials):
			c.JSON(http.StatusUnauthorized, model.ErrorResponse(model.ErrCodeUnauthorized, "邮箱或密码错误", nil))
		default:
			c.JSON(http.StatusBadRequest, model.ErrorResponse(model.ErrCodeBadRequest, err.Error(), nil))
		}
		return
	}

	setSessionCookie(c, token)
	c.JSON(http.StatusOK, model.SuccessResponse(profile))
}

func (h *AuthHandler) Me(c *gin.Context) {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok || userID == "" {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse(model.ErrCodeUnauthorized, "missing session", nil))
		return
	}

	profile, err := h.svc.BuildSessionProfile(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse(model.ErrCodeInternal, "failed to load session", nil))
		return
	}
	c.JSON(http.StatusOK, model.SuccessResponse(profile))
}

func (h *AuthHandler) Logout(c *gin.Context) {
	token, ok := middleware.GetSessionTokenFromContext(c)
	if ok && token != "" {
		_ = h.svc.Logout(token)
	}
	clearSessionCookie(c)
	c.JSON(http.StatusOK, model.SuccessResponse(gin.H{"logged_out": true, "at": time.Now().UTC()}))
}

func (h *AuthHandler) ResolveAccess(c *gin.Context) {
	projectID := strings.TrimSpace(c.GetHeader("X-Project-ID"))
	if projectID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(
			model.ErrCodeBadRequest, "missing X-Project-ID header", nil,
		))
		return
	}

	if rawAuth := strings.TrimSpace(c.GetHeader("Authorization")); rawAuth != "" {
		access, status, errResp := h.resolveAPIKeyAccess(projectID, rawAuth)
		if errResp != nil {
			c.JSON(status, errResp)
			return
		}
		c.JSON(http.StatusOK, model.SuccessResponse(access))
		return
	}

	access, status, errResp := h.resolveSessionAccess(c, projectID)
	if errResp != nil {
		c.JSON(status, errResp)
		return
	}
	c.JSON(http.StatusOK, model.SuccessResponse(access))
}

func (h *AuthHandler) resolveSessionAccess(c *gin.Context, projectID string) (*model.AuthAccessResponse, int, *model.Response) {
	rawToken, err := c.Cookie(sessionCookieName)
	if err != nil || strings.TrimSpace(rawToken) == "" {
		resp := model.ErrorResponse(model.ErrCodeUnauthorized, "missing session", nil)
		return nil, http.StatusUnauthorized, &resp
	}

	session, err := h.svc.ValidateSession(rawToken)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrSessionNotFound), errors.Is(err, service.ErrSessionExpired):
			resp := model.ErrorResponse(model.ErrCodeUnauthorized, "session expired", nil)
			return nil, http.StatusUnauthorized, &resp
		default:
			resp := model.ErrorResponse(model.ErrCodeInternal, "failed to verify session", nil)
			return nil, http.StatusInternalServerError, &resp
		}
	}

	member, err := h.memberRepo.Get(projectID, session.UserID)
	if err != nil {
		resp := model.ErrorResponse(model.ErrCodeInternal, "failed to resolve membership", nil)
		return nil, http.StatusInternalServerError, &resp
	}
	if member == nil {
		resp := model.ErrorResponse(model.ErrCodeForbidden, "forbidden", nil)
		return nil, http.StatusForbidden, &resp
	}

	return &model.AuthAccessResponse{
		UserID:     session.UserID,
		ProjectID:  projectID,
		Role:       member.Role,
		AuthMethod: "session",
		SessionID:  session.ID,
	}, http.StatusOK, nil
}

func (h *AuthHandler) resolveAPIKeyAccess(projectID, rawAuth string) (*model.AuthAccessResponse, int, *model.Response) {
	if !strings.HasPrefix(rawAuth, "Bearer ") {
		resp := model.ErrorResponse(model.ErrCodeUnauthorized, "invalid authorization format", nil)
		return nil, http.StatusUnauthorized, &resp
	}
	rawKey := strings.TrimSpace(strings.TrimPrefix(rawAuth, "Bearer "))
	if rawKey == "" {
		resp := model.ErrorResponse(model.ErrCodeAPIKeyInvalid, "API key is empty", nil)
		return nil, http.StatusUnauthorized, &resp
	}

	hash := sha256.Sum256([]byte(rawKey))
	keyHash := hex.EncodeToString(hash[:])
	apiKey, err := h.keyRepo.GetByHash(keyHash)
	if err != nil {
		resp := model.ErrorResponse(model.ErrCodeInternal, "failed to verify API key", nil)
		return nil, http.StatusInternalServerError, &resp
	}
	if apiKey == nil || !apiKey.IsActive {
		resp := model.ErrorResponse(model.ErrCodeAPIKeyInvalid, "API key invalid", nil)
		return nil, http.StatusUnauthorized, &resp
	}
	if apiKey.ProjectID != projectID {
		resp := model.ErrorResponse(model.ErrCodeForbidden, "project mismatch", nil)
		return nil, http.StatusForbidden, &resp
	}
	_ = h.keyRepo.UpdateLastUsed(apiKey.ID)

	return &model.AuthAccessResponse{
		UserID:     apiKey.ID,
		ProjectID:  projectID,
		Role:       model.ProjectRoleDeveloper,
		AuthMethod: "api_key",
		KeyID:      apiKey.ID,
	}, http.StatusOK, nil
}

func setSessionCookie(c *gin.Context, token string) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(sessionCookieName, token, sessionMaxAge, "/", "", false, true)
}

func clearSessionCookie(c *gin.Context) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(sessionCookieName, "", -1, "/", "", false, true)
}
