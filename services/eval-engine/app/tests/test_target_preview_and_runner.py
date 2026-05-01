from __future__ import annotations

import httpx
import pytest
from fastapi import HTTPException

from app.api import experiments
from app.auth import AccessContext
from app.models.schemas import ExperimentTargetPreviewRequest
from app.workflow import runner
from app.workflow.runner import (
    TargetConfigError,
    TargetEndpointUnavailableError,
    TargetInvocationResult,
)


def test_extract_target_output_supports_nested_response_path():
    payload = {
        "data": {
            "messages": [
                {"answer": "hello world"},
            ]
        }
    }

    assert runner._extract_target_output(payload, "data.messages[0].answer") == "hello world"

    with pytest.raises(TargetConfigError):
        runner._extract_target_output(payload, "data.messages[1].answer")


def test_extract_target_output_auto_detects_nested_answer():
    payload = {
        "data": {
            "answer": "nested hello",
        }
    }

    assert runner._extract_target_output(payload, None) == "nested hello"


def test_validate_target_config_rejects_invalid_response_path():
    with pytest.raises(TargetConfigError):
        runner.validate_target_config(
            target_url="http://agent.local/answer",
            target_method="POST",
            target_headers={"Authorization": "Bearer demo"},
            target_body_template='{"input": {{inputs.question}}}',
            target_response_path="data.answer[foo]",
            target_timeout_ms=120000,
        )


@pytest.mark.asyncio
async def test_invoke_target_endpoint_extracts_output_and_trace(monkeypatch: pytest.MonkeyPatch):
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url == httpx.URL("http://agent.local/answer")
        assert request.headers["content-type"] == "application/json"
        assert request.content.decode("utf-8") == '{"input":"How are you?"}'
        return httpx.Response(
            200,
            json={
                "trace_id": "trace_demo_1",
                "data": {"answer": "Everything looks good."},
            },
        )

    transport = httpx.MockTransport(handler)
    original_client = runner.httpx.AsyncClient

    def build_client(*args, **kwargs):
        return original_client(*args, transport=transport, **kwargs)

    monkeypatch.setattr(runner.httpx, "AsyncClient", build_client)

    result = await runner.invoke_target_endpoint(
        target_url="http://agent.local/answer",
        target_method="POST",
        target_body_template='{"input": {{inputs.question}}}',
        target_response_path="data.answer",
        example={"inputs": {"question": "How are you?"}},
    )

    assert result.output == "Everything looks good."
    assert result.trace_id == "trace_demo_1"
    assert result.response_status_code == 200
    assert result.request_body == {"input": "How are you?"}


@pytest.mark.asyncio
async def test_preview_experiment_target_returns_preview_payload(monkeypatch: pytest.MonkeyPatch):
    async def fake_invoke_target_endpoint(**_: object) -> TargetInvocationResult:
        return TargetInvocationResult(
            request_method="POST",
            request_url="http://agent.local/answer",
            request_body={"input": "ping"},
            response_status_code=200,
            response_path_used="data.answer",
            latency_ms=28,
            trace_id="trace_preview_1",
            output="pong",
            raw_response={"data": {"answer": "pong"}, "trace_id": "trace_preview_1"},
        )

    monkeypatch.setattr(experiments, "invoke_target_endpoint", fake_invoke_target_endpoint)

    response = await experiments.preview_experiment_target(
        ExperimentTargetPreviewRequest(
            target_url="http://agent.local/answer",
            target_response_path="data.answer",
            example={
                "id": "ex_1",
                "inputs": {"input": "ping"},
                "metadata": {},
                "split": "default",
            },
        ),
        AccessContext(user_id="user_1", project_id="proj_eval", role="developer", auth_method="session"),
    )

    assert response.code == 0
    assert response.data is not None
    assert response.data.output == "pong"
    assert response.data.trace_id == "trace_preview_1"
    assert response.data.response_path_used == "data.answer"


@pytest.mark.asyncio
async def test_preview_experiment_target_maps_unavailable_target_error(monkeypatch: pytest.MonkeyPatch):
    async def fake_invoke_target_endpoint(**_: object) -> TargetInvocationResult:
        raise TargetEndpointUnavailableError("Target endpoint timed out", reason="timeout")

    monkeypatch.setattr(experiments, "invoke_target_endpoint", fake_invoke_target_endpoint)

    with pytest.raises(HTTPException) as excinfo:
        await experiments.preview_experiment_target(
            ExperimentTargetPreviewRequest(
                target_url="http://agent.local/answer",
                target_response_path="data.answer",
                example={
                    "id": "ex_1",
                    "inputs": {"input": "ping"},
                    "metadata": {},
                    "split": "default",
                },
            ),
            AccessContext(user_id="user_1", project_id="proj_eval", role="developer", auth_method="session"),
        )

    assert excinfo.value.status_code == 502
    assert excinfo.value.detail["details"]["reason"] == "timeout"
