package handler

import (
	"database/sql"
	"net/http"
	"strings"

	"github.com/evalsmith/auth-service/internal/middleware"
	"github.com/evalsmith/auth-service/internal/model"
	"github.com/evalsmith/auth-service/internal/service"
	"github.com/gin-gonic/gin"
)

func (h *ProjectHandler) ListModels(c *gin.Context) {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse(model.ErrCodeUnauthorized, "missing session", nil))
		return
	}

	items, err := h.svc.ListModels(userID, c.Param("id"))
	if err != nil {
		if err == service.ErrProjectAccessDenied {
			c.JSON(http.StatusForbidden, model.ErrorResponse(model.ErrCodeForbidden, "forbidden", nil))
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse(model.ErrCodeInternal, "failed to list project models", nil))
		return
	}
	if items == nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse(model.ErrCodeNotFound, "project not found", nil))
		return
	}
	c.JSON(http.StatusOK, model.SuccessResponse(items))
}

func (h *ProjectHandler) CreateModel(c *gin.Context) {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse(model.ErrCodeUnauthorized, "missing session", nil))
		return
	}

	var req model.CreateProjectModelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(model.ErrCodeBadRequest, "invalid request body", map[string]string{"error": err.Error()}))
		return
	}

	item, err := h.svc.CreateModel(userID, c.Param("id"), &req)
	if err != nil {
		switch {
		case err == service.ErrProjectAccessDenied:
			c.JSON(http.StatusForbidden, model.ErrorResponse(model.ErrCodeForbidden, "forbidden", nil))
		case strings.Contains(err.Error(), "required"), strings.Contains(err.Error(), "unsupported llm protocol"):
			c.JSON(http.StatusBadRequest, model.ErrorResponse(model.ErrCodeBadRequest, err.Error(), nil))
		case strings.Contains(strings.ToLower(err.Error()), "duplicate key"):
			c.JSON(http.StatusConflict, model.ErrorResponse(model.ErrCodeConflict, "同名模型已存在", nil))
		default:
			c.JSON(http.StatusInternalServerError, model.ErrorResponse(model.ErrCodeInternal, "failed to create project model", nil))
		}
		return
	}
	if item == nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse(model.ErrCodeNotFound, "project not found", nil))
		return
	}
	c.JSON(http.StatusCreated, model.SuccessResponse(item))
}

func (h *ProjectHandler) GetModel(c *gin.Context) {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse(model.ErrCodeUnauthorized, "missing session", nil))
		return
	}

	item, err := h.svc.GetModel(userID, c.Param("id"), c.Param("model_id"))
	if err != nil {
		if err == service.ErrProjectAccessDenied {
			c.JSON(http.StatusForbidden, model.ErrorResponse(model.ErrCodeForbidden, "forbidden", nil))
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse(model.ErrCodeInternal, "failed to get project model", nil))
		return
	}
	if item == nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse(model.ErrCodeNotFound, "project model not found", nil))
		return
	}
	c.JSON(http.StatusOK, model.SuccessResponse(item))
}

func (h *ProjectHandler) UpdateModel(c *gin.Context) {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse(model.ErrCodeUnauthorized, "missing session", nil))
		return
	}

	var req model.UpdateProjectModelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(model.ErrCodeBadRequest, "invalid request body", map[string]string{"error": err.Error()}))
		return
	}

	item, err := h.svc.UpdateModel(userID, c.Param("id"), c.Param("model_id"), &req)
	if err != nil {
		switch {
		case err == service.ErrProjectAccessDenied:
			c.JSON(http.StatusForbidden, model.ErrorResponse(model.ErrCodeForbidden, "forbidden", nil))
		case strings.Contains(err.Error(), "required"), strings.Contains(err.Error(), "unsupported llm protocol"):
			c.JSON(http.StatusBadRequest, model.ErrorResponse(model.ErrCodeBadRequest, err.Error(), nil))
		case strings.Contains(strings.ToLower(err.Error()), "duplicate key"):
			c.JSON(http.StatusConflict, model.ErrorResponse(model.ErrCodeConflict, "同名模型已存在", nil))
		default:
			c.JSON(http.StatusInternalServerError, model.ErrorResponse(model.ErrCodeInternal, "failed to update project model", nil))
		}
		return
	}
	if item == nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse(model.ErrCodeNotFound, "project model not found", nil))
		return
	}
	c.JSON(http.StatusOK, model.SuccessResponse(item))
}

func (h *ProjectHandler) DeleteModel(c *gin.Context) {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse(model.ErrCodeUnauthorized, "missing session", nil))
		return
	}

	err := h.svc.DeleteModel(userID, c.Param("id"), c.Param("model_id"))
	switch err {
	case nil:
		c.JSON(http.StatusOK, model.SuccessResponse(nil))
		return
	case sql.ErrNoRows:
		c.JSON(http.StatusNotFound, model.ErrorResponse(model.ErrCodeNotFound, "project model not found", nil))
		return
	case service.ErrProjectAccessDenied:
		c.JSON(http.StatusForbidden, model.ErrorResponse(model.ErrCodeForbidden, "forbidden", nil))
		return
	default:
		c.JSON(http.StatusInternalServerError, model.ErrorResponse(model.ErrCodeInternal, "failed to delete project model", nil))
		return
	}
}

func (h *ProjectHandler) TestModel(c *gin.Context) {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse(model.ErrCodeUnauthorized, "missing session", nil))
		return
	}

	result, err := h.svc.TestModel(userID, c.Param("id"), c.Param("model_id"))
	if err != nil {
		if err == service.ErrProjectAccessDenied {
			c.JSON(http.StatusForbidden, model.ErrorResponse(model.ErrCodeForbidden, "forbidden", nil))
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse(model.ErrCodeInternal, "failed to test project model", nil))
		return
	}
	if result == nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse(model.ErrCodeNotFound, "project model not found", nil))
		return
	}
	c.JSON(http.StatusOK, model.SuccessResponse(result))
}

func (h *ProjectHandler) SetDefaultModel(c *gin.Context) {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse(model.ErrCodeUnauthorized, "missing session", nil))
		return
	}

	item, err := h.svc.SetDefaultModel(userID, c.Param("id"), c.Param("model_id"))
	if err != nil {
		if err == service.ErrProjectAccessDenied {
			c.JSON(http.StatusForbidden, model.ErrorResponse(model.ErrCodeForbidden, "forbidden", nil))
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse(model.ErrCodeInternal, "failed to set default model", nil))
		return
	}
	if item == nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse(model.ErrCodeNotFound, "project model not found", nil))
		return
	}
	c.JSON(http.StatusOK, model.SuccessResponse(item))
}

func (h *ProjectHandler) ResolveModel(c *gin.Context) {
	item, err := h.svc.ResolveModel(c.Param("id"), c.Param("model_id"), false)
	if err != nil {
		if strings.Contains(err.Error(), "archived") {
			c.JSON(http.StatusConflict, model.ErrorResponse(model.ErrCodeConflict, err.Error(), nil))
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse(model.ErrCodeInternal, "failed to resolve project model", nil))
		return
	}
	if item == nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse(model.ErrCodeNotFound, "project model not found", nil))
		return
	}
	c.JSON(http.StatusOK, model.SuccessResponse(item))
}

func (h *ProjectHandler) ResolveDefaultModel(c *gin.Context) {
	item, err := h.svc.ResolveModel(c.Param("id"), "", true)
	if err != nil {
		if strings.Contains(err.Error(), "archived") {
			c.JSON(http.StatusConflict, model.ErrorResponse(model.ErrCodeConflict, err.Error(), nil))
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse(model.ErrCodeInternal, "failed to resolve default project model", nil))
		return
	}
	if item == nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse(model.ErrCodeNotFound, "default project model not found", nil))
		return
	}
	c.JSON(http.StatusOK, model.SuccessResponse(item))
}
