package evalsmith

import (
	"context"
	"fmt"
	"time"
)

type BatchIngestRequest struct {
	Traces []TracePayload `json:"traces"`
}

type TracePayload struct {
	TraceID  string         `json:"trace_id,omitempty"`
	Name     string         `json:"name"`
	Tags     []string       `json:"tags,omitempty"`
	Metadata map[string]any `json:"metadata,omitempty"`
	Spans    []SpanPayload  `json:"spans"`
}

type SpanPayload struct {
	SpanID       string           `json:"span_id,omitempty"`
	ParentSpanID *string          `json:"parent_span_id,omitempty"`
	Name         string           `json:"name"`
	SpanType     string           `json:"span_type"`
	Status       string           `json:"status"`
	StartTime    string           `json:"start_time"`
	EndTime      string           `json:"end_time"`
	Input        any              `json:"input,omitempty"`
	Output       any              `json:"output,omitempty"`
	Metrics      map[string]any   `json:"metrics,omitempty"`
	Metadata     map[string]any   `json:"metadata,omitempty"`
	Events       []map[string]any `json:"events,omitempty"`
}

func NewTrace(name string, tags []string, metadata map[string]any) *Trace {
	return &Trace{
		TraceID:  "tr_" + time.Now().UTC().Format("20060102150405.000000"),
		Name:     name,
		Tags:     tags,
		Metadata: metadata,
		Spans:    []SpanPayload{},
	}
}

// Trace represents a full execution trace with nested spans.
type Trace struct {
	TraceID  string
	Name     string
	Tags     []string
	Metadata map[string]any
	Spans    []SpanPayload
}

// AddSpan appends a flat span (no parent tracking).
func (t *Trace) AddSpan(name string, spanType string, input any, output any, metadata map[string]any) {
	started := time.Now().UTC()
	ended := time.Now().UTC()
	t.Spans = append(t.Spans, SpanPayload{
		SpanID:    "sp_" + started.Format("150405.000000"),
		Name:      name,
		SpanType:  spanType,
		Status:    "ok",
		StartTime: started.Format(time.RFC3339Nano),
		EndTime:   ended.Format(time.RFC3339Nano),
		Input:     input,
		Output:    output,
		Metadata:  metadata,
		Metrics:   map[string]any{},
	})
}

// StartSpan creates a nested span with proper parent-child linkage.
func (t *Trace) StartSpan(name string, spanType string, parentSpanID string) *Span {
	spanID := fmt.Sprintf("sp_%d", time.Now().UnixNano())
	var parent *string
	if parentSpanID != "" {
		parent = &parentSpanID
	}
	return &Span{
		trace:    t,
		SpanID:   spanID,
		ParentID: parent,
		Name:     name,
		SpanType: spanType,
		Status:   "ok",
		Started:  time.Now().UTC(),
		Metrics:  map[string]any{},
		Metadata: map[string]any{},
	}
}

// Span is an in-progress span builder. Call End() to finalize and add to Trace.
type Span struct {
	trace    *Trace
	SpanID   string
	ParentID *string
	Name     string
	SpanType string
	Status   string
	Started  time.Time
	Input    any
	Output   any
	Metrics  map[string]any
	Metadata map[string]any
	Error    string
}

func (s *Span) SetInput(input any)            { s.Input = input }
func (s *Span) SetOutput(output any)          { s.Output = output }
func (s *Span) SetMetric(key string, val any) { s.Metrics[key] = val }
func (s *Span) SetError(msg string)           { s.Status = "error"; s.Error = msg }

// End finalizes the span and appends it to the parent trace.
func (s *Span) End() {
	ended := time.Now().UTC()
	s.trace.Spans = append(s.trace.Spans, SpanPayload{
		SpanID:       s.SpanID,
		ParentSpanID: s.ParentID,
		Name:         s.Name,
		SpanType:     s.SpanType,
		Status:       s.Status,
		StartTime:    s.Started.Format(time.RFC3339Nano),
		EndTime:      ended.Format(time.RFC3339Nano),
		Input:        s.Input,
		Output:       s.Output,
		Metrics:      s.Metrics,
		Metadata:     s.Metadata,
	})
}

// StartChild creates a child span of this span.
func (s *Span) StartChild(name string, spanType string) *Span {
	return s.trace.StartSpan(name, spanType, s.SpanID)
}

func (t *Trace) Payload() TracePayload {
	return TracePayload{
		TraceID:  t.TraceID,
		Name:     t.Name,
		Tags:     t.Tags,
		Metadata: t.Metadata,
		Spans:    t.Spans,
	}
}

func (c *Client) IngestTrace(ctx context.Context, trace *Trace) error {
	return c.IngestTraces(ctx, []TracePayload{trace.Payload()})
}

func (c *Client) IngestTraces(ctx context.Context, traces []TracePayload) error {
	return c.PostJSON(ctx, c.traceURL, "/api/v1/traces", BatchIngestRequest{Traces: traces}, nil)
}
