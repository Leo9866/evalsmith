#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST_DIR="${ROOT_DIR}/deploy/k8s/manifests"
TAG="${1:?usage: ./deploy/k8s/deploy.sh <image-tag>}"
NAMESPACE="${EVALSMITH_NAMESPACE:-evalsmith}"
INGRESS_NAMESPACE="${EVALSMITH_INGRESS_NAMESPACE:-ingress-nginx}"
INGRESS_SERVICE="${EVALSMITH_INGRESS_SERVICE:-ingress-nginx-controller}"
ACCESS_MODE="${EVALSMITH_ACCESS_MODE:-ingress}"
GATEWAY_LB_SERVICE="${EVALSMITH_GATEWAY_LB_SERVICE_NAME:-gateway-lb}"
GATEWAY_LB_PORT="${EVALSMITH_GATEWAY_LB_PORT:-8082}"
IMAGE_REGISTRY_BASE="${EVALSMITH_IMAGE_REGISTRY_BASE:-docker.io/evalsmith}"
REGISTRY="${EVALSMITH_REGISTRY:-${IMAGE_REGISTRY_BASE%%/*}}"
REGISTRY_SECRET_NAMESPACE="${EVALSMITH_REGISTRY_SECRET_NAMESPACE:-__REDACTED_SECRET__}"
REGISTRY_SECRET_NAME="${EVALSMITH_REGISTRY_SECRET_NAME:-__REDACTED_SECRET__}"
COPY_REGISTRY_SECRET="${EVALSMITH_COPY_REGISTRY_SECRET:-0}"

log() {
  printf '[deploy-k8s] %s\n' "$*"
}

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'missing required tool: %s\n' "$1" >&2
    exit 1
  fi
}

require_tool kubectl
require_tool python3
require_tool curl

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

if [[ "${COPY_REGISTRY_SECRET}" == "1" ]]; then
  REG_USER="$(read_registry_field username)"
  REG_PASS="$(read_registry_field password)"
fi

render_apply() {
  local file="$1"
  sed \
    -e "s#__IMAGE_TAG__#${TAG}#g" \
    -e "s#__IMAGE_REGISTRY_BASE__#${IMAGE_REGISTRY_BASE}#g" \
    -e "s#__NAMESPACE__#${NAMESPACE}#g" \
    -e "s#__GATEWAY_LB_SERVICE_NAME__#${GATEWAY_LB_SERVICE}#g" \
    -e "s#__GATEWAY_LB_PORT__#${GATEWAY_LB_PORT}#g" \
    "${file}" | kubectl apply -f -
}

rollout_wait() {
  local deployment="$1"
  kubectl -n "${NAMESPACE}" rollout status "deployment/${deployment}" --timeout=300s
}

copy_registry_secret() {
  kubectl -n "${NAMESPACE}" delete secret "${REGISTRY_SECRET_NAME}" --ignore-not-found >/dev/null 2>&1 || true
  kubectl -n "${NAMESPACE}" create secret docker-registry "${REGISTRY_SECRET_NAME}" \
    --docker-server="${REGISTRY}" \
    --docker-username="${REG_USER}" \
    --docker-password="${REG_PASS}" \
    >/dev/null
}

wait_for_job() {
  local job_name="$1"
  kubectl -n "${NAMESPACE}" wait --for=condition=complete "job/${job_name}" --timeout=600s
}

wait_for_ingress_ip() {
  local ip=""
  for _ in $(seq 1 120); do
    ip="$(
      kubectl -n "${INGRESS_NAMESPACE}" get svc "${INGRESS_SERVICE}" \
        -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true
    )"
    if [[ -n "${ip}" ]]; then
      printf '%s\n' "${ip}"
      return 0
    fi
    sleep 5
  done
  return 1
}

wait_for_service_ip() {
  local namespace="$1"
  local service_name="$2"
  local ip=""
  for _ in $(seq 1 120); do
    ip="$(
      kubectl -n "${namespace}" get svc "${service_name}" \
        -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true
    )"
    if [[ -n "${ip}" ]]; then
      printf '%s\n' "${ip}"
      return 0
    fi
    sleep 5
  done
  return 1
}

log "Apply namespace and shared config"
render_apply "${MANIFEST_DIR}/00-namespace.yaml"
if [[ "${COPY_REGISTRY_SECRET}" == "1" ]]; then
  copy_registry_secret
fi
render_apply "${MANIFEST_DIR}/10-config.yaml"

log "Apply infra"
render_apply "${MANIFEST_DIR}/20-infra.yaml"
rollout_wait postgres
rollout_wait clickhouse
rollout_wait kafka
rollout_wait minio

log "Run bootstrap jobs"
kubectl -n "${NAMESPACE}" delete job migrate seed-evaluators --ignore-not-found >/dev/null 2>&1 || true
render_apply "${MANIFEST_DIR}/30-bootstrap.yaml"
wait_for_job migrate
wait_for_job seed-evaluators

log "Apply application workloads"
render_apply "${MANIFEST_DIR}/40-app.yaml"
rollout_wait auth-service
rollout_wait dataset-service
rollout_wait annotation-service
rollout_wait trace-service
rollout_wait eval-engine
rollout_wait monitor-service
rollout_wait trace-consumer
rollout_wait eval-worker
rollout_wait monitor-worker
rollout_wait gateway

if [[ "${ACCESS_MODE}" == "gateway-lb" ]]; then
  log "Apply dedicated gateway LoadBalancer service"
  render_apply "${MANIFEST_DIR}/41-gateway-lb.yaml"
  ACCESS_IP="$(wait_for_service_ip "${NAMESPACE}" "${GATEWAY_LB_SERVICE}")"
  ACCESS_URL="http://${ACCESS_IP}:${GATEWAY_LB_PORT}/"
else
  ACCESS_IP="$(wait_for_ingress_ip)"
  ACCESS_URL="http://${ACCESS_IP}/"
fi

log "Smoke check gateway"
curl -fsS "${ACCESS_URL}health" >/dev/null

log "Deployment completed"
printf '\n'
printf 'Namespace: %s\n' "${NAMESPACE}"
printf 'Access URL: %s\n' "${ACCESS_URL}"
printf 'Health URL: %shealth\n' "${ACCESS_URL}"
