package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/evalsmith/trace-service/internal/authz"
	"github.com/gin-gonic/gin"

	"github.com/evalsmith/trace-service/internal/config"
	"github.com/evalsmith/trace-service/internal/handler"
	"github.com/evalsmith/trace-service/internal/middleware"
	"github.com/evalsmith/trace-service/internal/repository"
	"github.com/evalsmith/trace-service/internal/service"
)

func main() {
	cfg := config.Load()

	var (
		chRepo     *repository.ClickHouseRepo
		minioRepo  *repository.MinIORepo
		producer   *service.KafkaProducer
		localStore *repository.LocalTraceStore
		err        error
	)

	useLocalStore := cfg.StorageMode == "local"
	if !useLocalStore {
		chRepo, err = repository.NewClickHouseRepo(
			cfg.ClickHouseAddr, cfg.ClickHouseDB,
			cfg.ClickHouseUser, cfg.ClickHousePass,
		)
		if err != nil {
			if cfg.StorageMode == "clickhouse" {
				log.Fatalf("clickhouse init: %v", err)
			}
			log.Printf("clickhouse unavailable, falling back to local trace store: %v", err)
			useLocalStore = true
		}
	}
	if chRepo != nil {
		defer chRepo.Close()
	}

	if useLocalStore {
		localStore, err = repository.NewLocalTraceStore(cfg.LocalStorePath)
		if err != nil {
			log.Fatalf("local trace store init: %v", err)
		}
		log.Printf("trace-service using local store at %s", cfg.LocalStorePath)
	} else {
		minioRepo, err = repository.NewMinIORepo(
			cfg.MinIOEndpoint, cfg.MinIOAccessKey,
			cfg.MinIOSecretKey, cfg.MinIOBucket, cfg.MinIOUseSSL,
		)
		if err != nil {
			log.Fatalf("minio init: %v", err)
		}

		brokers := strings.Split(cfg.KafkaBrokers, ",")
		producer = service.NewKafkaProducer(brokers, cfg.KafkaTopic)
		defer producer.Close()
	}

	// Service + Handler
	traceSvc := service.NewTraceService(
		chRepo,
		minioRepo,
		producer,
		localStore,
		cfg.InternalServiceToken,
		cfg.DatasetServiceURL,
		cfg.AnnotationServiceURL,
	)
	traceHandler := handler.NewTraceHandler(traceSvc)

	// Gin router
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(middleware.RequestLogger())

	// Health check (no auth needed).
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	r.POST(
		"/v1/traces",
		authz.AuthContextMiddleware(cfg.AuthServiceURL, cfg.InternalServiceToken),
		authz.RequireRoles(authz.WriteRoles()...),
		traceHandler.OTLPIngest(),
	)

	// API v1 group with authz middleware.
	v1 := r.Group("/api/v1")
	v1.Use(authz.AuthContextMiddleware(cfg.AuthServiceURL, cfg.InternalServiceToken))
	traceHandler.RegisterRoutes(v1)

	// HTTP server
	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown.
	go func() {
		log.Printf("trace-service listening on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("shutting down trace-service...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("server shutdown: %v", err)
	}
	log.Println("trace-service stopped")
}
