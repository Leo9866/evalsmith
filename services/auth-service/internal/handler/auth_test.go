package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestResolveAccessRequiresProjectHeader(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/api/v1/auth/access", (&AuthHandler{}).ResolveAccess)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/access", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.Code)
	}
}

func TestResolveAccessRejectsMissingSession(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/api/v1/auth/access", (&AuthHandler{}).ResolveAccess)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/access", nil)
	req.Header.Set("X-Project-ID", "proj_test")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.Code)
	}
}

func TestResolveAccessRejectsInvalidAuthorizationFormat(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/api/v1/auth/access", (&AuthHandler{}).ResolveAccess)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/access", nil)
	req.Header.Set("X-Project-ID", "proj_test")
	req.Header.Set("Authorization", "Token not-supported")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.Code)
	}
}
