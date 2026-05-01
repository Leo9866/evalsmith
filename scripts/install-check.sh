#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${EVALSMITH_BASE_URL:-http://127.0.0.1:${EVALSMITH_GATEWAY_PORT:-8080}}"
TRACE_PORT="${EVALSMITH_TRACE_PORT:-8001}"
EVAL_PORT="${EVALSMITH_EVAL_PORT:-8002}"
DATASET_PORT="${EVALSMITH_DATASET_PORT:-8003}"
AUTH_PORT="${EVALSMITH_AUTH_PORT:-8004}"
ANNOTATION_PORT="${EVALSMITH_ANNOTATION_PORT:-8005}"
MONITOR_PORT="${EVALSMITH_MONITOR_PORT:-8006}"

failures=0
cookie_jar="$(mktemp)"
register_body="$(mktemp)"
me_body="$(mktemp)"
dataset_body="$(mktemp)"
trace_body="$(mktemp)"
annotation_body="$(mktemp)"

cleanup() {
  rm -f "$cookie_jar" "$register_body" "$me_body" "$dataset_body" "$trace_body" "$annotation_body"
}
trap cleanup EXIT

check_http() {
  local url="$1"
  local label="$2"
  if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
    printf '[PASS] %s reachable (%s)\n' "$label" "$url"
  else
    printf '[FAIL] %s unreachable (%s)\n' "$label" "$url"
    failures=$((failures + 1))
  fi
}

assert_envelope_ok() {
  local file="$1"
  local label="$2"
  if python3 - "$file" "$label" <<'PY'
import json
import sys

path, label = sys.argv[1], sys.argv[2]
with open(path, "r", encoding="utf-8") as f:
    payload = json.load(f)
if payload.get("code") != 0:
    raise SystemExit(f"[FAIL] {label} returned envelope code={payload.get('code')} message={payload.get('message')}")
print(f"[PASS] {label} returned success envelope")
PY
  then
    :
  else
    failures=$((failures + 1))
  fi
}

printf '== EvalSmith Install Check ==\n'

check_http "${BASE_URL}/health" "gateway"
check_http "http://127.0.0.1:${TRACE_PORT}/health" "trace-service"
check_http "http://127.0.0.1:${EVAL_PORT}/health" "eval-engine"
check_http "http://127.0.0.1:${DATASET_PORT}/health" "dataset-service"
check_http "http://127.0.0.1:${AUTH_PORT}/health" "auth-service"
check_http "http://127.0.0.1:${ANNOTATION_PORT}/health" "annotation-service"
check_http "http://127.0.0.1:${MONITOR_PORT}/health" "monitor-service"

email="install-check-$(date +%s)@evalsmith.local"
password="__REDACTED_SECRET__"

register_status="$(
  curl -sS -o "$register_body" -w "%{http_code}" \
    -c "$cookie_jar" \
    -H 'Content-Type: application/json' \
    -X POST "${BASE_URL}/api/v1/auth/register" \
    -d "{\"email\":\"${email}\",\"name\":\"Install Check\",\"password\":\"${password}\"}"
)"

if [[ "$register_status" == "200" || "$register_status" == "201" ]]; then
  assert_envelope_ok "$register_body" "auth register"
else
  printf '[FAIL] auth register returned HTTP %s\n' "$register_status"
  cat "$register_body"
  printf '\n'
  failures=$((failures + 1))
fi

me_status="$(
  curl -sS -o "$me_body" -w "%{http_code}" \
    -b "$cookie_jar" \
    "${BASE_URL}/api/v1/auth/me"
)"

project_id=""
if [[ "$me_status" == "200" ]]; then
  assert_envelope_ok "$me_body" "auth me"
  project_id="$(python3 - "$me_body" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as f:
    payload = json.load(f)
projects = payload.get("data", {}).get("projects", [])
print(projects[0]["id"] if projects else "")
PY
)"
  if [[ -n "$project_id" ]]; then
    printf '[PASS] bootstrap project resolved (%s)\n' "$project_id"
  else
    printf '[FAIL] auth me returned no accessible project\n'
    failures=$((failures + 1))
  fi
else
  printf '[FAIL] auth me returned HTTP %s\n' "$me_status"
  cat "$me_body"
  printf '\n'
  failures=$((failures + 1))
fi

dataset_id=""
if [[ -n "$project_id" ]]; then
  dataset_status="$(
    curl -sS -o "$dataset_body" -w "%{http_code}" \
      -b "$cookie_jar" \
      -H "X-Project-ID: ${project_id}" \
      -H 'Content-Type: application/json' \
      -X POST "${BASE_URL}/api/v1/datasets" \
      -d '{"name":"Install Check Dataset","description":"Created by install-check","schema_def":{"inputs":{"type":"object"},"expected_outputs":{"type":"string"}}}'
  )"

  if [[ "$dataset_status" == "200" || "$dataset_status" == "201" ]]; then
    assert_envelope_ok "$dataset_body" "dataset create"
    dataset_id="$(python3 - "$dataset_body" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as f:
    payload = json.load(f)
print(payload.get("data", {}).get("id", ""))
PY
)"
  else
    printf '[FAIL] dataset create returned HTTP %s\n' "$dataset_status"
    cat "$dataset_body"
    printf '\n'
    failures=$((failures + 1))
  fi
fi

trace_id="tr_install_check_$(date +%s)"
now_utc="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

if [[ -n "$project_id" ]]; then
  trace_status="$(
    curl -sS -o "$trace_body" -w "%{http_code}" \
      -b "$cookie_jar" \
      -H "X-Project-ID: ${project_id}" \
      -H 'Content-Type: application/json' \
      -X POST "${BASE_URL}/api/v1/traces" \
      -d "{\"traces\":[{\"trace_id\":\"${trace_id}\",\"name\":\"install-check-trace\",\"tags\":[\"install-check\"],\"metadata\":{\"source\":\"install-check\"},\"spans\":[{\"name\":\"root-span\",\"span_type\":\"llm\",\"status\":\"ok\",\"start_time\":\"${now_utc}\",\"end_time\":\"${now_utc}\",\"input\":{\"input\":\"hello\"},\"output\":{\"answer\":\"world\"},\"metrics\":{},\"metadata\":{},\"events\":[]}]}]}"
  )"

  if [[ "$trace_status" == "200" || "$trace_status" == "201" ]]; then
    assert_envelope_ok "$trace_body" "trace ingest"
  else
    printf '[FAIL] trace ingest returned HTTP %s\n' "$trace_status"
    cat "$trace_body"
    printf '\n'
    failures=$((failures + 1))
  fi
fi

trace_indexed="false"
if [[ -n "$project_id" ]]; then
  for _ in $(seq 1 20); do
    trace_list_status="$(
      curl -sS -o "$trace_body" -w "%{http_code}" \
        -b "$cookie_jar" \
        -H "X-Project-ID: ${project_id}" \
        "${BASE_URL}/api/v1/traces?search=${trace_id}&page_size=5"
    )"
    if [[ "$trace_list_status" == "200" ]] && python3 - "$trace_body" "$trace_id" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as f:
    payload = json.load(f)
trace_id = sys.argv[2]
items = payload.get("data", {}).get("traces", []) or payload.get("data", {}).get("items", [])
if any(item.get("trace_id") == trace_id for item in items):
    sys.exit(0)
sys.exit(1)
PY
    then
      trace_indexed="true"
      printf '[PASS] trace indexed and queryable\n'
      break
    fi
    sleep 2
  done
fi

if [[ "$trace_indexed" != "true" ]]; then
  printf '[FAIL] trace did not become queryable in time\n'
  failures=$((failures + 1))
fi

if [[ -n "$project_id" && "$trace_indexed" == "true" ]]; then
  annotation_status="$(
    curl -sS -o "$annotation_body" -w "%{http_code}" \
      -b "$cookie_jar" \
      -H "X-Project-ID: ${project_id}" \
      -H 'Content-Type: application/json' \
      -X POST "${BASE_URL}/api/v1/traces/batch/annotation" \
      -d "{\"trace_ids\":[\"${trace_id}\"],\"mode\":\"single_run\"}"
  )"

  if [[ "$annotation_status" == "200" || "$annotation_status" == "201" ]]; then
    assert_envelope_ok "$annotation_body" "trace backfill to annotation"
  else
    printf '[FAIL] trace backfill to annotation returned HTTP %s\n' "$annotation_status"
    cat "$annotation_body"
    printf '\n'
    failures=$((failures + 1))
  fi
fi

if [[ -n "$project_id" ]]; then
  annotation_list_status="$(
    curl -sS -o "$annotation_body" -w "%{http_code}" \
      -b "$cookie_jar" \
      -H "X-Project-ID: ${project_id}" \
      "${BASE_URL}/api/v1/annotation/tasks?page_size=5"
  )"
  if [[ "$annotation_list_status" == "200" ]]; then
    assert_envelope_ok "$annotation_body" "annotation task list"
  else
    printf '[FAIL] annotation task list returned HTTP %s\n' "$annotation_list_status"
    cat "$annotation_body"
    printf '\n'
    failures=$((failures + 1))
  fi
fi

printf '\n'
if [[ "$failures" -eq 0 ]]; then
  printf 'Install check summary: PASS\n'
  exit 0
fi

printf 'Install check summary: FAIL (%s checks failed)\n' "$failures"
exit 1

