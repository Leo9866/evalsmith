from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from app.auth import build_internal_headers
from app.settings import settings


@dataclass
class ResolvedProjectModel:
    id: str
    name: str
    provider: str
    protocol: str
    base_url: str
    model: str
    api_key: str
    extra_config: dict[str, Any]
    capabilities: list[str]
    is_default_judge: bool


async def resolve_project_model(
    *,
    project_id: str,
    model_id: str | None = None,
    use_default: bool = False,
) -> ResolvedProjectModel:
    suffix = "/default/resolved" if use_default or not model_id else f"/{model_id}/resolved"
    url = f"{settings.auth_service_url.rstrip('/')}/api/internal/v1/projects/{project_id}/models{suffix}"

    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(url, headers=build_internal_headers(project_id))

    try:
        payload = response.json()
    except ValueError as exc:  # pragma: no cover - defensive boundary
        raise ValueError(f"invalid auth-service response: {exc}") from exc

    if response.status_code >= 400 or payload.get("code") != 0:
        message = _extract_message(payload)
        raise ValueError(message)

    data = payload.get("data") or {}
    return ResolvedProjectModel(
        id=str(data.get("id") or ""),
        name=str(data.get("name") or ""),
        provider=str(data.get("provider") or ""),
        protocol=str(data.get("protocol") or "openai"),
        base_url=str(data.get("base_url") or ""),
        model=str(data.get("model") or ""),
        api_key=str(data.get("api_key") or ""),
        extra_config=dict(data.get("extra_config") or {}),
        capabilities=list(data.get("capabilities") or []),
        is_default_judge=bool(data.get("is_default_judge")),
    )


def _extract_message(payload: Any) -> str:
    if isinstance(payload, dict):
        message = payload.get("message")
        if isinstance(message, str) and message.strip():
            return message
        details = payload.get("details")
        if isinstance(details, dict):
            detail_message = details.get("message")
            if isinstance(detail_message, str) and detail_message.strip():
                return detail_message
    return "failed to resolve project model"
