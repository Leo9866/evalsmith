package repository

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/evalsmith/trace-service/internal/model"
)

type LocalTraceStore struct {
	mu      sync.RWMutex
	path    string
	traces  map[string]*localStoredTrace
	actions map[string]*model.TraceFeedbackAction
}

type localStoredTrace struct {
	ProjectID    string           `json:"project_id"`
	Trace        model.Trace      `json:"trace"`
	Spans        []model.Span     `json:"spans"`
	Input        model.JSON       `json:"input,omitempty"`
	Output       model.JSON       `json:"output,omitempty"`
	MetadataJSON model.JSON       `json:"metadata_json,omitempty"`
	Feedback     []model.Feedback `json:"feedback,omitempty"`
}

type localStoreSnapshot struct {
	Traces  []*localStoredTrace          `json:"traces"`
	Actions []*model.TraceFeedbackAction `json:"actions,omitempty"`
}

func NewLocalTraceStore(path string) (*LocalTraceStore, error) {
	store := &LocalTraceStore{
		path:    path,
		traces:  make(map[string]*localStoredTrace),
		actions: make(map[string]*model.TraceFeedbackAction),
	}
	if err := store.load(); err != nil {
		return nil, err
	}
	return store, nil
}

func (s *LocalTraceStore) BatchIngest(projectID string, req model.BatchIngestRequest) (*model.BatchIngestResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	traceIDs := make([]string, 0, len(req.Traces))
	now := time.Now().UTC()

	for _, traceItem := range req.Traces {
		stored, err := buildLocalStoredTrace(projectID, traceItem, now)
		if err != nil {
			return nil, err
		}
		s.traces[s.key(projectID, stored.Trace.TraceID)] = stored
		traceIDs = append(traceIDs, stored.Trace.TraceID)
	}

	if err := s.saveLocked(); err != nil {
		return nil, err
	}

	return &model.BatchIngestResponse{
		TraceIDs: traceIDs,
		Accepted: len(traceIDs),
	}, nil
}

func (s *LocalTraceStore) ListTraces(projectID string, q model.TraceListQuery) (*model.TraceListResult, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	filtered := make([]model.Trace, 0)
	for _, trace := range s.traces {
		if trace.ProjectID != projectID {
			continue
		}
		if !matchesTraceQuery(trace, q) {
			continue
		}
		filtered = append(filtered, trace.Trace)
	}

	sort.Slice(filtered, func(i, j int) bool {
		less := false
		switch q.SortBy {
		case "duration_ms":
			less = filtered[i].DurationMs < filtered[j].DurationMs
		case "total_tokens":
			less = filtered[i].TotalTokens < filtered[j].TotalTokens
		case "total_cost_usd":
			less = filtered[i].TotalCostUSD < filtered[j].TotalCostUSD
		default:
			less = filtered[i].StartTime.Before(filtered[j].StartTime)
		}
		if q.SortOrder == "asc" {
			return less
		}
		return !less
	})

	total := uint64(len(filtered))
	start := (q.Page - 1) * q.PageSize
	if start > len(filtered) {
		start = len(filtered)
	}
	end := start + q.PageSize
	if end > len(filtered) {
		end = len(filtered)
	}

	return &model.TraceListResult{
		Traces:   filtered[start:end],
		Total:    total,
		Page:     q.Page,
		PageSize: q.PageSize,
	}, nil
}

func (s *LocalTraceStore) GetTraceDetail(projectID, traceID string) (*model.TraceDetail, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	stored, ok := s.traces[s.key(projectID, traceID)]
	if !ok {
		return nil, fmt.Errorf("trace not found")
	}

	return &model.TraceDetail{
		Trace:        stored.Trace,
		Input:        stored.Input,
		Output:       stored.Output,
		MetadataJSON: stored.MetadataJSON,
		Spans:        buildLocalSpanTree(stored.Spans),
	}, nil
}

func (s *LocalTraceStore) GetStats(projectID, period string) (*model.TraceStats, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	since := time.Now().UTC().Add(-periodToDuration(period))
	var (
		traceCount uint64
		errorCount uint64
		totalDur   float64
		totalToken uint64
		totalCost  float64
		durations  []float64
	)

	for _, trace := range s.traces {
		if trace.ProjectID != projectID {
			continue
		}
		if trace.Trace.StartTime.Before(since) {
			continue
		}
		traceCount++
		if trace.Trace.Status == "error" {
			errorCount++
		}
		duration := float64(trace.Trace.DurationMs)
		totalDur += duration
		totalToken += uint64(trace.Trace.TotalTokens)
		totalCost += trace.Trace.TotalCostUSD
		durations = append(durations, duration)
	}

	sort.Float64s(durations)

	stats := &model.TraceStats{
		TraceCount:   traceCount,
		ErrorCount:   errorCount,
		TotalTokens:  totalToken,
		TotalCostUSD: totalCost,
	}
	if traceCount > 0 {
		stats.AvgDuration = totalDur / float64(traceCount)
		stats.P50Duration = percentile(durations, 0.50)
		stats.P95Duration = percentile(durations, 0.95)
		stats.P99Duration = percentile(durations, 0.99)
	}
	return stats, nil
}

func (s *LocalTraceStore) AddFeedback(projectID, traceID string, req model.FeedbackRequest) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	stored, ok := s.traces[s.key(projectID, traceID)]
	if !ok {
		return fmt.Errorf("trace not found")
	}
	stored.Feedback = append(stored.Feedback, model.Feedback{
		TraceID:   traceID,
		ProjectID: projectID,
		Score:     req.Score,
		Comment:   req.Comment,
		Tags:      req.Tags,
		CreatedAt: time.Now().UTC(),
	})
	return s.saveLocked()
}

func (s *LocalTraceStore) UpsertAction(action *model.TraceFeedbackAction) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.actions[s.actionKey(action.ProjectID, action.ID)] = cloneAction(action)
	return s.saveLocked()
}

func (s *LocalTraceStore) GetAction(projectID, actionID string) (*model.TraceFeedbackAction, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	action, ok := s.actions[s.actionKey(projectID, actionID)]
	if !ok {
		return nil, fmt.Errorf("action not found")
	}
	return cloneAction(action), nil
}

func (s *LocalTraceStore) ListTraceActions(projectID, traceID string) ([]model.TraceFeedbackAction, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]model.TraceFeedbackAction, 0)
	for _, action := range s.actions {
		if action.ProjectID != projectID || action.TraceID != traceID {
			continue
		}
		items = append(items, *cloneAction(action))
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].CreatedAt.Equal(items[j].CreatedAt) {
			return items[i].UpdatedAt.After(items[j].UpdatedAt)
		}
		return items[i].CreatedAt.After(items[j].CreatedAt)
	})
	return items, nil
}

func (s *LocalTraceStore) key(projectID, traceID string) string {
	return projectID + ":" + traceID
}

func (s *LocalTraceStore) actionKey(projectID, actionID string) string {
	return projectID + ":action:" + actionID
}

func (s *LocalTraceStore) load() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return fmt.Errorf("create local trace store dir: %w", err)
	}
	data, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read local trace store: %w", err)
	}
	if len(data) == 0 {
		return nil
	}

	var snapshot localStoreSnapshot
	if err := json.Unmarshal(data, &snapshot); err != nil {
		return fmt.Errorf("decode local trace store: %w", err)
	}
	for _, trace := range snapshot.Traces {
		s.traces[s.key(trace.ProjectID, trace.Trace.TraceID)] = trace
	}
	for _, action := range snapshot.Actions {
		s.actions[s.actionKey(action.ProjectID, action.ID)] = action
	}
	return nil
}

func (s *LocalTraceStore) saveLocked() error {
	snapshot := localStoreSnapshot{
		Traces:  make([]*localStoredTrace, 0, len(s.traces)),
		Actions: make([]*model.TraceFeedbackAction, 0, len(s.actions)),
	}
	for _, trace := range s.traces {
		snapshot.Traces = append(snapshot.Traces, trace)
	}
	sort.Slice(snapshot.Traces, func(i, j int) bool {
		return snapshot.Traces[i].Trace.StartTime.Before(snapshot.Traces[j].Trace.StartTime)
	})
	for _, action := range s.actions {
		snapshot.Actions = append(snapshot.Actions, cloneAction(action))
	}
	sort.Slice(snapshot.Actions, func(i, j int) bool {
		if snapshot.Actions[i].CreatedAt.Equal(snapshot.Actions[j].CreatedAt) {
			return snapshot.Actions[i].UpdatedAt.After(snapshot.Actions[j].UpdatedAt)
		}
		return snapshot.Actions[i].CreatedAt.After(snapshot.Actions[j].CreatedAt)
	})

	data, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return fmt.Errorf("encode local trace store: %w", err)
	}
	if err := os.WriteFile(s.path, data, 0o644); err != nil {
		return fmt.Errorf("write local trace store: %w", err)
	}
	return nil
}

func buildLocalStoredTrace(projectID string, traceItem model.TraceIngestItem, now time.Time) (*localStoredTrace, error) {
	var (
		traceStart    time.Time
		traceEnd      time.Time
		totalTokenIn  uint32
		totalTokenOut uint32
		totalCost     float64
		traceStatus   = "ok"
	)

	spans := make([]model.Span, 0, len(traceItem.Spans))
	var detailInput model.JSON
	var detailOutput model.JSON

	for i, spanItem := range traceItem.Spans {
		st, err := time.Parse(time.RFC3339Nano, spanItem.StartTime)
		if err != nil {
			return nil, fmt.Errorf("parse span start_time: %w", err)
		}
		et, err := time.Parse(time.RFC3339Nano, spanItem.EndTime)
		if err != nil {
			return nil, fmt.Errorf("parse span end_time: %w", err)
		}

		if i == 0 || st.Before(traceStart) {
			traceStart = st
		}
		if i == 0 || et.After(traceEnd) {
			traceEnd = et
		}
		if spanItem.Status == "error" {
			traceStatus = "error"
		}

		var metrics struct {
			Model       string  `json:"model"`
			TokenInput  uint32  `json:"token_input"`
			TokenOutput uint32  `json:"token_output"`
			CostUSD     float64 `json:"cost_usd"`
		}
		if spanItem.Metrics != nil {
			_ = json.Unmarshal(spanItem.Metrics, &metrics)
		}

		totalTokenIn += metrics.TokenInput
		totalTokenOut += metrics.TokenOutput
		totalCost += metrics.CostUSD

		var modelName *string
		if metrics.Model != "" {
			modelName = &metrics.Model
		}

		var errorMessage *string
		if spanItem.Status == "error" {
			var meta map[string]any
			if spanItem.Metadata != nil {
				_ = json.Unmarshal(spanItem.Metadata, &meta)
			}
			if value, ok := meta["error"]; ok {
				msg := fmt.Sprintf("%v", value)
				errorMessage = &msg
			}
		}

		if spanItem.ParentSpanID == nil || *spanItem.ParentSpanID == "" {
			detailInput = spanItem.Input
			detailOutput = spanItem.Output
		}

		spans = append(spans, model.Span{
			SpanID:        spanItem.SpanID,
			TraceID:       traceItem.TraceID,
			ParentSpanID:  spanItem.ParentSpanID,
			ProjectID:     projectID,
			Name:          spanItem.Name,
			SpanType:      spanItem.SpanType,
			Status:        spanItem.Status,
			StartTime:     st,
			EndTime:       et,
			DurationMs:    uint64(et.Sub(st).Milliseconds()),
			Model:         modelName,
			TokenInput:    metrics.TokenInput,
			TokenOutput:   metrics.TokenOutput,
			CostUSD:       metrics.CostUSD,
			ErrorMessage:  errorMessage,
			InputPreview:  truncateJSON(spanItem.Input, 500),
			OutputPreview: truncateJSON(spanItem.Output, 500),
			PayloadKey:    "local:" + traceItem.TraceID,
			Metadata:      string(spanItem.Metadata),
			Input:         spanItem.Input,
			Output:        spanItem.Output,
			Metrics:       spanItem.Metrics,
			MetadataJSON:  spanItem.Metadata,
			Events:        spanItem.Events,
			CreatedAt:     now,
		})
	}

	metadata := "{}"
	if traceItem.Metadata != nil {
		metadata = string(traceItem.Metadata)
	}

	return &localStoredTrace{
		ProjectID: projectID,
		Trace: model.Trace{
			TraceID:       traceItem.TraceID,
			ProjectID:     projectID,
			Name:          traceItem.Name,
			Status:        traceStatus,
			StartTime:     traceStart,
			EndTime:       traceEnd,
			DurationMs:    uint64(traceEnd.Sub(traceStart).Milliseconds()),
			TotalTokens:   totalTokenIn + totalTokenOut,
			TotalCostUSD:  totalCost,
			SpanCount:     uint16(len(traceItem.Spans)),
			Tags:          traceItem.Tags,
			Metadata:      metadata,
			InputPreview:  truncateJSON(detailInput, 500),
			OutputPreview: truncateJSON(detailOutput, 500),
			PayloadKey:    "local:" + traceItem.TraceID,
			CreatedAt:     now,
		},
		Spans:        spans,
		Input:        detailInput,
		Output:       detailOutput,
		MetadataJSON: traceItem.Metadata,
	}, nil
}

func cloneAction(action *model.TraceFeedbackAction) *model.TraceFeedbackAction {
	if action == nil {
		return nil
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
	return &cloned
}

func buildLocalSpanTree(spans []model.Span) []*model.SpanTree {
	nodes := make(map[string]*model.SpanTree, len(spans))
	for i := range spans {
		nodes[spans[i].SpanID] = &model.SpanTree{
			Span:     spans[i],
			Children: []*model.SpanTree{},
		}
	}

	var roots []*model.SpanTree
	for _, node := range nodes {
		if node.ParentSpanID == nil || *node.ParentSpanID == "" {
			roots = append(roots, node)
			continue
		}
		parent, ok := nodes[*node.ParentSpanID]
		if !ok {
			roots = append(roots, node)
			continue
		}
		parent.Children = append(parent.Children, node)
	}
	return roots
}

func truncateJSON(data json.RawMessage, maxLen int) string {
	if data == nil {
		return ""
	}
	value := string(data)
	if len(value) > maxLen {
		return value[:maxLen] + "..."
	}
	return value
}

func matchesTraceQuery(trace *localStoredTrace, q model.TraceListQuery) bool {
	if q.Status != "" && trace.Trace.Status != q.Status {
		return false
	}
	if q.Search != "" && !matchesTraceSearch(trace, q.Search) {
		return false
	}
	if q.StartTime != "" {
		start, err := time.Parse(time.RFC3339, q.StartTime)
		if err == nil && trace.Trace.StartTime.Before(start) {
			return false
		}
	}
	if q.EndTime != "" {
		end, err := time.Parse(time.RFC3339, q.EndTime)
		if err == nil && trace.Trace.StartTime.After(end) {
			return false
		}
	}
	if q.MinDurationMs != nil && int64(trace.Trace.DurationMs) < *q.MinDurationMs {
		return false
	}
	if q.MaxDurationMs != nil && int64(trace.Trace.DurationMs) > *q.MaxDurationMs {
		return false
	}
	if q.Tags != "" {
		requiredTags := strings.Split(q.Tags, ",")
		for _, required := range requiredTags {
			required = strings.TrimSpace(required)
			if required == "" {
				continue
			}
			found := false
			for _, tag := range trace.Trace.Tags {
				if tag == required {
					found = true
					break
				}
			}
			if !found {
				return false
			}
		}
	}
	return true
}

func matchesTraceSearch(trace *localStoredTrace, rawQuery string) bool {
	query := strings.TrimSpace(strings.ToLower(rawQuery))
	if query == "" {
		return true
	}

	searchableFields := []string{
		trace.Trace.TraceID,
		trace.Trace.Name,
		trace.Trace.InputPreview,
		trace.Trace.OutputPreview,
		trace.Trace.Metadata,
		strings.Join(trace.Trace.Tags, " "),
	}

	for _, field := range searchableFields {
		if strings.Contains(strings.ToLower(field), query) {
			return true
		}
	}
	return false
}

func periodToDuration(period string) time.Duration {
	switch period {
	case "1h":
		return time.Hour
	case "7d":
		return 7 * 24 * time.Hour
	case "30d":
		return 30 * 24 * time.Hour
	default:
		return 24 * time.Hour
	}
}

func percentile(values []float64, ratio float64) float64 {
	if len(values) == 0 {
		return 0
	}
	index := int(float64(len(values)-1) * ratio)
	if index < 0 {
		index = 0
	}
	if index >= len(values) {
		index = len(values) - 1
	}
	return values[index]
}
