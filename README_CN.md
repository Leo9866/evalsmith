<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="web/public/brand/evalsmith-logo-horizontal-dark.png">
    <img alt="EvalSmith" src="web/public/brand/evalsmith-logo-horizontal-light.png" width="420">
  </picture>
</p>

# EvalSmith

<p align="center">
  <strong>面向 AI Agent 应用的开源评测与可观测性平台。</strong>
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

EvalSmith 是一个面向 AI Agent 应用的开源评测与可观测性平台。它提供 Trace 采集、数据集管理、评测器编排、实验运行、人工标注、监控能力，以及用于接入评测流水线的 SDK。

EvalSmith 适合本地试用、私有化部署和自托管评测场景。

## 产品界面预览

下面的动态 PNG 展示了 EvalSmith 的主要使用流程，包括登录、总览、Trace、Dataset、Evaluator、Prompt、Experiment、标注、监控和设置页面。

![EvalSmith 界面预览](docs/assets/evalsmith-ui-tour.png)

## 核心能力

- Agent Trace 采集与可观测性
- 评测数据集管理
- 评测器配置与实验执行
- 人工标注工作流
- 在线监控与告警基础能力
- Python、Go、TypeScript SDK
- Docker Compose 试用部署
- Kubernetes 部署清单
- 面向网关的 OpenAPI 规范

## 当前状态

这个仓库已经按早期开源版本进行整理。SDK 包名、Go module 路径、环境变量、Cookie 和 localStorage key 都统一使用 `evalsmith` 命名空间。

## 架构概览

EvalSmith 由 React 前端、Nginx 网关、后端服务、异步 worker 和基础设施组件组成。

```text
Browser
  -> Gateway / Web
  -> Auth, Trace, Dataset, Annotation, Eval Engine, Monitor APIs
  -> Trace Consumer, Eval Worker, Monitor Worker
  -> PostgreSQL, ClickHouse, Kafka, Redis, MinIO
```

## 仓库结构

```text
deploy/       Docker Compose 和 Kubernetes 部署资源
docs/         公开 API、部署和使用文档
examples/     Demo agent 与初始化示例
gateway/      Nginx 网关和前端容器构建
migrations/   PostgreSQL 和 ClickHouse 迁移脚本
scripts/      本地运维、迁移、测试和开源检查脚本
sdks/         Python、Go、TypeScript SDK
services/     后端服务
web/          React、Vite、TypeScript 前端应用
workers/      异步 worker 和消费者
```

## 环境要求

Docker Compose 试用部署需要：

- Docker
- Docker Compose plugin
- Make

本地开发建议使用：

- Go 1.24
- Python 3.12
- `uv`
- Node.js 22
- npm

## 快速开始

启动单机试用环境：

```sh
cp deploy/env/trial.env.example deploy/env/trial.env
# 如果不是仅在本地开发使用，请先修改 deploy/env/trial.env 中的占位密钥。
make trial-up
make install-check
```

启动完成后访问：

```text
http://127.0.0.1:8080
```

Docker Compose 试用环境会创建一个本地 demo 账号：

```text
账号: demo@evalsmith.local
登录口令: evalsmith-demo
```

这个账号只用于本地体验。如果要把服务暴露到本机以外的网络，请先通过 `EVALSMITH_DEMO_USER_ENABLED=false` 关闭，或通过 `EVALSMITH_DEMO_USER_PASSWORD` 覆盖登录口令。

停止并清理试用环境：

```sh
make trial-down
```

## 本地开发

只启动基础设施：

```sh
make infra-up
make db-migrate
make seed-evaluators
make bootstrap-demo
make doctor
```

查看推荐的服务启动顺序：

```sh
make run-all
```

然后按照输出提示，在不同终端中分别启动对应的 `make run-*` 目标。

## SDK 与 API

SDK 源码位于：

```text
sdks/python
sdks/go
sdks/typescript
```

面向网关的 OpenAPI 文件位于：

```text
docs/api/evalsmith-public.openapi.yaml
```

## 安全配置

不要提交真实凭证。密钥应通过本地环境变量、被忽略的 env 文件、密钥管理系统、Docker Compose 环境文件或 Kubernetes Secret 配置。

共享环境或生产环境中必须替换的配置包括：

- `EVALSMITH_SECRET_KEY`
- 数据库密码
- `EVALSMITH_INTERNAL_TOKEN`
- MinIO 访问凭证
- LLM 服务商 API key
- 部署脚本使用的镜像仓库凭证

示例文件会刻意使用 `__REDACTED_SECRET__` 这类占位值。

## 开源检查

发布前检查当前仓库：

```sh
make open-source-check
```

生成清理后的导出目录：

```sh
make open-source-export
```

生成导出目录后，检查导出结果：

```sh
make open-source-check-export
```

## 文档

- 部署文档：`docs/deployment/README.md`
- 使用文档：`docs/usage/README_CN.md`
- GitHub 维护规范：`docs/maintenance/GITHUB_MAINTENANCE_CN.md`
- 仓库管理标准：`docs/maintenance/REPOSITORY_STANDARDS_CN.md`
- 贡献指南：`CONTRIBUTING.md`
- 更新日志：`CHANGELOG.md`
- 公开 API 规范：`docs/api/evalsmith-public.openapi.yaml`
- 安全策略：`SECURITY.md`

## 许可证

EvalSmith 使用 MIT License 开源，详见 `LICENSE`。
