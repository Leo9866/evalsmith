package service

import (
	"strings"
	"testing"

	"github.com/evalsmith/dataset-service/internal/model"
)

func TestParseJSONCollectsInvalidExamplesWithoutFailingWholeImport(t *testing.T) {
	payload := `[
		{"inputs": {"query": "valid-1"}},
		{"split": "default"},
		{"inputs": {"query": "valid-2"}}
	]`

	result, err := parseJSON(strings.NewReader(payload))
	if err != nil {
		t.Fatalf("parseJSON returned error: %v", err)
	}

	if result.TotalRows != 3 {
		t.Fatalf("expected 3 total rows, got %d", result.TotalRows)
	}
	if len(result.Examples) != 2 {
		t.Fatalf("expected 2 valid examples, got %d", len(result.Examples))
	}
	if len(result.InvalidExamples) != 1 {
		t.Fatalf("expected 1 invalid example, got %d", len(result.InvalidExamples))
	}
	if result.InvalidExamples[0].Row != 2 {
		t.Fatalf("expected invalid row 2, got %d", result.InvalidExamples[0].Row)
	}
}

func TestFilterImportExamplesUsesNormalizedInputsForDatasetAndFileDeduplication(t *testing.T) {
	parsed := []parsedImportExample{
		{
			Example: model.ExampleInput{Inputs: mustJSON(t, map[string]int{"x": 1, "y": 2})},
			Row:     1,
		},
		{
			Example: model.ExampleInput{Inputs: mustJSON(t, map[string]int{"a": 1, "b": 2})},
			Row:     2,
		},
		{
			Example: model.ExampleInput{Inputs: mustJSON(t, map[string]int{"y": 2, "x": 1})},
			Row:     3,
		},
		{
			Example:    model.ExampleInput{Inputs: []byte(`not-json`)},
			Row:        4,
			RawPreview: `not-json`,
		},
	}

	active := []*model.Example{
		{
			ID:     "ex_existing",
			Inputs: mustJSON(t, map[string]int{"b": 2, "a": 1}),
		},
	}

	examplesToAdd, duplicates, invalids := filterImportExamples(parsed, active)

	if len(examplesToAdd) != 1 {
		t.Fatalf("expected 1 example to add, got %d", len(examplesToAdd))
	}
	if examplesToAdd[0].Source != "import" {
		t.Fatalf("expected import source, got %q", examplesToAdd[0].Source)
	}

	if len(duplicates) != 2 {
		t.Fatalf("expected 2 duplicates, got %d", len(duplicates))
	}
	if duplicates[0].Scope != "dataset" || duplicates[0].ExistingExampleID != "ex_existing" {
		t.Fatalf("expected dataset duplicate against ex_existing, got %+v", duplicates[0])
	}
	if duplicates[1].Scope != "file" || duplicates[1].DuplicateOfRow == nil || *duplicates[1].DuplicateOfRow != 1 {
		t.Fatalf("expected file duplicate against row 1, got %+v", duplicates[1])
	}

	if len(invalids) != 1 {
		t.Fatalf("expected 1 invalid item, got %d", len(invalids))
	}
	if invalids[0].Row != 4 {
		t.Fatalf("expected invalid row 4, got %d", invalids[0].Row)
	}
}

func TestBuildImportVersionDescriptionIncludesSkippedSummary(t *testing.T) {
	description := buildImportVersionDescription(5, 2, 1)
	expected := "Imported 5 examples; skipped 2 duplicates, 1 invalid"
	if description != expected {
		t.Fatalf("expected %q, got %q", expected, description)
	}
}
