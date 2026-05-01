from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

import httpx
from fastapi import Depends, Header, HTTPException, Request

from app.settings import settings

WRITE_ROLES = ("owner", "admin", "developer")
INTERNAL_TOKEN_HEADER = "X-Internal-Service-Token"


@dataclass
class AccessContext:
    user_id: str
    project_id: str
    role: str
    auth_method: str
    key_id: str | None = None
    session_id: str | None = None


def raise_api_error(status_code: int, message: str, details: Any = None) -> None:
    raise HTTPException(
        status_code=status_code,
        detail={
            "code": -1,
            "message": message,
            "details": details,
        },
    )


def build_internal_headers(project_id: str) -> dict[str, str]:
    headers = {"X-Project-ID": project_id}
    if settings.internal_service_token:
        headers[INTERNAL_TOKEN_HEADER] = settings.internal_service_token
    return headers


async def get_access_context(
    request: Request,
    x_project_id: str | None = Header(default=None),
) -> AccessContext:
    project_id = (x_project_id or "").strip()
    if not project_id:
        raise_api_error(400, "missing X-Project-ID header")

    internal_token = (request.headers.get(INTERNAL_TOKEN_HEADER) or "").strip()
    if settings.internal_service_token and internal_token == settings.internal_service_token:
        return AccessContext(
            user_id="internal",
            project_id=project_id,
            role="owner",
            auth_method="internal",
        )

    headers = {"X-Project-ID": project_id}
    if authorization := request.headers.get("Authorization"):
        headers["Authorization"] = authorization
    if cookie := request.headers.get("Cookie"):
        headers["Cookie"] = cookie

    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            response = await client.get(
                f"{settings.auth_service_url.rstrip('/')}/api/v1/auth/access",
                headers=headers,
            )
        except httpx.HTTPError as exc:
            raise_api_error(502, f"auth service unavailable: {exc}")  # pragma: no cover

    try:
        payload = response.json()
    except ValueError:
        raise_api_error(502, "invalid auth service response")

    if response.status_code >= 400 or payload.get("code") != 0:
        message = _extract_error_message(payload)
        raise_api_error(response.status_code or 403, message)

    data = payload.get("data") or {}
    return AccessContext(
        user_id=str(data.get("user_id") or ""),
        project_id=str(data.get("project_id") or project_id),
        role=str(data.get("role") or ""),
        auth_method=str(data.get("auth_method") or ""),
        key_id=_optional_string(data.get("key_id")),
        session_id=_optional_string(data.get("session_id")),
    )


def require_roles(*roles: str) -> Callable[[AccessContext], AccessContext]:
    allowed = set(roles)

    async def dependency(access: AccessContext = Depends(get_access_context)) -> AccessContext:
        if access.auth_method == "internal" or access.role in allowed:
            return access
        raise_api_error(403, "forbidden")

    return dependency


def _extract_error_message(payload: Any) -> str:
    if isinstance(payload, dict):
        message = payload.get("message")
        if isinstance(message, str) and message.strip():
            return message
        detail = payload.get("detail")
        if isinstance(detail, dict):
            inner_message = detail.get("message")
            if isinstance(inner_message, str) and inner_message.strip():
                return inner_message
        if isinstance(detail, str) and detail.strip():
            return detail
    return "access denied"


def _optional_string(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value
    return None
