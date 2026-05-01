#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TAG="${1:-k8s-$(date +%Y%m%d-%H%M%S)}"
REGISTRY="${EVALSMITH_REGISTRY:-docker.io}"
PROJECT="${EVALSMITH_REGISTRY_PROJECT:-evalsmith}"
REGISTRY_BASE="${REGISTRY}/${PROJECT}"
REGISTRY_SECRET_NAMESPACE="${EVALSMITH_REGISTRY_SECRET_NAMESPACE:-__REDACTED_SECRET__}"
REGISTRY_SECRET_NAME="${EVALSMITH_REGISTRY_SECRET_NAME:-__REDACTED_SECRET__}"
DOCKER_LOGIN_FROM_SECRET="${EVALSMITH_DOCKER_LOGIN_FROM_SECRET:-0}"
SKIP_THIRDPARTY_MIRROR="${EVALSMITH_SKIP_THIRDPARTY_MIRROR:-0}"

log() {
  printf '[build-and-push] %s\n' "$*"
}

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'missing required tool: %s\n' "$1" >&2
    exit 1
  fi
}

require_tool docker
require_tool python3
if [[ "${DOCKER_LOGIN_FROM_SECRET}" == "1" ]]; then
  require_tool kubectl
fi

read_registry_field() {
  local field="$1"
  python3 - "$field" "${REGISTRY_SECRET_NAMESPACE}" "${REGISTRY_SECRET_NAME}" "${REGISTRY}" <<'PY'
import base64
import json
import subprocess
import sys

field = sys.argv[1]
namespace = sys.argv[2]
secret_name = sys.argv[3]
registry = sys.argv[4]
raw = subprocess.check_output(
    [
        "kubectl",
        "-n",
        namespace,
        "get",
        "secret",
        secret_name,
        "-o",
        "jsonpath={.data.\\.dockerconfigjson}",
    ]
).decode()
obj = json.loads(base64.b64decode(raw))
print(obj["auths"][registry][field])
PY
}

if [[ "${DOCKER_LOGIN_FROM_SECRET}" == "1" ]]; then
  REG_USER="$(read_registry_field username)"
  REG_PASS="$(read_registry_field password)"
  printf '%s' "${REG_PASS}" | docker login "${REGISTRY}" -u "${REG_USER}" --password-stdin >/dev/null
fi

mirror_image() {
  local source_ref="$1"
  local target_ref="$2"
  if docker buildx imagetools inspect "${target_ref}" >/dev/null 2>&1; then
    log "Reuse existing ${target_ref}"
    return 0
  fi
  log "Mirror ${source_ref} -> ${target_ref}"
  docker buildx imagetools create -t "${target_ref}" "${source_ref}" >/dev/null
}

build_component() {
  local name="$1"
  local dockerfile="$2"
  shift 2
  local image_ref="${REGISTRY_BASE}/evalsmith-${name}:${TAG}"

  log "Build ${image_ref}"
  docker buildx build \
    --platform linux/amd64 \
    --load \
    -t "${image_ref}" \
    -f "${ROOT_DIR}/${dockerfile}" \
    "${ROOT_DIR}" \
    "$@"

  log "Push ${image_ref}"
  docker push "${image_ref}"
}

if [[ "${SKIP_THIRDPARTY_MIRROR}" != "1" ]]; then
  log "Mirroring the only missing third-party runtime image"
  mirror_image "docker.io/apache/kafka:3.9.0" "${REGISTRY_BASE}/evalsmith-thirdparty-kafka:3.9.0"
else
  log "Skip third-party runtime mirror"
fi

log "Building EvalSmith application images"
build_component gateway gateway/Dockerfile --build-arg "NPM_REGISTRY=${EVALSMITH_NPM_REGISTRY:-https://registry.npmjs.org/}"
build_component auth-service services/auth-service/Dockerfile --build-arg "GOPROXY=${EVALSMITH_GOPROXY:-https://proxy.golang.org,direct}"
build_component trace-service services/trace-service/Dockerfile --build-arg "GOPROXY=${EVALSMITH_GOPROXY:-https://proxy.golang.org,direct}"
build_component dataset-service services/dataset-service/Dockerfile --build-arg "GOPROXY=${EVALSMITH_GOPROXY:-https://proxy.golang.org,direct}"
build_component annotation-service services/annotation-service/Dockerfile --build-arg "GOPROXY=${EVALSMITH_GOPROXY:-https://proxy.golang.org,direct}"
build_component eval-engine services/eval-engine/Dockerfile --build-arg "PIP_INDEX_URL=${EVALSMITH_PIP_INDEX_URL:-https://pypi.org/simple}"
build_component monitor-service services/monitor-service/Dockerfile --build-arg "PIP_INDEX_URL=${EVALSMITH_PIP_INDEX_URL:-https://pypi.org/simple}"
build_component trace-consumer workers/trace-consumer/Dockerfile --build-arg "GOPROXY=${EVALSMITH_GOPROXY:-https://proxy.golang.org,direct}"
build_component eval-worker workers/eval-worker/Dockerfile --build-arg "PIP_INDEX_URL=${EVALSMITH_PIP_INDEX_URL:-https://pypi.org/simple}"
build_component monitor-worker workers/monitor-worker/Dockerfile --build-arg "PIP_INDEX_URL=${EVALSMITH_PIP_INDEX_URL:-https://pypi.org/simple}"

log "Done. Use tag: ${TAG}"
