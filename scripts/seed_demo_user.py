#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
import time
from dataclasses import dataclass

import httpx


DEFAULT_AUTH_URL = "http://127.0.0.1:8004"
DEFAULT_DEMO_EMAIL = "demo@evalsmith.local"
DEFAULT_DEMO_NAME = "EvalSmith Demo"

# This is intentionally public and only used by the Docker Compose trial stack.
PUBLIC_TRIAL_LOGIN_PHRASE = "evalsmith-demo"

TRUE_VALUES = {"1", "true", "yes", "y", "on"}
FALSE_VALUES = {"0", "false", "no", "n", "off"}


@dataclass(frozen=True)
class DemoUserConfig:
    enabled: bool
    auth_url: str
    email: str
    name: str
    login_phrase: str
    startup_timeout_seconds: float
    request_timeout_seconds: float


def read_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default

    value = raw.strip().lower()
    if value in TRUE_VALUES:
        return True
    if value in FALSE_VALUES:
        return False
    raise ValueError(f"{name} must be one of: true, false, 1, 0, yes, no")


def read_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = float(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be a number") from exc
    if value <= 0:
        raise ValueError(f"{name} must be greater than zero")
    return value


def read_config() -> DemoUserConfig:
    auth_url = os.getenv("EVALSMITH_AUTH_URL") or os.getenv("AUTH_SERVICE_URL") or DEFAULT_AUTH_URL
    login_phrase = os.getenv("EVALSMITH_DEMO_USER_PASSWORD") or PUBLIC_TRIAL_LOGIN_PHRASE

    return DemoUserConfig(
        enabled=read_bool("EVALSMITH_DEMO_USER_ENABLED", True),
        auth_url=auth_url.rstrip("/"),
        email=(os.getenv("EVALSMITH_DEMO_USER_EMAIL") or DEFAULT_DEMO_EMAIL).strip().lower(),
        name=(os.getenv("EVALSMITH_DEMO_USER_NAME") or DEFAULT_DEMO_NAME).strip(),
        login_phrase=login_phrase.strip(),
        startup_timeout_seconds=read_float("EVALSMITH_DEMO_USER_STARTUP_TIMEOUT_SECONDS", 240),
        request_timeout_seconds=read_float("EVALSMITH_DEMO_USER_REQUEST_TIMEOUT_SECONDS", 180),
    )


def envelope_success(response: httpx.Response) -> bool:
    try:
        payload = response.json()
    except ValueError:
        return False
    return isinstance(payload, dict) and payload.get("code") == 0


def wait_for_auth(client: httpx.Client, timeout_seconds: float) -> None:
    deadline = time.monotonic() + timeout_seconds
    last_error = "auth service did not respond"

    while time.monotonic() < deadline:
        try:
            response = client.get("/health", timeout=10)
            if response.status_code < 500:
                return
            last_error = f"auth health returned HTTP {response.status_code}"
        except httpx.HTTPError as exc:
            last_error = str(exc)
        time.sleep(2)

    raise RuntimeError(f"timed out waiting for auth service: {last_error}")


def verify_existing_login(client: httpx.Client, config: DemoUserConfig) -> bool:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": config.email, "password": config.login_phrase},
        timeout=config.request_timeout_seconds,
    )
    return response.status_code == 200 and envelope_success(response)


def seed_demo_user(config: DemoUserConfig) -> int:
    if not config.enabled:
        print("[seed-demo-user] skipped; EVALSMITH_DEMO_USER_ENABLED=false")
        return 0

    if not config.email or "@" not in config.email:
        print("[seed-demo-user] invalid demo user email", file=sys.stderr)
        return 1
    if not config.name:
        print("[seed-demo-user] invalid demo user name", file=sys.stderr)
        return 1
    if len(config.login_phrase) < 8:
        print("[seed-demo-user] demo login phrase must be at least 8 characters", file=sys.stderr)
        return 1

    timeout = httpx.Timeout(
        config.request_timeout_seconds,
        connect=min(10.0, config.request_timeout_seconds),
    )
    with httpx.Client(base_url=config.auth_url, timeout=timeout) as client:
        wait_for_auth(client, config.startup_timeout_seconds)

        response = client.post(
            "/api/v1/auth/register",
            json={"email": config.email, "name": config.name, "password": config.login_phrase},
            timeout=config.request_timeout_seconds,
        )

        if response.status_code in {200, 201} and envelope_success(response):
            print(f"[seed-demo-user] created local trial account {config.email}")
            return 0

        if response.status_code == 409:
            if verify_existing_login(client, config):
                print(f"[seed-demo-user] local trial account {config.email} already exists")
                return 0

            print(
                f"[seed-demo-user] account {config.email} already exists with a different login phrase; "
                "leaving it unchanged"
            )
            return 0

        print(
            f"[seed-demo-user] failed to create demo account: HTTP {response.status_code} {response.text[:300]}",
            file=sys.stderr,
        )
        return 1


def main() -> int:
    try:
        config = read_config()
    except ValueError as exc:
        print(f"[seed-demo-user] {exc}", file=sys.stderr)
        return 1

    try:
        return seed_demo_user(config)
    except Exception as exc:
        print(f"[seed-demo-user] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
