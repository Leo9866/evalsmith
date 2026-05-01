package main

import (
	"context"
	"log"

	"github.com/evalsmith/sdk-go/evalsmith"
)

func main() {
	client := evalsmith.NewClient(evalsmith.Config{})
	trace := evalsmith.NewTrace("go sdk smoke trace", []string{"sdk", "go"}, map[string]any{
		"source": "sdk-go-example",
	})
	trace.AddSpan(
		"answer",
		"agent",
		map[string]any{"question": "EvalSmith 是什么？"},
		map[string]any{"answer": "一个面向 Agent 的评测与可观测性平台。"},
		map[string]any{"model": "demo"},
	)
	if err := client.IngestTrace(context.Background(), trace); err != nil {
		log.Fatalf("failed to send trace: %v", err)
	}
	log.Printf("sent trace %s to %s", trace.TraceID, client.TraceURL())
}
