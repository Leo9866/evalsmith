package main

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/evalsmith/auth-service/internal/handler"
	"github.com/evalsmith/auth-service/internal/middleware"
	"github.com/evalsmith/auth-service/internal/model"
	"github.com/evalsmith/auth-service/internal/repository"
	"github.com/evalsmith/auth-service/internal/service"
	"github.com/gin-gonic/gin"
	_ "github.com/lib/pq"
)

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}

func main() {
	// Database connection
	dbHost := getEnv("DB_HOST", "localhost")
	dbPort := getEnv("DB_PORT", "5432")
	dbUser := getEnv("DB_USER", "evalsmith")
	dbPassword := getEnv("DB_PASSWORD", "__REDACTED_SECRET__")
	dbName := getEnv("DB_NAME", "evalsmith")
	dbSchema := getEnv("DB_SCHEMA", "")
	serverPort := getEnv("SERVER_PORT", "8004")
	secretKey := getEnv("EVALSMITH_SECRET_KEY", "")
	internalServiceToken := getEnv("INTERNAL_SERVICE_TOKEN", getEnv("EVALSMITH_INTERNAL_SERVICE_TOKEN", ""))
	if strings.TrimSpace(secretKey) == "" {
		log.Fatal("EVALSMITH_SECRET_KEY must be set")
	}

	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		dbHost, dbPort, dbUser, dbPassword, dbName,
	)
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
	log.Println("connected to database")

	// Repositories
	projectRepo := repository.NewProjectRepository(db)
	apiKeyRepo := repository.NewAPIKeyRepository(db)
	userRepo := repository.NewUserRepository(db)
	sessionRepo := repository.NewSessionRepository(db)
	memberRepo := repository.NewProjectMemberRepository(db)
	if err := userRepo.EnsureSchema(); err != nil {
		log.Fatalf("failed to ensure users schema: %v", err)
	}
	if err := sessionRepo.EnsureSchema(); err != nil {
		log.Fatalf("failed to ensure sessions schema: %v", err)
	}
	if err := memberRepo.EnsureSchema(); err != nil {
		log.Fatalf("failed to ensure project members schema: %v", err)
	}
	if err := projectRepo.EnsureSchema(); err != nil {
		log.Fatalf("failed to ensure auth-service schema: %v", err)
	}

	// Services
	authSvc := service.NewAuthService(userRepo, sessionRepo, projectRepo, memberRepo)
	projectSvc, err := service.NewProjectService(projectRepo, memberRepo, userRepo, secretKey)
	if err != nil {
		log.Fatalf("failed to initialize project service: %v", err)
	}
	apiKeySvc := service.NewAPIKeyService(apiKeyRepo, projectRepo, memberRepo)

	// Handlers
	authHandler := handler.NewAuthHandler(authSvc, apiKeyRepo, memberRepo)
	projectHandler := handler.NewProjectHandler(projectSvc)
	apiKeyHandler := handler.NewAPIKeyHandler(apiKeySvc)

	// Auth middleware for protected routes
	authMw := middleware.AuthMiddleware(apiKeyRepo)
	sessionMw := middleware.SessionMiddleware(sessionRepo, userRepo)
	internalMw := middleware.RequireInternalServiceToken(internalServiceToken)

	// Router
	r := gin.Default()

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, model.SuccessResponse(gin.H{"status": "healthy"}))
	})

	v1 := r.Group("/api/v1")
	{
		auth := v1.Group("/auth")
		{
			auth.POST("/register", authHandler.Register)
			auth.POST("/login", authHandler.Login)
			auth.POST("/verify", apiKeyHandler.Verify)
			auth.GET("/access", authHandler.ResolveAccess)
		}

		userAuth := v1.Group("")
		userAuth.Use(sessionMw)
		{
			authUser := userAuth.Group("/auth")
			{
				authUser.GET("/me", authHandler.Me)
				authUser.POST("/logout", authHandler.Logout)
			}

			projects := userAuth.Group("/projects")
			{
				projects.POST("", projectHandler.Create)
				projects.GET("", projectHandler.List)
				projects.GET("/:id", projectHandler.Get)
				projects.PUT("/:id", projectHandler.Update)
				projects.GET("/:id/llm-config", projectHandler.GetLLMConfig)
				projects.PUT("/:id/llm-config", projectHandler.UpdateLLMConfig)
				projects.GET("/:id/models", projectHandler.ListModels)
				projects.POST("/:id/models", projectHandler.CreateModel)
				projects.GET("/:id/models/:model_id", projectHandler.GetModel)
				projects.PUT("/:id/models/:model_id", projectHandler.UpdateModel)
				projects.PATCH("/:id/models/:model_id", projectHandler.UpdateModel)
				projects.DELETE("/:id/models/:model_id", projectHandler.DeleteModel)
				projects.POST("/:id/models/:model_id/test", projectHandler.TestModel)
				projects.POST("/:id/models/:model_id/set-default", projectHandler.SetDefaultModel)
				projects.GET("/:id/members", projectHandler.ListMembers)
				projects.POST("/:id/members", projectHandler.AddMember)
				projects.PUT("/:id/members/:user_id", projectHandler.UpdateMemberRole)
				projects.DELETE("/:id/members/:user_id", projectHandler.RemoveMember)
				projects.DELETE("/:id", projectHandler.Delete)
			}

			apiKeys := userAuth.Group("/api-keys")
			{
				apiKeys.POST("", apiKeyHandler.Generate)
				apiKeys.GET("", apiKeyHandler.List)
				apiKeys.DELETE("/:id", apiKeyHandler.Revoke)
			}
		}

		// Protected endpoint example: validates API key via middleware
		// Other services can use middleware.AuthMiddleware(apiKeyRepo) the same way
		protected := v1.Group("/protected")
		protected.Use(authMw)
		{
			protected.GET("/me", func(c *gin.Context) {
				projectID, _ := middleware.GetProjectIDFromContext(c)
				c.JSON(http.StatusOK, model.SuccessResponse(gin.H{
					"project_id": projectID,
				}))
			})
		}
	}

	internal := r.Group("/api/internal/v1")
	internal.Use(internalMw)
	{
		projects := internal.Group("/projects")
		{
			projects.GET("/:id/models/default/resolved", projectHandler.ResolveDefaultModel)
			projects.GET("/:id/models/:model_id/resolved", projectHandler.ResolveModel)
		}
	}

	log.Printf("auth-service starting on port %s", serverPort)
	if err := r.Run(":" + serverPort); err != nil {
		log.Fatalf("failed to start server: %v", err)
	}
}
