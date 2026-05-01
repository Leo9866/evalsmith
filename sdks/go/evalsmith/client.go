package evalsmith

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

func envFirst(names ...string) string {
	for _, name := range names {
		if value := strings.TrimSpace(os.Getenv(name)); value != "" {
			return value
		}
	}
	return ""
}

type Config struct {
	APIKey     string
	Project    string
	BaseURL    string
	TraceURL   string
	DatasetURL string
	EvalURL    string
	AuthURL    string
	HTTPClient *http.Client
}

type Client struct {
	apiKey     string
	project    string
	traceURL   string
	datasetURL string
	evalURL    string
	authURL    string
	httpClient *http.Client
}

func NewClient(cfg Config) *Client {
	baseURL := strings.TrimRight(firstNonEmpty(cfg.BaseURL, envFirst("EVALSMITH_BASE_URL")), "/")
	traceURL := strings.TrimRight(firstNonEmpty(cfg.TraceURL, envFirst("EVALSMITH_TRACE_URL"), baseURL, "http://127.0.0.1:8001"), "/")
	datasetURL := strings.TrimRight(firstNonEmpty(cfg.DatasetURL, envFirst("EVALSMITH_DATASET_URL"), baseURL, "http://127.0.0.1:8003"), "/")
	evalURL := strings.TrimRight(firstNonEmpty(cfg.EvalURL, envFirst("EVALSMITH_EVAL_URL"), baseURL, "http://127.0.0.1:8002"), "/")
	authURL := strings.TrimRight(firstNonEmpty(cfg.AuthURL, envFirst("EVALSMITH_AUTH_URL"), baseURL, "http://127.0.0.1:8004"), "/")
	project := firstNonEmpty(cfg.Project, envFirst("EVALSMITH_PROJECT"), "proj_default")
	apiKey := firstNonEmpty(cfg.APIKey, envFirst("EVALSMITH_API_KEY"))
	httpClient := cfg.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 30 * time.Second}
	}
	return &Client{
		apiKey:     apiKey,
		project:    project,
		traceURL:   traceURL,
		datasetURL: datasetURL,
		evalURL:    evalURL,
		authURL:    authURL,
		httpClient: httpClient,
	}
}

func (c *Client) Project() string {
	return c.project
}

func (c *Client) TraceURL() string {
	return c.traceURL
}

func (c *Client) BuildHeaders() http.Header {
	headers := make(http.Header)
	headers.Set("Content-Type", "application/json")
	headers.Set("X-Project-ID", c.project)
	if c.apiKey != "" {
		headers.Set("Authorization", "Bearer "+c.apiKey)
	}
	return headers
}

func (c *Client) PostJSON(ctx context.Context, baseURL, path string, payload any, out any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(baseURL, "/")+path, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header = c.BuildHeaders()
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("request failed: %s", resp.Status)
	}
	if out == nil {
		return nil
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}
	return nil
}

// GetJSON performs a GET request and decodes JSON response.
func (c *Client) GetJSON(ctx context.Context, baseURL, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(baseURL, "/")+path, nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header = c.BuildHeaders()
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("request failed: %s", resp.Status)
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
