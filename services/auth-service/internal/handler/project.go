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

type ProjectHandler struct {
	svc *service.ProjectService
}

func NewProjectHandler(svc *service.ProjectService) *ProjectHandler {
	return &ProjectHandler{svc: svc}
}

func (h *ProjectHandler) Create(c *gin.Context) {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse(model.ErrCodeUnauthorized, "missing session", nil))
		return
	}

	var req model.CreateProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(
			model.ErrCodeBadRequest, "invalid request body", map[string]string{"error": err.Error()},
		))
		return
	}

	project, err := h.svc.Create(userID, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse(
			model.ErrCodeInternal, "failed to create project", nil,
		))
		return
	}

	c.JSON(http.StatusCreated, model.SuccessResponse(project))
}

func (h *ProjectHandler) List(c *gin.Context) {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse(model.ErrCodeUnauthorized, "missing session", nil))
		return
	}

	projects, err := h.svc.List(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse(
			model.ErrCodeInternal, "failed to list projects", nil,
		))
		return
	}

	if projects == nil {
		projects = []model.Project{}
	}

	c.JSON(http.StatusOK, model.SuccessResponse(projects))
}

func (h *ProjectHandler) Get(c *gin.Context) {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse(model.ErrCodeUnauthorized, "missing session", nil))
		return
	}
	id := c.Param("id")

	project, err := h.svc.GetByID(userID, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse(
			model.ErrCodeInternal, "failed to get project", nil,
		))
		return
	}
	if project == nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse(
			model.ErrCodeNotFound, "project not found", nil,
		))
		return
	}

	c.JSON(http.StatusOK, model.SuccessResponse(project))
}

func (h *ProjectHandler) Update(c *gin.Context) {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse(model.ErrCodeUnauthorized, "missing session", nil))
		return
	}
	id := c.Param("id")

	var req model.UpdateProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(
			model.ErrCodeBadRequest, "invalid request body", map[string]string{"error": err.Error()},
		))
		return
	}

	project, err := h.svc.Update(userID, id, &req)
	if err != nil {
		if err == service.ErrProjectAccessDenied {
			c.JSON(http.StatusForbidden, model.ErrorResponse(
				model.ErrCodeForbidden, "forbidden", nil,
			))
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse(
			model.ErrCodeInternal, "failed to update project", nil,
		))
		return
	}
	if project == nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse(
			model.ErrCodeNotFound, "project not found", nil,
		))
		return
	}

	c.JSON(http.StatusOK, model.SuccessResponse(project))
}

func (h *ProjectHandler) Delete(c *gin.Context) {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse(model.ErrCodeUnauthorized, "missing session", nil))
		return
	}
	id := c.Param("id")

	err := h.svc.Delete(userID, id)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, model.ErrorResponse(
			model.ErrCodeNotFound, "project not found", nil,
		))
		return
	}
	if err == service.ErrProjectAccessDenied {
		c.JSON(http.StatusForbidden, model.ErrorResponse(
			model.ErrCodeForbidden, "forbidden", nil,
		))
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse(
			model.ErrCodeInternal, "failed to delete project", nil,
		))
		return
	}

	c.JSON(http.StatusOK, model.SuccessResponse(nil))
}

func (h *ProjectHandler) GetLLMConfig(c *gin.Context) {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse(model.ErrCodeUnauthorized, "missing session", nil))
		return
	}
	id := c.Param("id")

	config, err := h.svc.GetLLMConfig(userID, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse(
			model.ErrCodeInternal, "failed to get project llm config", nil,
		))
		return
	}
	if config == nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse(
			model.ErrCodeNotFound, "project not found", nil,
		))
		return
	}

	c.JSON(http.StatusOK, model.SuccessResponse(config))
}

func (h *ProjectHandler) UpdateLLMConfig(c *gin.Context) {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse(model.ErrCodeUnauthorized, "missing session", nil))
		return
	}
	id := c.Param("id")

	var req model.UpdateProjectLLMConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(
			model.ErrCodeBadRequest, "invalid request body", map[string]string{"error": err.Error()},
		))
		return
	}

	config, err := h.svc.UpdateLLMConfig(userID, id, &req)
	if err != nil {
		if err == service.ErrProjectAccessDenied {
			c.JSON(http.StatusForbidden, model.ErrorResponse(
				model.ErrCodeForbidden, "forbidden", nil,
			))
			return
		}
		if strings.Contains(err.Error(), "unsupported llm protocol") {
			c.JSON(http.StatusBadRequest, model.ErrorResponse(
				model.ErrCodeBadRequest, err.Error(), nil,
			))
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse(
			model.ErrCodeInternal, "failed to update project llm config", nil,
		))
		return
	}
	if config == nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse(
			model.ErrCodeNotFound, "project not found", nil,
		))
		return
	}

	c.JSON(http.StatusOK, model.SuccessResponse(config))
}

func (h *ProjectHandler) ListMembers(c *gin.Context) {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse(model.ErrCodeUnauthorized, "missing session", nil))
		return
	}

	projectID := c.Param("id")
	members, err := h.svc.ListMembers(userID, projectID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse(model.ErrCodeInternal, "failed to list members", nil))
		return
	}
	if members == nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse(model.ErrCodeNotFound, "project not found", nil))
		return
	}
	c.JSON(http.StatusOK, model.SuccessResponse(members))
}

func (h *ProjectHandler) AddMember(c *gin.Context) {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse(model.ErrCodeUnauthorized, "missing session", nil))
		return
	}

	projectID := c.Param("id")
	var req model.AddProjectMemberRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(model.ErrCodeBadRequest, "invalid request body", map[string]string{"error": err.Error()}))
		return
	}

	member, err := h.svc.AddMember(userID, projectID, &req)
	if err != nil {
		switch {
		case err == sql.ErrNoRows:
			c.JSON(http.StatusNotFound, model.ErrorResponse(model.ErrCodeNotFound, "user not found", nil))
		case err == service.ErrProjectAccessDenied:
			c.JSON(http.StatusForbidden, model.ErrorResponse(model.ErrCodeForbidden, "forbidden", nil))
		case strings.Contains(err.Error(), "invalid role"):
			c.JSON(http.StatusBadRequest, model.ErrorResponse(model.ErrCodeBadRequest, err.Error(), nil))
		default:
			c.JSON(http.StatusInternalServerError, model.ErrorResponse(model.ErrCodeInternal, "failed to add member", nil))
		}
		return
	}
	if member == nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse(model.ErrCodeNotFound, "project not found", nil))
		return
	}
	c.JSON(http.StatusCreated, model.SuccessResponse(member))
}

func (h *ProjectHandler) UpdateMemberRole(c *gin.Context) {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse(model.ErrCodeUnauthorized, "missing session", nil))
		return
	}

	projectID := c.Param("id")
	memberUserID := c.Param("user_id")
	var req model.UpdateProjectMemberRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(model.ErrCodeBadRequest, "invalid request body", map[string]string{"error": err.Error()}))
		return
	}

	member, err := h.svc.UpdateMemberRole(userID, projectID, memberUserID, &req)
	if err != nil {
		switch {
		case err == service.ErrProjectAccessDenied:
			c.JSON(http.StatusForbidden, model.ErrorResponse(model.ErrCodeForbidden, "forbidden", nil))
		case strings.Contains(err.Error(), "invalid role"):
			c.JSON(http.StatusBadRequest, model.ErrorResponse(model.ErrCodeBadRequest, err.Error(), nil))
		default:
			c.JSON(http.StatusInternalServerError, model.ErrorResponse(model.ErrCodeInternal, "failed to update member role", nil))
		}
		return
	}
	if member == nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse(model.ErrCodeNotFound, "member not found", nil))
		return
	}
	c.JSON(http.StatusOK, model.SuccessResponse(member))
}

func (h *ProjectHandler) RemoveMember(c *gin.Context) {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse(model.ErrCodeUnauthorized, "missing session", nil))
		return
	}

	projectID := c.Param("id")
	memberUserID := c.Param("user_id")
	err := h.svc.RemoveMember(userID, projectID, memberUserID)
	if err != nil {
		switch {
		case err == sql.ErrNoRows:
			c.JSON(http.StatusNotFound, model.ErrorResponse(model.ErrCodeNotFound, "member not found", nil))
		case err == service.ErrProjectAccessDenied:
			c.JSON(http.StatusForbidden, model.ErrorResponse(model.ErrCodeForbidden, "forbidden", nil))
		case strings.Contains(err.Error(), "owner cannot remove themselves"):
			c.JSON(http.StatusBadRequest, model.ErrorResponse(model.ErrCodeBadRequest, err.Error(), nil))
		default:
			c.JSON(http.StatusInternalServerError, model.ErrorResponse(model.ErrCodeInternal, "failed to remove member", nil))
		}
		return
	}

	c.JSON(http.StatusOK, model.SuccessResponse(nil))
}
