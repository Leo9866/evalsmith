"""@traceable decorator for automatic trace collection."""

from __future__ import annotations

import functools
import inspect
import time
from typing import Any, Callable

from evalsmith.trace import Trace, Span


def traceable(
    name: str | None = None,
    tags: list[str] | None = None,
    metadata: dict | None = None,
    capture_input: bool = True,
    capture_output: bool = True,
):
    """Decorator to automatically trace a function.

    Usage:
        @traceable(name="my_agent")
        def my_agent(query: str) -> str:
            return llm.chat(query)

        @traceable()
        async def my_async_agent(query: str) -> str:
            return await llm.achat(query)
    """

    def decorator(func: Callable) -> Callable:
        trace_name = name or func.__name__

        if inspect.iscoroutinefunction(func):

            @functools.wraps(func)
            async def async_wrapper(*args, **kwargs):
                with Trace(name=trace_name, tags=tags, metadata=metadata) as t:
                    with t.span(name=trace_name, span_type="agent") as s:
                        if capture_input:
                            s.set_input(_capture_args(func, args, kwargs))
                        try:
                            result = await func(*args, **kwargs)
                            if capture_output:
                                s.set_output(_safe_serialize(result))
                            return result
                        except Exception as e:
                            s.set_error(str(e))
                            raise

            return async_wrapper
        else:

            @functools.wraps(func)
            def sync_wrapper(*args, **kwargs):
                with Trace(name=trace_name, tags=tags, metadata=metadata) as t:
                    with t.span(name=trace_name, span_type="agent") as s:
                        if capture_input:
                            s.set_input(_capture_args(func, args, kwargs))
                        try:
                            result = func(*args, **kwargs)
                            if capture_output:
                                s.set_output(_safe_serialize(result))
                            return result
                        except Exception as e:
                            s.set_error(str(e))
                            raise

            return sync_wrapper

    return decorator


def _capture_args(func: Callable, args: tuple, kwargs: dict) -> dict:
    """Capture function arguments as a dict."""
    sig = inspect.signature(func)
    bound = sig.bind(*args, **kwargs)
    bound.apply_defaults()
    return {k: _safe_serialize(v) for k, v in bound.arguments.items()}


def _safe_serialize(value: Any) -> Any:
    """Best-effort serialization for trace data."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, tuple)):
        return [_safe_serialize(v) for v in value[:100]]
    if isinstance(value, dict):
        return {str(k): _safe_serialize(v) for k, v in list(value.items())[:100]}
    return str(value)[:1000]
