package handler

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"

	tracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	resourcepb "go.opentelemetry.io/proto/otlp/resource/v1"
	tracev1 "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	"github.com/evalsmith/trace-service/internal/model"
	"github.com/gin-gonic/gin"
)

func (h *TraceHandler) OTLPIngest() gin.HandlerFunc {
	return func(c *gin.Context) {
		body, err := io.ReadAll(c.Request.Body)
		if err != nil {
			c.JSON(400, model.ErrorResponse(1002, "read request failed: "+err.Error()))
			return
		}

		var req tracepb.ExportTraceServiceRequest
		contentType := strings.ToLower(c.GetHeader("Content-Type"))
		switch {
		case strings.Contains(contentType, "json"):
			if err := protojson.Unmarshal(body, &req); err != nil {
				c.JSON(400, model.ErrorResponse(1002, "invalid OTLP JSON payload: "+err.Error()))
				return
			}
		default:
			if err := proto.Unmarshal(body, &req); err != nil {
				c.JSON(400, model.ErrorResponse(1002, "invalid OTLP protobuf payload: "+err.Error()))
				return
			}
		}

		projectID := c.GetString("project_id")
		if projectID == "" {
			c.JSON(400, model.ErrorResponse(1001, "missing project_id"))
			return
		}
		batchReq, derivedProjectID, err := convertOTLPRequest(&req)
		if err != nil {
			c.JSON(400, model.ErrorResponse(1002, "invalid OTLP payload: "+err.Error()))
			return
		}
		if derivedProjectID != "" && derivedProjectID != projectID {
			c.JSON(403, model.ErrorResponse(1003, "project mismatch between header and OTLP payload"))
			return
		}

		resp, err := h.svc.BatchIngest(c.Request.Context(), projectID, *batchReq)
		if err != nil {
			c.JSON(500, model.ErrorResponse(5000, "OTLP ingest failed: "+err.Error()))
			return
		}
		c.JSON(200, model.SuccessResponse(resp))
	}
}

func convertOTLPRequest(req *tracepb.ExportTraceServiceRequest) (*model.BatchIngestRequest, string, error) {
	type traceAccumulator struct {
		projectID string
		name      string
		tags      []string
		metadata  map[string]any
		spans     []model.SpanIngestItem
	}

	accumulators := map[string]*traceAccumulator{}
	for _, resourceSpans := range req.ResourceSpans {
		resourceAttrs := attrsToMap(resourceSpans.Resource)
		resourceProjectID := firstString(resourceAttrs, "evalsmith.project_id", "project.id", "project_id")
		serviceName := firstString(resourceAttrs, "service.name", "evalsmith.trace_name")

		for _, scopeSpans := range resourceSpans.ScopeSpans {
			for _, span := range scopeSpans.Spans {
				traceID := hex.EncodeToString(span.TraceId)
				if traceID == "" {
					continue
				}
				acc, ok := accumulators[traceID]
				if !ok {
					acc = &traceAccumulator{
						projectID: resourceProjectID,
						name:      serviceName,
						metadata:  cloneMap(resourceAttrs),
						spans:     make([]model.SpanIngestItem, 0),
					}
					accumulators[traceID] = acc
				}

				spanAttrs := attrsToMap(span.Attributes)
				if acc.projectID == "" {
					acc.projectID = firstString(spanAttrs, "evalsmith.project_id", "project.id", "project_id")
				}
				spanType := normalizeSpanType(firstString(spanAttrs, "evalsmith.span_type", "span_type", "gen_ai.operation.name"))
				item := model.SpanIngestItem{
					SpanID:       hex.EncodeToString(span.SpanId),
					ParentSpanID: bytesToHexPtr(span.ParentSpanId),
					Name:         span.Name,
					SpanType:     spanType,
					Status:       normalizeSpanStatus(span.Status),
					StartTime:    nanosToRFC3339(span.StartTimeUnixNano),
					EndTime:      nanosToRFC3339(span.EndTimeUnixNano),
					Input:        toJSONRaw(firstValue(spanAttrs, "evalsmith.input", "input", "gen_ai.prompt")),
					Output:       toJSONRaw(firstValue(spanAttrs, "evalsmith.output", "output", "gen_ai.completion")),
					Metrics:      toJSONRaw(extractMetrics(spanAttrs)),
					Metadata:     toJSONRaw(mergeMaps(resourceAttrs, spanAttrs, map[string]any{"otel_scope": scopeSpans.Scope.GetName()})),
					Events:       convertEvents(span.Events),
				}
				acc.spans = append(acc.spans, item)
				if acc.name == "" || len(span.ParentSpanId) == 0 {
					acc.name = span.Name
				}
			}
		}
	}

	if len(accumulators) == 0 {
		return nil, "", fmt.Errorf("no spans found")
	}

	traces := make([]model.TraceIngestItem, 0, len(accumulators))
	derivedProjectID := ""
	for traceID, acc := range accumulators {
		if acc.projectID != "" && derivedProjectID == "" {
			derivedProjectID = acc.projectID
		}
		name := acc.name
		if name == "" {
			name = traceID
		}
		traces = append(traces, model.TraceIngestItem{
			TraceID:  traceID,
			Name:     name,
			Tags:     acc.tags,
			Metadata: toJSONRaw(acc.metadata),
			Spans:    acc.spans,
		})
	}
	return &model.BatchIngestRequest{Traces: traces}, derivedProjectID, nil
}

func attrsToMap(input any) map[string]any {
	var attrs []*commonpb.KeyValue
	switch value := input.(type) {
	case *resourcepb.Resource:
		if value == nil {
			return map[string]any{}
		}
		attrs = value.Attributes
	case []*commonpb.KeyValue:
		attrs = value
	default:
		return map[string]any{}
	}
	out := make(map[string]any, len(attrs))
	for _, attr := range attrs {
		out[attr.Key] = anyValue(attr.Value)
	}
	return out
}

func anyValue(value *commonpb.AnyValue) any {
	if value == nil {
		return nil
	}
	switch v := value.Value.(type) {
	case *commonpb.AnyValue_StringValue:
		return v.StringValue
	case *commonpb.AnyValue_BoolValue:
		return v.BoolValue
	case *commonpb.AnyValue_IntValue:
		return v.IntValue
	case *commonpb.AnyValue_DoubleValue:
		return v.DoubleValue
	case *commonpb.AnyValue_BytesValue:
		return string(v.BytesValue)
	case *commonpb.AnyValue_ArrayValue:
		items := make([]any, 0, len(v.ArrayValue.Values))
		for _, item := range v.ArrayValue.Values {
			items = append(items, anyValue(item))
		}
		return items
	case *commonpb.AnyValue_KvlistValue:
		out := make(map[string]any, len(v.KvlistValue.Values))
		for _, kv := range v.KvlistValue.Values {
			out[kv.Key] = anyValue(kv.Value)
		}
		return out
	default:
		return nil
	}
}

func convertEvents(events []*tracev1.Span_Event) []model.JSON {
	if len(events) == 0 {
		return nil
	}
	out := make([]model.JSON, 0, len(events))
	for _, event := range events {
		payload := map[string]any{
			"name":       event.Name,
			"time_unix":  event.TimeUnixNano,
			"attributes": attrsToMap(event.Attributes),
		}
		out = append(out, toJSONRaw(payload))
	}
	return out
}

func bytesToHexPtr(value []byte) *string {
	if len(value) == 0 {
		return nil
	}
	hexValue := hex.EncodeToString(value)
	return &hexValue
}

func firstString(values map[string]any, keys ...string) string {
	for _, key := range keys {
		if raw, ok := values[key]; ok {
			if str, ok := raw.(string); ok && strings.TrimSpace(str) != "" {
				return str
			}
		}
	}
	return ""
}

func firstValue(values map[string]any, keys ...string) any {
	for _, key := range keys {
		if raw, ok := values[key]; ok {
			return raw
		}
	}
	return nil
}

func normalizeSpanType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "llm", "tool", "retrieval", "chain", "agent", "custom":
		return strings.ToLower(value)
	case "chat", "completion":
		return "llm"
	default:
		return "custom"
	}
}

func normalizeSpanStatus(status *tracev1.Status) string {
	if status != nil && status.Code == tracev1.Status_STATUS_CODE_ERROR {
		return "error"
	}
	return "ok"
}

func nanosToRFC3339(value uint64) string {
	if value == 0 {
		return time.Now().UTC().Format(time.RFC3339Nano)
	}
	seconds := int64(value / 1_000_000_000)
	nanos := int64(value % 1_000_000_000)
	return time.Unix(seconds, nanos).UTC().Format(time.RFC3339Nano)
}

func extractMetrics(attrs map[string]any) map[string]any {
	modelName := firstString(attrs, "gen_ai.request.model", "llm.model", "evalsmith.model")
	tokenInput := firstValue(attrs, "gen_ai.usage.input_tokens", "llm.token_count.prompt", "evalsmith.token_input")
	tokenOutput := firstValue(attrs, "gen_ai.usage.output_tokens", "llm.token_count.completion", "evalsmith.token_output")
	costUSD := firstValue(attrs, "gen_ai.usage.cost", "evalsmith.cost_usd")
	return map[string]any{
		"model":        modelName,
		"token_input":  tokenInput,
		"token_output": tokenOutput,
		"cost_usd":     costUSD,
	}
}

func toJSONRaw(value any) model.JSON {
	if value == nil {
		return nil
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	return model.JSON(raw)
}

func mergeMaps(values ...map[string]any) map[string]any {
	out := make(map[string]any)
	for _, item := range values {
		for key, value := range item {
			out[key] = value
		}
	}
	return out
}

func cloneMap(input map[string]any) map[string]any {
	return mergeMaps(input)
}
