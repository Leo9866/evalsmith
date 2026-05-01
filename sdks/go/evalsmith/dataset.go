package evalsmith

import (
	"context"
	"fmt"
)

type Dataset struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Description    string `json:"description"`
	CurrentVersion int    `json:"current_version"`
	ExampleCount   int    `json:"example_count"`
}

type Example struct {
	ID              string         `json:"id"`
	Inputs          map[string]any `json:"inputs"`
	ExpectedOutputs any            `json:"expected_outputs"`
	Metadata        map[string]any `json:"metadata"`
	Split           string         `json:"split"`
	Source          string         `json:"source"`
}

// GetDatasetByName resolves a dataset by name within the current project.
func (c *Client) GetDatasetByName(ctx context.Context, name string) (*Dataset, error) {
	var resp struct {
		Code int `json:"code"`
		Data struct {
			Items []Dataset `json:"items"`
		} `json:"data"`
	}
	path := fmt.Sprintf("/api/v1/datasets?name=%s&page_size=10", name)
	if err := c.GetJSON(ctx, c.datasetURL, path, &resp); err != nil {
		return nil, err
	}
	for _, ds := range resp.Data.Items {
		if ds.Name == name {
			return &ds, nil
		}
	}
	if len(resp.Data.Items) > 0 {
		return &resp.Data.Items[0], nil
	}
	return nil, fmt.Errorf("dataset %q not found", name)
}

// ListExamples fetches examples from a dataset.
func (c *Client) ListExamples(ctx context.Context, datasetID string, pageSize int) ([]Example, error) {
	if pageSize <= 0 {
		pageSize = 100
	}
	var resp struct {
		Code int `json:"code"`
		Data struct {
			Items []Example `json:"items"`
		} `json:"data"`
	}
	path := fmt.Sprintf("/api/v1/datasets/%s/examples?page_size=%d", datasetID, pageSize)
	if err := c.GetJSON(ctx, c.datasetURL, path, &resp); err != nil {
		return nil, err
	}
	return resp.Data.Items, nil
}
