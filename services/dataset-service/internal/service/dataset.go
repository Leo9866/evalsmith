package service

import (
	"bytes"
	"database/sql"
	"fmt"
	"sort"
	"strings"

	"github.com/evalsmith/dataset-service/internal/model"
	"github.com/evalsmith/dataset-service/internal/repository"
)

type DatasetService struct {
	datasetRepo *repository.DatasetRepository
	versionRepo *repository.VersionRepository
	exampleRepo *repository.ExampleRepository
}

func NewDatasetService(
	datasetRepo *repository.DatasetRepository,
	versionRepo *repository.VersionRepository,
	exampleRepo *repository.ExampleRepository,
) *DatasetService {
	return &DatasetService{
		datasetRepo: datasetRepo,
		versionRepo: versionRepo,
		exampleRepo: exampleRepo,
	}
}

func (s *DatasetService) CreateDataset(projectID string, req *model.CreateDatasetRequest) (*model.Dataset, error) {
	d := &model.Dataset{
		ID:          model.NewDatasetID(),
		ProjectID:   projectID,
		Name:        req.Name,
		Description: req.Description,
		SchemaDef:   req.SchemaDef,
	}
	if err := s.datasetRepo.Create(d); err != nil {
		return nil, fmt.Errorf("create dataset: %w", err)
	}

	// Create initial version.
	v := &model.DatasetVersion{
		ID:          model.NewVersionID(),
		DatasetID:   d.ID,
		Version:     1,
		Description: "Initial version",
	}
	if err := s.versionRepo.Create(v); err != nil {
		return nil, fmt.Errorf("create initial version: %w", err)
	}
	if err := s.refreshSnapshot(d.ID, 1); err != nil {
		return nil, fmt.Errorf("create initial snapshot: %w", err)
	}
	return d, nil
}

func (s *DatasetService) GetDataset(id, projectID string) (*model.Dataset, error) {
	d, err := s.datasetRepo.GetByID(id, projectID)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return d, err
}

func (s *DatasetService) ListDatasets(projectID, name string, page, pageSize int) ([]*model.Dataset, int, error) {
	return s.datasetRepo.List(projectID, name, page, pageSize)
}

func (s *DatasetService) UpdateDataset(id, projectID string, req *model.UpdateDatasetRequest) (*model.Dataset, error) {
	d, err := s.datasetRepo.GetByID(id, projectID)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	if req.Name != nil {
		d.Name = *req.Name
	}
	if req.Description != nil {
		d.Description = *req.Description
	}
	if req.SchemaDef != nil {
		d.SchemaDef = *req.SchemaDef
	}

	if err := s.datasetRepo.Update(d); err != nil {
		return nil, fmt.Errorf("update dataset: %w", err)
	}
	return d, nil
}

func (s *DatasetService) DeleteDataset(id, projectID string) error {
	_, err := s.datasetRepo.GetByID(id, projectID)
	if err == sql.ErrNoRows {
		return ErrNotFound
	}
	if err != nil {
		return err
	}

	// Delete all examples first.
	if err := s.exampleRepo.DeleteByDataset(id); err != nil {
		return fmt.Errorf("delete dataset examples: %w", err)
	}
	return s.datasetRepo.Delete(id, projectID)
}

func (s *DatasetService) BatchAddExamples(datasetID, projectID string, req *model.BatchAddExamplesRequest) (*model.BatchAddExamplesResponse, error) {
	d, err := s.datasetRepo.GetByID(datasetID, projectID)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	description := strings.TrimSpace(req.Description)
	if description == "" {
		if req.SourceContext != nil && req.SourceContext.SourceType == "trace_backfill" {
			description = fmt.Sprintf("从 Trace 回流新增 %d 条样本", len(req.Examples))
		} else {
			description = fmt.Sprintf("Added %d examples", len(req.Examples))
		}
	}

	// Bump version.
	newVersion, err := s.datasetRepo.IncrementVersionAndCount(d.ID, len(req.Examples))
	if err != nil {
		return nil, fmt.Errorf("increment version: %w", err)
	}

	// Create version record.
	ver := &model.DatasetVersion{
		ID:          model.NewVersionID(),
		DatasetID:   d.ID,
		Version:     newVersion,
		Description: description,
	}
	if err := s.versionRepo.Create(ver); err != nil {
		return nil, fmt.Errorf("create version: %w", err)
	}

	// Build example records.
	examples := make([]*model.Example, 0, len(req.Examples))
	ids := make([]string, 0, len(req.Examples))
	for _, ei := range req.Examples {
		id := model.NewExampleID()
		ids = append(ids, id)
		split := ei.Split
		if split == "" {
			split = "default"
		}
		source := ei.Source
		if source == "" {
			source = "manual"
		}
		examples = append(examples, &model.Example{
			ID:              id,
			DatasetID:       d.ID,
			Inputs:          ei.Inputs,
			ExpectedOutputs: ei.ExpectedOutputs,
			Metadata:        ei.Metadata,
			Source:          source,
			Split:           split,
			VersionAdded:    newVersion,
		})
	}

	if err := s.exampleRepo.BatchCreate(examples); err != nil {
		return nil, fmt.Errorf("batch create examples: %w", err)
	}
	if err := s.refreshSnapshot(d.ID, newVersion); err != nil {
		return nil, fmt.Errorf("refresh dataset snapshot: %w", err)
	}

	return &model.BatchAddExamplesResponse{
		Added:      len(examples),
		NewVersion: newVersion,
		ExampleIDs: ids,
	}, nil
}

func (s *DatasetService) ListExamples(datasetID, projectID, split, query string, page, pageSize int, version *int) ([]*model.Example, int, error) {
	// Verify dataset belongs to project.
	_, err := s.datasetRepo.GetByID(datasetID, projectID)
	if err == sql.ErrNoRows {
		return nil, 0, ErrNotFound
	}
	if err != nil {
		return nil, 0, err
	}

	if version != nil {
		snapshot, err := s.loadSnapshotForVersion(datasetID, *version)
		if err != nil {
			return nil, 0, err
		}
		return paginateSnapshotExamples(datasetID, snapshot, split, query, page, pageSize), countSnapshotExamples(snapshot, split, query), nil
	}
	return s.exampleRepo.List(datasetID, split, query, page, pageSize)
}

func (s *DatasetService) UpdateExample(datasetID, exampleID, projectID string, req *model.UpdateExampleRequest) (*model.Example, error) {
	_, err := s.datasetRepo.GetByID(datasetID, projectID)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	ex, err := s.exampleRepo.GetByID(exampleID, datasetID)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	if req.Inputs != nil {
		ex.Inputs = *req.Inputs
	}
	if req.ExpectedOutputs != nil {
		ex.ExpectedOutputs = *req.ExpectedOutputs
	}
	if req.Metadata != nil {
		ex.Metadata = *req.Metadata
	}
	if req.Split != nil {
		ex.Split = *req.Split
	}

	if err := s.exampleRepo.Update(ex); err != nil {
		return nil, fmt.Errorf("update example: %w", err)
	}

	// Bump version for mutation.
	newVersion, err := s.datasetRepo.BumpVersion(datasetID)
	if err != nil {
		return nil, fmt.Errorf("bump version: %w", err)
	}
	ver := &model.DatasetVersion{
		ID:          model.NewVersionID(),
		DatasetID:   datasetID,
		Version:     newVersion,
		Description: fmt.Sprintf("Updated example %s", exampleID),
	}
	_ = s.versionRepo.Create(ver)
	_ = s.refreshSnapshot(datasetID, newVersion)

	return ex, nil
}

func (s *DatasetService) DeleteExample(datasetID, exampleID, projectID string) error {
	_, err := s.datasetRepo.GetByID(datasetID, projectID)
	if err == sql.ErrNoRows {
		return ErrNotFound
	}
	if err != nil {
		return err
	}

	_, err = s.exampleRepo.GetByID(exampleID, datasetID)
	if err == sql.ErrNoRows {
		return ErrNotFound
	}
	if err != nil {
		return err
	}

	if err := s.exampleRepo.Delete(exampleID, datasetID); err != nil {
		return fmt.Errorf("delete example: %w", err)
	}

	if err := s.datasetRepo.AdjustExampleCount(datasetID, -1); err != nil {
		return fmt.Errorf("adjust count: %w", err)
	}

	newVersion, err := s.datasetRepo.BumpVersion(datasetID)
	if err != nil {
		return fmt.Errorf("bump version: %w", err)
	}
	ver := &model.DatasetVersion{
		ID:          model.NewVersionID(),
		DatasetID:   datasetID,
		Version:     newVersion,
		Description: fmt.Sprintf("Deleted example %s", exampleID),
	}
	_ = s.versionRepo.Create(ver)
	_ = s.refreshSnapshot(datasetID, newVersion)

	return nil
}

func (s *DatasetService) ListVersions(datasetID, projectID string) ([]*model.DatasetVersion, error) {
	_, err := s.datasetRepo.GetByID(datasetID, projectID)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return s.versionRepo.ListByDataset(datasetID)
}

func (s *DatasetService) UpdateVersionDescription(datasetID, projectID string, version int, description string) (*model.DatasetVersion, error) {
	_, err := s.datasetRepo.GetByID(datasetID, projectID)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	description = strings.TrimSpace(description)
	if description == "" {
		return nil, fmt.Errorf("%w: version description is required", ErrInvalidArgument)
	}

	if _, err := s.versionRepo.GetByDatasetAndVersion(datasetID, version); err == sql.ErrNoRows {
		return nil, ErrNotFound
	} else if err != nil {
		return nil, err
	}

	if err := s.versionRepo.UpdateDescription(datasetID, version, description); err != nil {
		return nil, fmt.Errorf("update version description: %w", err)
	}

	updated, err := s.versionRepo.GetByDatasetAndVersion(datasetID, version)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return updated, nil
}

func (s *DatasetService) GetSplitSummary(datasetID, projectID string) ([]*model.SplitSummary, error) {
	_, err := s.datasetRepo.GetByID(datasetID, projectID)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return s.exampleRepo.SplitSummary(datasetID)
}

func (s *DatasetService) GetVersionDiff(datasetID, projectID string, baseVersion, targetVersion int) (*model.DatasetVersionDiffResponse, error) {
	_, err := s.datasetRepo.GetByID(datasetID, projectID)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	baseSnapshot, err := s.loadSnapshotForVersion(datasetID, baseVersion)
	if err != nil {
		return nil, err
	}

	targetSnapshot, err := s.loadSnapshotForVersion(datasetID, targetVersion)
	if err != nil {
		return nil, err
	}

	response := buildVersionDiff(datasetID, baseSnapshot, targetSnapshot)
	return &response, nil
}

func (s *DatasetService) RollbackVersion(datasetID, projectID string, targetVersion int, description string) (*model.DatasetVersionRollbackResponse, error) {
	dataset, err := s.datasetRepo.GetByID(datasetID, projectID)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	targetSnapshot, err := s.loadSnapshotForVersion(datasetID, targetVersion)
	if err != nil {
		return nil, err
	}

	newVersion, err := s.datasetRepo.BumpVersion(datasetID)
	if err != nil {
		return nil, fmt.Errorf("bump version: %w", err)
	}

	examples := make([]*model.Example, 0, len(targetSnapshot.Examples))
	for _, item := range targetSnapshot.Examples {
		examples = append(examples, &model.Example{
			ID:              item.ID,
			DatasetID:       datasetID,
			Inputs:          item.Inputs,
			ExpectedOutputs: item.ExpectedOutputs,
			Metadata:        item.Metadata,
			Source:          item.Source,
			Split:           item.Split,
			VersionAdded:    item.VersionAdded,
		})
	}

	if err := s.exampleRepo.ReplaceActiveSet(datasetID, examples); err != nil {
		return nil, fmt.Errorf("replace active examples: %w", err)
	}
	if err := s.datasetRepo.SetExampleCount(datasetID, len(examples)); err != nil {
		return nil, fmt.Errorf("update dataset example count: %w", err)
	}

	if description == "" {
		description = fmt.Sprintf("Rolled back to version v%d", targetVersion)
	}
	version := &model.DatasetVersion{
		ID:          model.NewVersionID(),
		DatasetID:   dataset.ID,
		Version:     newVersion,
		Description: description,
	}
	if err := s.versionRepo.Create(version); err != nil {
		return nil, fmt.Errorf("create rollback version: %w", err)
	}
	if err := s.refreshSnapshot(datasetID, newVersion); err != nil {
		return nil, fmt.Errorf("refresh rollback snapshot: %w", err)
	}

	return &model.DatasetVersionRollbackResponse{
		DatasetID:           datasetID,
		RestoredFromVersion: targetVersion,
		NewVersion:          newVersion,
		ActiveExampleCount:  len(examples),
	}, nil
}

func (s *DatasetService) refreshSnapshot(datasetID string, version int) error {
	examples, err := s.exampleRepo.ListActiveAll(datasetID)
	if err != nil {
		return err
	}
	return s.versionRepo.SaveSnapshot(datasetID, version, examples)
}

func (s *DatasetService) loadSnapshotForVersion(datasetID string, version int) (*model.DatasetVersionSnapshot, error) {
	snapshot, err := s.versionRepo.GetSnapshot(datasetID, version)
	if err == nil {
		return snapshot, nil
	}
	if err != sql.ErrNoRows {
		return nil, err
	}

	if _, versionErr := s.versionRepo.GetByDatasetAndVersion(datasetID, version); versionErr == sql.ErrNoRows {
		return nil, ErrNotFound
	} else if versionErr != nil {
		return nil, versionErr
	}

	return nil, fmt.Errorf("%w: snapshot for dataset version v%d is unavailable; create a new dataset version before using diff or rollback on this legacy history", ErrInvalidArgument, version)
}

func buildVersionDiff(datasetID string, baseSnapshot, targetSnapshot *model.DatasetVersionSnapshot) model.DatasetVersionDiffResponse {
	baseByID := make(map[string]model.DatasetSnapshotExample, len(baseSnapshot.Examples))
	for _, item := range baseSnapshot.Examples {
		baseByID[item.ID] = item
	}

	targetByID := make(map[string]model.DatasetSnapshotExample, len(targetSnapshot.Examples))
	for _, item := range targetSnapshot.Examples {
		targetByID[item.ID] = item
	}

	added := make([]model.DatasetDiffEntry, 0)
	removed := make([]model.DatasetDiffEntry, 0)
	changed := make([]model.DatasetChangedPair, 0)

	for _, target := range targetSnapshot.Examples {
		base, exists := baseByID[target.ID]
		if !exists {
			added = append(added, toDiffEntry(target))
			continue
		}
		if !snapshotExamplesEqual(base, target) {
			changed = append(changed, model.DatasetChangedPair{
				ExampleID: target.ID,
				Before:    toDiffEntry(base),
				After:     toDiffEntry(target),
			})
		}
	}

	for _, base := range baseSnapshot.Examples {
		if _, exists := targetByID[base.ID]; !exists {
			removed = append(removed, toDiffEntry(base))
		}
	}

	sort.Slice(added, func(i, j int) bool { return added[i].ExampleID < added[j].ExampleID })
	sort.Slice(removed, func(i, j int) bool { return removed[i].ExampleID < removed[j].ExampleID })
	sort.Slice(changed, func(i, j int) bool { return changed[i].ExampleID < changed[j].ExampleID })

	return model.DatasetVersionDiffResponse{
		DatasetID:     datasetID,
		BaseVersion:   baseSnapshot.Version,
		TargetVersion: targetSnapshot.Version,
		AddedCount:    len(added),
		RemovedCount:  len(removed),
		ChangedCount:  len(changed),
		Added:         added,
		Removed:       removed,
		Changed:       changed,
	}
}

func toDiffEntry(item model.DatasetSnapshotExample) model.DatasetDiffEntry {
	return model.DatasetDiffEntry{
		ExampleID:       item.ID,
		Inputs:          item.Inputs,
		ExpectedOutputs: item.ExpectedOutputs,
		Metadata:        item.Metadata,
		Split:           item.Split,
		Source:          item.Source,
	}
}

func snapshotExamplesEqual(left, right model.DatasetSnapshotExample) bool {
	return left.Source == right.Source &&
		left.Split == right.Split &&
		left.VersionAdded == right.VersionAdded &&
		bytes.Equal(left.Inputs, right.Inputs) &&
		bytes.Equal(left.ExpectedOutputs, right.ExpectedOutputs) &&
		bytes.Equal(left.Metadata, right.Metadata)
}

func countSnapshotExamples(snapshot *model.DatasetVersionSnapshot, split, query string) int {
	if snapshot == nil {
		return 0
	}
	total := 0
	for _, item := range snapshot.Examples {
		if snapshotExampleMatches(item, split, query) {
			total++
		}
	}
	return total
}

func paginateSnapshotExamples(
	datasetID string,
	snapshot *model.DatasetVersionSnapshot,
	split string,
	query string,
	page int,
	pageSize int,
) []*model.Example {
	if snapshot == nil {
		return []*model.Example{}
	}

	filtered := make([]model.DatasetSnapshotExample, 0, len(snapshot.Examples))
	for _, item := range snapshot.Examples {
		if snapshotExampleMatches(item, split, query) {
			filtered = append(filtered, item)
		}
	}

	offset := (page - 1) * pageSize
	if offset >= len(filtered) {
		return []*model.Example{}
	}

	end := offset + pageSize
	if end > len(filtered) {
		end = len(filtered)
	}

	items := make([]*model.Example, 0, end-offset)
	for _, item := range filtered[offset:end] {
		items = append(items, &model.Example{
			ID:              item.ID,
			DatasetID:       datasetID,
			Inputs:          append([]byte(nil), item.Inputs...),
			ExpectedOutputs: append([]byte(nil), item.ExpectedOutputs...),
			Metadata:        append([]byte(nil), item.Metadata...),
			Source:          item.Source,
			Split:           item.Split,
			VersionAdded:    item.VersionAdded,
			CreatedAt:       snapshot.CreatedAt,
			UpdatedAt:       snapshot.CreatedAt,
		})
	}

	return items
}

func snapshotExampleMatches(item model.DatasetSnapshotExample, split, query string) bool {
	if split != "" && item.Split != split {
		return false
	}
	if strings.TrimSpace(query) == "" {
		return true
	}
	needle := strings.ToLower(strings.TrimSpace(query))
	haystacks := []string{
		strings.ToLower(item.ID),
		strings.ToLower(string(item.Inputs)),
		strings.ToLower(string(item.ExpectedOutputs)),
		strings.ToLower(string(item.Metadata)),
		strings.ToLower(item.Source),
		strings.ToLower(item.Split),
	}
	for _, haystack := range haystacks {
		if strings.Contains(haystack, needle) {
			return true
		}
	}
	return false
}

// errors
var ErrNotFound = fmt.Errorf("not found")
var ErrInvalidArgument = fmt.Errorf("invalid argument")
