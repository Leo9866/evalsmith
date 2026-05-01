#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST_PATH="${ROOT_DIR}/deploy/k8s/manifests/45-verification-agent.yaml"
NAMESPACE="${EVALSMITH_NAMESPACE:-evalsmith}"

resolve_tag() {
  if [[ $# -gt 0 && -n "${1:-}" ]]; then
    printf '%s\n' "$1"
    return 0
  fi

  local image
  image="$(kubectl -n "${NAMESPACE}" get deploy eval-engine -o jsonpath='{.spec.template.spec.containers[0].image}')"
  printf '%s\n' "${image##*:}"
}

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'missing required tool: %s\n' "$1" >&2
    exit 1
  fi
}

require_tool kubectl
require_tool sed

TAG="$(resolve_tag "${1:-}")"

sed \
  -e "s#__NAMESPACE__#${NAMESPACE}#g" \
  -e "s#__IMAGE_TAG__#${TAG}#g" \
  -e "s#__INTERNAL_TOKEN_PLACEHOLDER__#${EVALSMITH_INTERNAL_TOKEN:-__REDACTED_SECRET__}#g" \
  "${MANIFEST_PATH}" | kubectl apply -f -

kubectl -n "${NAMESPACE}" rollout status deployment/verification-agent --timeout=300s
kubectl -n "${NAMESPACE}" get svc verification-agent

printf '\n'
printf 'Namespace: %s\n' "${NAMESPACE}"
printf 'Service: http://verification-agent.%s.svc.cluster.local:8010/answer\n' "${NAMESPACE}"
