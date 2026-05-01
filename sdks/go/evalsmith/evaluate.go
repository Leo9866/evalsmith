package evalsmith

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

type CreateExperimentRequest struct {
	Name               string            `json:"name"`
	Description        string            `json:"description,omitempty"`
	DatasetID          string            `json:"dataset_id"`
	DatasetVersion     *int              `json:"dataset_version,omitempty"`
	Split              string            `json:"split,omitempty"`
	EvaluatorIDs       []string          `json:"evaluator_ids"`
	TargetURL          string            `json:"target_url"`
	TargetMethod       string            `json:"target_method,omitempty"`
	TargetHeaders      map[string]string `json:"target_headers,omitempty"`
	BodyTemplate       string            `json:"target_body_template,omitempty"`
	TargetResponsePath string            `json:"target_response_path,omitempty"`
	TargetTimeoutMS    int               `json:"target_timeout_ms,omitempty"`
	Concurrency        int               `json:"concurrency,omitempty"`
}

type ExperimentResponse struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
}

type APIEnvelope struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}

type ExperimentSummary struct {
	TotalExamples int                `json:"total_examples"`
	Completed     int                `json:"completed"`
	Failed        int                `json:"failed"`
	AvgScores     map[string]float64 `json:"avg_scores"`
	PassRates     map[string]float64 `json:"pass_rates"`
}

type ExperimentDetail struct {
	ID      string             `json:"id"`
	Name    string             `json:"name"`
	Status  string             `json:"status"`
	Summary *ExperimentSummary `json:"summary"`
}

type PreviewExample struct {
	ID              string         `json:"id,omitempty"`
	Inputs          any            `json:"inputs"`
	ExpectedOutputs any            `json:"expected_outputs,omitempty"`
	Metadata        map[string]any `json:"metadata,omitempty"`
	Split           string         `json:"split,omitempty"`
}

type PreviewTargetRequest struct {
	TargetURL          string            `json:"target_url"`
	TargetMethod       string            `json:"target_method,omitempty"`
	TargetHeaders      map[string]string `json:"target_headers,omitempty"`
	TargetBodyTemplate string            `json:"target_body_template,omitempty"`
	TargetResponsePath string            `json:"target_response_path,omitempty"`
	TargetTimeoutMS    int               `json:"target_timeout_ms,omitempty"`
	Example            PreviewExample    `json:"example"`
}

type PreviewTargetResponse struct {
	RequestMethod      string `json:"request_method"`
	RequestURL         string `json:"request_url"`
	RequestBody        any    `json:"request_body,omitempty"`
	ResponseStatusCode int    `json:"response_status_code"`
	ResponsePathUsed   string `json:"response_path_used,omitempty"`
	LatencyMS          int    `json:"latency_ms"`
	TraceID            string `json:"trace_id,omitempty"`
	Output             any    `json:"output,omitempty"`
	RawResponse        any    `json:"raw_response,omitempty"`
}

// Evaluate creates an experiment and polls until completion.
func (c *Client) Evaluate(ctx context.Context, req CreateExperimentRequest) (*ExperimentDetail, error) {
	var createResp struct {
		Code int                `json:"code"`
		Data ExperimentResponse `json:"data"`
	}
	if err := c.PostJSON(ctx, c.evalURL, "/api/v1/experiments", req, &createResp); err != nil {
		return nil, fmt.Errorf("create experiment: %w", err)
	}

	expID := createResp.Data.ID
	if expID == "" {
		return nil, fmt.Errorf("experiment ID empty in response")
	}

	for i := 0; i < 120; i++ {
		detail, err := c.GetExperiment(ctx, expID)
		if err != nil {
			return nil, err
		}
		if detail.Status == "completed" || detail.Status == "failed" || detail.Status == "canceled" {
			return detail, nil
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
	return nil, fmt.Errorf("experiment %s did not complete within timeout", expID)
}

// GetExperiment fetches experiment status and summary.
func (c *Client) GetExperiment(ctx context.Context, experimentID string) (*ExperimentDetail, error) {
	var resp struct {
		Code int              `json:"code"`
		Data ExperimentDetail `json:"data"`
	}
	if err := c.GetJSON(ctx, c.evalURL, "/api/v1/experiments/"+experimentID, &resp); err != nil {
		return nil, err
	}
	return &resp.Data, nil
}

func (c *Client) PreviewExperimentTarget(ctx context.Context, req PreviewTargetRequest) (*PreviewTargetResponse, error) {
	if req.TargetMethod == "" {
		req.TargetMethod = "POST"
	}
	if req.TargetBodyTemplate == "" {
		req.TargetBodyTemplate = `{"input": {{inputs.input}}}`
	}
	if req.TargetTimeoutMS == 0 {
		req.TargetTimeoutMS = 120000
	}
	if req.Example.Split == "" {
		req.Example.Split = "default"
	}
	if req.Example.Metadata == nil {
		req.Example.Metadata = map[string]any{}
	}

	var resp struct {
		Code int                   `json:"code"`
		Data PreviewTargetResponse `json:"data"`
	}
	if err := c.PostJSON(ctx, c.evalURL, "/api/v1/experiments/target-preview", req, &resp); err != nil {
		return nil, fmt.Errorf("preview target: %w", err)
	}
	return &resp.Data, nil
}
