package service

import (
	"testing"
	"time"

	"github.com/evalsmith/dataset-service/internal/model"
)

func TestPaginateSnapshotExamplesSupportsVersionedPaginationAndSplitFilter(t *testing.T) {
	snapshot := &model.DatasetVersionSnapshot{
		DatasetID: "ds_1",
		Version:   3,
		CreatedAt: time.Date(2026, 4, 6, 0, 0, 0, 0, time.UTC),
		Examples: []model.DatasetSnapshotExample{
			{ID: "ex_1", Split: "default", Source: "manual"},
			{ID: "ex_2", Split: "default", Source: "manual"},
			{ID: "ex_3", Split: "regression", Source: "import"},
		},
	}

	items := paginateSnapshotExamples("ds_1", snapshot, "default", "", 1, 1)
	if len(items) != 1 {
		t.Fatalf("expected 1 paginated item, got %d", len(items))
	}
	if items[0].ID != "ex_1" {
		t.Fatalf("expected ex_1, got %s", items[0].ID)
	}
	if items[0].DatasetID != "ds_1" {
		t.Fatalf("expected dataset id ds_1, got %s", items[0].DatasetID)
	}

	total := countSnapshotExamples(snapshot, "default", "")
	if total != 2 {
		t.Fatalf("expected 2 split-filtered examples, got %d", total)
	}
}
