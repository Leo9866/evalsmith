from __future__ import annotations

import httpx
import pytest

from app.api import experiments, prompts
from app.auth import AccessContext
from app.models.schemas import (
    ExperimentCreate,
    ExperimentPromptRef,
    ExperimentPromptSnapshot,
    ExperimentResponse,
    ExperimentStatus,
    PromptRenderPreviewRequest,
)
from app.workflow import runner


@pytest.mark.asyncio
async def test_render_prompt_preview_returns_rendered_prompt(monkeypatch: pytest.MonkeyPatch):
    async def fake_get_prompt_snapshot(prompt_id: str, project_id: str, version: int | None = None):
        assert prompt_id == "prm_support"
        assert project_id == "proj_eval"
        assert version == 3
        return ExperimentPromptSnapshot(
            prompt_id="prm_support",
            prompt_name="客服 Prompt",
            version=3,
            system_prompt="你是客服助手",
            user_prompt_template="用户问题：{{inputs.input}}",
            variables_schema={},
            render_config={},
        )

    monkeypatch.setattr(prompts.prompt_repo, "get_prompt_snapshot", fake_get_prompt_snapshot)

    response = await prompts.render_prompt_preview(
        "prm_support",
        PromptRenderPreviewRequest(
            version=3,
            sample={
                "inputs": {"input": "如何重置密钥？"},
                "expected_outputs": "进入设置页重置。",
                "metadata": {"lang": "zh-CN"},
            },
        ),
        AccessContext(user_id="user_1", project_id="proj_eval", role="developer", auth_method="session"),
    )

    assert response.code == 0
    assert response.data is not None
    assert response.data.system_prompt == "你是客服助手"
    assert response.data.user_prompt == "用户问题：如何重置密钥？"
    assert response.data.messages[0].role == "system"
    assert response.data.messages[1].role == "user"


@pytest.mark.asyncio
async def test_create_experiment_persists_prompt_snapshot(monkeypatch: pytest.MonkeyPatch):
    captured: dict[str, object] = {}

    async def fake_get_prompt_snapshot(prompt_id: str, project_id: str, version: int | None = None):
        assert prompt_id == "prm_support"
        assert project_id == "proj_eval"
        assert version == 3
        return ExperimentPromptSnapshot(
            prompt_id="prm_support",
            prompt_name="客服 Prompt",
            version=3,
            system_prompt="你是客服助手",
            user_prompt_template="用户问题：{{inputs.input}}",
            variables_schema={},
            render_config={},
        )

    async def fake_create_experiment(
        body: ExperimentCreate,
        project_id: str,
        *,
        prompt_ref: ExperimentPromptRef | None = None,
        prompt_snapshot: ExperimentPromptSnapshot | None = None,
    ):
        captured["project_id"] = project_id
        captured["prompt_ref"] = prompt_ref
        captured["prompt_snapshot"] = prompt_snapshot
        return ExperimentResponse(
            id="exp_prompt_1",
            name=body.name,
            description=body.description,
            dataset_id=body.dataset_id,
            dataset_version=body.dataset_version,
            split=body.split,
            evaluator_ids=body.evaluator_ids,
            target_url=body.target_url,
            target_method=body.target_method,
            target_headers=body.target_headers,
            target_body_template=body.target_body_template,
            target_response_path=body.target_response_path,
            target_timeout_ms=body.target_timeout_ms,
            concurrency=body.concurrency,
            prompt_ref=prompt_ref,
            prompt_snapshot=prompt_snapshot,
            status=ExperimentStatus.PENDING,
            project_id=project_id,
        )

    async def fake_enqueue_experiment_job(experiment_id: str, project_id: str, payload: dict, max_attempts: int = 3):
        captured["payload"] = payload
        return "job_1"

    monkeypatch.setattr(experiments.prompt_repo, "get_prompt_snapshot", fake_get_prompt_snapshot)
    monkeypatch.setattr(experiments.experiment_repo, "create_experiment", fake_create_experiment)
    monkeypatch.setattr(experiments.experiment_repo, "enqueue_experiment_job", fake_enqueue_experiment_job)

    response = await experiments.create_experiment(
        ExperimentCreate(
            name="prompt regression",
            description="verify prompt binding",
            dataset_id="ds_1",
            dataset_version=2,
            split="default",
            evaluator_ids=["builtin:not_empty"],
            target_url="http://agent.local/answer",
            target_body_template='{"messages": {{prompt.messages}}}',
            prompt_ref={"prompt_id": "prm_support", "version": 3},
        ),
        AccessContext(user_id="user_1", project_id="proj_eval", role="developer", auth_method="session"),
    )

    assert response.code == 0
    assert response.data is not None
    assert response.data.prompt_snapshot is not None
    assert response.data.prompt_snapshot.prompt_name == "客服 Prompt"
    assert captured["project_id"] == "proj_eval"
    payload = captured["payload"]
    assert isinstance(payload, dict)
    assert payload["prompt_ref"] == {"prompt_id": "prm_support", "version": 3}
    assert payload["prompt_snapshot"]["prompt_id"] == "prm_support"
    assert payload["prompt_snapshot"]["version"] == 3


@pytest.mark.asyncio
async def test_invoke_target_endpoint_renders_prompt_context(monkeypatch: pytest.MonkeyPatch):
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.content.decode("utf-8") == '{"messages":[{"role":"system","content":"你是客服助手"},{"role":"user","content":"用户问题：如何回滚版本？"}]}'
        return httpx.Response(200, json={"answer": "ok"})

    transport = httpx.MockTransport(handler)
    original_client = runner.httpx.AsyncClient

    def build_client(*args, **kwargs):
        return original_client(*args, transport=transport, **kwargs)

    monkeypatch.setattr(runner.httpx, "AsyncClient", build_client)

    result = await runner.invoke_target_endpoint(
        target_url="http://agent.local/answer",
        target_body_template='{"messages": {{prompt.messages}}}',
        prompt_snapshot={
            "prompt_id": "prm_support",
            "prompt_name": "客服 Prompt",
            "version": 3,
            "system_prompt": "你是客服助手",
            "user_prompt_template": "用户问题：{{inputs.input}}",
            "variables_schema": {},
            "render_config": {},
            "template_engine": "mustache",
        },
        example={"inputs": {"input": "如何回滚版本？"}},
    )

    assert result.output == "ok"
    assert result.prompt_preview is not None
    assert result.prompt_preview["user_prompt"] == "用户问题：如何回滚版本？"
