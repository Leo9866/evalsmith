package service

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"time"

	"github.com/evalsmith/trace-service/internal/model"
	"github.com/evalsmith/trace-service/internal/repository"
)

type TraceService struct {
	chRepo               *repository.ClickHouseRepo
	minioRepo            *repository.MinIORepo
	producer             *KafkaProducer
	localStore           *repository.LocalTraceStore
	httpClient           *http.Client
	internalServiceToken string
	datasetServiceURL    string
	annotationServiceURL string
}

type datasetExample struct {
	Inputs          model.JSON `json:"inputs"`
	ExpectedOutputs model.JSON `json:"expected_outputs"`
	Metadata        model.JSON `json:"metadata"`
	Split           string     `json:"split"`
	Source          string     `json:"source"`
}

type datasetRequest struct {
	Examples      []datasetExample `json:"examples"`
	SourceContext map[string]any   `json:"source_context,omitempty"`
}

type datasetResponse struct {
	Added      int      `json:"added"`
	NewVersion int      `json:"new_version"`
	ExampleIDs []string `json:"example_ids"`
}

type annotationTask struct {
	SourceType       string     `json:"source_type"`
	SourceID         string     `json:"source_id"`
	Mode             string     `json:"mode"`
	TraceID          *string    `json:"trace_id"`
	InputPayload     model.JSON `json:"input_payload"`
	CandidateOutput  model.JSON `json:"candidate_output"`
	ReferenceOutput  model.JSON `json:"reference_output"`
	Metadata         model.JSON `json:"metadata"`
	BackfillActionID *string    `json:"backfill_action_id,omitempty"`
	SourceTraceID    *string    `json:"source_trace_id,omitempty"`
}

type annotationRequest struct {
	Tasks []annotationTask `json:"tasks"`
}

type annotationResponse struct {
	Added   int      `json:"added"`
	TaskIDs []string `json:"task_ids"`
}

func NewTraceService(
	chRepo *repository.ClickHouseRepo,
	minioRepo *repository.MinIORepo,
	producer *KafkaProducer,
	localStore *repository.LocalTraceStore,
	internalServiceToken string,
	datasetServiceURL string,
	annotationServiceURL string,
) *TraceService {
	return &TraceService{
		chRepo:               chRepo,
		minioRepo:            minioRepo,
		producer:             producer,
		localStore:           localStore,
		httpClient:           &http.Client{Timeout: 30 * time.Second},
		internalServiceToken: internalServiceToken,
		datasetServiceURL:    datasetServiceURL,
		annotationServiceURL: annotationServiceURL,
	}
}

// BatchIngest validates the request and produces each trace to Kafka.
func (s *TraceService) BatchIngest(ctx context.Context, projectID string, req model.BatchIngestRequest) (*model.BatchIngestResponse, error) {
	for i := range req.Traces {
		trace := &req.Traces[i]

		// Generate trace_id if not provided.
		if trace.TraceID == "" {
			trace.TraceID = generateID("tr")
		}

		// Generate span_ids if not provided.
		for j := range trace.Spans {
			if trace.Spans[j].SpanID == "" {
				trace.Spans[j].SpanID = generateID("sp")
			}
		}

	}

	if s.localStore != nil {
		return s.localStore.BatchIngest(projectID, req)
	}

	var traceIDs []string
	for i := range req.Traces {
		trace := &req.Traces[i]

		// Build the Kafka message payload: includes project_id + the trace data.
		payload := map[string]interface{}{
			"project_id":  projectID,
			"trace":       trace,
			"ingested_at": time.Now().UTC().Format(time.RFC3339Nano),
		}

		data, err := json.Marshal(payload)
		if err != nil {
			return nil, fmt.Errorf("marshal trace %s: %w", trace.TraceID, err)
		}

		if err := s.producer.Produce(ctx, trace.TraceID, data); err != nil {
			return nil, fmt.Errorf("produce trace %s: %w", trace.TraceID, err)
		}

		traceIDs = append(traceIDs, trace.TraceID)
	}

	return &model.BatchIngestResponse{
		TraceIDs: traceIDs,
		Accepted: len(traceIDs),
	}, nil
}

// ListTraces returns a paginated list of traces.
func (s *TraceService) ListTraces(ctx context.Context, projectID string, q model.TraceListQuery) (*model.TraceListResult, error) {
	q.Defaults()
	var (
		result *model.TraceListResult
		err    error
	)
	if s.localStore != nil {
		result, err = s.localStore.ListTraces(projectID, q)
	} else {
		result, err = s.chRepo.ListTraces(ctx, projectID, q)
	}
	if err != nil {
		return nil, err
	}
	return normalizeTraceList(result, q), nil
}

// GetTraceDetail returns a trace with its span tree.
func (s *TraceService) GetTraceDetail(ctx context.Context, projectID, traceID string) (*model.TraceDetail, error) {
	if s.localStore != nil {
		return s.localStore.GetTraceDetail(projectID, traceID)
	}
	trace, err := s.chRepo.GetTrace(ctx, projectID, traceID)
	if err != nil {
		return nil, fmt.Errorf("get trace: %w", err)
	}

	spans, err := s.chRepo.GetSpansByTraceID(ctx, projectID, traceID)
	if err != nil {
		return nil, fmt.Errorf("get spans: %w", err)
	}

	if trace.PayloadKey != "" {
		if payloadBytes, payloadErr := s.minioRepo.GetPayload(ctx, trace.PayloadKey); payloadErr == nil {
			var envelope model.TracePayloadEnvelope
			if err := json.Unmarshal(payloadBytes, &envelope); err == nil {
				applyPayloadToSpans(spans, envelope.Trace.Spans)
				traceMetadata := envelope.Trace.Metadata
				var detailInput model.JSON
				var detailOutput model.JSON
				for _, payloadSpan := range envelope.Trace.Spans {
					if payloadSpan.ParentSpanID == nil || *payloadSpan.ParentSpanID == "" {
						detailInput = payloadSpan.Input
						detailOutput = payloadSpan.Output
						break
					}
				}

				tree := buildSpanTree(spans)
				return &model.TraceDetail{
					Trace:        *trace,
					Input:        detailInput,
					Output:       detailOutput,
					MetadataJSON: traceMetadata,
					Spans:        tree,
				}, nil
			}
		}
	}

	tree := buildSpanTree(spans)
	return &model.TraceDetail{Trace: *trace, Spans: tree}, nil
}

// GetStats returns aggregated statistics.
func (s *TraceService) GetStats(ctx context.Context, projectID string, q model.StatsQuery) (*model.TraceStats, error) {
	q.Defaults()
	var (
		stats *model.TraceStats
		err   error
	)
	if s.localStore != nil {
		stats, err = s.localStore.GetStats(projectID, q.Period)
	} else {
		stats, err = s.chRepo.GetStats(ctx, projectID, q.Period)
	}
	if err != nil {
		return nil, err
	}
	return normalizeTraceStats(stats), nil
}

// AddFeedback adds user feedback to a trace.
func (s *TraceService) AddFeedback(ctx context.Context, projectID, traceID string, req model.FeedbackRequest) error {
	if s.localStore != nil {
		return s.localStore.AddFeedback(projectID, traceID, req)
	}
	// Verify trace exists.
	_, err := s.chRepo.GetTrace(ctx, projectID, traceID)
	if err != nil {
		return fmt.Errorf("trace not found: %w", err)
	}

	fb := model.Feedback{
		TraceID:   traceID,
		ProjectID: projectID,
		Score:     req.Score,
		Comment:   req.Comment,
		Tags:      req.Tags,
		CreatedAt: time.Now().UTC(),
	}

	return s.chRepo.InsertFeedback(ctx, fb)
}

func (s *TraceService) IngestSpans(ctx context.Context, projectID string, req model.SpanBatchIngestRequest) (*model.BatchIngestResponse, error) {
	name := req.Name
	if name == "" {
		name = req.TraceID
	}
	return s.BatchIngest(ctx, projectID, model.BatchIngestRequest{
		Traces: []model.TraceIngestItem{
			{
				TraceID:  req.TraceID,
				Name:     name,
				Tags:     req.Tags,
				Metadata: req.Metadata,
				Spans:    req.Spans,
			},
		},
	})
}

func (s *TraceService) BackfillToDataset(ctx context.Context, projectID, createdBy string, req model.TraceBackfillDatasetRequest) (*model.TraceBackfillDatasetResponse, error) {
	split := req.Split
	if split == "" {
		split = "default"
	}

	sourceType := req.SourceType
	if sourceType == "" {
		sourceType = "manual"
	}

	examples := make([]datasetExample, 0, len(req.TraceIDs))
	actions := make([]*model.TraceFeedbackAction, 0, len(req.TraceIDs))

	for _, traceID := range req.TraceIDs {
		trace, err := s.GetTraceDetail(ctx, projectID, traceID)
		if err != nil {
			return nil, fmt.Errorf("load trace %s: %w", traceID, err)
		}

		requestPayload, err := json.Marshal(map[string]any{
			"dataset_id": req.DatasetID,
			"trace_id":   trace.TraceID,
			"split":      split,
		})
		if err != nil {
			return nil, fmt.Errorf("marshal action request: %w", err)
		}

		action := newTraceAction(projectID, trace.TraceID, "dataset_backfill", sourceType, req.SourceRefID, "dataset", createdBy, requestPayload)
		if err := s.upsertAction(ctx, action); err != nil {
			return nil, err
		}

		example, err := buildDatasetExample(trace, split, action.ID)
		if err != nil {
			return nil, err
		}
		examples = append(examples, example)
		actions = append(actions, action)
	}

	resp := &model.TraceBackfillDatasetResponse{
		DatasetID: req.DatasetID,
		TraceIDs:  req.TraceIDs,
		Actions:   cloneActionValues(actions),
	}

	respData := &datasetResponse{}
	err := s.postJSON(
		ctx,
		s.datasetServiceURL+"/api/v1/datasets/"+req.DatasetID+"/examples",
		projectID,
		datasetRequest{
			Examples: examples,
			SourceContext: map[string]any{
				"source_type":          "trace_backfill",
				"trace_ids":            req.TraceIDs,
				"backfill_action_ids":  actionIDs(actions),
				"backfill_source_type": sourceType,
				"source_ref_id":        req.SourceRefID,
			},
		},
		respData,
	)
	if err != nil {
		for _, action := range actions {
			markActionFailed(action, err)
			if upsertErr := s.upsertAction(ctx, action); upsertErr != nil {
				return nil, upsertErr
			}
		}
		resp.Actions = cloneActionValues(actions)
		return resp, nil
	}

	resp.Added = respData.Added
	resp.NewVersion = respData.NewVersion
	resp.ExampleIDs = respData.ExampleIDs

	for index, action := range actions {
		action.TargetID = req.DatasetID
		version := respData.NewVersion
		action.TargetVersion = &version
		resultPayload, err := json.Marshal(map[string]any{
			"added":         1,
			"dataset_id":    req.DatasetID,
			"new_version":   respData.NewVersion,
			"example_id":    valueAt(respData.ExampleIDs, index),
			"batch_added":   respData.Added,
			"source_trace":  action.TraceID,
			"source_action": action.ID,
		})
		if err != nil {
			return nil, fmt.Errorf("marshal action result: %w", err)
		}
		markActionSucceeded(action, resultPayload)
		if upsertErr := s.upsertAction(ctx, action); upsertErr != nil {
			return nil, upsertErr
		}
	}

	resp.Actions = cloneActionValues(actions)
	return resp, nil
}

func (s *TraceService) BackfillToAnnotation(ctx context.Context, projectID, createdBy string, req model.TraceBackfillAnnotationRequest) (*model.TraceBackfillAnnotationResponse, error) {
	mode := req.Mode
	if mode == "" {
		mode = "single_run"
	}

	sourceType := req.SourceType
	if sourceType == "" {
		sourceType = "manual"
	}

	tasks := make([]annotationTask, 0, len(req.TraceIDs))
	actions := make([]*model.TraceFeedbackAction, 0, len(req.TraceIDs))

	for _, traceID := range req.TraceIDs {
		trace, err := s.GetTraceDetail(ctx, projectID, traceID)
		if err != nil {
			return nil, fmt.Errorf("load trace %s: %w", traceID, err)
		}

		requestPayload, err := json.Marshal(map[string]any{
			"trace_id": trace.TraceID,
			"mode":     mode,
		})
		if err != nil {
			return nil, fmt.Errorf("marshal action request: %w", err)
		}

		action := newTraceAction(projectID, trace.TraceID, "annotation_create", sourceType, req.SourceRefID, "annotation_task", createdBy, requestPayload)
		if err := s.upsertAction(ctx, action); err != nil {
			return nil, err
		}

		task, err := buildAnnotationTask(trace, mode, action.ID)
		if err != nil {
			return nil, err
		}
		tasks = append(tasks, task)
		actions = append(actions, action)
	}

	resp := &model.TraceBackfillAnnotationResponse{
		TraceIDs: req.TraceIDs,
		Actions:  cloneActionValues(actions),
	}

	respData := &annotationResponse{}
	err := s.postJSON(ctx, s.annotationServiceURL+"/api/v1/annotation/tasks", projectID, annotationRequest{Tasks: tasks}, respData)
	if err != nil {
		for _, action := range actions {
			markActionFailed(action, err)
			if upsertErr := s.upsertAction(ctx, action); upsertErr != nil {
				return nil, upsertErr
			}
		}
		resp.Actions = cloneActionValues(actions)
		return resp, nil
	}

	resp.Added = respData.Added
	resp.TaskIDs = respData.TaskIDs

	for index, action := range actions {
		action.TargetID = valueAt(respData.TaskIDs, index)
		resultPayload, err := json.Marshal(map[string]any{
			"added":         1,
			"task_id":       action.TargetID,
			"mode":          mode,
			"source_trace":  action.TraceID,
			"source_action": action.ID,
		})
		if err != nil {
			return nil, fmt.Errorf("marshal action result: %w", err)
		}
		markActionSucceeded(action, resultPayload)
		if upsertErr := s.upsertAction(ctx, action); upsertErr != nil {
			return nil, upsertErr
		}
	}

	resp.Actions = cloneActionValues(actions)
	return resp, nil
}

func (s *TraceService) ListTraceActions(ctx context.Context, projectID, traceID string) ([]model.TraceFeedbackAction, error) {
	if s.localStore != nil {
		return s.localStore.ListTraceActions(projectID, traceID)
	}
	return s.chRepo.ListTraceActions(ctx, projectID, traceID)
}

func (s *TraceService) GetAction(ctx context.Context, projectID, actionID string) (*model.TraceFeedbackAction, error) {
	if s.localStore != nil {
		return s.localStore.GetAction(projectID, actionID)
	}
	return s.chRepo.GetAction(ctx, projectID, actionID)
}

func (s *TraceService) RetryAction(ctx context.Context, projectID, actionID string) (*model.TraceFeedbackAction, error) {
	action, err := s.GetAction(ctx, projectID, actionID)
	if err != nil {
		return nil, err
	}
	if action.Status != "failed" {
		return nil, fmt.Errorf("only failed actions can be retried")
	}

	switch action.ActionType {
	case "dataset_backfill":
		var payload struct {
			DatasetID string `json:"dataset_id"`
			TraceID   string `json:"trace_id"`
			Split     string `json:"split"`
		}
		if err := json.Unmarshal(action.RequestPayload, &payload); err != nil {
			return nil, fmt.Errorf("decode dataset action request: %w", err)
		}
		trace, err := s.GetTraceDetail(ctx, projectID, payload.TraceID)
		if err != nil {
			return nil, fmt.Errorf("load trace %s: %w", payload.TraceID, err)
		}
		example, err := buildDatasetExample(trace, payload.Split, action.ID)
		if err != nil {
			return nil, err
		}
		resetActionForRetry(action)
		if err := s.upsertAction(ctx, action); err != nil {
			return nil, err
		}

		respData := &datasetResponse{}
		err = s.postJSON(
			ctx,
			s.datasetServiceURL+"/api/v1/datasets/"+payload.DatasetID+"/examples",
			projectID,
			datasetRequest{
				Examples: []datasetExample{example},
				SourceContext: map[string]any{
					"source_type":          "trace_backfill_retry",
					"trace_ids":            []string{payload.TraceID},
					"backfill_action_ids":  []string{action.ID},
					"backfill_source_type": action.SourceType,
					"source_ref_id":        action.SourceRefID,
				},
			},
			respData,
		)
		if err != nil {
			markActionFailed(action, err)
		} else {
			action.TargetID = payload.DatasetID
			version := respData.NewVersion
			action.TargetVersion = &version
			resultPayload, marshalErr := json.Marshal(map[string]any{
				"added":         1,
				"dataset_id":    payload.DatasetID,
				"new_version":   respData.NewVersion,
				"example_id":    valueAt(respData.ExampleIDs, 0),
				"batch_added":   respData.Added,
				"source_trace":  action.TraceID,
				"source_action": action.ID,
			})
			if marshalErr != nil {
				return nil, fmt.Errorf("marshal action result: %w", marshalErr)
			}
			markActionSucceeded(action, resultPayload)
		}
	case "annotation_create":
		var payload struct {
			TraceID string `json:"trace_id"`
			Mode    string `json:"mode"`
		}
		if err := json.Unmarshal(action.RequestPayload, &payload); err != nil {
			return nil, fmt.Errorf("decode annotation action request: %w", err)
		}
		trace, err := s.GetTraceDetail(ctx, projectID, payload.TraceID)
		if err != nil {
			return nil, fmt.Errorf("load trace %s: %w", payload.TraceID, err)
		}
		task, err := buildAnnotationTask(trace, payload.Mode, action.ID)
		if err != nil {
			return nil, err
		}
		resetActionForRetry(action)
		if err := s.upsertAction(ctx, action); err != nil {
			return nil, err
		}

		respData := &annotationResponse{}
		err = s.postJSON(ctx, s.annotationServiceURL+"/api/v1/annotation/tasks", projectID, annotationRequest{Tasks: []annotationTask{task}}, respData)
		if err != nil {
			markActionFailed(action, err)
		} else {
			action.TargetID = valueAt(respData.TaskIDs, 0)
			resultPayload, marshalErr := json.Marshal(map[string]any{
				"added":         1,
				"task_id":       action.TargetID,
				"mode":          payload.Mode,
				"source_trace":  action.TraceID,
				"source_action": action.ID,
			})
			if marshalErr != nil {
				return nil, fmt.Errorf("marshal action result: %w", marshalErr)
			}
			markActionSucceeded(action, resultPayload)
		}
	default:
		return nil, fmt.Errorf("unsupported action type %q", action.ActionType)
	}

	if err := s.upsertAction(ctx, action); err != nil {
		return nil, err
	}
	return action, nil
}

// buildSpanTree converts a flat list of spans into a nested tree.
func buildSpanTree(spans []model.Span) []*model.SpanTree {
	nodeMap := make(map[string]*model.SpanTree, len(spans))
	for i := range spans {
		nodeMap[spans[i].SpanID] = &model.SpanTree{
			Span:     spans[i],
			Children: []*model.SpanTree{},
		}
	}

	var roots []*model.SpanTree
	for _, node := range nodeMap {
		if node.ParentSpanID == nil || *node.ParentSpanID == "" {
			roots = append(roots, node)
		} else {
			parent, ok := nodeMap[*node.ParentSpanID]
			if ok {
				parent.Children = append(parent.Children, node)
			} else {
				// Orphan span, treat as root.
				roots = append(roots, node)
			}
		}
	}
	return roots
}

func generateID(prefix string) string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return prefix + "_" + hex.EncodeToString(b)
}

func newTraceAction(
	projectID, traceID, actionType, sourceType, sourceRefID, targetType, createdBy string,
	requestPayload []byte,
) *model.TraceFeedbackAction {
	now := time.Now().UTC()
	return &model.TraceFeedbackAction{
		ID:             generateID("tfa"),
		ProjectID:      projectID,
		TraceID:        traceID,
		ActionType:     actionType,
		SourceType:     sourceType,
		SourceRefID:    sourceRefID,
		TargetType:     targetType,
		Status:         "pending",
		RequestPayload: model.JSON(requestPayload),
		ResultPayload:  model.JSON(`{}`),
		CreatedBy:      createdBy,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
}

func markActionFailed(action *model.TraceFeedbackAction, err error) {
	if action == nil {
		return
	}
	action.Status = "failed"
	action.ErrorMessage = err.Error()
	action.ResultPayload = model.JSON(`{}`)
	action.UpdatedAt = time.Now().UTC()
}

func markActionSucceeded(action *model.TraceFeedbackAction, resultPayload []byte) {
	if action == nil {
		return
	}
	action.Status = "succeeded"
	action.ErrorMessage = ""
	action.ResultPayload = model.JSON(resultPayload)
	action.UpdatedAt = time.Now().UTC()
}

func resetActionForRetry(action *model.TraceFeedbackAction) {
	if action == nil {
		return
	}
	action.Status = "pending"
	action.ErrorMessage = ""
	action.ResultPayload = model.JSON(`{}`)
	action.UpdatedAt = time.Now().UTC()
}

func cloneActionValues(actions []*model.TraceFeedbackAction) []model.TraceFeedbackAction {
	items := make([]model.TraceFeedbackAction, 0, len(actions))
	for _, action := range actions {
		if action == nil {
			continue
		}
		cloned := *action
		if action.RequestPayload != nil {
			cloned.RequestPayload = append(model.JSON(nil), action.RequestPayload...)
		}
		if action.ResultPayload != nil {
			cloned.ResultPayload = append(model.JSON(nil), action.ResultPayload...)
		}
		if action.TargetVersion != nil {
			value := *action.TargetVersion
			cloned.TargetVersion = &value
		}
		items = append(items, cloned)
	}
	return items
}

func actionIDs(actions []*model.TraceFeedbackAction) []string {
	items := make([]string, 0, len(actions))
	for _, action := range actions {
		if action != nil {
			items = append(items, action.ID)
		}
	}
	return items
}

func valueAt(values []string, index int) string {
	if index < 0 || index >= len(values) {
		return ""
	}
	return values[index]
}

func normalizeTraceList(result *model.TraceListResult, q model.TraceListQuery) *model.TraceListResult {
	if result == nil {
		return &model.TraceListResult{
			Traces:   []model.Trace{},
			Page:     q.Page,
			PageSize: q.PageSize,
		}
	}
	if result.Traces == nil {
		result.Traces = []model.Trace{}
	}
	return result
}

func normalizeTraceStats(stats *model.TraceStats) *model.TraceStats {
	if stats == nil {
		return &model.TraceStats{}
	}

	stats.AvgDuration = normalizeFiniteFloat(stats.AvgDuration)
	stats.P50Duration = normalizeFiniteFloat(stats.P50Duration)
	stats.P95Duration = normalizeFiniteFloat(stats.P95Duration)
	stats.P99Duration = normalizeFiniteFloat(stats.P99Duration)
	stats.TotalCostUSD = normalizeFiniteFloat(stats.TotalCostUSD)

	return stats
}

func normalizeFiniteFloat(value float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0
	}
	return value
}

func applyPayloadToSpans(spans []model.Span, payloadSpans []model.TracePayloadSpan) {
	payloadByID := make(map[string]model.TracePayloadSpan, len(payloadSpans))
	for _, payloadSpan := range payloadSpans {
		payloadByID[payloadSpan.SpanID] = payloadSpan
	}

	for idx := range spans {
		payloadSpan, ok := payloadByID[spans[idx].SpanID]
		if !ok {
			continue
		}
		spans[idx].Input = payloadSpan.Input
		spans[idx].Output = payloadSpan.Output
		spans[idx].Metrics = payloadSpan.Metrics
		spans[idx].MetadataJSON = payloadSpan.Metadata
		spans[idx].Events = payloadSpan.Events
	}
}

func normalizeJSON(raw model.JSON, fallback any) model.JSON {
	if len(raw) > 0 && string(raw) != "null" {
		return raw
	}
	if fallback == nil {
		return model.JSON(`null`)
	}
	data, err := json.Marshal(fallback)
	if err != nil {
		return model.JSON(`null`)
	}
	return model.JSON(data)
}

func buildDatasetExample(trace *model.TraceDetail, split, actionID string) (datasetExample, error) {
	exampleMetadata, err := json.Marshal(map[string]any{
		"trace_id":           trace.TraceID,
		"trace_name":         trace.Name,
		"trace_status":       trace.Status,
		"tags":               trace.Tags,
		"source":             "trace_backfill",
		"payload_key":        trace.PayloadKey,
		"start_time":         trace.StartTime,
		"backfill_action_id": actionID,
	})
	if err != nil {
		return datasetExample{}, fmt.Errorf("marshal trace metadata: %w", err)
	}
	return datasetExample{
		Inputs:          normalizeJSON(trace.Input, map[string]any{"trace_id": trace.TraceID, "input_preview": trace.InputPreview}),
		ExpectedOutputs: normalizeJSON(trace.Output, map[string]any{"trace_id": trace.TraceID, "output_preview": trace.OutputPreview}),
		Metadata:        model.JSON(exampleMetadata),
		Split:           split,
		Source:          "trace_backfill",
	}, nil
}

func buildAnnotationTask(trace *model.TraceDetail, mode, actionID string) (annotationTask, error) {
	metadata, err := json.Marshal(map[string]any{
		"trace_id":           trace.TraceID,
		"trace_name":         trace.Name,
		"trace_status":       trace.Status,
		"tags":               trace.Tags,
		"source":             "trace_backfill",
		"backfill_action_id": actionID,
	})
	if err != nil {
		return annotationTask{}, fmt.Errorf("marshal annotation metadata: %w", err)
	}
	traceIDCopy := trace.TraceID
	return annotationTask{
		SourceType:       "trace",
		SourceID:         trace.TraceID,
		Mode:             mode,
		TraceID:          &traceIDCopy,
		InputPayload:     normalizeJSON(trace.Input, map[string]any{"trace_id": trace.TraceID, "input_preview": trace.InputPreview}),
		CandidateOutput:  normalizeJSON(trace.Output, map[string]any{"trace_id": trace.TraceID, "output_preview": trace.OutputPreview}),
		ReferenceOutput:  normalizeJSON(trace.Output, map[string]any{"trace_id": trace.TraceID, "output_preview": trace.OutputPreview}),
		Metadata:         model.JSON(metadata),
		BackfillActionID: &actionID,
		SourceTraceID:    &traceIDCopy,
	}, nil
}

func (s *TraceService) upsertAction(ctx context.Context, action *model.TraceFeedbackAction) error {
	if s.localStore != nil {
		return s.localStore.UpsertAction(action)
	}
	return s.chRepo.UpsertAction(ctx, action)
}

func (s *TraceService) postJSON(ctx context.Context, url, projectID string, payload any, target any) error {
	if url == "" {
		return fmt.Errorf("service URL is not configured")
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Project-ID", projectID)
	if s.internalServiceToken != "" {
		req.Header.Set("X-Internal-Service-Token", s.internalServiceToken)
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("request %s: %w", url, err)
	}
	defer resp.Body.Close()

	rawResp, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}
	if resp.StatusCode >= 400 {
		return fmt.Errorf("request %s failed: %s", url, string(rawResp))
	}

	var envelope struct {
		Code    int             `json:"code"`
		Message string          `json:"message"`
		Data    json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(rawResp, &envelope); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}
	if envelope.Code != 0 {
		return fmt.Errorf("request %s failed: %s", url, envelope.Message)
	}
	if target != nil && len(envelope.Data) > 0 {
		if err := json.Unmarshal(envelope.Data, target); err != nil {
			return fmt.Errorf("decode response data: %w", err)
		}
	}
	return nil
}
