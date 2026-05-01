"""EvalSmith HTTP client for communicating with the platform."""

from __future__ import annotations

import os
import atexit
import threading
import time
from typing import Any

import httpx


def _env_first(*names: str) -> str:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return ""


def _env_url(value: str | None) -> str | None:
    if not value:
        return None
    return value.rstrip("/")


class EvalSmithClient:
    """Core HTTP client for EvalSmith API."""

    def __init__(
        self,
        api_key: str | None = None,
        project: str | None = None,
        base_url: str | None = None,
        flush_interval: float = 2.0,
        batch_size: int = 50,
    ):
        self.api_key = api_key or _env_first("EVALSMITH_API_KEY")
        self.project = project or _env_first("EVALSMITH_PROJECT") or "proj_default"
        flush_interval = float(_env_first("EVALSMITH_FLUSH_INTERVAL") or flush_interval)
        batch_size = int(_env_first("EVALSMITH_BATCH_SIZE") or batch_size)
        self.base_url = _env_url(base_url) or _env_url(_env_first("EVALSMITH_BASE_URL"))
        self.trace_base_url = _env_url(_env_first("EVALSMITH_TRACE_URL")) or self.base_url or "http://127.0.0.1:8001"
        self.dataset_base_url = _env_url(_env_first("EVALSMITH_DATASET_URL")) or self.base_url or "http://127.0.0.1:8003"
        self.eval_base_url = _env_url(_env_first("EVALSMITH_EVAL_URL")) or self.base_url or "http://127.0.0.1:8002"
        self.auth_base_url = _env_url(_env_first("EVALSMITH_AUTH_URL")) or self.base_url or "http://127.0.0.1:8004"
        self.tracing_enabled = (_env_first("EVALSMITH_TRACING") or "true").lower() == "true"

        common_headers = {
            "X-Project-ID": self.project,
            "Content-Type": "application/json",
        }
        if self.api_key:
            common_headers["Authorization"] = f"Bearer {self.api_key}"
        self._trace_http = httpx.Client(base_url=self.trace_base_url, headers=common_headers, timeout=30.0)
        self._dataset_http = httpx.Client(base_url=self.dataset_base_url, headers=common_headers, timeout=30.0)
        self._eval_http = httpx.Client(base_url=self.eval_base_url, headers=common_headers, timeout=30.0)
        self._auth_http = httpx.Client(base_url=self.auth_base_url, headers=common_headers, timeout=30.0)

        self._buffer: list[dict] = []
        self._lock = threading.Lock()
        self._flush_interval = flush_interval
        self._batch_size = max(batch_size, 1)
        self._running = True

        self._flush_thread = threading.Thread(target=self._flush_loop, daemon=True)
        self._flush_thread.start()
        atexit.register(self.shutdown)

    def enqueue_trace(self, trace_data: dict):
        """Add a trace to the send buffer."""
        if not self.tracing_enabled:
            return
        with self._lock:
            self._buffer.append(trace_data)
            if len(self._buffer) >= self._batch_size:
                self._flush()

    def _flush(self):
        """Send buffered traces to the API."""
        if not self._buffer:
            return
        batch = self._buffer[:]
        self._buffer.clear()
        try:
            self._trace_http.post("/api/v1/traces", json={"traces": batch})
        except Exception:
            pass  # Best-effort, don't crash the user's app

    def _flush_loop(self):
        while self._running:
            time.sleep(self._flush_interval)
            with self._lock:
                self._flush()

    def shutdown(self):
        """Flush remaining traces and close."""
        self._running = False
        with self._lock:
            self._flush()
        self._trace_http.close()
        self._dataset_http.close()
        self._eval_http.close()
        self._auth_http.close()

    def _resolve_client(self, path: str) -> tuple[httpx.Client, str]:
        if path.startswith("http://") or path.startswith("https://"):
            return self._trace_http, path
        if path.startswith("/api/v1/traces") or path.startswith("/api/v1/spans"):
            return self._trace_http, path
        if path.startswith("/api/v1/datasets"):
            return self._dataset_http, path
        if (
            path.startswith("/api/v1/evaluators")
            or path.startswith("/api/v1/experiments")
            or path.startswith("/api/v1/evaluate")
        ):
            return self._eval_http, path
        if (
            path.startswith("/api/v1/projects")
            or path.startswith("/api/v1/api-keys")
            or path.startswith("/api/v1/auth")
        ):
            return self._auth_http, path

        if self.base_url:
            fallback = httpx.Client(
                base_url=self.base_url,
                headers=self._trace_http.headers,
                timeout=30.0,
            )
            return fallback, path
        return self._trace_http, path

    def get(self, path: str, **kwargs) -> dict:
        client, resolved_path = self._resolve_client(path)
        try:
            resp = client.get(resolved_path, **kwargs)
            resp.raise_for_status()
            return resp.json()
        finally:
            if client not in {self._trace_http, self._dataset_http, self._eval_http, self._auth_http}:
                client.close()

    def post(self, path: str, **kwargs) -> dict:
        client, resolved_path = self._resolve_client(path)
        try:
            resp = client.post(resolved_path, **kwargs)
            resp.raise_for_status()
            return resp.json()
        finally:
            if client not in {self._trace_http, self._dataset_http, self._eval_http, self._auth_http}:
                client.close()
