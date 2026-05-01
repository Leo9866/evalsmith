package authz

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestInternalTokenBypassesRemoteAuth(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(AuthContextMiddleware("http://127.0.0.1:0", "internal-test-token"))
	writeRoutes := router.Group("/")
	writeRoutes.Use(RequireRoles(WriteRoles()...))
	writeRoutes.POST("/v1/traces", func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/traces", strings.NewReader(`{}`))
	req.Header.Set("X-Project-ID", "proj_test")
	req.Header.Set(InternalTokenHeader, "internal-test-token")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", resp.Code)
	}
}

func TestWriteRolesRejectViewer(t *testing.T) {
	authServer := newTestAuthServer(t)
	defer authServer.Close()

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(AuthContextMiddleware(authServer.URL, ""))
	writeRoutes := router.Group("/")
	writeRoutes.Use(RequireRoles(WriteRoles()...))
	writeRoutes.POST("/api/v1/traces", func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/traces", strings.NewReader(`{}`))
	req.Header.Set("X-Project-ID", "proj_test")
	req.Header.Set("Authorization", "Bearer viewer")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", resp.Code)
	}
}

func newTestAuthServer(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		role := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		if role == "" {
			role = "developer"
		}

		payload := map[string]any{
			"code":    0,
			"message": "success",
			"data": map[string]any{
				"user_id":     "user_test",
				"project_id":  r.Header.Get("X-Project-ID"),
				"role":        role,
				"auth_method": "session",
			},
		}
		if err := json.NewEncoder(w).Encode(payload); err != nil {
			t.Fatalf("encode auth response: %v", err)
		}
	}))
}
