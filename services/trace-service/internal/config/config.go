package config

import "os"

type Config struct {
	Port                 string
	StorageMode          string
	LocalStorePath       string
	DefaultProjectID     string
	AuthServiceURL       string
	InternalServiceToken string
	DatasetServiceURL    string
	AnnotationServiceURL string
	KafkaBrokers         string
	KafkaTopic           string
	ClickHouseAddr       string
	ClickHouseDB         string
	ClickHouseUser       string
	ClickHousePass       string
	MinIOEndpoint        string
	MinIOAccessKey       string
	MinIOSecretKey       string
	MinIOBucket          string
	MinIOUseSSL          bool
}

func Load() *Config {
	return &Config{
		Port:                 getEnv("PORT", "8001"),
		StorageMode:          getEnv("TRACE_STORAGE_MODE", "auto"),
		LocalStorePath:       getEnv("TRACE_LOCAL_STORE_PATH", "./data/trace-store.json"),
		DefaultProjectID:     getEnv("TRACE_DEFAULT_PROJECT_ID", "proj_default"),
		AuthServiceURL:       getEnv("AUTH_SERVICE_URL", "http://127.0.0.1:8004"),
		InternalServiceToken: getEnv("EVALSMITH_INTERNAL_TOKEN", ""),
		DatasetServiceURL:    getEnv("DATASET_SERVICE_URL", "http://127.0.0.1:8003"),
		AnnotationServiceURL: getEnv("ANNOTATION_SERVICE_URL", "http://127.0.0.1:8005"),
		KafkaBrokers:         getEnv("KAFKA_BROKERS", "localhost:9092"),
		KafkaTopic:           getEnv("KAFKA_TOPIC", "traces.raw"),
		ClickHouseAddr:       getEnv("CLICKHOUSE_ADDR", "localhost:9000"),
		ClickHouseDB:         getEnv("CLICKHOUSE_DATABASE", "evalsmith"),
		ClickHouseUser:       getEnv("CLICKHOUSE_USER", "default"),
		ClickHousePass:       getEnv("CLICKHOUSE_PASSWORD", ""),
		MinIOEndpoint:        getEnv("MINIO_ENDPOINT", "localhost:9100"),
		MinIOAccessKey:       getEnv("MINIO_ACCESS_KEY", "__REDACTED_SECRET__"),
		MinIOSecretKey:       getEnv("MINIO_SECRET_KEY", "__REDACTED_SECRET__"),
		MinIOBucket:          getEnv("MINIO_BUCKET", "trace-payloads"),
		MinIOUseSSL:          getEnv("MINIO_USE_SSL", "false") == "true",
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
