<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="web/public/brand/evalsmith-logo-horizontal-dark.png">
    <img alt="EvalSmith" src="web/public/brand/evalsmith-logo-horizontal-light.png" width="420">
  </picture>
</p>

# EvalSmith

<p align="center">
  <strong>Open-source evaluation and observability platform for AI agent applications.</strong>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README_CN.md">简体中文</a>
</p>

<p align="center">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-green">
  <img alt="Version: 0.1.0" src="https://img.shields.io/badge/version-0.1.0-blue">
  <img alt="Docker Compose" src="https://img.shields.io/badge/deploy-Docker%20Compose-2496ED">
  <img alt="Kubernetes" src="https://img.shields.io/badge/deploy-Kubernetes-326CE5">
</p>

---

EvalSmith helps teams evaluate, observe, and improve AI agent applications. It provides trace ingestion, dataset management, evaluator authoring, experiment runs, annotation workflows, monitoring, and SDKs for integrating agents into evaluation pipelines.

EvalSmith is intended for local trials, private deployments, and self-hosted evaluation workflows.

## Features

- Trace ingestion and agent observability
- Dataset management for evaluation cases
- Evaluator authoring and experiment execution
- Human annotation workflows
- Online monitoring and alerting foundations
- Python, Go, and TypeScript SDKs
- Docker Compose trial deployment
- Kubernetes deployment manifests
- Gateway-facing OpenAPI specification

## Current Status

This repository is prepared as an early open-source release. Package names, Go module paths, environment variables, cookies, and local storage keys use the `evalsmith` namespace.

## Architecture

EvalSmith is composed of a React web application, an Nginx gateway, backend services, asynchronous workers, and supporting infrastructure.

```text
Browser
  -> Gateway / Web
  -> Auth, Trace, Dataset, Annotation, Eval Engine, Monitor APIs
  -> Trace Consumer, Eval Worker, Monitor Worker
  -> PostgreSQL, ClickHouse, Kafka, Redis, MinIO
```

## Repository Layout

```text
deploy/       Docker Compose and Kubernetes deployment assets
docs/         Public API, deployment, and usage documentation
examples/     Demo agent and bootstrap examples
gateway/      Nginx gateway and frontend container build
migrations/   PostgreSQL and ClickHouse migrations
scripts/      Local operations, migration, testing, and release guard scripts
sdks/         Python, Go, and TypeScript SDKs
services/     Backend services
web/          React, Vite, and TypeScript frontend application
workers/      Async workers and consumers
```

## Requirements

For the Docker Compose trial:

- Docker
- Docker Compose plugin
- Make

For local development:

- Go 1.24 recommended
- Python 3.12 recommended
- `uv`
- Node.js 22 recommended
- npm

## Quick Start

Start the single-node trial stack:

```sh
cp deploy/env/trial.env.example deploy/env/trial.env
# Edit deploy/env/trial.env before using it outside local development.
make trial-up
make install-check
```

Then open:

```text
http://127.0.0.1:8080
```

The Docker Compose trial stack creates a local demo account:

```text
Email: demo@evalsmith.local
Login phrase: evalsmith-demo
```

This account is only for local evaluation. Disable it with `EVALSMITH_DEMO_USER_ENABLED=false` or override `EVALSMITH_DEMO_USER_PASSWORD` before exposing the stack outside your machine.

Stop and remove the trial stack:

```sh
make trial-down
```

## Local Development

Start only the infrastructure services:

```sh
make infra-up
make db-migrate
make seed-evaluators
make bootstrap-demo
make doctor
```

Print the canonical service startup order:

```sh
make run-all
```

Then start the listed `make run-*` targets in separate terminals.

## SDKs and API

SDK source code is available under:

```text
sdks/python
sdks/go
sdks/typescript
```

The gateway-facing OpenAPI schema is available at:

```text
docs/api/evalsmith-public.openapi.yaml
```

## Security Configuration

Never commit real credentials. Configure secrets through your local environment, an ignored env file, a secret manager, Docker Compose environment files, or Kubernetes Secrets.

Values that must be replaced for shared or production deployments include:

- `EVALSMITH_SECRET_KEY`
- Database passwords
- `EVALSMITH_INTERNAL_TOKEN`
- MinIO access credentials
- LLM provider API keys
- Registry credentials used by deployment scripts

The example files intentionally use placeholder values such as `__REDACTED_SECRET__`.

## Open Source Checks

Check the current repository before publishing:

```sh
make open-source-check
```

Build a sanitized export directory:

```sh
make open-source-export
```

After creating an export, check the generated export directory:

```sh
make open-source-check-export
```

## Documentation

- Deployment guide: `docs/deployment/README.md`
- Usage guide: `docs/usage/README.md`
- GitHub maintenance guide: `docs/maintenance/GITHUB_MAINTENANCE_CN.md`
- Repository standards: `docs/maintenance/REPOSITORY_STANDARDS_CN.md`
- Contribution guide: `CONTRIBUTING.md`
- Changelog: `CHANGELOG.md`
- Public API schema: `docs/api/evalsmith-public.openapi.yaml`
- Security policy: `SECURITY.md`

## License

EvalSmith is released under the MIT License. See `LICENSE`.
