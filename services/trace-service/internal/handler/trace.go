package handler

import (
	"net/http"

	"github.com/evalsmith/trace-service/internal/authz"
	"github.com/gin-gonic/gin"

	"github.com/evalsmith/trace-service/internal/model"
	"github.com/evalsmith/trace-service/internal/service"
)

type TraceHandler struct {
	svc *service.TraceService
}

func NewTraceHandler(svc *service.TraceService) *TraceHandler {
	return &TraceHandler{svc: svc}
}

// RegisterRoutes registers all trace API routes.
func (h *TraceHandler) RegisterRoutes(rg *gin.RouterGroup) {
	rg.GET("/traces", h.ListTraces)
	rg.GET("/traces/stats", h.GetStats)
	rg.GET("/traces/:id", h.GetTraceDetail)
	rg.GET("/traces/:id/actions", h.ListTraceActions)
	rg.GET("/actions/:id", h.GetAction)

	writeRoutes := rg.Group("")
	writeRoutes.Use(authz.RequireRoles(authz.WriteRoles()...))
	writeRoutes.POST("/traces", h.BatchIngest)
	writeRoutes.POST("/spans", h.IngestSpans)
	writeRoutes.POST("/traces/:id/feedback", h.AddFeedback)
	writeRoutes.POST("/traces/batch/dataset", h.BackfillToDataset)
	writeRoutes.POST("/traces/batch/annotation", h.BackfillToAnnotation)
	writeRoutes.POST("/actions/:id/retry", h.RetryAction)
}

// BatchIngest handles POST /api/v1/traces
func (h *TraceHandler) BatchIngest(c *gin.Context) {
	projectID := c.GetString("project_id")
	if projectID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(1001, "missing project_id"))
		return
	}

	var req model.BatchIngestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(1002, "invalid request: "+err.Error()))
		return
	}

	resp, err := h.svc.BatchIngest(c.Request.Context(), projectID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse(5000, "ingest failed: "+err.Error()))
		return
	}

	c.JSON(http.StatusOK, model.SuccessResponse(resp))
}

// IngestSpans handles POST /api/v1/spans
func (h *TraceHandler) IngestSpans(c *gin.Context) {
	projectID := c.GetString("project_id")
	if projectID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(1001, "missing project_id"))
		return
	}

	var req model.SpanBatchIngestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(1002, "invalid request: "+err.Error()))
		return
	}

	resp, err := h.svc.IngestSpans(c.Request.Context(), projectID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse(5000, "span ingest failed: "+err.Error()))
		return
	}
	c.JSON(http.StatusOK, model.SuccessResponse(resp))
}

// ListTraces handles GET /api/v1/traces
func (h *TraceHandler) ListTraces(c *gin.Context) {
	projectID := c.GetString("project_id")
	if projectID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(1001, "missing project_id"))
		return
	}

	var q model.TraceListQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(1002, "invalid query: "+err.Error()))
		return
	}

	result, err := h.svc.ListTraces(c.Request.Context(), projectID, q)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse(5000, "list failed: "+err.Error()))
		return
	}

	c.JSON(http.StatusOK, model.SuccessResponse(result))
}

// GetTraceDetail handles GET /api/v1/traces/:id
func (h *TraceHandler) GetTraceDetail(c *gin.Context) {
	projectID := c.GetString("project_id")
	if projectID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(1001, "missing project_id"))
		return
	}

	traceID := c.Param("id")
	detail, err := h.svc.GetTraceDetail(c.Request.Context(), projectID, traceID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse(4004, "trace not found"))
		return
	}

	c.JSON(http.StatusOK, model.SuccessResponse(detail))
}

// GetStats handles GET /api/v1/traces/stats
func (h *TraceHandler) GetStats(c *gin.Context) {
	projectID := c.GetString("project_id")
	if projectID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(1001, "missing project_id"))
		return
	}

	var q model.StatsQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(1002, "invalid query: "+err.Error()))
		return
	}

	stats, err := h.svc.GetStats(c.Request.Context(), projectID, q)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse(5000, "stats failed: "+err.Error()))
		return
	}

	c.JSON(http.StatusOK, model.SuccessResponse(stats))
}

// AddFeedback handles POST /api/v1/traces/:id/feedback
func (h *TraceHandler) AddFeedback(c *gin.Context) {
	projectID := c.GetString("project_id")
	if projectID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(1001, "missing project_id"))
		return
	}

	traceID := c.Param("id")

	var req model.FeedbackRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(1002, "invalid request: "+err.Error()))
		return
	}

	if err := h.svc.AddFeedback(c.Request.Context(), projectID, traceID, req); err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse(5000, "feedback failed: "+err.Error()))
		return
	}

	c.JSON(http.StatusOK, model.SuccessResponse(nil))
}

func (h *TraceHandler) BackfillToDataset(c *gin.Context) {
	projectID := c.GetString("project_id")
	if projectID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(1001, "missing project_id"))
		return
	}

	var req model.TraceBackfillDatasetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(1002, "invalid request: "+err.Error()))
		return
	}

	resp, err := h.svc.BackfillToDataset(c.Request.Context(), projectID, c.GetString("user_id"), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse(5000, "trace backfill failed: "+err.Error()))
		return
	}
	c.JSON(http.StatusOK, model.SuccessResponse(resp))
}

func (h *TraceHandler) BackfillToAnnotation(c *gin.Context) {
	projectID := c.GetString("project_id")
	if projectID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(1001, "missing project_id"))
		return
	}

	var req model.TraceBackfillAnnotationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(1002, "invalid request: "+err.Error()))
		return
	}

	resp, err := h.svc.BackfillToAnnotation(c.Request.Context(), projectID, c.GetString("user_id"), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse(5000, "annotation backfill failed: "+err.Error()))
		return
	}
	c.JSON(http.StatusOK, model.SuccessResponse(resp))
}

func (h *TraceHandler) ListTraceActions(c *gin.Context) {
	projectID := c.GetString("project_id")
	if projectID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(1001, "missing project_id"))
		return
	}

	items, err := h.svc.ListTraceActions(c.Request.Context(), projectID, c.Param("id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse(5000, "list actions failed: "+err.Error()))
		return
	}
	c.JSON(http.StatusOK, model.SuccessResponse(items))
}

func (h *TraceHandler) GetAction(c *gin.Context) {
	projectID := c.GetString("project_id")
	if projectID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(1001, "missing project_id"))
		return
	}

	item, err := h.svc.GetAction(c.Request.Context(), projectID, c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse(4004, "action not found"))
		return
	}
	c.JSON(http.StatusOK, model.SuccessResponse(item))
}

func (h *TraceHandler) RetryAction(c *gin.Context) {
	projectID := c.GetString("project_id")
	if projectID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(1001, "missing project_id"))
		return
	}

	item, err := h.svc.RetryAction(c.Request.Context(), projectID, c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse(4000, "retry failed: "+err.Error()))
		return
	}
	c.JSON(http.StatusOK, model.SuccessResponse(item))
}
