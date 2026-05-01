package service

import (
	"encoding/json"
	"testing"

	"github.com/evalsmith/dataset-service/internal/model"
)

func TestBuildVersionDiffClassifiesAddedRemovedAndChanged(t *testing.T) {
	base := &model.DatasetVersionSnapshot{
		DatasetID: "ds_1",
		Version:   2,
		Examples: []model.DatasetSnapshotExample{
			{
				ID:              "ex_same",
				Inputs:          mustJSON(t, map[string]string{"query": "hello"}),
				ExpectedOutputs: mustJSON(t, map[string]string{"answer": "world"}),
				Metadata:        mustJSON(t, map[string]string{"topic": "general"}),
				Source:          "manual",
				Split:           "default",
				VersionAdded:    1,
			},
			{
				ID:              "ex_removed",
				Inputs:          mustJSON(t, map[string]string{"query": "remove me"}),
				ExpectedOutputs: mustJSON(t, map[string]string{"answer": "old"}),
				Metadata:        mustJSON(t, map[string]string{"topic": "old"}),
				Source:          "manual",
				Split:           "default",
				VersionAdded:    1,
			},
		},
	}

	target := &model.DatasetVersionSnapshot{
		DatasetID: "ds_1",
		Version:   3,
		Examples: []model.DatasetSnapshotExample{
			{
				ID:              "ex_same",
				Inputs:          mustJSON(t, map[string]string{"query": "hello updated"}),
				ExpectedOutputs: mustJSON(t, map[string]string{"answer": "world"}),
				Metadata:        mustJSON(t, map[string]string{"topic": "general"}),
				Source:          "manual",
				Split:           "default",
				VersionAdded:    1,
			},
			{
				ID:              "ex_added",
				Inputs:          mustJSON(t, map[string]string{"query": "new one"}),
				ExpectedOutputs: mustJSON(t, map[string]string{"answer": "fresh"}),
				Metadata:        mustJSON(t, map[string]string{"topic": "new"}),
				Source:          "import",
				Split:           "regression",
				VersionAdded:    3,
			},
		},
	}

	diff := buildVersionDiff("ds_1", base, target)

	if diff.AddedCount != 1 {
		t.Fatalf("expected 1 added example, got %d", diff.AddedCount)
	}
	if diff.RemovedCount != 1 {
		t.Fatalf("expected 1 removed example, got %d", diff.RemovedCount)
	}
	if diff.ChangedCount != 1 {
		t.Fatalf("expected 1 changed example, got %d", diff.ChangedCount)
	}
	if len(diff.Added) != 1 || diff.Added[0].ExampleID != "ex_added" {
		t.Fatalf("unexpected added examples: %+v", diff.Added)
	}
	if len(diff.Removed) != 1 || diff.Removed[0].ExampleID != "ex_removed" {
		t.Fatalf("unexpected removed examples: %+v", diff.Removed)
	}
	if len(diff.Changed) != 1 || diff.Changed[0].ExampleID != "ex_same" {
		t.Fatalf("unexpected changed examples: %+v", diff.Changed)
	}
}

func mustJSON(t *testing.T, value any) json.RawMessage {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal json: %v", err)
	}
	return data
}
