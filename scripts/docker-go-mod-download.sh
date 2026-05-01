#!/bin/sh

set -eu

module="${1:-}"
primary_proxy="${GOPROXY:-https://proxy.golang.org,direct}"

attempt_download() {
  proxy="$1"
  retries="$2"
  i=1

  export GOPROXY="$proxy"
  if [ "$proxy" = "direct" ]; then
    export GOSUMDB=off
  else
    unset GOSUMDB || true
  fi

  while [ "$i" -le "$retries" ]; do
    if [ -n "$module" ]; then
      if go mod download "$module"; then
        return 0
      fi
    else
      if go mod download; then
        return 0
      fi
    fi

    sleep_time=$((i * 5))
    echo "go mod download failed via GOPROXY=$proxy (attempt $i/$retries); retrying in ${sleep_time}s..." >&2
    sleep "$sleep_time"
    i=$((i + 1))
  done

  return 1
}

for proxy in "$primary_proxy" "https://proxy.golang.org,direct" "direct"; do
  if attempt_download "$proxy" 3; then
    exit 0
  fi
done

echo "go mod download failed after exhausting proxy fallbacks" >&2
exit 1
