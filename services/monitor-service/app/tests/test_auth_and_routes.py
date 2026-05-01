from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest
from starlette.requests import Request

from app import auth as auth_module
from app.auth import AccessContext
from app.main import create_rule, list_alerts, list_rules, run_rule
from app.schemas import GuardrailConfig, MonitorAlertResponse, MonitorRuleCreate, MonitorRuleResponse


def build_request(headers: dict[str, str]) -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [(key.lower().encode("utf-8"), value.encode("utf-8")) for key, value in headers.items()],
    }

    async def receive() -> dict[str, Any]:
        return {"type": "http.request", "body": b"", "more_body": False}

    return Request(scope, receive)


@pytest.mark.asyncio
async def test_get_access_context_accepts_internal_token(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(auth_module.settings, "internal_service_token", "internal-test-token")
    request = build_request(
        {
            "X-Project-ID": "proj_monitor",
            "X-Internal-Service-Token": "internal-test-token",
        }
    )

    access = await auth_module.get_access_context(request, "proj_monitor")

    assert access.project_id == "proj_monitor"
    assert access.auth_method == "internal"
    assert access.role == "owner"


@pytest.mark.asyncio
async def test_create_rule_uses_access_project(monkeypatch: pytest.MonkeyPatch):
    captured: dict[str, Any] = {}

    async def fake_create_rule(project_id: str, body: MonitorRuleCreate):
        captured["project_id"] = project_id
        captured["name"] = body.name
        return {
            "id": "mon_1",
            "project_id": project_id,
            "name": body.name,
            "description": body.description,
            "status": body.status,
            "sampling_rate": body.sampling_rate,
            "evaluator_ids": body.evaluator_ids,
            "threshold": body.threshold,
            "severity": body.severity,
            "backfill_dataset_id": body.backfill_dataset_id,
            "backfill_split": body.backfill_split,
            "auto_annotation": body.auto_annotation,
            "guardrail_config": body.guardrail_config,
            "last_checked_at": None,
            "created_at": datetime.now(UTC),
            "updated_at": datetime.now(UTC),
        }

    monkeypatch.setattr("app.main.service.create_rule", fake_create_rule)

    response = await create_rule(
        MonitorRuleCreate(
            name="latency-guard",
            guardrail_config=GuardrailConfig(require_non_empty_output=True),
        ),
        access=AccessContext(user_id="user_1", project_id="proj_monitor", role="developer", auth_method="session"),
    )

    assert response.code == 0
    assert captured == {"project_id": "proj_monitor", "name": "latency-guard"}


@pytest.mark.asyncio
async def test_run_rule_maps_missing_rule(monkeypatch: pytest.MonkeyPatch):
    async def fake_process_rule_by_id(project_id: str, rule_id: str):
        raise ValueError(f"{project_id}:{rule_id}")

    monkeypatch.setattr("app.main.service.process_rule_by_id", fake_process_rule_by_id)

    response = await run_rule(
        "rule_missing",
        access=AccessContext(user_id="user_1", project_id="proj_monitor", role="developer", auth_method="session"),
    )

    assert response.code == 404
    assert response.message == "Rule not found"


@pytest.mark.asyncio
async def test_list_rules_returns_paginated_payload(monkeypatch: pytest.MonkeyPatch):
    captured: dict[str, Any] = {}

    async def fake_list_rules(
        project_id: str,
        *,
        page: int = 1,
        page_size: int = 20,
        query: str | None = None,
        status: str | None = None,
    ):
        captured.update(
            {
                "project_id": project_id,
                "page": page,
                "page_size": page_size,
                "query": query,
                "status": status,
            }
        )
        return (
            [
                MonitorRuleResponse(
                    id="mon_1",
                    project_id=project_id,
                    name="latency-guard",
                    description="p95 latency guard",
                    status="active",
                    sampling_rate=1.0,
                    evaluator_ids=["builtin:not_empty"],
                    threshold=0.7,
                    severity="warning",
                    guardrail_config=GuardrailConfig(),
                )
            ],
            9,
        )

    monkeypatch.setattr("app.main.service.list_rules", fake_list_rules)

    response = await list_rules(
        page=2,
        page_size=4,
        query="latency",
        status="active",
        access=AccessContext(user_id="user_1", project_id="proj_monitor", role="developer", auth_method="session"),
    )

    assert response.code == 0
    assert response.data is not None
    assert response.data.total == 9
    assert response.data.page == 2
    assert response.data.page_size == 4
    assert response.data.total_pages == 3
    assert response.data.items[0].id == "mon_1"
    assert captured == {
        "project_id": "proj_monitor",
        "page": 2,
        "page_size": 4,
        "query": "latency",
        "status": "active",
    }


@pytest.mark.asyncio
async def test_list_alerts_returns_paginated_payload(monkeypatch: pytest.MonkeyPatch):
    captured: dict[str, Any] = {}

    async def fake_list_alerts(
        project_id: str,
        *,
        status: str | None = None,
        page: int = 1,
        page_size: int = 20,
        query: str | None = None,
    ):
        captured.update(
            {
                "project_id": project_id,
                "page": page,
                "page_size": page_size,
                "query": query,
                "status": status,
            }
        )
        return (
            [
                MonitorAlertResponse(
                    id="al_1",
                    rule_id="mon_1",
                    run_id="run_1",
                    project_id=project_id,
                    trace_id="trace_1",
                    kind="score",
                    severity="warning",
                    status="open",
                    title="score dropped",
                    summary="score below threshold",
                )
            ],
            5,
        )

    monkeypatch.setattr("app.main.service.list_alerts", fake_list_alerts)

    response = await list_alerts(
        status="open",
        page=1,
        page_size=3,
        query="trace_1",
        access=AccessContext(user_id="user_1", project_id="proj_monitor", role="developer", auth_method="session"),
    )

    assert response.code == 0
    assert response.data is not None
    assert response.data.total == 5
    assert response.data.page == 1
    assert response.data.page_size == 3
    assert response.data.total_pages == 2
    assert response.data.items[0].id == "al_1"
    assert captured == {
        "project_id": "proj_monitor",
        "page": 1,
        "page_size": 3,
        "query": "trace_1",
        "status": "open",
    }
