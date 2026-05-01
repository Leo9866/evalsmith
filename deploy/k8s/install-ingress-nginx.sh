#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INGRESS_NAMESPACE="${INGRESS_NAMESPACE:-ingress-nginx}"
INGRESS_RELEASE="${INGRESS_RELEASE:-ingress-nginx}"
INGRESS_CONTROLLER_REPOSITORY="${EVALSMITH_INGRESS_CONTROLLER_REPOSITORY:-registry.k8s.io/ingress-nginx/controller}"
INGRESS_CONTROLLER_TAG="${EVALSMITH_INGRESS_CONTROLLER_TAG:-v1.15.1}"

log() {
  printf '[install-ingress-nginx] %s\n' "$*"
}

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'missing required tool: %s\n' "$1" >&2
    exit 1
  fi
}

require_tool kubectl
require_tool helm

log "Install ingress-nginx Helm chart"
kubectl create namespace "${INGRESS_NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx >/dev/null 2>&1 || true
helm repo update ingress-nginx >/dev/null

helm upgrade --install "${INGRESS_RELEASE}" ingress-nginx/ingress-nginx \
  --namespace "${INGRESS_NAMESPACE}" \
  --set controller.admissionWebhooks.enabled=false \
  --set controller.image.repository="${INGRESS_CONTROLLER_REPOSITORY}" \
  --set controller.image.tag="${INGRESS_CONTROLLER_TAG}" \
  --set controller.image.digest= \
  --set controller.ingressClassResource.name=nginx \
  --set controller.ingressClassResource.default=true \
  --wait --timeout 10m >/dev/null

IP="$(
  kubectl -n "${INGRESS_NAMESPACE}" get svc "${INGRESS_RELEASE}-controller" \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
)"

log "Ingress installed"
printf 'Ingress controller service IP: %s\n' "${IP}"
