package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"

	"github.com/evalsmith/annotation-service/internal/handler"
	"github.com/evalsmith/annotation-service/internal/repository"
	"github.com/evalsmith/annotation-service/internal/service"
	"github.com/gin-gonic/gin"
	_ "github.com/lib/pq"
)

func main() {
	dbHost := envOr("DB_HOST", "localhost")
	dbPort := envOr("DB_PORT", "5432")
	dbUser := envOr("DB_USER", "evalsmith")
	dbPassword := envOr("DB_PASSWORD", "__REDACTED_SECRET__")
	dbName := envOr("DB_NAME", "evalsmith")
	dbSchema := envOr("DB_SCHEMA", "")
	serverPort := envOr("PORT", "8005")
	authServiceURL := envOr("AUTH_SERVICE_URL", "http://127.0.0.1:8004")
	internalToken := envOr("EVALSMITH_INTERNAL_TOKEN", "")

	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		dbHost, dbPort, dbUser, dbPassword, dbName)
	if dbSchema != "" {
		dsn += fmt.Sprintf(" search_path=%s", dbSchema)
	}

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("failed to open database: %v", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		log.Fatalf("failed to ping database: %v", err)
	}
	log.Println("connected to PostgreSQL")

	taskRepo := repository.NewTaskRepository(db)
	svc := service.NewAnnotationService(taskRepo)
	h := handler.NewHandler(svc, authServiceURL, internalToken)

	r := gin.Default()
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok", "service": "annotation-service"})
	})
	h.RegisterRoutes(r)

	log.Printf("annotation-service starting on :%s", serverPort)
	if err := r.Run(":" + serverPort); err != nil {
		log.Fatalf("failed to start server: %v", err)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
