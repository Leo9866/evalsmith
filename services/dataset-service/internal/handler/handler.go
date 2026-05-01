package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/evalsmith/dataset-service/internal/authz"
	"github.com/evalsmith/dataset-service/internal/model"
	"github.com/evalsmith/dataset-service/internal/service"
	"github.com/gin-gonic/gin"
)

type Handler struct {
	svc            *service.DatasetService
	authServiceURL string
	internalToken  string
}

func NewHandler(svc *service.DatasetService, authServiceURL, internalToken string) *Handler {
	return &Handler{
		svc:            svc,
		authServiceURL: authServiceURL,
		internalToken:  internalToken,
	}
}

// RegisterRoutes sets up all API routes.
func (h *Handler) RegisterRoutes(r *gin.Engine) {
	v1 := r.Group("/api/v1")
	v1.Use(authz.AuthContextMiddleware(h.authServiceURL, h.internalToken))

	v1.GET("/datasets", h.ListDatasets)
	v1.GET("/datasets/:id", h.GetDataset)
	v1.GET("/datasets/:id/examples", h.ListExamples)
	v1.GET("/datasets/:id/splits", h.GetSplitSummary)
	v1.GET("/datasets/:id/versions", h.ListVersions)
	v1.GET("/datasets/:id/versions/:version/diff", h.GetVersionDiff)

	writeRoutes := v1.Group("")
	writeRoutes.Use(authz.RequireRoles(authz.WriteRoles()...))
	writeRoutes.POST("/datasets", h.CreateDataset)
	writeRoutes.PUT("/datasets/:id", h.UpdateDataset)
	writeRoutes.DELETE("/datasets/:id", h.DeleteDataset)
	writeRoutes.POST("/datasets/:id/examples", h.BatchAddExamples)
	writeRoutes.PUT("/datasets/:id/examples/:eid", h.UpdateExample)
	writeRoutes.DELETE("/datasets/:id/examples/:eid", h.DeleteExample)
	writeRoutes.POST("/datasets/:id/import", h.ImportFile)
	writeRoutes.PUT("/datasets/:id/versions/:version", h.UpdateVersion)
	writeRoutes.POST("/datasets/:id/versions/:version/rollback", h.RollbackVersion)
}

func getProjectID(c *gin.Context) string {
	return authz.GetProjectID(c)
}

// --- Dataset handlers ---

func (h *Handler) CreateDataset(c *gin.Context) {
	var req model.CreateDatasetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, respErr(err.Error()))
		return
	}

	d, err := h.svc.CreateDataset(getProjectID(c), &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, respErr(err.Error()))
		return
	}
	c.JSON(http.StatusOK, respOK(d))
}

func (h *Handler) ListDatasets(c *gin.Context) {
	page, pageSize := parsePagination(c)
	name := c.Query("name")
	items, total, err := h.svc.ListDatasets(getProjectID(c), name, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, respErr(err.Error()))
		return
	}
	if items == nil {
		items = []*model.Dataset{}
	}
	c.JSON(http.StatusOK, respPage(items, total, page, pageSize))
}

func (h *Handler) GetDataset(c *gin.Context) {
	d, err := h.svc.GetDataset(c.Param("id"), getProjectID(c))
	if err != nil {
		handleError(c, err)
		return
	}
	c.JSON(http.StatusOK, respOK(d))
}

func (h *Handler) UpdateDataset(c *gin.Context) {
	var req model.UpdateDatasetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, respErr(err.Error()))
		return
	}

	d, err := h.svc.UpdateDataset(c.Param("id"), getProjectID(c), &req)
	if err != nil {
		handleError(c, err)
		return
	}
	c.JSON(http.StatusOK, respOK(d))
}

func (h *Handler) DeleteDataset(c *gin.Context) {
	if err := h.svc.DeleteDataset(c.Param("id"), getProjectID(c)); err != nil {
		handleError(c, err)
		return
	}
	c.JSON(http.StatusOK, respOK(nil))
}

// --- Example handlers ---

func (h *Handler) BatchAddExamples(c *gin.Context) {
	var req model.BatchAddExamplesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, respErr(err.Error()))
		return
	}

	resp, err := h.svc.BatchAddExamples(c.Param("id"), getProjectID(c), &req)
	if err != nil {
		handleError(c, err)
		return
	}
	c.JSON(http.StatusOK, respOK(resp))
}

func (h *Handler) ListExamples(c *gin.Context) {
	page, pageSize := parsePagination(c)
	split := c.Query("split")
	query := c.Query("query")
	var version *int
	if rawVersion := c.Query("version"); rawVersion != "" {
		parsedVersion, err := strconv.Atoi(rawVersion)
		if err != nil || parsedVersion < 1 {
			c.JSON(http.StatusBadRequest, respErr("invalid version"))
			return
		}
		version = &parsedVersion
	}
	items, total, err := h.svc.ListExamples(c.Param("id"), getProjectID(c), split, query, page, pageSize, version)
	if err != nil {
		handleError(c, err)
		return
	}
	if items == nil {
		items = []*model.Example{}
	}
	c.JSON(http.StatusOK, respPage(items, total, page, pageSize))
}

func (h *Handler) GetSplitSummary(c *gin.Context) {
	summaries, err := h.svc.GetSplitSummary(c.Param("id"), getProjectID(c))
	if err != nil {
		handleError(c, err)
		return
	}
	if summaries == nil {
		summaries = []*model.SplitSummary{}
	}
	c.JSON(http.StatusOK, respOK(summaries))
}

func (h *Handler) UpdateExample(c *gin.Context) {
	var req model.UpdateExampleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, respErr(err.Error()))
		return
	}

	ex, err := h.svc.UpdateExample(c.Param("id"), c.Param("eid"), getProjectID(c), &req)
	if err != nil {
		handleError(c, err)
		return
	}
	c.JSON(http.StatusOK, respOK(ex))
}

func (h *Handler) DeleteExample(c *gin.Context) {
	if err := h.svc.DeleteExample(c.Param("id"), c.Param("eid"), getProjectID(c)); err != nil {
		handleError(c, err)
		return
	}
	c.JSON(http.StatusOK, respOK(nil))
}

// --- Version handlers ---

func (h *Handler) ListVersions(c *gin.Context) {
	versions, err := h.svc.ListVersions(c.Param("id"), getProjectID(c))
	if err != nil {
		handleError(c, err)
		return
	}
	if versions == nil {
		versions = []*model.DatasetVersion{}
	}
	c.JSON(http.StatusOK, respOK(versions))
}

func (h *Handler) GetVersionDiff(c *gin.Context) {
	version, err := strconv.Atoi(c.Param("version"))
	if err != nil || version < 1 {
		c.JSON(http.StatusBadRequest, respErr("invalid version"))
		return
	}

	baseVersion, err := strconv.Atoi(c.Query("base_version"))
	if err != nil || baseVersion < 1 {
		c.JSON(http.StatusBadRequest, respErr("invalid base_version"))
		return
	}

	diff, err := h.svc.GetVersionDiff(c.Param("id"), getProjectID(c), baseVersion, version)
	if err != nil {
		handleError(c, err)
		return
	}
	c.JSON(http.StatusOK, respOK(diff))
}

func (h *Handler) RollbackVersion(c *gin.Context) {
	version, err := strconv.Atoi(c.Param("version"))
	if err != nil || version < 1 {
		c.JSON(http.StatusBadRequest, respErr("invalid version"))
		return
	}

	var req model.DatasetVersionRollbackRequest
	if c.Request.ContentLength > 0 {
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, respErr(err.Error()))
			return
		}
	}

	resp, err := h.svc.RollbackVersion(c.Param("id"), getProjectID(c), version, req.Description)
	if err != nil {
		handleError(c, err)
		return
	}
	c.JSON(http.StatusOK, respOK(resp))
}

func (h *Handler) UpdateVersion(c *gin.Context) {
	version, err := strconv.Atoi(c.Param("version"))
	if err != nil || version < 1 {
		c.JSON(http.StatusBadRequest, respErr("invalid version"))
		return
	}

	var req model.UpdateDatasetVersionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, respErr(err.Error()))
		return
	}

	item, err := h.svc.UpdateVersionDescription(c.Param("id"), getProjectID(c), version, req.Description)
	if err != nil {
		if errors.Is(err, service.ErrInvalidArgument) {
			c.JSON(http.StatusBadRequest, respErr(err.Error()))
			return
		}
		handleError(c, err)
		return
	}
	c.JSON(http.StatusOK, respOK(item))
}

// --- Import handler ---

func (h *Handler) ImportFile(c *gin.Context) {
	fh, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, respErr("missing 'file' in multipart upload"))
		return
	}

	description := c.PostForm("description")

	resp, err := h.svc.ImportFile(c.Param("id"), getProjectID(c), fh, description)
	if err != nil {
		handleError(c, err)
		return
	}
	c.JSON(http.StatusOK, respOK(resp))
}

// --- Response helpers ---

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
	if errors.Is(err, service.ErrInvalidArgument) {
		c.JSON(http.StatusBadRequest, respErr(err.Error()))
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
