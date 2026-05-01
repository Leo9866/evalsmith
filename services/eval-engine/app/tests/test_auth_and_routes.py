from __future__ import annotations

from typing import Any

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app import auth as auth_module
from app.api import evaluators, experiments
from app.auth import AccessContext, WRITE_ROLES, require_roles
from app.models.schemas import (
    ExperimentBaselineSetRequest,
    ExperimentCompareRequest,
    ExperimentResponse,
    ExperimentStatus,
)


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
            "X-Project-ID": "proj_eval",
            "X-Internal-Service-Token": "internal-test-token",
        }
    )

    access = await auth_module.get_access_context(request, "proj_eval")

    assert access.project_id == "proj_eval"
    assert access.auth_method == "internal"
    assert access.role == "owner"


@pytest.mark.asyncio
async def test_require_roles_rejects_viewer():
    dependency = require_roles(*WRITE_ROLES)

    with pytest.raises(HTTPException) as excinfo:
        await dependency(AccessContext(user_id="user_1", project_id="proj_eval", role="viewer", auth_method="session"))

    assert excinfo.value.status_code == 403


@pytest.mark.asyncio
async def test_test_evaluator_config_returns_rule_result():
    response = await evaluators.test_evaluator_config(
        {
            "config": {
                "type": "rule",
                "rule_config": {
                    "kind": "not_empty",
                },
            },
            "eval_input": {
                "input": "hello",
                "output": "world",
            },
        },
        AccessContext(user_id="user_1", project_id="proj_eval", role="developer", auth_method="session"),
    )

    assert response.code == 0
    assert response.data is not None
    assert response.data.score == 1.0


@pytest.mark.asyncio
async def test_get_builtin_evaluator_returns_cloneable_config(monkeypatch: pytest.MonkeyPatch):
    class FakeBuiltin:
        name = "contains"
        type = "rule"
        keywords = ["safe", "helpful"]
        mode = "all"

    monkeypatch.setattr(evaluators.registry, "get", lambda name: FakeBuiltin() if name == "contains" else None)

    response = await evaluators.get_evaluator(
        "builtin:contains",
        access=AccessContext(user_id="user_1", project_id="proj_eval", role="developer", auth_method="session"),
    )

    assert response.code == 0
    assert response.data.config.rule_config is not None
    assert response.data.config.rule_config.kind.value == "contains"
    assert response.data.config.rule_config.keywords == ["safe", "helpful"]
    assert response.data.config.rule_config.mode.value == "all"


@pytest.mark.asyncio
async def test_list_builtin_evaluator_versions_returns_current_entry(monkeypatch: pytest.MonkeyPatch):
    class FakeBuiltin:
        name = "contains"
        type = "rule"
        keywords = ["safe"]
        mode = "any"

    monkeypatch.setattr(evaluators.registry, "get", lambda name: FakeBuiltin() if name == "contains" else None)

    response = await evaluators.list_evaluator_versions(
        "builtin:contains",
        access=AccessContext(user_id="user_1", project_id="proj_eval", role="developer", auth_method="session"),
    )

    assert response.code == 0
    assert len(response.data) == 1
    assert response.data[0]["is_current"] is True
    assert response.data[0]["version"] == 1
    assert response.data[0]["config"]["rule_config"]["kind"] == "contains"


@pytest.mark.asyncio
async def test_update_builtin_evaluator_rejected():
    from app.models.schemas import EvaluatorConfig, EvaluatorCreate, EvaluatorType, RuleConfig

    response = await evaluators.update_evaluator(
        "builtin:contains",
        EvaluatorCreate(
            name="contains",
            description="should fail",
            config=EvaluatorConfig(
                type=EvaluatorType.RULE,
                rule_config=RuleConfig(kind="contains", keywords=["safe"], mode="all"),
            ),
        ),
        access=AccessContext(user_id="user_1", project_id="proj_eval", role="developer", auth_method="session"),
    )

    assert response.code == 409
    assert response.message == "Built-in evaluator is read-only. Clone it to create a custom evaluator."


@pytest.mark.asyncio
async def test_delete_builtin_evaluator_rejected():
    response = await evaluators.delete_evaluator(
        "builtin:contains",
        access=AccessContext(user_id="user_1", project_id="proj_eval", role="developer", auth_method="session"),
    )

    assert response.code == 409
    assert response.message == "Built-in evaluator is read-only. Clone it to create a custom evaluator."


@pytest.mark.asyncio
async def test_list_custom_evaluator_versions_prepends_current(monkeypatch: pytest.MonkeyPatch):
    from app.models.schemas import EvaluatorConfig, EvaluatorResponse, EvaluatorType, RuleConfig

    async def fake_get_evaluator(evaluator_id: str, project_id: str):
        assert evaluator_id == "ev_custom"
        assert project_id == "proj_eval"
        return EvaluatorResponse(
            id="ev_custom",
            name="custom_guard",
            type=EvaluatorType.RULE,
            description="custom desc",
            config=EvaluatorConfig(
                type=EvaluatorType.RULE,
                rule_config=RuleConfig(kind="not_empty"),
            ),
            is_builtin=False,
            version=3,
        )

    async def fake_list_versions(evaluator_id: str, project_id: str):
        assert evaluator_id == "ev_custom"
        assert project_id == "proj_eval"
        return [
            {
                "id": "ver_2",
                "evaluator_id": "ev_custom",
                "version": 2,
                "config": {"type": "rule", "rule_config": {"kind": "contains", "keywords": ["ok"], "mode": "any"}},
                "changelog": "Superseded by v3",
                "created_at": "2026-04-06T00:00:00Z",
            }
        ]

    monkeypatch.setattr(evaluators.evaluator_repo, "get_evaluator", fake_get_evaluator)
    monkeypatch.setattr(evaluators.evaluator_repo, "list_evaluator_versions", fake_list_versions)

    response = await evaluators.list_evaluator_versions(
        "ev_custom",
        access=AccessContext(user_id="user_1", project_id="proj_eval", role="developer", auth_method="session"),
    )

    assert response.code == 0
    assert len(response.data) == 2
    assert response.data[0]["is_current"] is True
    assert response.data[0]["version"] == 3
    assert response.data[1]["is_current"] is False
    assert response.data[1]["version"] == 2


@pytest.mark.asyncio
async def test_get_evaluator_version_diff_returns_changed_fields(monkeypatch: pytest.MonkeyPatch):
    from app.models.schemas import EvaluatorConfig, EvaluatorResponse, EvaluatorType, RuleConfig

    async def fake_get_evaluator(evaluator_id: str, project_id: str):
        assert evaluator_id == "ev_custom"
        assert project_id == "proj_eval"
        return EvaluatorResponse(
            id="ev_custom",
            name="custom_guard",
            type=EvaluatorType.RULE,
            description="custom desc",
            config=EvaluatorConfig(
                type=EvaluatorType.RULE,
                rule_config=RuleConfig(kind="contains", keywords=["safe", "helpful"], mode="all"),
            ),
            is_builtin=False,
            version=3,
        )

    async def fake_list_versions(evaluator_id: str, project_id: str):
        assert evaluator_id == "ev_custom"
        assert project_id == "proj_eval"
        return [
            {
                "id": "ver_2",
                "evaluator_id": "ev_custom",
                "version": 2,
                "config": {"type": "rule", "rule_config": {"kind": "contains", "keywords": ["safe"], "mode": "any"}},
                "changelog": "Superseded by v3",
                "created_at": "2026-04-06T00:00:00Z",
            }
        ]

    monkeypatch.setattr(evaluators.evaluator_repo, "get_evaluator", fake_get_evaluator)
    monkeypatch.setattr(evaluators.evaluator_repo, "list_evaluator_versions", fake_list_versions)

    response = await evaluators.get_evaluator_version_diff(
        "ev_custom",
        version=2,
        base_version=3,
        access=AccessContext(user_id="user_1", project_id="proj_eval", role="developer", auth_method="session"),
    )

    assert response.code == 0
    assert response.data.base_version == 3
    assert response.data.target_version == 2
    changes = {item.path: item for item in response.data.changes}
    assert changes["rule_config.keywords"].before == ["safe", "helpful"]
    assert changes["rule_config.keywords"].after == ["safe"]
    assert changes["rule_config.mode"].before == "all"
    assert changes["rule_config.mode"].after == "any"


@pytest.mark.asyncio
async def test_regression_test_evaluator_runs_selected_versions(monkeypatch: pytest.MonkeyPatch):
    from app.models.schemas import EvalInput, EvalResult, EvaluatorConfig, EvaluatorRegressionTestRequest, EvaluatorResponse, EvaluatorType, RuleConfig

    async def fake_get_evaluator(evaluator_id: str, project_id: str):
        assert evaluator_id == "ev_custom"
        assert project_id == "proj_eval"
        return EvaluatorResponse(
            id="ev_custom",
            name="custom_guard",
            type=EvaluatorType.RULE,
            description="custom desc",
            config=EvaluatorConfig(
                type=EvaluatorType.RULE,
                rule_config=RuleConfig(kind="not_empty"),
            ),
            is_builtin=False,
            version=3,
        )

    async def fake_list_versions(evaluator_id: str, project_id: str):
        assert evaluator_id == "ev_custom"
        assert project_id == "proj_eval"
        return [
            {
                "id": "ver_2",
                "evaluator_id": "ev_custom",
                "version": 2,
                "config": {"type": "rule", "rule_config": {"kind": "contains", "keywords": ["safe"], "mode": "any"}},
                "changelog": "Superseded by v3",
                "created_at": "2026-04-06T00:00:00Z",
            }
        ]

    class FakeRuntime:
        def __init__(self, score: float):
            self.score = score

        async def run(self, _eval_input: EvalInput):
            return EvalResult(score=self.score, reasoning=f"score={self.score}", metadata={})

    async def fake_build_project_evaluator(_name: str, config: EvaluatorConfig, _project_id: str):
        assert config.rule_config is not None
        score = 1.0 if config.rule_config.kind.value == "not_empty" else 0.4
        return FakeRuntime(score)

    monkeypatch.setattr(evaluators.evaluator_repo, "get_evaluator", fake_get_evaluator)
    monkeypatch.setattr(evaluators.evaluator_repo, "list_evaluator_versions", fake_list_versions)
    monkeypatch.setattr(evaluators, "build_project_evaluator", fake_build_project_evaluator)

    response = await evaluators.regression_test_evaluator(
        "ev_custom",
        EvaluatorRegressionTestRequest(
            versions=[3, 2],
            samples=[
                {
                    "label": "positive",
                    "eval_input": {"input": "hello", "output": "world"},
                },
                {
                    "label": "negative",
                    "eval_input": {"input": "hello", "output": ""},
                },
            ],
        ),
        access=AccessContext(user_id="user_1", project_id="proj_eval", role="developer", auth_method="session"),
    )

    assert response.code == 0
    assert response.data.sample_count == 2
    assert [item.version for item in response.data.versions] == [3, 2]
    assert response.data.versions[0].is_current is True
    assert response.data.versions[0].avg_score == 1.0
    assert response.data.versions[0].passed == 2
    assert response.data.versions[1].avg_score == 0.4
    assert response.data.versions[1].failed == 2
    assert response.data.versions[1].sample_results[0].label == "positive"
    assert response.data.versions[1].sample_results[0].result is not None


@pytest.mark.asyncio
async def test_get_experiment_results_uses_access_project(monkeypatch: pytest.MonkeyPatch):
    captured: dict[str, Any] = {}

    async def fake_get_results(
        experiment_id: str,
        project_id: str,
        page: int = 1,
        page_size: int = 20,
        sort_by: str = "created_at",
        sort_order: str = "asc",
        max_score: float | None = None,
    ):
        captured.update(
            {
                "experiment_id": experiment_id,
                "project_id": project_id,
                "page": page,
                "page_size": page_size,
                "sort_by": sort_by,
                "sort_order": sort_order,
                "max_score": max_score,
            }
        )
        return [], 0

    monkeypatch.setattr(experiments.experiment_repo, "get_results", fake_get_results)

    response = await experiments.get_experiment_results(
        "exp_1",
        page=2,
        page_size=10,
        sort_by="score",
        sort_order="desc",
        max_score=0.5,
        access=AccessContext(user_id="user_1", project_id="proj_eval", role="developer", auth_method="session"),
    )

    assert response.code == 0
    assert captured == {
        "experiment_id": "exp_1",
        "project_id": "proj_eval",
        "page": 2,
        "page_size": 10,
        "sort_by": "score",
        "sort_order": "desc",
        "max_score": 0.5,
    }


@pytest.mark.asyncio
async def test_compare_experiments_rejects_cross_dataset_compare(monkeypatch: pytest.MonkeyPatch):
    experiments_by_id = {
        "exp_1": ExperimentResponse(
            id="exp_1",
            name="Baseline",
            description="",
            dataset_id="ds_1",
            split="default",
            evaluator_ids=["builtin:exact_match"],
            target_url="http://agent.local/a",
            target_body_template='{"input":"hi"}',
            status=ExperimentStatus.COMPLETED,
        ),
        "exp_2": ExperimentResponse(
            id="exp_2",
            name="Candidate",
            description="",
            dataset_id="ds_2",
            split="default",
            evaluator_ids=["builtin:exact_match"],
            target_url="http://agent.local/b",
            target_body_template='{"input":"hi"}',
            status=ExperimentStatus.COMPLETED,
        ),
    }

    async def fake_get_experiment(experiment_id: str, _project_id: str):
        return experiments_by_id.get(experiment_id)

    monkeypatch.setattr(experiments.experiment_repo, "get_experiment", fake_get_experiment)

    response = await experiments.compare_experiments(
        ExperimentCompareRequest(experiment_ids=["exp_1", "exp_2"], baseline_experiment_id="exp_1"),
        access=AccessContext(user_id="user_1", project_id="proj_eval", role="developer", auth_method="session"),
    )

    assert response.code == 422
    assert response.message == "Compared experiments must use the same dataset"


@pytest.mark.asyncio
async def test_compare_experiments_rejects_running_experiment(monkeypatch: pytest.MonkeyPatch):
    experiments_by_id = {
        "exp_1": ExperimentResponse(
            id="exp_1",
            name="Baseline",
            description="",
            dataset_id="ds_1",
            split="default",
            evaluator_ids=["builtin:exact_match"],
            target_url="http://agent.local/a",
            target_body_template='{"input":"hi"}',
            status=ExperimentStatus.RUNNING,
        ),
        "exp_2": ExperimentResponse(
            id="exp_2",
            name="Candidate",
            description="",
            dataset_id="ds_1",
            split="default",
            evaluator_ids=["builtin:exact_match"],
            target_url="http://agent.local/b",
            target_body_template='{"input":"hi"}',
            status=ExperimentStatus.COMPLETED,
        ),
    }

    async def fake_get_experiment(experiment_id: str, _project_id: str):
        return experiments_by_id.get(experiment_id)

    monkeypatch.setattr(experiments.experiment_repo, "get_experiment", fake_get_experiment)

    response = await experiments.compare_experiments(
        ExperimentCompareRequest(experiment_ids=["exp_1", "exp_2"], baseline_experiment_id="exp_1"),
        access=AccessContext(user_id="user_1", project_id="proj_eval", role="developer", auth_method="session"),
    )

    assert response.code == 409
    assert "still running" in response.message


@pytest.mark.asyncio
async def test_set_baseline_rejects_dataset_mismatch(monkeypatch: pytest.MonkeyPatch):
    async def fake_get_experiment(_experiment_id: str, _project_id: str):
        return ExperimentResponse(
            id="exp_1",
            name="Baseline",
            description="",
            dataset_id="ds_1",
            split="default",
            evaluator_ids=["builtin:exact_match"],
            target_url="http://agent.local/a",
            target_body_template='{"input":"hi"}',
            status=ExperimentStatus.COMPLETED,
        )

    monkeypatch.setattr(experiments.experiment_repo, "get_experiment", fake_get_experiment)

    response = await experiments.set_baseline(
        "exp_1",
        ExperimentBaselineSetRequest(dataset_id="ds_other"),
        access=AccessContext(user_id="user_1", project_id="proj_eval", role="owner", auth_method="session"),
    )

    assert response.code == 422
    assert response.message == "Baseline dataset does not match experiment dataset"


@pytest.mark.asyncio
async def test_list_evaluators_paginates_builtin_and_custom(monkeypatch: pytest.MonkeyPatch):
    from app.models.schemas import EvaluatorConfig, EvaluatorResponse, EvaluatorType, RuleConfig

    class FakeBuiltin:
        name = "contains"
        type = "rule"
        keywords = ["safe"]
        mode = "any"

    captured: dict[str, Any] = {}

    async def fake_list_evaluators(
        project_id: str,
        *,
        offset: int = 0,
        limit: int = 20,
        query: str | None = None,
        evaluator_type: str | None = None,
    ):
        captured.update(
            {
                "project_id": project_id,
                "offset": offset,
                "limit": limit,
                "query": query,
                "evaluator_type": evaluator_type,
            }
        )
        return (
            [
                EvaluatorResponse(
                    id="ev_custom_1",
                    name="Custom Guard",
                    type=EvaluatorType.RULE,
                    description="custom rule",
                    config=EvaluatorConfig(
                        type=EvaluatorType.RULE,
                        rule_config=RuleConfig(kind="not_empty"),
                    ),
                    is_builtin=False,
                    version=2,
                )
            ],
            2,
        )

    monkeypatch.setattr(evaluators.registry, "list_all", lambda: [FakeBuiltin()])
    monkeypatch.setattr(evaluators.evaluator_repo, "list_evaluators", fake_list_evaluators)

    response = await evaluators.list_evaluators(
        page=2,
        page_size=1,
        query=None,
        evaluator_type=None,
        access=AccessContext(user_id="user_1", project_id="proj_eval", role="developer", auth_method="session"),
    )

    assert response.code == 0
    assert response.data is not None
    assert response.data.total == 3
    assert response.data.page == 2
    assert response.data.total_pages == 3
    assert [item.id for item in response.data.items] == ["ev_custom_1"]
    assert captured == {
        "project_id": "proj_eval",
        "offset": 0,
        "limit": 1,
        "query": None,
        "evaluator_type": None,
    }


@pytest.mark.asyncio
async def test_list_experiments_returns_paginated_payload(monkeypatch: pytest.MonkeyPatch):
    captured: dict[str, Any] = {}

    async def fake_list_experiments_paginated(
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
                ExperimentResponse(
                    id="exp_running_1",
                    name="prod-agent regression",
                    description="nightly",
                    dataset_id="ds_1",
                    evaluator_ids=["builtin:not_empty"],
                    target_url="http://agent.local/run",
                    status=ExperimentStatus.RUNNING,
                    project_id=project_id,
                )
            ],
            7,
        )

    monkeypatch.setattr(experiments.experiment_repo, "list_experiments_paginated", fake_list_experiments_paginated)

    response = await experiments.list_experiments(
        page=2,
        page_size=5,
        query="prod",
        status=ExperimentStatus.RUNNING,
        access=AccessContext(user_id="user_1", project_id="proj_eval", role="developer", auth_method="session"),
    )

    assert response.code == 0
    assert response.data is not None
    assert response.data.total == 7
    assert response.data.page == 2
    assert response.data.page_size == 5
    assert response.data.total_pages == 2
    assert response.data.items[0].id == "exp_running_1"
    assert captured == {
        "project_id": "proj_eval",
        "page": 2,
        "page_size": 5,
        "query": "prod",
        "status": "running",
    }
