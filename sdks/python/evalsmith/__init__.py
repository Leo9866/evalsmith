"""EvalSmith Python SDK - AI Agent evaluation platform."""

from evalsmith.client import EvalSmithClient
from evalsmith.decorators import traceable
from evalsmith.trace import Trace, Span
from evalsmith.evaluate import evaluate, preview_target, Dataset, Evaluator, Score, TargetPreview
from evalsmith.testing import eval_test

try:
    from evalsmith.otel import build_otlp_headers, configure_otel_tracing, shutdown_otel_tracing
except ModuleNotFoundError as exc:
    if exc.name and exc.name.startswith("opentelemetry"):
        otel_import_error = exc

        def _missing_otel_dependency(*_args, **_kwargs):
            raise ModuleNotFoundError(
                "OpenTelemetry support requires optional dependencies. "
                "Install `opentelemetry-sdk` and "
                "`opentelemetry-exporter-otlp-proto-http` to enable tracing helpers."
            ) from otel_import_error

        build_otlp_headers = _missing_otel_dependency
        configure_otel_tracing = _missing_otel_dependency
        shutdown_otel_tracing = _missing_otel_dependency
    else:
        raise

__all__ = [
    "EvalSmithClient",
    "traceable",
    "Trace",
    "Span",
    "evaluate",
    "preview_target",
    "Dataset",
    "Evaluator",
    "Score",
    "TargetPreview",
    "build_otlp_headers",
    "configure_otel_tracing",
    "shutdown_otel_tracing",
    "eval_test",
]

_client: EvalSmithClient | None = None


def init(api_key: str | None = None, project: str | None = None, base_url: str | None = None):
    """Initialize the global EvalSmith client."""
    global _client
    _client = EvalSmithClient(api_key=api_key, project=project, base_url=base_url)
    return _client


def get_client() -> EvalSmithClient:
    """Get or auto-initialize the global client."""
    global _client
    if _client is None:
        _client = EvalSmithClient()
    return _client
