package middleware

import (
	"net/http"
	"strings"

	"github.com/evalsmith/auth-service/internal/model"
	"github.com/gin-gonic/gin"
)

const internalServiceTokenHeader = "X-Internal-Service-Token"

func RequireInternalServiceToken(expected string) gin.HandlerFunc {
	normalized := strings.TrimSpace(expected)
	return func(c *gin.Context) {
		if normalized == "" {
			c.Next()
			return
		}

		provided := strings.TrimSpace(c.GetHeader(internalServiceTokenHeader))
		if provided == normalized {
			c.Next()
			return
		}

		c.AbortWithStatusJSON(http.StatusUnauthorized, model.ErrorResponse(
			model.ErrCodeUnauthorized,
			"missing or invalid internal service token",
			nil,
		))
	}
}
