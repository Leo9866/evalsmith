package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/evalsmith/annotation-service/internal/authz"
	"github.com/evalsmith/annotation-service/internal/model"
	"github.com/evalsmith/annotation-service/internal/service"
	"github.com/gin-gonic/gin"
)

type Handler struct {
	svc            *service.AnnotationService
	authServiceURL string
	internalToken  string
}

func NewHandler(svc *service.AnnotationService, authServiceURL, internalToken string) *Handler {
	return &Handler{
		svc:            svc,
		authServiceURL: authServiceURL,
		internalToken:  internalToken,
	}
}

func (h *Handler) RegisterRoutes(r *gin.Engine) {
	v1 := r.Group("/api/v1")
	v1.Use(authz.AuthContextMiddleware(h.authServiceURL, h.internalToken))

	v1.GET("/annotation/tasks", h.ListTasks)
	v1.GET("/annotation/tasks/:id", h.GetTask)
	v1.GET("/annotation/stats", h.GetStats)

	writeRoutes := v1.Group("")
	writeRoutes.Use(authz.RequireRoles(authz.WriteRoles()...))
	writeRoutes.POST("/annotation/tasks", h.CreateTasks)

	annotationRoutes := v1.Group("")
	annotationRoutes.Use(authz.RequireRoles(authz.AnnotationRoles()...))
	annotationRoutes.POST("/annotation/tasks/:id/claim", h.ClaimTask)
	annotationRoutes.POST("/annotation/tasks/:id/submit", h.SubmitTask)
}

func getProjectID(c *gin.Context) string {
	return authz.GetProjectID(c)
}

func (h *Handler) CreateTasks(c *gin.Context) {
	var req model.CreateAnnotationTasksRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, respErr(err.Error()))
		return
	}
	resp, err := h.svc.CreateTasks(getProjectID(c), &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, respErr(err.Error()))
		return
	}
	c.JSON(http.StatusOK, respOK(resp))
}

func (h *Handler) ListTasks(c *gin.Context) {
	page, pageSize := parsePagination(c)
	status := c.DefaultQuery("status", "all")
	query := c.Query("query")
	items, total, err := h.svc.ListTasks(getProjectID(c), status, query, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, respErr(err.Error()))
		return
	}
	if items == nil {
		items = []*model.AnnotationTask{}
	}
	c.JSON(http.StatusOK, respPage(items, total, page, pageSize))
}

func (h *Handler) GetTask(c *gin.Context) {
	task, err := h.svc.GetTask(getProjectID(c), c.Param("id"))
	if err != nil {
		handleError(c, err)
		return
	}
	c.JSON(http.StatusOK, respOK(task))
}

func (h *Handler) ClaimTask(c *gin.Context) {
	if err := h.svc.ClaimTask(getProjectID(c), c.Param("id")); err != nil {
		handleError(c, err)
		return
	}
	c.JSON(http.StatusOK, respOK(nil))
}

func (h *Handler) SubmitTask(c *gin.Context) {
	var req model.SubmitAnnotationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, respErr(err.Error()))
		return
	}
	if err := h.svc.SubmitTask(getProjectID(c), c.Param("id"), &req); err != nil {
		handleError(c, err)
		return
	}
	c.JSON(http.StatusOK, respOK(nil))
}

func (h *Handler) GetStats(c *gin.Context) {
	stats, err := h.svc.Stats(getProjectID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, respErr(err.Error()))
		return
	}
	c.JSON(http.StatusOK, respOK(stats))
}

type apiResponse struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

func respOK(data interface{}) apiResponse {
	return apiResponse{Code: 0, Message: "success", Data: data}
}

func respErr(msg string) apiResponse {
	return apiResponse{Code: -1, Message: msg}
}

func respPage(items interface{}, total, page, pageSize int) apiResponse {
	totalPages := 0
	if total > 0 && pageSize > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}
	return apiResponse{
		Code:    0,
		Message: "success",
		Data: model.PaginatedResponse{
			Items:      items,
			Total:      total,
			Page:       page,
			PageSize:   pageSize,
			TotalPages: totalPages,
		},
	}
}

func handleError(c *gin.Context, err error) {
	if errors.Is(err, service.ErrNotFound) {
		c.JSON(http.StatusNotFound, respErr("resource not found"))
		return
	}
	c.JSON(http.StatusInternalServerError, respErr(err.Error()))
}

func parsePagination(c *gin.Context) (int, int) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	return page, pageSize
}
