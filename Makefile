.PHONY: infra-up infra-down infra-reset db-migrate seed-evaluators bootstrap-demo run-llm-regression \
       run-trace-service run-dataset-service run-eval-engine run-auth-service run-web \
       run-trace-consumer run-demo-agent run-annotation-service run-eval-worker \
       run-monitor-service run-monitor-worker doctor test-ci run-all trial-up trial-down install-check \
       open-source-export open-source-check open-source-check-export

EVALSMITH_PG_PORT ?= 15432
EVALSMITH_CH_HTTP_PORT ?= 18123
EVALSMITH_CH_NATIVE_PORT ?= 19000
EVALSMITH_KAFKA_PORT ?= 19092
EVALSMITH_REDIS_PORT ?= 26379
EVALSMITH_MINIO_API_PORT ?= 19100
EVALSMITH_MINIO_CONSOLE_PORT ?= 19101
EVALSMITH_INTERNAL_TOKEN ?= __REDACTED_SECRET__
EVALSMITH_SECRET_KEY ?= __REDACTED_SECRET__
TRIAL_ENV_FILE ?= deploy/env/trial.env

GO_DB_ENV = DB_HOST=127.0.0.1 DB_PORT=$(EVALSMITH_PG_PORT) DB_USER=evalsmith DB_PASSWORD=__REDACTED_SECRET__ DB_NAME=evalsmith DB_SCHEMA=public
AUTH_SHARED_ENV = AUTH_SERVICE_URL=http://127.0.0.1:8004 EVALSMITH_INTERNAL_TOKEN=$(EVALSMITH_INTERNAL_TOKEN)
EVAL_DB_ENV = PG_HOST=127.0.0.1 PG_PORT=$(EVALSMITH_PG_PORT) PG_USER=evalsmith PG_PASSWORD=__REDACTED_SECRET__ PG_DATABASE=evalsmith PG_SCHEMA=public DATASET_SERVICE_URL=http://127.0.0.1:8003 $(AUTH_SHARED_ENV)
TRACE_ENV = KAFKA_BROKERS=127.0.0.1:$(EVALSMITH_KAFKA_PORT) CLICKHOUSE_ADDR=127.0.0.1:$(EVALSMITH_CH_NATIVE_PORT) MINIO_ENDPOINT=127.0.0.1:$(EVALSMITH_MINIO_API_PORT) MINIO_ACCESS_KEY=__REDACTED_SECRET__ MINIO_SECRET_KEY=__REDACTED_SECRET__ MINIO_BUCKET=trace-payloads DATASET_SERVICE_URL=http://127.0.0.1:8003 ANNOTATION_SERVICE_URL=http://127.0.0.1:8005 $(AUTH_SHARED_ENV)
MONITOR_ENV = PG_HOST=127.0.0.1 PG_PORT=$(EVALSMITH_PG_PORT) PG_USER=evalsmith PG_PASSWORD=__REDACTED_SECRET__ PG_DATABASE=evalsmith PG_SCHEMA=public TRACE_SERVICE_URL=http://127.0.0.1:8001 EVAL_ENGINE_URL=http://127.0.0.1:8002 $(AUTH_SHARED_ENV)
SDK_ENV = EVALSMITH_TRACE_URL=http://127.0.0.1:8001 EVALSMITH_DATASET_URL=http://127.0.0.1:8003 EVALSMITH_EVAL_URL=http://127.0.0.1:8002 EVALSMITH_AUTH_URL=http://127.0.0.1:8004 EVALSMITH_PROJECT=proj_default
EVAL_PY_DEPS = --with fastapi --with "uvicorn[standard]" --with pydantic --with pydantic-settings --with asyncpg --with httpx --with jsonschema
MONITOR_PY_DEPS = --with fastapi --with "uvicorn[standard]" --with pydantic --with pydantic-settings --with asyncpg --with httpx
PY_SERVICE_FLAGS ?=

# ========== Infrastructure ==========
infra-up:
	EVALSMITH_PG_PORT=$(EVALSMITH_PG_PORT) \
	EVALSMITH_CH_HTTP_PORT=$(EVALSMITH_CH_HTTP_PORT) \
	EVALSMITH_CH_NATIVE_PORT=$(EVALSMITH_CH_NATIVE_PORT) \
	EVALSMITH_KAFKA_PORT=$(EVALSMITH_KAFKA_PORT) \
	EVALSMITH_REDIS_PORT=$(EVALSMITH_REDIS_PORT) \
	EVALSMITH_MINIO_API_PORT=$(EVALSMITH_MINIO_API_PORT) \
	EVALSMITH_MINIO_CONSOLE_PORT=$(EVALSMITH_MINIO_CONSOLE_PORT) \
	docker compose -f deploy/docker-compose.dev.yml up -d

infra-down:
	EVALSMITH_PG_PORT=$(EVALSMITH_PG_PORT) \
	EVALSMITH_CH_HTTP_PORT=$(EVALSMITH_CH_HTTP_PORT) \
	EVALSMITH_CH_NATIVE_PORT=$(EVALSMITH_CH_NATIVE_PORT) \
	EVALSMITH_KAFKA_PORT=$(EVALSMITH_KAFKA_PORT) \
	EVALSMITH_REDIS_PORT=$(EVALSMITH_REDIS_PORT) \
	EVALSMITH_MINIO_API_PORT=$(EVALSMITH_MINIO_API_PORT) \
	EVALSMITH_MINIO_CONSOLE_PORT=$(EVALSMITH_MINIO_CONSOLE_PORT) \
	docker compose -f deploy/docker-compose.dev.yml down

infra-reset: infra-down
	EVALSMITH_PG_PORT=$(EVALSMITH_PG_PORT) \
	EVALSMITH_CH_HTTP_PORT=$(EVALSMITH_CH_HTTP_PORT) \
	EVALSMITH_CH_NATIVE_PORT=$(EVALSMITH_CH_NATIVE_PORT) \
	EVALSMITH_KAFKA_PORT=$(EVALSMITH_KAFKA_PORT) \
	EVALSMITH_REDIS_PORT=$(EVALSMITH_REDIS_PORT) \
	EVALSMITH_MINIO_API_PORT=$(EVALSMITH_MINIO_API_PORT) \
	EVALSMITH_MINIO_CONSOLE_PORT=$(EVALSMITH_MINIO_CONSOLE_PORT) \
	docker compose -f deploy/docker-compose.dev.yml down -v
	$(MAKE) infra-up
	sleep 5
	$(MAKE) db-migrate

# ========== Database ==========
db-migrate:
	EVALSMITH_PG_HOST=127.0.0.1 EVALSMITH_PG_PORT=$(EVALSMITH_PG_PORT) EVALSMITH_PG_USER=evalsmith EVALSMITH_PG_PASSWORD=__REDACTED_SECRET__ EVALSMITH_PG_DATABASE=evalsmith EVALSMITH_PG_SCHEMA=public EVALSMITH_CH_HOST=127.0.0.1 EVALSMITH_CH_HTTP_PORT=$(EVALSMITH_CH_HTTP_PORT) \
	uv run --python 3.12 --with asyncpg --with httpx python scripts/migrate_dev_stack.py

doctor:
	bash scripts/doctor.sh

seed-evaluators:
	cd services/eval-engine && PYTHONPATH=. $(EVAL_DB_ENV) uv run --no-project --python 3.12 $(EVAL_PY_DEPS) python -m app.scripts.seed_builtin_evaluators

bootstrap-demo:
	$(SDK_ENV) python examples/demo-agent/bootstrap_demo.py

run-llm-regression:
	$(SDK_ENV) uv run --python 3.12 --with httpx python scripts/run_llm_regression.py

# ========== Services ==========
run-auth-service:
	cd services/auth-service && $(GO_DB_ENV) EVALSMITH_SECRET_KEY=$(EVALSMITH_SECRET_KEY) EVALSMITH_INTERNAL_SERVICE_TOKEN=$(EVALSMITH_INTERNAL_TOKEN) go run cmd/server/main.go

run-trace-service:
	cd services/trace-service && $(TRACE_ENV) go run cmd/server/main.go

run-trace-consumer:
	cd workers/trace-consumer && $(TRACE_ENV) go run cmd/consumer/main.go

run-dataset-service:
	cd services/dataset-service && $(GO_DB_ENV) $(AUTH_SHARED_ENV) go run cmd/server/main.go

run-annotation-service:
	cd services/annotation-service && $(GO_DB_ENV) $(AUTH_SHARED_ENV) go run cmd/server/main.go

run-eval-engine:
	cd services/eval-engine && PYTHONPATH=. $(EVAL_DB_ENV) uv run --no-project --python 3.12 $(EVAL_PY_DEPS) uvicorn app.main:app --host 0.0.0.0 --port 8002 $(PY_SERVICE_FLAGS)

run-eval-worker:
	PYTHONPATH=services/eval-engine $(EVAL_DB_ENV) uv run --no-project --python 3.12 $(EVAL_PY_DEPS) python workers/eval-worker/main.py

run-monitor-service:
	cd services/monitor-service && PYTHONPATH=. $(MONITOR_ENV) uv run --no-project --python 3.12 $(MONITOR_PY_DEPS) uvicorn app.main:app --host 0.0.0.0 --port 8006 $(PY_SERVICE_FLAGS)

run-monitor-worker:
	$(MONITOR_ENV) uv run --no-project --python 3.12 $(MONITOR_PY_DEPS) python workers/monitor-worker/main.py

run-web:
	cd web && npm run dev

test-ci:
	cd services/auth-service && go test ./...
	cd services/trace-service && go test ./...
	cd services/dataset-service && go test ./...
	cd services/annotation-service && go test ./...
	cd services/eval-engine && PYTHONPATH=. uv run --no-project --python 3.12 $(EVAL_PY_DEPS) --with pytest --with pytest-asyncio pytest app/tests
	cd services/monitor-service && PYTHONPATH=. uv run --no-project --python 3.12 $(MONITOR_PY_DEPS) --with pytest --with pytest-asyncio pytest app/tests
	cd sdks/python && PYTHONPATH=. uv run --no-project --python 3.12 --with httpx --with pytest pytest tests
	cd web && npm run test:smoke

trial-up:
	@env_file="$(TRIAL_ENV_FILE)"; \
	if [ ! -f "$$env_file" ]; then env_file="deploy/env/trial.env.example"; fi; \
	docker compose -f deploy/docker-compose.trial.yml --env-file "$$env_file" up -d --build

trial-down:
	@env_file="$(TRIAL_ENV_FILE)"; \
	if [ ! -f "$$env_file" ]; then env_file="deploy/env/trial.env.example"; fi; \
	docker compose -f deploy/docker-compose.trial.yml --env-file "$$env_file" down -v

install-check:
	@env_file="$(TRIAL_ENV_FILE)"; \
	if [ ! -f "$$env_file" ]; then env_file="deploy/env/trial.env.example"; fi; \
	set -a; . "$$env_file"; set +a; \
	bash scripts/install-check.sh

open-source-export:
	python3 scripts/open_source_guard.py export

open-source-check:
	python3 scripts/open_source_guard.py check .

open-source-check-export:
	python3 scripts/open_source_guard.py check

run-demo-agent:
	PYTHONPATH=sdks/python $(SDK_ENV) python examples/demo-agent/app.py

run-all:
	@echo "Canonical local startup order:"
	@echo "  1. make infra-up"
	@echo "  2. make db-migrate"
	@echo "  3. make seed-evaluators"
	@echo "  4. make bootstrap-demo"
	@echo "  5. make doctor"
	@echo ""
	@echo "Then start services in separate terminals:"
	@echo "  make run-auth-service       # :8004"
	@echo "  make run-trace-service      # :8001"
	@echo "  make run-trace-consumer"
	@echo "  make run-dataset-service    # :8003"
	@echo "  make run-annotation-service # :8005"
	@echo "  make run-eval-engine        # :8002"
	@echo "  make run-eval-worker"
	@echo "  make run-monitor-service    # :8006"
	@echo "  make run-monitor-worker"
	@echo "  make run-demo-agent         # :8010"
	@echo "  make run-web                # :3000"
