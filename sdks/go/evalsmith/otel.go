package evalsmith

import "fmt"

func BuildOTLPHeaders(project string, apiKey string) map[string]string {
	headers := map[string]string{
		"Content-Type": "application/x-protobuf",
		"X-Project-ID": project,
	}
	if apiKey != "" {
		headers["Authorization"] = fmt.Sprintf("Bearer %s", apiKey)
	}
	return headers
}
