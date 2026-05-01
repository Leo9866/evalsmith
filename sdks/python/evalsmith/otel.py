from __future__ import annotations

import os

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor


def _env_first(*names: str) -> str:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return ""


def build_otlp_headers(project: str | None = None, api_key: str | None = None) -> dict[str, str]:
    headers: dict[str, str] = {}
    resolved_project = project or _env_first("EVALSMITH_PROJECT") or "proj_default"
    headers["X-Project-ID"] = resolved_project
    resolved_api_key = api_key or _env_first("EVALSMITH_API_KEY")
    if resolved_api_key:
        headers["Authorization"] = f"Bearer {resolved_api_key}"
    return headers


def configure_otel_tracing(
    *,
    service_name: str = "evalsmith-client",
    endpoint: str | None = None,
    project: str | None = None,
    api_key: str | None = None,
) -> TracerProvider:
    base_url = (
        endpoint
        or _env_first("EVALSMITH_OTLP_ENDPOINT")
        or _env_first("EVALSMITH_TRACE_URL")
        or "http://127.0.0.1:8001"
    )
    otlp_endpoint = base_url.rstrip("/") + "/v1/traces"
    resource = Resource.create({
        "service.name": service_name,
        "evalsmith.project_id": project or _env_first("EVALSMITH_PROJECT") or "proj_default",
    })

    provider = TracerProvider(resource=resource)
    exporter = OTLPSpanExporter(
        endpoint=otlp_endpoint,
        headers=build_otlp_headers(project=project, api_key=api_key),
    )
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    return provider


def shutdown_otel_tracing() -> None:
    provider = trace.get_tracer_provider()
    if hasattr(provider, "shutdown"):
        provider.shutdown()
