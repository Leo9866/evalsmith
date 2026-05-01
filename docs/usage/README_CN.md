# EvalSmith 使用文档

<p align="center">
  <strong>本地启动 EvalSmith、接入 Agent、采集 Trace，并运行评测实验。</strong>
</p>

<p align="center">
  <a href="../../README_CN.md">README 中文版</a> |
  <a href="README.md">English</a> |
  <a href="README_CN.md">简体中文</a>
</p>

---

## 目录

- [概览](#概览)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [访问地址](#访问地址)
- [首次配置](#首次配置)
- [接入 Agent](#接入-agent)
- [运行 Demo 工作流](#运行-demo-工作流)
- [核心使用流程](#核心使用流程)
- [本地开发](#本地开发)
- [配置说明](#配置说明)
- [常用运维命令](#常用运维命令)
- [测试与校验](#测试与校验)
- [故障排查](#故障排查)
- [安全注意事项](#安全注意事项)
- [后续阅读](#后续阅读)

## 概览

EvalSmith 是一个面向 AI Agent 应用的自托管评测与可观测性平台。它可以帮助团队：

- 采集 Agent 执行过程中的 Trace 和 Span；
- 从典型样本或失败案例中构建评测数据集；
- 配置规则型、代码型、LLM Judge、统计型和人工评测器；
- 针对 Agent 接口运行实验；
- 管理人工标注工作流；
- 监控线上质量信号和运行行为。

推荐的默认使用流程是：

```text
启动 EvalSmith
  -> 使用 trial demo 账号登录，或注册本地用户
  -> 创建或选择项目
  -> 创建 API Key
  -> 使用 SDK 接入 Agent
  -> 发送 Trace
  -> 创建数据集和评测器
  -> 运行实验
  -> 查看结果并监控回归
```

## 环境要求

Docker Compose 单机试用环境需要：

- Docker Desktop 或 Docker Engine
- Docker Compose plugin
- Make
- 建议 Docker 可用内存不低于 6 GB
- 首次构建建议保留 10 GB 以上可用磁盘空间

本地开发建议使用：

- Go 1.24
- Python 3.12
- `uv`
- Node.js 22
- npm

检查本地 Docker 环境：

```sh
docker version
docker compose version
```

## 快速开始

克隆仓库并启动单机试用环境：

```sh
git clone <your-fork-or-repository-url> evalsmith
cd evalsmith
cp deploy/env/trial.env.example deploy/env/trial.env
```

如果不是仅在本机开发使用，请先检查并修改 `deploy/env/trial.env`。示例文件中的密钥都是占位值，不能当作生产安全配置使用。

启动完整服务：

```sh
make trial-up
```

如果 Docker 内存较小，建议使用串行构建：

```sh
COMPOSE_PARALLEL_LIMIT=1 make trial-up
```

验证安装：

```sh
make install-check
curl -fsS http://127.0.0.1:8080/health
```

打开 Web 页面：

```text
http://127.0.0.1:8080
```

Docker Compose 试用环境会自动创建一个本地 demo 账号，便于截图、录屏和第一次体验：

```text
账号: demo@evalsmith.local
登录口令: evalsmith-demo
```

这个 demo 登录口令是公开的，并且只适合本机试用。如果服务会被本机以外的机器访问，请在运行 `make trial-up` 之前，在 `deploy/env/trial.env` 中设置 `EVALSMITH_DEMO_USER_ENABLED=false`，或通过 `EVALSMITH_DEMO_USER_PASSWORD` 覆盖登录口令。

停止并清理试用环境数据：

```sh
make trial-down
```

如果只想停止容器但保留数据卷，可以直接使用 Docker Compose：

```sh
docker compose -f deploy/docker-compose.trial.yml --env-file deploy/env/trial.env down
```

## 访问地址

试用环境会暴露以下本地端口：

| 组件 | 地址 | 说明 |
| --- | --- | --- |
| Web 和网关 | `http://127.0.0.1:8080` | 浏览器主入口 |
| 网关健康检查 | `http://127.0.0.1:8080/health` | 返回 `ok` |
| Trace 服务 | `http://127.0.0.1:8001` | Trace 写入和查询 |
| Eval Engine | `http://127.0.0.1:8002` | 评测器和实验 |
| Dataset 服务 | `http://127.0.0.1:8003` | 数据集和样本 |
| Auth 服务 | `http://127.0.0.1:8004` | 用户、会话、项目和 API Key |
| Annotation 服务 | `http://127.0.0.1:8005` | 标注队列和人工审核 |
| Monitor 服务 | `http://127.0.0.1:8006` | 监控规则和质量信号 |
| PostgreSQL | `127.0.0.1:15432` | 关系型业务数据 |
| ClickHouse HTTP | `http://127.0.0.1:18123` | 分析存储 HTTP 接口 |
| ClickHouse Native | `127.0.0.1:19000` | 分析存储原生协议 |
| Kafka | `127.0.0.1:19092` | Trace 事件流 |
| Redis | `127.0.0.1:26379` | 缓存和后台协调 |
| MinIO API | `http://127.0.0.1:19100` | 对象存储 API |
| MinIO Console | `http://127.0.0.1:19101` | 对象存储控制台 |

批量检查公开服务健康状态：

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

## 首次配置

1. 打开 `http://127.0.0.1:8080`。
2. 使用 trial demo 账号登录，或注册本地用户账号。
3. 创建或选择项目。
4. 进入项目设置页面。
5. 创建用于 SDK 写入的 API Key。
6. 将 API Key 保存到本地 shell、`.env` 文件或密钥管理系统中。

推荐的本地 SDK 环境变量：

```sh
export EVALSMITH_BASE_URL=http://127.0.0.1:8080
export EVALSMITH_PROJECT=<project-id>
export EVALSMITH_API_KEY=__REDACTED_SECRET__
```

如果本地开发时想直接连接各个服务端口：

```sh
export EVALSMITH_TRACE_URL=http://127.0.0.1:8001
export EVALSMITH_DATASET_URL=http://127.0.0.1:8003
export EVALSMITH_EVAL_URL=http://127.0.0.1:8002
export EVALSMITH_AUTH_URL=http://127.0.0.1:8004
export EVALSMITH_PROJECT=<project-id>
export EVALSMITH_API_KEY=__REDACTED_SECRET__
```

## 接入 Agent

### Python Trace 接入

从仓库中直接使用本地 Python SDK：

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

然后在 Web 页面中打开 Traces 页面查看写入结果。

### TypeScript Trace 写入

TypeScript SDK 源码位于 `sdks/typescript`：

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

## 运行 Demo 工作流

EvalSmith 提供了一个确定性的 demo agent 和初始化脚本，用于创建数据集并运行实验。

在一个终端中启动 demo agent：

```sh
PYTHONPATH=sdks/python \
EVALSMITH_BASE_URL=http://127.0.0.1:8080 \
EVALSMITH_PROJECT=<project-id> \
EVALSMITH_API_KEY=__REDACTED_SECRET__ \
python examples/demo-agent/app.py
```

在另一个终端中运行初始化和评测流程：

```sh
PYTHONPATH=sdks/python \
EVALSMITH_BASE_URL=http://127.0.0.1:8080 \
EVALSMITH_PROJECT=<project-id> \
EVALSMITH_API_KEY=__REDACTED_SECRET__ \
python examples/demo-agent/bootstrap_demo.py
```

这个 demo 会：

- 创建或复用名为 `Support QA Demo` 的数据集；
- 写入确定性样本；
- 针对 demo agent 运行实验；
- 使用内置 `exact_match` 和 `not_empty` 评测器；
- 发送 Agent 调用 Trace。

## 核心使用流程

### Trace

Trace 用于观察 Agent 执行过程。

典型流程：

1. 使用 SDK 接入 Agent。
2. 为 retrieval、tool call、model call、final response 等步骤写入 span。
3. 打开 Traces 页面。
4. 查看延迟、token、错误、输入、输出和 metadata。
5. 将典型或失败案例沉淀为数据集样本。

### 数据集

数据集用于保存回归测试和实验样本。

推荐样本结构：

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

### 评测器

评测器用于给实验输出打分。EvalSmith 支持多种评测方式：

- exact-match 和确定性规则检查；
- 非空、结构和格式检查；
- 代码评测器；
- LLM Judge 评测器；
- 统计型评测器；
- 人工反馈和标注分数。

使用 LLM Judge 时，应通过项目设置或密钥管理系统配置服务商凭证，不要把 API Key 提交到仓库。

### 实验

实验会使用一个数据集调用目标 Agent 接口，并用评测器进行打分。

典型流程：

1. 创建数据集。
2. 选择评测器。
3. 配置目标 URL、请求方法、请求头、body 模板、响应路径、超时和并发。
4. 运行实验。
5. 查看平均分、通过率、失败样本和回归情况。

### 标注

人工标注适合自动评分不足的场景。

建议在以下场景使用标注：

- 输出质量依赖主观判断或业务规则；
- 需要人工审核安全、合规或策略边界；
- 需要积累人工标签来设计后续评测器。

### 监控

监控用于持续观察线上质量信号。

你可以使用监控规则把实验结果、Trace 异常和线上行为关联起来，逐步建立回归发现流程。

## 本地开发

如果你需要直接修改服务代码，而不是全部运行在 trial 容器里，可以使用本地开发模式。

只启动基础设施：

```sh
make infra-up
make db-migrate
make seed-evaluators
make bootstrap-demo
make doctor
```

查看推荐启动顺序：

```sh
make run-all
```

在不同终端中分别启动服务：

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

前端开发服务：

```sh
cd web
npm install
npm run dev
```

前端生产构建：

```sh
cd web
npm run build
```

## 配置说明

### 运行时变量

| 变量 | 用途 | 本地常用值 |
| --- | --- | --- |
| `EVALSMITH_BASE_URL` | SDK 使用的网关地址 | `http://127.0.0.1:8080` |
| `EVALSMITH_API_KEY` | SDK 请求使用的 API Key | 在项目设置中生成 |
| `EVALSMITH_PROJECT` | SDK 请求所属项目 ID | Web 页面中当前项目 ID |
| `EVALSMITH_TRACE_URL` | 直连 Trace 服务地址 | `http://127.0.0.1:8001` |
| `EVALSMITH_DATASET_URL` | 直连 Dataset 服务地址 | `http://127.0.0.1:8003` |
| `EVALSMITH_EVAL_URL` | 直连 Eval Engine 地址 | `http://127.0.0.1:8002` |
| `EVALSMITH_AUTH_URL` | 直连 Auth 服务地址 | `http://127.0.0.1:8004` |
| `EVALSMITH_TRACING` | 是否启用 SDK Trace | `true` |
| `EVALSMITH_BATCH_SIZE` | SDK Trace 批量发送大小 | `50` |
| `EVALSMITH_FLUSH_INTERVAL` | SDK 发送间隔，单位秒 | `2.0` |

### 试用环境配置文件

Docker Compose trial 环境使用以下文件配置：

```text
deploy/env/trial.env
```

它来自示例文件：

```text
deploy/env/trial.env.example
```

在共享环境中使用前，必须替换以下占位值：

- `EVALSMITH_SECRET_KEY`
- `EVALSMITH_INTERNAL_TOKEN`
- `EVALSMITH_PG_PASSWORD`
- `EVALSMITH_CLICKHOUSE_PASSWORD`
- `EVALSMITH_MINIO_ROOT_PASSWORD`
- LLM Judge 使用的任何服务商 API Key

trial demo 用户由以下变量控制：

- `EVALSMITH_DEMO_USER_ENABLED`
- `EVALSMITH_DEMO_USER_EMAIL`
- `EVALSMITH_DEMO_USER_NAME`
- `EVALSMITH_DEMO_USER_PASSWORD`

如果要把试用环境暴露到本地开发以外的网络，请关闭 demo 用户或覆盖登录口令。

包含真实密钥的 `.env` 文件应保持未跟踪状态。

## 常用运维命令

查看容器状态：

```sh
docker compose -f deploy/docker-compose.trial.yml --env-file deploy/env/trial.env ps
```

查看所有日志：

```sh
docker compose -f deploy/docker-compose.trial.yml --env-file deploy/env/trial.env logs -f
```

查看单个服务日志：

```sh
docker compose -f deploy/docker-compose.trial.yml --env-file deploy/env/trial.env logs -f trace-service
```

重启单个服务：

```sh
docker compose -f deploy/docker-compose.trial.yml --env-file deploy/env/trial.env restart trace-service
```

停止服务但保留数据卷：

```sh
docker compose -f deploy/docker-compose.trial.yml --env-file deploy/env/trial.env down
```

停止服务并删除数据卷：

```sh
docker compose -f deploy/docker-compose.trial.yml --env-file deploy/env/trial.env down -v
```

重建单个服务镜像：

```sh
docker compose -f deploy/docker-compose.trial.yml --env-file deploy/env/trial.env build gateway
```

## 测试与校验

开源检查：

```sh
make open-source-check
```

Docker Compose 配置校验：

```sh
docker compose -f deploy/docker-compose.trial.yml --env-file deploy/env/trial.env.example config -q
```

启动 trial stack 后执行安装检查：

```sh
make install-check
```

完整测试入口：

```sh
make test-ci
```

完整测试包含服务测试和 Web smoke 测试。浏览器类 smoke 测试需要安装前端测试依赖，并具备可用的本地浏览器运行时。

## 故障排查

### 首次构建很慢

第一次完整 Docker 构建会编译 Go 服务，并安装 Python 和前端依赖，耗时可能比较长。

资源紧张的机器建议串行构建：

```sh
COMPOSE_PARALLEL_LIMIT=1 make trial-up
```

也可以增加 Docker Desktop 的内存和 CPU 配额。

### Docker 构建中 Go 编译被 killed

通常是 Docker 内存不足导致大型依赖编译被系统终止。

先尝试：

```sh
COMPOSE_PARALLEL_LIMIT=1 make trial-up
```

必要时清理 Docker build cache：

```sh
docker builder prune
```

### Docker Hub 或镜像仓库访问失败

Compose 文件支持通过 `deploy/env/trial.env` 覆盖镜像：

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

在受限网络中，可以把这些值指向内部镜像仓库或本地已拉取的 tag。

### 页面能打开但接口报错

查看网关和服务日志：

```sh
docker compose -f deploy/docker-compose.trial.yml --env-file deploy/env/trial.env logs -f gateway
docker compose -f deploy/docker-compose.trial.yml --env-file deploy/env/trial.env logs -f auth-service trace-service dataset-service eval-engine
```

再检查服务健康状态：

```sh
curl -fsS http://127.0.0.1:8001/health
curl -fsS http://127.0.0.1:8002/health
curl -fsS http://127.0.0.1:8003/health
curl -fsS http://127.0.0.1:8004/health
```

### Trace 没有显示

重点检查：

- `EVALSMITH_PROJECT` 是否与当前项目一致；
- 需要认证时，`EVALSMITH_API_KEY` 是否已设置；
- SDK URL 是否指向网关或正确的服务端口；
- 短生命周期脚本退出前是否调用 `evalsmith.get_client().shutdown()`；
- `trace-service`、`trace-consumer`、Kafka、ClickHouse 和 MinIO 是否正常运行。

### 重置本地试用数据

```sh
make trial-down
make trial-up
```

这会删除 trial stack 使用的 Docker volumes。

## 安全注意事项

不要提交真实凭证、客户数据、私有端点、内部 runbook 或生产环境配置文件。

共享环境或生产部署中建议：

- 替换所有占位密钥；
- 使用密钥管理系统或 Kubernetes Secrets；
- 限制外部暴露端口；
- 在网关前配置 TLS；
- 配置备份和数据保留策略；
- 审核 API Key 归属和项目成员权限；
- 不要把服务商 API Key 写入源码或日志。

发布仓库快照前执行：

```sh
make open-source-check
```

## 后续阅读

- 部署文档：[`../deployment/README.md`](../deployment/README.md)
- 公开 API 规范：[`../api/evalsmith-public.openapi.yaml`](../api/evalsmith-public.openapi.yaml)
- 安全策略：[`../../SECURITY.md`](../../SECURITY.md)
- SDK 源码：[`../../sdks`](../../sdks)
- Demo Agent：[`../../examples/demo-agent`](../../examples/demo-agent)
