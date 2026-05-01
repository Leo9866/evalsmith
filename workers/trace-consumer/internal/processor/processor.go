package processor

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/evalsmith/trace-consumer/internal/repository"
)

// KafkaTraceMessage is the envelope produced by the trace-service.
type KafkaTraceMessage struct {
	ProjectID  string    `json:"project_id"`
	Trace      TraceData `json:"trace"`
	IngestedAt string    `json:"ingested_at"`
}

type TraceData struct {
	TraceID  string     `json:"trace_id"`
	Name     string     `json:"name"`
	Tags     []string   `json:"tags"`
	Metadata JSON       `json:"metadata"`
	Spans    []SpanData `json:"spans"`
}

type SpanData struct {
	SpanID       string  `json:"span_id"`
	ParentSpanID *string `json:"parent_span_id"`
	Name         string  `json:"name"`
	SpanType     string  `json:"span_type"`
	Status       string  `json:"status"`
	StartTime    string  `json:"start_time"`
	EndTime      string  `json:"end_time"`
	Input        JSON    `json:"input"`
	Output       JSON    `json:"output"`
	Metrics      JSON    `json:"metrics"`
	Metadata     JSON    `json:"metadata"`
	Events       []JSON  `json:"events"`
}

type JSON = json.RawMessage

type Processor struct {
	chRepo    *repository.ClickHouseRepo
	minioRepo *repository.MinIORepo
}

func New(chRepo *repository.ClickHouseRepo, minioRepo *repository.MinIORepo) *Processor {
	return &Processor{chRepo: chRepo, minioRepo: minioRepo}
}

// Process handles a single Kafka message: parses the trace, computes aggregates,
// writes indexed data to ClickHouse, and stores the full payload in MinIO.
func (p *Processor) Process(ctx context.Context, msgValue []byte) error {
	var msg KafkaTraceMessage
	if err := json.Unmarshal(msgValue, &msg); err != nil {
		return fmt.Errorf("unmarshal kafka message: %w", err)
	}

	traceData := msg.Trace
	projectID := msg.ProjectID
	now := time.Now().UTC()

	// Store full payload in MinIO.
	payloadKey := fmt.Sprintf("%s/%s/%s.json",
		projectID,
		now.Format("2006/01/02"),
		traceData.TraceID,
	)
	if err := p.minioRepo.PutPayload(ctx, payloadKey, msgValue); err != nil {
		return fmt.Errorf("store payload: %w", err)
	}

	// Compute aggregates from spans.
	var (
		traceStart    time.Time
		traceEnd      time.Time
		totalTokenIn  uint32
		totalTokenOut uint32
		totalCost     float64
		traceStatus   = "ok"
	)

	chSpans := make([]repository.Span, 0, len(traceData.Spans))

	for i, sd := range traceData.Spans {
		st, _ := time.Parse(time.RFC3339Nano, sd.StartTime)
		et, _ := time.Parse(time.RFC3339Nano, sd.EndTime)

		if i == 0 || st.Before(traceStart) {
			traceStart = st
		}
		if i == 0 || et.After(traceEnd) {
			traceEnd = et
		}

		if sd.Status == "error" {
			traceStatus = "error"
		}

		// Extract metrics.
		var metrics struct {
			Model       string  `json:"model"`
			TokenInput  uint32  `json:"token_input"`
			TokenOutput uint32  `json:"token_output"`
			CostUSD     float64 `json:"cost_usd"`
		}
		if sd.Metrics != nil {
			_ = json.Unmarshal(sd.Metrics, &metrics)
		}

		totalTokenIn += metrics.TokenInput
		totalTokenOut += metrics.TokenOutput
		totalCost += metrics.CostUSD

		durationMs := uint64(et.Sub(st).Milliseconds())

		var model *string
		if metrics.Model != "" {
			m := metrics.Model
			model = &m
		}

		var errMsg *string
		if sd.Status == "error" {
			// Try to extract error from metadata.
			var meta map[string]interface{}
			if sd.Metadata != nil {
				_ = json.Unmarshal(sd.Metadata, &meta)
			}
			if e, ok := meta["error"]; ok {
				s := fmt.Sprintf("%v", e)
				errMsg = &s
			}
		}

		chSpans = append(chSpans, repository.Span{
			SpanID:        sd.SpanID,
			TraceID:       traceData.TraceID,
			ParentSpanID:  sd.ParentSpanID,
			ProjectID:     projectID,
			Name:          sd.Name,
			SpanType:      sd.SpanType,
			Status:        sd.Status,
			StartTime:     st,
			EndTime:       et,
			DurationMs:    durationMs,
			Model:         model,
			TokenInput:    metrics.TokenInput,
			TokenOutput:   metrics.TokenOutput,
			CostUSD:       metrics.CostUSD,
			ErrorMessage:  errMsg,
			InputPreview:  truncateJSON(sd.Input, 500),
			OutputPreview: truncateJSON(sd.Output, 500),
			PayloadKey:    payloadKey,
			Metadata:      string(sd.Metadata),
			CreatedAt:     now,
		})
	}

	traceDurationMs := uint64(traceEnd.Sub(traceStart).Milliseconds())

	metadataStr := "{}"
	if traceData.Metadata != nil {
		metadataStr = string(traceData.Metadata)
	}

	// Determine input/output previews from the first root span.
	inputPreview := ""
	outputPreview := ""
	for _, sd := range traceData.Spans {
		if sd.ParentSpanID == nil || *sd.ParentSpanID == "" {
			inputPreview = truncateJSON(sd.Input, 500)
			outputPreview = truncateJSON(sd.Output, 500)
			break
		}
	}

	chTrace := repository.Trace{
		TraceID:       traceData.TraceID,
		ProjectID:     projectID,
		Name:          traceData.Name,
		Status:        traceStatus,
		StartTime:     traceStart,
		EndTime:       traceEnd,
		DurationMs:    traceDurationMs,
		TotalTokens:   totalTokenIn + totalTokenOut,
		TotalCostUSD:  totalCost,
		SpanCount:     uint16(len(traceData.Spans)),
		Tags:          traceData.Tags,
		Metadata:      metadataStr,
		InputPreview:  inputPreview,
		OutputPreview: outputPreview,
		PayloadKey:    payloadKey,
		CreatedAt:     now,
	}

	// Write to ClickHouse.
	if err := p.chRepo.InsertTrace(ctx, chTrace); err != nil {
		return fmt.Errorf("insert trace: %w", err)
	}

	if len(chSpans) > 0 {
		if err := p.chRepo.InsertSpans(ctx, chSpans); err != nil {
			return fmt.Errorf("insert spans: %w", err)
		}
	}

	log.Printf("processed trace %s (%d spans, %dms, %d tokens)",
		traceData.TraceID, len(traceData.Spans), traceDurationMs, totalTokenIn+totalTokenOut)

	return nil
}

// truncateJSON returns a string representation of raw JSON, truncated to maxLen.
func truncateJSON(data json.RawMessage, maxLen int) string {
	if data == nil {
		return ""
	}
	s := string(data)
	if len(s) > maxLen {
		return s[:maxLen] + "..."
	}
	return s
}
