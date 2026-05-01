package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/evalsmith/trace-service/internal/model"
	"github.com/evalsmith/trace-service/internal/repository"
)

func TestBackfillToDatasetFailureCreatesFailedAction(t *testing.T) {
	store, err := repository.NewLocalTraceStore(t.TempDir() + "/trace-store.json")
	if err != nil {
		t.Fatalf("create local store: %v", err)
	}

	datasetServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"code":5000,"message":"dataset unavailable"}`, http.StatusBadGateway)
	}))
	defer datasetServer.Close()

	svc := NewTraceService(nil, nil, nil, store, "", datasetServer.URL, "")
	traceID := seedTraceForActionTests(t, svc)

	resp, err := svc.BackfillToDataset(
		context.Background(),
		"proj_actions",
		"user_1",
		model.TraceBackfillDatasetRequest{
			DatasetID: "ds_target",
			TraceIDs:  []string{traceID},
			Split:     "regression",
		},
	)
	if err != nil {
		t.Fatalf("backfill dataset: %v", err)
	}
	if len(resp.Actions) != 1 {
		t.Fatalf("expected one action, got %d", len(resp.Actions))
	}
	if resp.Actions[0].Status != "failed" {
		t.Fatalf("expected failed action, got %s", resp.Actions[0].Status)
	}

	actions, err := svc.ListTraceActions(context.Background(), "proj_actions", traceID)
	if err != nil {
		t.Fatalf("list actions: %v", err)
	}
	if len(actions) != 1 || actions[0].Status != "failed" {
		t.Fatalf("expected persisted failed action, got %+v", actions)
	}
}

func TestRetryFailedDatasetActionSucceeds(t *testing.T) {
	store, err := repository.NewLocalTraceStore(t.TempDir() + "/trace-store.json")
	if err != nil {
		t.Fatalf("create local store: %v", err)
	}

	var callCount atomic.Int32
	datasetServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count := callCount.Add(1)
		if count == 1 {
			http.Error(w, `{"code":5000,"message":"dataset unavailable"}`, http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"message":"success","data":{"added":1,"new_version":3,"example_ids":["ex_retry_ok"]}}`))
	}))
	defer datasetServer.Close()

	svc := NewTraceService(nil, nil, nil, store, "", datasetServer.URL, "")
	traceID := seedTraceForActionTests(t, svc)

	initial, err := svc.BackfillToDataset(
		context.Background(),
		"proj_actions",
		"user_1",
		model.TraceBackfillDatasetRequest{
			DatasetID: "ds_target",
			TraceIDs:  []string{traceID},
			Split:     "regression",
		},
	)
	if err != nil {
		t.Fatalf("initial backfill dataset: %v", err)
	}
	if len(initial.Actions) != 1 || initial.Actions[0].Status != "failed" {
		t.Fatalf("expected initial failed action, got %+v", initial.Actions)
	}

	retried, err := svc.RetryAction(context.Background(), "proj_actions", initial.Actions[0].ID)
	if err != nil {
		t.Fatalf("retry action: %v", err)
	}
	if retried.Status != "succeeded" {
		t.Fatalf("expected succeeded retry, got %s", retried.Status)
	}
	if retried.TargetID != "ds_target" {
		t.Fatalf("expected dataset target id, got %s", retried.TargetID)
	}
	if retried.TargetVersion == nil || *retried.TargetVersion != 3 {
		t.Fatalf("expected target version 3, got %+v", retried.TargetVersion)
	}
}

func seedTraceForActionTests(t *testing.T, svc *TraceService) string {
	t.Helper()

	start := time.Date(2026, time.April, 9, 10, 0, 0, 0, time.UTC)
	end := start.Add(1500 * time.Millisecond)
	traceID := "tr_action_seed"

	_, err := svc.BatchIngest(
		context.Background(),
		"proj_actions",
		model.BatchIngestRequest{
			Traces: []model.TraceIngestItem{
				{
					TraceID: traceID,
					Name:    "action-seed",
					Tags:    []string{"seed"},
					Spans: []model.SpanIngestItem{
						{
							SpanID:    "sp_root",
							Name:      "root",
							SpanType:  "chain",
							Status:    "ok",
							StartTime: start.Format(time.RFC3339Nano),
							EndTime:   end.Format(time.RFC3339Nano),
							Input:     model.JSON(`{"question":"how do I retry?"}`),
							Output:    model.JSON(`{"answer":"retry the failed action"}`),
							Metrics:   model.JSON(`{"token_input":8,"token_output":12}`),
						},
					},
				},
			},
		},
	)
	if err != nil {
		t.Fatalf("seed trace: %v", err)
	}
	return traceID
}
