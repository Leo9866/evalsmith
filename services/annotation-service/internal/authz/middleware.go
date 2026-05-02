package authz

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	ContextKeyProjectID  = "project_id"
	ContextKeyUserID     = "user_id"
	ContextKeyRole       = "project_role"
	ContextKeyAuthMethod = "auth_method"
	InternalTokenHeader  = "X-Internal-Service-Token"
	internalAuthMethod   = "internal"
	roleOwner            = "owner"
	roleAdmin            = "admin"
	roleDeveloper        = "developer"
	roleAnnotator        = "annotator"
)

type accessResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    struct {
		UserID     string `json:"user_id"`
		ProjectID  string `json:"project_id"`
		Role       string `json:"role"`
		AuthMethod string `json:"auth_method"`
	} `json:"data"`
}

func AuthContextMiddleware(authServiceURL, internalToken string) gin.HandlerFunc {
	client := &http.Client{Timeout: 15 * time.Second}
	return func(c *gin.Context) {
		projectID := strings.TrimSpace(c.GetHeader("X-Project-ID"))
		if projectID == "" {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"code": -1, "message": "missing X-Project-ID header"})
			return
		}

		if internalToken != "" && c.GetHeader(InternalTokenHeader) == internalToken {
			c.Set(ContextKeyProjectID, projectID)
			c.Set(ContextKeyUserID, "internal")
			c.Set(ContextKeyRole, roleOwner)
			c.Set(ContextKeyAuthMethod, internalAuthMethod)
			c.Next()
			return
		}

		req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, strings.TrimRight(authServiceURL, "/")+"/api/v1/auth/access", nil)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"code": -1, "message": "failed to create auth request"})
			return
		}
		req.Header.Set("X-Project-ID", projectID)
		if authHeader := c.GetHeader("Authorization"); authHeader != "" {
			req.Header.Set("Authorization", authHeader)
		}
		if cookie := c.GetHeader("Cookie"); cookie != "" {
			req.Header.Set("Cookie", cookie)
		}

		resp, err := client.Do(req)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusBadGateway, gin.H{"code": -1, "message": fmt.Sprintf("auth service unavailable: %v", err)})
			return
		}
		defer resp.Body.Close()

		var envelope accessResponse
		if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
			c.AbortWithStatusJSON(http.StatusBadGateway, gin.H{"code": -1, "message": "invalid auth service response"})
			return
		}
		if resp.StatusCode >= 400 || envelope.Code != 0 {
			message := envelope.Message
			if message == "" {
				message = "access denied"
			}
			c.AbortWithStatusJSON(resp.StatusCode, gin.H{"code": -1, "message": message})
			return
		}

		c.Set(ContextKeyProjectID, envelope.Data.ProjectID)
		c.Set(ContextKeyUserID, envelope.Data.UserID)
		c.Set(ContextKeyRole, envelope.Data.Role)
		c.Set(ContextKeyAuthMethod, envelope.Data.AuthMethod)
		c.Next()
	}
}

func RequireRoles(roles ...string) gin.HandlerFunc {
	allowed := make(map[string]struct{}, len(roles))
	for _, role := range roles {
		allowed[role] = struct{}{}
	}
	return func(c *gin.Context) {
		authMethod, _ := c.Get(ContextKeyAuthMethod)
		if authMethod == internalAuthMethod {
			c.Next()
			return
		}

		role, _ := c.Get(ContextKeyRole)
		roleName, _ := role.(string)
		if _, ok := allowed[roleName]; ok {
			c.Next()
			return
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"code": -1, "message": "forbidden"})
	}
}

func WriteRoles() []string {
	return []string{roleOwner, roleAdmin, roleDeveloper}
}

func AnnotationRoles() []string {
	return []string{roleOwner, roleAdmin, roleAnnotator, roleDeveloper}
}

func GetProjectID(c *gin.Context) string {
	return c.GetString(ContextKeyProjectID)
}
