package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/segmentio/kafka-go"

	"github.com/evalsmith/trace-consumer/internal/config"
	"github.com/evalsmith/trace-consumer/internal/processor"
	"github.com/evalsmith/trace-consumer/internal/repository"
)

func main() {
	cfg := config.Load()

	// ClickHouse
	chRepo, err := repository.NewClickHouseRepo(
		cfg.ClickHouseAddr, cfg.ClickHouseDB,
		cfg.ClickHouseUser, cfg.ClickHousePass,
	)
	if err != nil {
		log.Fatalf("clickhouse init: %v", err)
	}
	defer chRepo.Close()

	// MinIO
	minioRepo, err := repository.NewMinIORepo(
		cfg.MinIOEndpoint, cfg.MinIOAccessKey,
		cfg.MinIOSecretKey, cfg.MinIOBucket, cfg.MinIOUseSSL,
	)
	if err != nil {
		log.Fatalf("minio init: %v", err)
	}

	// Processor
	proc := processor.New(chRepo, minioRepo)

	// Kafka reader
	brokers := strings.Split(cfg.KafkaBrokers, ",")
	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:  brokers,
		Topic:    cfg.KafkaTopic,
		GroupID:  cfg.KafkaGroupID,
		MinBytes: 1e3,  // 1KB
		MaxBytes: 10e6, // 10MB
	})
	defer reader.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Handle shutdown.
	go func() {
		quit := make(chan os.Signal, 1)
		signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
		<-quit
		log.Println("shutting down trace-consumer...")
		cancel()
	}()

	log.Printf("trace-consumer started, reading from topic %s (group: %s)", cfg.KafkaTopic, cfg.KafkaGroupID)

	for {
		msg, err := reader.FetchMessage(ctx)
		if err != nil {
			if ctx.Err() != nil {
				// Context cancelled, clean shutdown.
				break
			}
			log.Printf("fetch message error: %v", err)
			continue
		}

		if err := proc.Process(ctx, msg.Value); err != nil {
			log.Printf("process error (offset %d): %v", msg.Offset, err)
			// In production, consider dead-letter queue. For now, log and commit.
		}

		if err := reader.CommitMessages(ctx, msg); err != nil {
			if ctx.Err() != nil {
				break
			}
			log.Printf("commit error: %v", err)
		}
	}

	log.Println("trace-consumer stopped")
}
