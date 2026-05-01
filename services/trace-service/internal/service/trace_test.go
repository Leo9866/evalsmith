package service

import (
	"math"
	"testing"

	"github.com/evalsmith/trace-service/internal/model"
)

func TestNormalizeTraceStatsHandlesNil(t *testing.T) {
	stats := normalizeTraceStats(nil)
	if stats == nil {
		t.Fatal("expected zero-value stats, got nil")
	}
	if stats.TraceCount != 0 || stats.P95Duration != 0 {
		t.Fatalf("expected zero-value stats, got %+v", stats)
	}
}

func TestNormalizeTraceStatsReplacesInvalidFloats(t *testing.T) {
	stats := normalizeTraceStats(&model.TraceStats{
		AvgDuration:  math.NaN(),
		P50Duration:  math.Inf(1),
		P95Duration:  math.Inf(-1),
		P99Duration:  42,
		TotalCostUSD: math.NaN(),
	})

	if stats.AvgDuration != 0 || stats.P50Duration != 0 || stats.P95Duration != 0 || stats.TotalCostUSD != 0 {
		t.Fatalf("expected invalid floats to be zeroed, got %+v", stats)
	}
	if stats.P99Duration != 42 {
		t.Fatalf("expected finite values to be preserved, got %+v", stats)
	}
}

func TestNormalizeTraceListInitializesEmptySlice(t *testing.T) {
	result := normalizeTraceList(nil, model.TraceListQuery{Page: 1, PageSize: 12})
	if result == nil {
		t.Fatal("expected trace list result, got nil")
	}
	if result.Traces == nil {
		t.Fatal("expected empty trace slice, got nil")
	}
	if len(result.Traces) != 0 {
		t.Fatalf("expected empty trace slice, got %d entries", len(result.Traces))
	}
	if result.Page != 1 || result.PageSize != 12 {
		t.Fatalf("expected pagination values to be preserved, got %+v", result)
	}
}
