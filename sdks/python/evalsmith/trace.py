"""Trace and Span context managers for manual instrumentation."""

from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone
from typing import Any, Callable


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _ts_to_iso(ts: float) -> str:
    if ts == 0:
        return ""
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class Span:
    """Represents a single execution step within a Trace."""

    def __init__(
        self,
        name: str,
        span_type: str = "custom",
        parent_span_id: str | None = None,
        on_exit: Callable[[Span], None] | None = None,
    ):
        self.span_id = f"sp_{uuid.uuid4().hex[:12]}"
        self.parent_span_id = parent_span_id
        self.name = name
        self.span_type = span_type
        self.status = "ok"
        self.start_time: float = 0
        self.end_time: float = 0
        self.input: Any = None
        self.output: Any = None
        self.model: str | None = None
        self.token_input: int = 0
        self.token_output: int = 0
        self.cost_usd: float = 0.0
        self.metadata: dict = {}
        self.events: list[dict] = []
        self.error_message: str | None = None
        self.children: list[Span] = []
        self._on_exit = on_exit

    def set_input(self, value: Any):
        self.input = value
        return self

    def set_output(self, value: Any):
        self.output = value
        return self

    def set_metadata(self, **values: Any):
        self.metadata.update(values)
        return self

    def set_model(self, model: str, token_input: int = 0, token_output: int = 0, cost_usd: float = 0.0):
        self.model = model
        self.token_input = token_input
        self.token_output = token_output
        self.cost_usd = cost_usd
        return self

    def set_error(self, message: str):
        self.status = "error"
        self.error_message = message
        return self

    def add_event(self, name: str, attributes: dict | None = None):
        self.events.append(
            {
                "name": name,
                "timestamp": _iso_now(),
                "attributes": attributes or {},
            }
        )
        return self

    def to_dict(self) -> dict:
        payload: dict[str, Any] = {
            "span_id": self.span_id,
            "parent_span_id": self.parent_span_id,
            "name": self.name,
            "span_type": self.span_type,
            "status": self.status,
            "start_time": _ts_to_iso(self.start_time),
            "end_time": _ts_to_iso(self.end_time),
            "input": self.input,
            "output": self.output,
            "metadata": self.metadata,
            "events": self.events,
            "metrics": {
                "model": self.model,
                "token_input": self.token_input,
                "token_output": self.token_output,
                "cost_usd": self.cost_usd,
            },
        }
        if self.error_message:
            payload["error_message"] = self.error_message
        return payload

    def __enter__(self):
        self.start_time = time.time()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.end_time = time.time()
        if exc_type is not None:
            self.set_error(str(exc_val))
        if self._on_exit is not None:
            self._on_exit(self)
        return False


class Trace:
    """Represents a complete agent execution trace."""

    def __init__(self, name: str, tags: list[str] | None = None, metadata: dict | None = None):
        self.trace_id = f"tr_{uuid.uuid4().hex[:12]}"
        self.name = name
        self.tags = tags or []
        self.metadata = metadata or {}
        self.spans: list[Span] = []
        self._span_stack: list[Span] = []
        self.start_time: float = 0
        self.end_time: float = 0

    def span(self, name: str, span_type: str = "custom") -> Span:
        """Create a child span. Use as a context manager."""

        parent = self._span_stack[-1] if self._span_stack else None
        span = Span(
            name=name,
            span_type=span_type,
            parent_span_id=parent.span_id if parent else None,
            on_exit=self._on_span_exit,
        )
        if parent is not None:
            parent.children.append(span)
        self.spans.append(span)
        self._span_stack.append(span)
        return span

    def to_dict(self) -> dict:
        return {
            "trace_id": self.trace_id,
            "name": self.name,
            "tags": self.tags,
            "metadata": self.metadata,
            "spans": [span.to_dict() for span in self.spans],
        }

    def __enter__(self):
        self.start_time = time.time()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.end_time = time.time()
        if exc_type is not None and self._span_stack:
            self._span_stack[-1].set_error(str(exc_val))

        import evalsmith

        client = evalsmith.get_client()
        client.enqueue_trace(self.to_dict())
        return False

    def _on_span_exit(self, span: Span) -> None:
        if self._span_stack and self._span_stack[-1].span_id == span.span_id:
            self._span_stack.pop()
            return
        self._span_stack = [item for item in self._span_stack if item.span_id != span.span_id]
