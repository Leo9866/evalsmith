package config

import "os"

type Config struct {
	KafkaBrokers   string
	KafkaTopic     string
	KafkaGroupID   string
	ClickHouseAddr string
	ClickHouseDB   string
	ClickHouseUser string
	ClickHousePass string
	MinIOEndpoint  string
	MinIOAccessKey string
	MinIOSecretKey string
	MinIOBucket    string
	MinIOUseSSL    bool
}

func Load() *Config {
	return &Config{
		KafkaBrokers:   getEnv("KAFKA_BROKERS", "localhost:9092"),
		KafkaTopic:     getEnv("KAFKA_TOPIC", "traces.raw"),
		KafkaGroupID:   getEnv("KAFKA_GROUP_ID", "trace-consumer"),
		ClickHouseAddr: getEnv("CLICKHOUSE_ADDR", "localhost:9000"),
		ClickHouseDB:   getEnv("CLICKHOUSE_DATABASE", "evalsmith"),
		ClickHouseUser: getEnv("CLICKHOUSE_USER", "default"),
		ClickHousePass: getEnv("CLICKHOUSE_PASSWORD", ""),
		MinIOEndpoint:  getEnv("MINIO_ENDPOINT", "localhost:9100"),
		MinIOAccessKey: getEnv("MINIO_ACCESS_KEY", "__REDACTED_SECRET__"),
		MinIOSecretKey: getEnv("MINIO_SECRET_KEY", "__REDACTED_SECRET__"),
		MinIOBucket:    getEnv("MINIO_BUCKET", "trace-payloads"),
		MinIOUseSSL:    getEnv("MINIO_USE_SSL", "false") == "true",
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
