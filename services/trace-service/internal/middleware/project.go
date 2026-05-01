package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/evalsmith/trace-service/internal/model"
)

// ProjectIDMiddleware extracts X-Project-ID header and sets it in the context.
// Authentication is handled by the API gateway and upstream auth service.
func ProjectIDMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		projectID := c.GetHeader("X-Project-ID")
		if projectID == "" {
			c.AbortWithStatusJSON(http.StatusBadRequest, model.ErrorResponse(1001, "X-Project-ID header is required"))
			return
		}
		c.Set("project_id", projectID)
		c.Next()
	}
}
