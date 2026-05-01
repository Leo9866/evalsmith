package service

import (
	"bufio"
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"path/filepath"
	"strings"

	"github.com/evalsmith/dataset-service/internal/model"
)

const maxImportIssueSamples = 8

type parsedImportExample struct {
	Example    model.ExampleInput
	Row        int
	RawPreview string
}

type importParseResult struct {
	TotalRows       int
	Examples        []parsedImportExample
	InvalidExamples []model.DatasetImportInvalidExample
}

// ImportFile parses an uploaded file, deduplicates rows against active examples,
// and returns a structured import summary.
func (s *DatasetService) ImportFile(datasetID, projectID string, fh *multipart.FileHeader, description string) (*model.DatasetImportResponse, error) {
	dataset, err := s.datasetRepo.GetByID(datasetID, projectID)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	f, err := fh.Open()
	if err != nil {
		return nil, fmt.Errorf("open uploaded file: %w", err)
	}
	defer f.Close()

	ext := strings.ToLower(filepath.Ext(fh.Filename))
	parseResult, err := parseImportFile(ext, f)
	if err != nil {
		return nil, fmt.Errorf("parse %s: %w", ext, err)
	}
	if parseResult.TotalRows == 0 {
		return nil, fmt.Errorf("file contains no examples")
	}

	activeExamples, err := s.exampleRepo.ListActiveAll(dataset.ID)
	if err != nil {
		return nil, fmt.Errorf("list active examples: %w", err)
	}

	examplesToAdd, duplicates, normalizationInvalids := filterImportExamples(parseResult.Examples, activeExamples)
	invalidExamples := append(parseResult.InvalidExamples, normalizationInvalids...)

	response := &model.DatasetImportResponse{
		TotalRows:       parseResult.TotalRows,
		Added:           0,
		DuplicateCount:  len(duplicates),
		InvalidCount:    len(invalidExamples),
		Duplicates:      sampleImportDuplicates(duplicates),
		InvalidExamples: sampleImportInvalidExamples(invalidExamples),
	}

	if len(examplesToAdd) == 0 {
		return response, nil
	}

	versionDescription := strings.TrimSpace(description)
	if versionDescription == "" {
		versionDescription = buildImportVersionDescription(len(examplesToAdd), len(duplicates), len(invalidExamples))
	}

	batchResp, err := s.BatchAddExamples(datasetID, projectID, &model.BatchAddExamplesRequest{
		Examples:    examplesToAdd,
		Description: versionDescription,
	})
	if err != nil {
		return nil, err
	}

	response.Added = batchResp.Added
	response.NewVersion = &batchResp.NewVersion
	response.ExampleIDs = batchResp.ExampleIDs
	response.VersionDescription = versionDescription
	return response, nil
}

func parseImportFile(ext string, r io.Reader) (*importParseResult, error) {
	switch ext {
	case ".csv":
		return parseCSV(r)
	case ".json":
		return parseJSON(r)
	case ".jsonl":
		return parseJSONL(r)
	default:
		return nil, fmt.Errorf("unsupported file format: %s (expected .csv, .json, or .jsonl)", ext)
	}
}

// parseCSV reads a CSV file. First row is headers. Columns named "inputs.*" map into inputs,
// "expected_outputs.*" into expected_outputs, "metadata.*" into metadata, "split" sets split.
// If none of those prefixed columns exist, all columns become inputs fields.
func parseCSV(r io.Reader) (*importParseResult, error) {
	reader := csv.NewReader(r)
	headers, err := reader.Read()
	if err != nil {
		return nil, fmt.Errorf("read csv headers: %w", err)
	}

	result := &importParseResult{
		Examples:        make([]parsedImportExample, 0),
		InvalidExamples: make([]model.DatasetImportInvalidExample, 0),
	}

	lineNum := 1
	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		lineNum++
		if err != nil {
			return nil, fmt.Errorf("read csv row %d: %w", lineNum, err)
		}

		inputs := make(map[string]interface{})
		expectedOutputs := make(map[string]interface{})
		metadata := make(map[string]interface{})
		split := ""

		for i, header := range headers {
			if i >= len(record) {
				break
			}
			val := record[i]
			switch {
			case header == "split":
				split = val
			case strings.HasPrefix(header, "inputs."):
				key := strings.TrimPrefix(header, "inputs.")
				inputs[key] = val
			case strings.HasPrefix(header, "expected_outputs."):
				key := strings.TrimPrefix(header, "expected_outputs.")
				expectedOutputs[key] = val
			case strings.HasPrefix(header, "metadata."):
				key := strings.TrimPrefix(header, "metadata.")
				metadata[key] = val
			default:
				inputs[header] = val
			}
		}

		if len(inputs) == 0 {
			result.InvalidExamples = append(result.InvalidExamples, model.DatasetImportInvalidExample{
				Row:        lineNum,
				Message:    "row does not contain any inputs columns",
				RawPreview: truncatePreview(marshalPreview(headers, record)),
			})
			result.TotalRows++
			continue
		}

		ei := model.ExampleInput{Split: split}
		ei.Inputs, _ = json.Marshal(inputs)
		if len(expectedOutputs) > 0 {
			ei.ExpectedOutputs, _ = json.Marshal(expectedOutputs)
		}
		if len(metadata) > 0 {
			ei.Metadata, _ = json.Marshal(metadata)
		}

		result.Examples = append(result.Examples, parsedImportExample{
			Example:    ei,
			Row:        lineNum,
			RawPreview: truncatePreview(marshalPreview(headers, record)),
		})
		result.TotalRows++
	}

	return result, nil
}

// parseJSON reads a JSON array of example objects and accumulates invalid rows instead of failing fast.
func parseJSON(r io.Reader) (*importParseResult, error) {
	data, err := io.ReadAll(r)
	if err != nil {
		return nil, err
	}

	var raw []json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("invalid JSON array: %w", err)
	}

	result := &importParseResult{
		TotalRows:       len(raw),
		Examples:        make([]parsedImportExample, 0, len(raw)),
		InvalidExamples: make([]model.DatasetImportInvalidExample, 0),
	}
	for idx, item := range raw {
		row := idx + 1
		ei, err := parseExampleObject(item)
		if err != nil {
			result.InvalidExamples = append(result.InvalidExamples, model.DatasetImportInvalidExample{
				Row:        row,
				Message:    err.Error(),
				RawPreview: truncatePreview(string(item)),
			})
			continue
		}
		result.Examples = append(result.Examples, parsedImportExample{
			Example:    ei,
			Row:        row,
			RawPreview: truncatePreview(string(item)),
		})
	}
	return result, nil
}

// parseJSONL reads one JSON object per line and keeps row-level validation errors in the summary.
func parseJSONL(r io.Reader) (*importParseResult, error) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 1024*1024), 10*1024*1024)

	result := &importParseResult{
		Examples:        make([]parsedImportExample, 0),
		InvalidExamples: make([]model.DatasetImportInvalidExample, 0),
	}

	lineNum := 0
	for scanner.Scan() {
		lineNum++
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		result.TotalRows++
		ei, err := parseExampleObject(json.RawMessage(line))
		if err != nil {
			result.InvalidExamples = append(result.InvalidExamples, model.DatasetImportInvalidExample{
				Row:        lineNum,
				Message:    err.Error(),
				RawPreview: truncatePreview(line),
			})
			continue
		}

		result.Examples = append(result.Examples, parsedImportExample{
			Example:    ei,
			Row:        lineNum,
			RawPreview: truncatePreview(line),
		})
	}

	return result, scanner.Err()
}

func parseExampleObject(data json.RawMessage) (model.ExampleInput, error) {
	var obj struct {
		Inputs          json.RawMessage `json:"inputs"`
		ExpectedOutputs json.RawMessage `json:"expected_outputs"`
		Metadata        json.RawMessage `json:"metadata"`
		Split           string          `json:"split"`
	}
	if err := json.Unmarshal(data, &obj); err != nil {
		return model.ExampleInput{}, fmt.Errorf("parse example: %w", err)
	}
	if len(obj.Inputs) == 0 || string(obj.Inputs) == "null" {
		return model.ExampleInput{}, fmt.Errorf("example missing required 'inputs' field")
	}
	if _, err := normalizeExampleInputs(obj.Inputs); err != nil {
		return model.ExampleInput{}, fmt.Errorf("invalid inputs: %w", err)
	}
	return model.ExampleInput{
		Inputs:          obj.Inputs,
		ExpectedOutputs: obj.ExpectedOutputs,
		Metadata:        obj.Metadata,
		Split:           obj.Split,
	}, nil
}

func filterImportExamples(parsed []parsedImportExample, activeExamples []*model.Example) ([]model.ExampleInput, []model.DatasetImportDuplicate, []model.DatasetImportInvalidExample) {
	activeByKey := make(map[string]string, len(activeExamples))
	for _, ex := range activeExamples {
		key, err := normalizeExampleInputs(ex.Inputs)
		if err != nil {
			continue
		}
		if _, exists := activeByKey[key]; !exists {
			activeByKey[key] = ex.ID
		}
	}

	seenRows := make(map[string]int, len(parsed))
	examplesToAdd := make([]model.ExampleInput, 0, len(parsed))
	duplicates := make([]model.DatasetImportDuplicate, 0)
	invalids := make([]model.DatasetImportInvalidExample, 0)

	for _, item := range parsed {
		key, err := normalizeExampleInputs(item.Example.Inputs)
		if err != nil {
			invalids = append(invalids, model.DatasetImportInvalidExample{
				Row:        item.Row,
				Message:    fmt.Sprintf("invalid inputs: %v", err),
				RawPreview: item.RawPreview,
			})
			continue
		}

		inputsPreview := truncatePreview(key)
		if existingID, exists := activeByKey[key]; exists {
			duplicates = append(duplicates, model.DatasetImportDuplicate{
				Row:               item.Row,
				Scope:             "dataset",
				Message:           fmt.Sprintf("row duplicates active dataset example %s", existingID),
				InputsPreview:     inputsPreview,
				ExistingExampleID: existingID,
			})
			continue
		}

		if firstRow, exists := seenRows[key]; exists {
			duplicateOfRow := firstRow
			duplicates = append(duplicates, model.DatasetImportDuplicate{
				Row:            item.Row,
				Scope:          "file",
				Message:        fmt.Sprintf("row duplicates import row %d", firstRow),
				InputsPreview:  inputsPreview,
				DuplicateOfRow: &duplicateOfRow,
			})
			continue
		}

		seenRows[key] = item.Row
		example := item.Example
		example.Source = "import"
		examplesToAdd = append(examplesToAdd, example)
	}

	return examplesToAdd, duplicates, invalids
}

func normalizeExampleInputs(raw json.RawMessage) (string, error) {
	var value interface{}
	if len(strings.TrimSpace(string(raw))) == 0 {
		return "", fmt.Errorf("inputs cannot be empty")
	}
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", err
	}
	normalized, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(normalized), nil
}

func buildImportVersionDescription(added, duplicateCount, invalidCount int) string {
	description := fmt.Sprintf("Imported %d examples", added)
	skipped := make([]string, 0, 2)
	if duplicateCount > 0 {
		skipped = append(skipped, fmt.Sprintf("%d duplicates", duplicateCount))
	}
	if invalidCount > 0 {
		skipped = append(skipped, fmt.Sprintf("%d invalid", invalidCount))
	}
	if len(skipped) == 0 {
		return description
	}
	return fmt.Sprintf("%s; skipped %s", description, strings.Join(skipped, ", "))
}

func sampleImportDuplicates(items []model.DatasetImportDuplicate) []model.DatasetImportDuplicate {
	if len(items) <= maxImportIssueSamples {
		return items
	}
	return items[:maxImportIssueSamples]
}

func sampleImportInvalidExamples(items []model.DatasetImportInvalidExample) []model.DatasetImportInvalidExample {
	if len(items) <= maxImportIssueSamples {
		return items
	}
	return items[:maxImportIssueSamples]
}

func truncatePreview(value string) string {
	value = strings.TrimSpace(value)
	if len(value) <= 220 {
		return value
	}
	return value[:217] + "..."
}

func marshalPreview(headers, record []string) string {
	payload := make(map[string]string, len(record))
	for idx, value := range record {
		key := fmt.Sprintf("column_%d", idx)
		if idx < len(headers) && strings.TrimSpace(headers[idx]) != "" {
			key = headers[idx]
		}
		payload[key] = value
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return strings.Join(record, ",")
	}
	return string(data)
}
