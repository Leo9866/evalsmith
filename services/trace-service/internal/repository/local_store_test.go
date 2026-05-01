package repository

import (
	"testing"
	"time"

	"github.com/evalsmith/trace-service/internal/model"
)

func TestLocalTraceStoreSearchMatchesOperationalFields(t *testing.T) {
	store, err := NewLocalTraceStore(t.TempDir() + "/trace-store.json")
	if err != nil {
		t.Fatalf("create local trace store: %v", err)
	}

	start := time.Date(2026, time.April, 8, 5, 18, 27, 0, time.UTC)
	end := start.Add(2 * time.Second)
	req := model.BatchIngestRequest{
		Traces: []model.TraceIngestItem{
			{
				TraceID: "tr_searchable_123",
				Name:    "verification_agent_request",
				Tags:    []string{"verification", "latency"},
				Metadata: model.JSON(`{
					"source": "verification-agent",
					"expected_output": "inspect recent traces first"
				}`),
				Spans: []model.SpanIngestItem{
					{
						SpanID:    "sp_root",
						Name:      "root",
						SpanType:  "chain",
						Status:    "ok",
						StartTime: start.Format(time.RFC3339Nano),
						EndTime:   end.Format(time.RFC3339Nano),
						Input:     model.JSON(`{"input":"The agent feels slow in production. What should I check first?"}`),
						Output:    model.JSON(`{"answer":"Inspect recent traces first and then reduce prompt size."}`),
						Metrics:   model.JSON(`{"token_input":8,"token_output":12}`),
					},
				},
			},
		},
	}

	if _, err := store.BatchIngest("proj_search", req); err != nil {
		t.Fatalf("batch ingest: %v", err)
	}

	tests := []struct {
		name  string
		query string
	}{
		{name: "trace id", query: "tr_searchable_123"},
		{name: "name", query: "verification_agent_request"},
		{name: "input preview", query: "slow in production"},
		{name: "output preview", query: "reduce prompt size"},
		{name: "metadata", query: "verification-agent"},
		{name: "tag", query: "latency"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result, err := store.ListTraces("proj_search", model.TraceListQuery{
				Page:     1,
				PageSize: 20,
				Search:   tc.query,
			})
			if err != nil {
				t.Fatalf("list traces with query %q: %v", tc.query, err)
			}
			if len(result.Traces) != 1 {
				t.Fatalf("expected one trace for query %q, got %d", tc.query, len(result.Traces))
			}
			if result.Traces[0].TraceID != "tr_searchable_123" {
				t.Fatalf("expected trace tr_searchable_123, got %s", result.Traces[0].TraceID)
			}
		})
	}
}
