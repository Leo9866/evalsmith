package middleware

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	"github.com/evalsmith/auth-service/internal/model"
	"github.com/evalsmith/auth-service/internal/repository"
	"github.com/gin-gonic/gin"
)

const (
	ContextKeyProjectID    = "project_id"
	ContextKeyKeyID        = "key_id"
	ContextKeyUserID       = "user_id"
	ContextKeySessionID    = "session_id"
	ContextKeySessionToken = "session_token"
	bearerPrefix           = "Bearer "
	sessionCookieName      = "evalsmith_session"
)

// AuthMiddleware validates API keys from the Authorization header.
// It extracts the Bearer token, hashes it, and looks it up in the api_keys table.
// On success, it sets project_id and key_id in the Gin context.
// Exported so other services can use it.
func AuthMiddleware(keyRepo *repository.APIKeyRepository) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, model.ErrorResponse(
				model.ErrCodeUnauthorized, "missing authorization header", nil,
			))
			return
		}

		if !strings.HasPrefix(authHeader, bearerPrefix) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, model.ErrorResponse(
				model.ErrCodeUnauthorized, "invalid authorization format, expected Bearer token", nil,
			))
			return
		}

		rawKey := strings.TrimPrefix(authHeader, bearerPrefix)
		rawKey = strings.TrimSpace(rawKey)

		if rawKey == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, model.ErrorResponse(
				model.ErrCodeAPIKeyInvalid, "API key is empty", nil,
			))
			return
		}

		hash := sha256.Sum256([]byte(rawKey))
		keyHash := hex.EncodeToString(hash[:])

		apiKey, err := keyRepo.GetByHash(keyHash)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, model.ErrorResponse(
				model.ErrCodeInternal, "internal error verifying API key", nil,
			))
			return
		}

		if apiKey == nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, model.ErrorResponse(
				model.ErrCodeAPIKeyInvalid, "API key invalid", nil,
			))
			return
		}

		if !apiKey.IsActive {
			c.AbortWithStatusJSON(http.StatusUnauthorized, model.ErrorResponse(
				model.ErrCodeAPIKeyRevoked, "API key has been revoked", nil,
			))
			return
		}

		// Update last_used_at (best effort)
		go func(id string, db *repository.APIKeyRepository) {
			_ = db.UpdateLastUsed(id)
		}(apiKey.ID, keyRepo)

		c.Set(ContextKeyProjectID, apiKey.ProjectID)
		c.Set(ContextKeyKeyID, apiKey.ID)
		c.Next()
	}
}

// GetProjectIDFromContext retrieves the project_id set by AuthMiddleware.
// Exported for use by other services.
func GetProjectIDFromContext(c *gin.Context) (string, bool) {
	val, exists := c.Get(ContextKeyProjectID)
	if !exists {
		return "", false
	}
	projectID, ok := val.(string)
	return projectID, ok
}

// NewAPIKeyRepository creates a new APIKeyRepository from a sql.DB.
// Convenience function exported for other services that need auth middleware.
func NewAPIKeyRepository(db *sql.DB) *repository.APIKeyRepository {
	return repository.NewAPIKeyRepository(db)
}

func SessionMiddleware(sessionRepo *repository.SessionRepository, userRepo *repository.UserRepository) gin.HandlerFunc {
	return func(c *gin.Context) {
		rawToken, err := c.Cookie(sessionCookieName)
		if err != nil || strings.TrimSpace(rawToken) == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, model.ErrorResponse(
				model.ErrCodeUnauthorized, "missing session", nil,
			))
			return
		}

		hash := sha256.Sum256([]byte(rawToken))
		tokenHash := hex.EncodeToString(hash[:])

		session, err := sessionRepo.GetByHash(tokenHash)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, model.ErrorResponse(
				model.ErrCodeInternal, "failed to verify session", nil,
			))
			return
		}
		if session == nil || session.ExpiresAt.Before(time.Now()) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, model.ErrorResponse(
				model.ErrCodeUnauthorized, "session expired", nil,
			))
			return
		}

		user, err := userRepo.GetByID(session.UserID)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, model.ErrorResponse(
				model.ErrCodeInternal, "failed to load user", nil,
			))
			return
		}
		if user == nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, model.ErrorResponse(
				model.ErrCodeUnauthorized, "session user missing", nil,
			))
			return
		}

		go func() {
			_ = sessionRepo.Touch(session.ID)
		}()

		c.Set(ContextKeyUserID, user.ID)
		c.Set(ContextKeySessionID, session.ID)
		c.Set(ContextKeySessionToken, rawToken)
		c.Set("current_user", user)
		c.Next()
	}
}

func GetUserIDFromContext(c *gin.Context) (string, bool) {
	val, exists := c.Get(ContextKeyUserID)
	if !exists {
		return "", false
	}
	userID, ok := val.(string)
	return userID, ok
}

func GetSessionTokenFromContext(c *gin.Context) (string, bool) {
	val, exists := c.Get(ContextKeySessionToken)
	if !exists {
		return "", false
	}
	token, ok := val.(string)
	return token, ok
}
