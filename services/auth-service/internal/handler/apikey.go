package handler

import (
	"net/http"

	"github.com/evalsmith/auth-service/internal/middleware"
	"github.com/evalsmith/auth-service/internal/model"
	"github.com/evalsmith/auth-service/internal/service"
	"github.com/gin-gonic/gin"
)

type APIKeyHandler struct {
	svc *service.APIKeyService
}

func NewAPIKeyHandler(svc *service.APIKeyService) *APIKeyHandler {
	return &APIKeyHandler{svc: svc}
}

func (h *APIKeyHandler) Generate(c *gin.Context) {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse(model.ErrCodeUnauthorized, "missing session", nil))
		return
	}

	var req model.CreateAPIKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(
			model.ErrCodeBadRequest, "invalid request body", map[string]string{"error": err.Error()},
		))
		return
	}

	result, err := h.svc.Generate(userID, &req)
	if err != nil {
		if err.Error() == "project not found" {
			c.JSON(http.StatusNotFound, model.ErrorResponse(
				model.ErrCodeNotFound, "project not found", nil,
			))
			return
		}
		if err == service.ErrAPIKeyAccessDenied {
			c.JSON(http.StatusForbidden, model.ErrorResponse(
				model.ErrCodeForbidden, "forbidden", nil,
			))
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse(
			model.ErrCodeInternal, "failed to generate API key", nil,
		))
		return
	}

	c.JSON(http.StatusCreated, model.SuccessResponse(result))
}

func (h *APIKeyHandler) List(c *gin.Context) {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse(model.ErrCodeUnauthorized, "missing session", nil))
		return
	}

	projectID := c.Query("project_id")
	if projectID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(
			model.ErrCodeBadRequest, "project_id query parameter is required", nil,
		))
		return
	}

	keys, err := h.svc.ListByProjectID(userID, projectID)
	if err != nil {
		if err == service.ErrAPIKeyAccessDenied {
			c.JSON(http.StatusForbidden, model.ErrorResponse(
				model.ErrCodeForbidden, "forbidden", nil,
			))
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse(
			model.ErrCodeInternal, "failed to list API keys", nil,
		))
		return
	}

	if keys == nil {
		keys = []model.APIKey{}
	}

	c.JSON(http.StatusOK, model.SuccessResponse(keys))
}

func (h *APIKeyHandler) Revoke(c *gin.Context) {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse(model.ErrCodeUnauthorized, "missing session", nil))
		return
	}

	id := c.Param("id")

	err := h.svc.Revoke(userID, id)
	if err != nil {
		if err.Error() == "api key not found" {
			c.JSON(http.StatusNotFound, model.ErrorResponse(
				model.ErrCodeNotFound, "API key not found", nil,
			))
			return
		}
		if err == service.ErrAPIKeyAccessDenied {
			c.JSON(http.StatusForbidden, model.ErrorResponse(
				model.ErrCodeForbidden, "forbidden", nil,
			))
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse(
			model.ErrCodeInternal, "failed to revoke API key", nil,
		))
		return
	}

	c.JSON(http.StatusOK, model.SuccessResponse(nil))
}

func (h *APIKeyHandler) Verify(c *gin.Context) {
	var req model.VerifyAPIKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(
			model.ErrCodeBadRequest, "invalid request body", map[string]string{"error": err.Error()},
		))
		return
	}

	result, err := h.svc.Verify(req.APIKey)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse(
			model.ErrCodeInternal, "failed to verify API key", nil,
		))
		return
	}

	if !result.Valid {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse(
			model.ErrCodeAPIKeyInvalid, "API key invalid", nil,
		))
		return
	}

	c.JSON(http.StatusOK, model.SuccessResponse(result))
}
