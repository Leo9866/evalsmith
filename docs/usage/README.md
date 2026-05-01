# EvalSmith Usage Guide

<p align="center">
  <strong>Run EvalSmith locally, connect your agent, collect traces, and run evaluations.</strong>
</p>

<p align="center">
  <a href="../../README.md">README</a> |
  <a href="README.md">English</a> |
  <a href="README_CN.md">简体中文</a>
</p>

---

## Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Access URLs](#access-urls)
- [First-Time Setup](#first-time-setup)
- [Connect an Agent](#connect-an-agent)
- [Run the Demo Workflow](#run-the-demo-workflow)
- [Core Workflows](#core-workflows)
- [Local Development](#local-development)
- [Configuration](#configuration)
- [Operations](#operations)
- [Testing and Validation](#testing-and-validation)
- [Troubleshooting](#troubleshooting)
- [Security Notes](#security-notes)
- [Next Steps](#next-steps)

## Overview

EvalSmith is a self-hosted evaluation and observability platform for AI agent applications. It helps teams:

- collect traces and spans from agent executions;
- build datasets from representative or failed cases;
- define rule-based, code-based, LLM-judge, statistical, and human evaluators;
- run experiments against agent endpoints;
- review human annotations;
- monitor online quality signals and operational behavior.

The default open-source workflow is:

```text
Start EvalSmith
  -> Sign in with the trial demo account or register a local user
  -> Create or select a project
  -> Create an API key
  -> Instrument your agent with an SDK
  -> Send traces
  -> Create datasets and evaluators
  -> Run experiments
  -> Review results and monitor regressions
```

## Prerequisites

For the Docker Compose trial stack:

- Docker Desktop or Docker Engine
- Docker Compose plugin
- Make
- 6 GB or more Docker memory recommended
- 10 GB or more free disk space recommended for the first build

For local service development:

- Go 1.24
- Python 3.12
- `uv`
- Node.js 22
- npm

Check your local Docker setup:

```sh
docker version
docker compose version
```

## Quick Start

Clone the repository and start the single-node trial stack:

```sh
git clone <your-fork-or-repository-url> evalsmith
cd evalsmith
cp deploy/env/trial.env.example deploy/env/trial.env
```

Review `deploy/env/trial.env` before sharing the environment or running outside local development. The example file uses placeholder values and must not be treated as production security configuration.

Start the stack:

```sh
make trial-up
```

On machines with limited Docker memory, use a serialized Compose build:

```sh
COMPOSE_PARALLEL_LIMIT=1 make trial-up
```

Validate the installation:

```sh
make install-check
curl -fsS http://127.0.0.1:8080/health
```

Open the web application:

```text
http://127.0.0.1:8080
```

The Docker Compose trial stack seeds a local demo account for screenshots, demos, and first-run exploration:

```text
Email: demo@evalsmith.local
Login phrase: evalsmith-demo
```

The demo login is intentionally public and local-only. If the stack will be reachable from another machine, set `EVALSMITH_DEMO_USER_ENABLED=false` or configure `EVALSMITH_DEMO_USER_PASSWORD` in `deploy/env/trial.env` before running `make trial-up`.

Stop the stack and remove local trial data:

```sh
make trial-down
```

If you want to stop containers without deleting data volumes, use Docker Compose directly:

```sh
docker compose -f deploy/docker-compose.trial.yml --env-file deploy/env/trial.env down
```

## Access URLs

The trial stack exposes the following local endpoints:

| Component | URL | Notes |
| --- | --- | --- |
| Web and gateway | `http://127.0.0.1:8080` | Main browser entry point |
| Gateway health | `http://127.0.0.1:8080/health` | Returns `ok` |
| Trace service | `http://127.0.0.1:8001` | Trace ingestion and trace queries |
| Eval engine | `http://127.0.0.1:8002` | Evaluators and experiments |
| Dataset service | `http://127.0.0.1:8003` | Datasets and examples |
| Auth service | `http://127.0.0.1:8004` | Users, sessions, projects, API keys |
| Annotation service | `http://127.0.0.1:8005` | Annotation queues and reviews |
| Monitor service | `http://127.0.0.1:8006` | Monitoring rules and signals |
| PostgreSQL | `127.0.0.1:15432` | Application relational data |
| ClickHouse HTTP | `http://127.0.0.1:18123` | Analytics storage HTTP interface |
| ClickHouse native | `127.0.0.1:19000` | Analytics storage native protocol |
| Kafka | `127.0.0.1:19092` | Trace event stream |
| Redis | `127.0.0.1:26379` | Cache and background coordination |
| MinIO API | `http://127.0.0.1:19100` | Object storage API |
| MinIO console | `http://127.0.0.1:19101` | Object storage console |

Health-check all public services:

```sh
for url in \
  http://127.0.0.1:8080/health \
  http://127.0.0.1:8001/health \
  http://127.0.0.1:8002/health \
  http://127.0.0.1:8003/health \
  http://127.0.0.1:8004/health \
  http://127.0.0.1:8005/health \
  http://127.0.0.1:8006/health
do
  printf "%s -> " "$url"
  curl -fsS --max-time 15 "$url"
  printf "\n"
done
```

## First-Time Setup

1. Open `http://127.0.0.1:8080`.
2. Sign in with the trial demo account, or register a local user account.
3. Create or select a project.
4. Open the project settings page.
5. Create an API key for SDK ingestion.
6. Store the API key in your local shell or secret manager.

Recommended local SDK environment:

```sh
export EVALSMITH_BASE_URL=http://127.0.0.1:8080
export EVALSMITH_PROJECT=<project-id>
export EVALSMITH_API_KEY=__REDACTED_SECRET__
```

For local development against service ports instead of the gateway:

```sh
export EVALSMITH_TRACE_URL=http://127.0.0.1:8001
export EVALSMITH_DATASET_URL=http://127.0.0.1:8003
export EVALSMITH_EVAL_URL=http://127.0.0.1:8002
export EVALSMITH_AUTH_URL=http://127.0.0.1:8004
export EVALSMITH_PROJECT=<project-id>
export EVALSMITH_API_KEY=__REDACTED_SECRET__
```

## Connect an Agent

### Python Trace Instrumentation

Use the local Python SDK from the repository:

```sh
PYTHONPATH=sdks/python python - <<'PY'
import os

import evalsmith

evalsmith.init(
    api_key=os.getenv("EVALSMITH_API_KEY"),
    project=os.getenv("EVALSMITH_PROJECT", "proj_default"),
    base_url=os.getenv("EVALSMITH_BASE_URL", "http://127.0.0.1:8080"),
)

with evalsmith.Trace(
    name="support_agent_request",
    tags=["demo", "manual"],
    metadata={"source": "usage-guide"},
) as trace:
    with trace.span("retrieve_context", span_type="retrieval") as span:
        span.set_input({"query": "How do I change my plan?"})
        span.set_output({"documents": ["Billing changes apply on the next invoice."]})

    with trace.span("generate_answer", span_type="llm") as span:
        span.set_input({"prompt": "Answer the customer question."})
        span.set_output({"answer": "Plan changes apply on your next invoice."})
        span.set_model("example-model", token_input=12, token_output=9, cost_usd=0.0)

evalsmith.get_client().shutdown()
print("Sent trace:", trace.trace_id)
PY
```

Then open the Traces page in the web application.

### TypeScript Trace Ingestion

Use the TypeScript SDK source from `sdks/typescript`:

```ts
import { EvalSmithClient, TraceBuilder } from './sdks/typescript/src/index'

const client = new EvalSmithClient({
  baseUrl: 'http://127.0.0.1:8080',
  project: process.env.EVALSMITH_PROJECT,
  apiKey: process.env.EVALSMITH_API_KEY,
})

const trace = new TraceBuilder('typescript_agent_request', {
  tags: ['demo', 'typescript'],
  metadata: { source: 'usage-guide' },
})

trace.addSpan({
  name: 'tool_call',
  span_type: 'tool',
  status: 'ok',
  input: { tool: 'search' },
  output: { result_count: 3 },
})

await client.ingestTrace(trace.toJSON())
```

## Run the Demo Workflow

EvalSmith includes a deterministic demo agent and a bootstrap script that creates a dataset and runs an experiment.

Start the demo agent in one terminal:

```sh
PYTHONPATH=sdks/python \
EVALSMITH_BASE_URL=http://127.0.0.1:8080 \
EVALSMITH_PROJECT=<project-id> \
EVALSMITH_API_KEY=__REDACTED_SECRET__ \
python examples/demo-agent/app.py
```

Run the bootstrap and evaluation workflow in another terminal:

```sh
PYTHONPATH=sdks/python \
EVALSMITH_BASE_URL=http://127.0.0.1:8080 \
EVALSMITH_PROJECT=<project-id> \
EVALSMITH_API_KEY=__REDACTED_SECRET__ \
python examples/demo-agent/bootstrap_demo.py
```

The demo workflow:

- creates or reuses a dataset named `Support QA Demo`;
- inserts deterministic examples;
- runs an experiment against the demo agent;
- uses the built-in `exact_match` and `not_empty` evaluators;
- sends traces for agent calls.

## Core Workflows

### Traces

Use traces to inspect agent execution behavior.

Typical flow:

1. Instrument the agent with an SDK.
2. Send traces with spans for retrieval, tool calls, model calls, and final responses.
3. Open the Traces page.
4. Inspect latency, token usage, errors, inputs, outputs, and metadata.
5. Promote interesting or failed cases into datasets.

### Datasets

Datasets store examples used for regression tests and experiments.

Recommended example shape:

```json
{
  "inputs": {
    "input": "How should I handle a billing plan change?"
  },
  "expected_outputs": "Billing changes apply on the next invoice.",
  "metadata": {
    "topic": "billing"
  },
  "split": "default"
}
```

### Evaluators

Evaluators score experiment outputs. EvalSmith supports multiple evaluator styles:

- exact-match and deterministic rule checks;
- non-empty and shape checks;
- code evaluators;
- LLM judge evaluators;
- statistical evaluators;
- human feedback and annotation-derived scores.

When using LLM judge evaluators, configure provider credentials through project settings or secret-backed deployment configuration. Do not commit provider API keys.

### Experiments

Experiments run a dataset against an agent endpoint.

Typical flow:

1. Create a dataset.
2. Select evaluators.
3. Configure target URL, method, headers, body template, response path, timeout, and concurrency.
4. Run the experiment.
5. Compare average scores, pass rates, failures, and regressions.

### Annotation

Annotation workflows help humans review outputs and produce feedback.

Use annotation when:

- automatic scoring is insufficient;
- quality depends on judgment or policy interpretation;
- you need reviewer labels for future evaluator design.

### Monitoring

Monitoring is intended for ongoing online quality checks.

Use it to define rules, observe signals, and connect evaluation findings back to production behavior.

## Local Development

Use local development mode when you want to edit services directly rather than run everything inside trial containers.

Start infrastructure only:

```sh
make infra-up
make db-migrate
make seed-evaluators
make bootstrap-demo
make doctor
```

Print the recommended service startup order:

```sh
make run-all
```

Start services in separate terminals:

```sh
make run-auth-service
make run-trace-service
make run-trace-consumer
make run-dataset-service
make run-annotation-service
make run-eval-engine
make run-eval-worker
make run-monitor-service
make run-monitor-worker
make run-web
```

Frontend development server:

```sh
cd web
npm install
npm run dev
```

Frontend production build:

```sh
cd web
npm run build
```

## Configuration

### Runtime Variables

| Variable | Purpose | Typical local value |
| --- | --- | --- |
| `EVALSMITH_BASE_URL` | Gateway URL used by SDKs | `http://127.0.0.1:8080` |
| `EVALSMITH_API_KEY` | API key for SDK requests | Generated in project settings |
| `EVALSMITH_PROJECT` | Project ID used by SDK requests | Project selected in the UI |
| `EVALSMITH_TRACE_URL` | Direct trace service URL | `http://127.0.0.1:8001` |
| `EVALSMITH_DATASET_URL` | Direct dataset service URL | `http://127.0.0.1:8003` |
| `EVALSMITH_EVAL_URL` | Direct eval engine URL | `http://127.0.0.1:8002` |
| `EVALSMITH_AUTH_URL` | Direct auth service URL | `http://127.0.0.1:8004` |
| `EVALSMITH_TRACING` | Enable or disable SDK tracing | `true` |
| `EVALSMITH_BATCH_SIZE` | SDK trace batch size | `50` |
| `EVALSMITH_FLUSH_INTERVAL` | SDK flush interval in seconds | `2.0` |

### Trial Environment File

The Docker Compose trial environment is configured through:

```text
deploy/env/trial.env
```

Create it from:

```text
deploy/env/trial.env.example
```

Replace placeholder values before using the stack in shared environments:

- `EVALSMITH_SECRET_KEY`
- `EVALSMITH_INTERNAL_TOKEN`
- `EVALSMITH_PG_PASSWORD`
- `EVALSMITH_CLICKHOUSE_PASSWORD`
- `EVALSMITH_MINIO_ROOT_PASSWORD`
- any provider API key used by LLM judge evaluators

The trial demo user is controlled by:

- `EVALSMITH_DEMO_USER_ENABLED`
- `EVALSMITH_DEMO_USER_EMAIL`
- `EVALSMITH_DEMO_USER_NAME`
- `EVALSMITH_DEMO_USER_PASSWORD`

Disable the demo user or override its login phrase before exposing the trial stack outside local development.

The `.env` file used for local secrets should remain untracked.

## Operations

Show container status:

```sh
docker compose -f deploy/docker-compose.trial.yml --env-file deploy/env/trial.env ps
```

Show logs for all services:

```sh
docker compose -f deploy/docker-compose.trial.yml --env-file deploy/env/trial.env logs -f
```

Show logs for one service:

```sh
docker compose -f deploy/docker-compose.trial.yml --env-file deploy/env/trial.env logs -f trace-service
```

Restart one service:

```sh
docker compose -f deploy/docker-compose.trial.yml --env-file deploy/env/trial.env restart trace-service
```

Stop the stack but keep volumes:

```sh
docker compose -f deploy/docker-compose.trial.yml --env-file deploy/env/trial.env down
```

Stop the stack and remove volumes:

```sh
docker compose -f deploy/docker-compose.trial.yml --env-file deploy/env/trial.env down -v
```

Rebuild one service image:

```sh
docker compose -f deploy/docker-compose.trial.yml --env-file deploy/env/trial.env build gateway
```

## Testing and Validation

Open-source guard:

```sh
make open-source-check
```

Docker Compose config validation:

```sh
docker compose -f deploy/docker-compose.trial.yml --env-file deploy/env/trial.env.example config -q
```

Install check after starting the trial stack:

```sh
make install-check
```

Full test target:

```sh
make test-ci
```

The full test target includes service tests and web smoke tests. Browser-based smoke tests require the web test dependencies and a suitable local browser runtime.

## Troubleshooting

### The first build is slow

The first full Docker build compiles Go services and installs Python and frontend dependencies. This can take several minutes.

Use serialized builds on constrained machines:

```sh
COMPOSE_PARALLEL_LIMIT=1 make trial-up
```

You can also increase Docker Desktop memory and CPU allocation.

### A Go build is killed during Docker build

This usually means Docker ran out of memory while compiling a large dependency graph.

Try:

```sh
COMPOSE_PARALLEL_LIMIT=1 make trial-up
```

If needed, free Docker build cache:

```sh
docker builder prune
```

### Docker Hub or registry access fails

The Compose file supports image overrides in `deploy/env/trial.env`:

```sh
EVALSMITH_PYTHON_BASE_IMAGE=python:3.12-slim
EVALSMITH_GOLANG_BASE_IMAGE=golang:1.24-alpine
EVALSMITH_NODE_BASE_IMAGE=node:22-alpine
EVALSMITH_NGINX_BASE_IMAGE=nginx:1.27-alpine
EVALSMITH_POSTGRES_IMAGE=postgres:15-alpine
EVALSMITH_CLICKHOUSE_IMAGE=clickhouse/clickhouse-server:24.3
EVALSMITH_KAFKA_IMAGE=apache/kafka:3.9.0
EVALSMITH_REDIS_IMAGE=redis:7-alpine
EVALSMITH_MINIO_IMAGE=minio/minio:latest
```

Point these values to an internal registry or pre-pulled local tags when working in restricted networks.

### The web page opens but APIs fail

Check gateway and service logs:

```sh
docker compose -f deploy/docker-compose.trial.yml --env-file deploy/env/trial.env logs -f gateway
docker compose -f deploy/docker-compose.trial.yml --env-file deploy/env/trial.env logs -f auth-service trace-service dataset-service eval-engine
```

Then verify service health:

```sh
curl -fsS http://127.0.0.1:8001/health
curl -fsS http://127.0.0.1:8002/health
curl -fsS http://127.0.0.1:8003/health
curl -fsS http://127.0.0.1:8004/health
```

### Traces do not appear

Check:

- `EVALSMITH_PROJECT` matches the selected project;
- `EVALSMITH_API_KEY` is set when authentication is required;
- SDK URLs point to the gateway or the correct service ports;
- the application process calls `evalsmith.get_client().shutdown()` before exiting short scripts;
- `trace-service`, `trace-consumer`, Kafka, ClickHouse, and MinIO are running.

### Reset local trial data

```sh
make trial-down
make trial-up
```

This removes Docker volumes used by the trial stack.

## Security Notes

Never commit real credentials, customer data, private endpoints, internal runbooks, or production environment files.

For shared or production deployments:

- rotate all placeholder values;
- use a secret manager or Kubernetes Secrets;
- restrict exposed ports;
- put the gateway behind TLS;
- configure backup and retention policies;
- review API key ownership and project membership;
- keep provider API keys out of source control and logs.

Before publishing a repository snapshot:

```sh
make open-source-check
```

## Next Steps

- Review the deployment guide: [`../deployment/README.md`](../deployment/README.md)
- Review the public API schema: [`../api/evalsmith-public.openapi.yaml`](../api/evalsmith-public.openapi.yaml)
- Review the security policy: [`../../SECURITY.md`](../../SECURITY.md)
- Explore SDK source code: [`../../sdks`](../../sdks)
- Explore the demo agent: [`../../examples/demo-agent`](../../examples/demo-agent)
