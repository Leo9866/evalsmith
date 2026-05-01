#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

failures=0

check_port() {
  local port="$1"
  local label="$2"
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    printf '[PASS] %s is listening on :%s\n' "$label" "$port"
  else
    printf '[FAIL] %s is not listening on :%s\n' "$label" "$port"
    failures=$((failures + 1))
  fi
}

check_http() {
  local url="$1"
  local label="$2"
  if curl -fsS --max-time 3 "$url" >/dev/null 2>&1; then
    printf '[PASS] %s health check succeeded (%s)\n' "$label" "$url"
  else
    printf '[FAIL] %s health check failed (%s)\n' "$label" "$url"
    failures=$((failures + 1))
  fi
}

echo '== EvalSmith Doctor =='

check_port 3000 'web'
check_port 8001 'trace-service'
check_port 8002 'eval-engine'
check_port 8003 'dataset-service'
check_port 8004 'auth-service'
check_port 8005 'annotation-service'
check_port 8006 'monitor-service'
check_port 15432 'postgres'
check_port 26379 'redis'

echo
check_http 'http://127.0.0.1:3000/' 'web'
check_http 'http://127.0.0.1:8001/health' 'trace-service'
check_http 'http://127.0.0.1:8002/health' 'eval-engine'
check_http 'http://127.0.0.1:8003/health' 'dataset-service'
check_http 'http://127.0.0.1:8004/health' 'auth-service'
check_http 'http://127.0.0.1:8005/health' 'annotation-service'
check_http 'http://127.0.0.1:8006/health' 'monitor-service'

echo
if [[ "$failures" -eq 0 ]]; then
  echo 'Doctor summary: PASS'
  exit 0
fi

echo "Doctor summary: FAIL (${failures} checks failed)"
exit 1
