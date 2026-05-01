from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest

from app.db import experiment_repo
from app.models.schemas import EvalResult, ExperimentStatus
from app.workflow import runner


class FakeTransaction:
    async def __aenter__(self) -> "FakeTransaction":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False


class FakeAcquire:
    def __init__(self, conn: "FakeConn") -> None:
        self.conn = conn

    async def __aenter__(self) -> "FakeConn":
        return self.conn

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False


class FakeConn:
    def __init__(
        self,
        *,
        fetchrow_handler: Callable[[str, tuple[Any, ...]], Any] | None = None,
        fetchval_handler: Callable[[str, tuple[Any, ...]], Any] | None = None,
    ) -> None:
        self.fetchrow_handler = fetchrow_handler
        self.fetchval_handler = fetchval_handler
        self.execute_calls: list[tuple[str, tuple[Any, ...]]] = []
        self.fetchrow_calls: list[tuple[str, tuple[Any, ...]]] = []
        self.fetchval_calls: list[tuple[str, tuple[Any, ...]]] = []

    def transaction(self) -> FakeTransaction:
        return FakeTransaction()

    async def execute(self, query: str, *args: Any) -> str:
        self.execute_calls.append((query, args))
        return "OK"

    async def fetchrow(self, query: str, *args: Any) -> Any:
        self.fetchrow_calls.append((query, args))
        if self.fetchrow_handler is None:
            return None
        return self.fetchrow_handler(query, args)

    async def fetchval(self, query: str, *args: Any) -> Any:
        self.fetchval_calls.append((query, args))
        if self.fetchval_handler is None:
            return None
        return self.fetchval_handler(query, args)


class FakePool:
    def __init__(self, conn: FakeConn) -> None:
        self.conn = conn

    def acquire(self) -> FakeAcquire:
        return FakeAcquire(self.conn)


@pytest.mark.asyncio
async def test_save_result_uses_upsert_when_example_already_exists(monkeypatch: pytest.MonkeyPatch):
    conn = FakeConn(
        fetchval_handler=lambda query, _args: (
            "running"
            if "SELECT status FROM experiment_jobs" in query
            else "result_existing_1"
        )
    )

    async def fake_get_pool() -> FakePool:
        return FakePool(conn)

    monkeypatch.setattr(experiment_repo, "get_pool", fake_get_pool)

    result_id = await experiment_repo.save_result(
        experiment_id="exp_1",
        example_id="example_1",
        input_value={"question": "ping"},
        expected_output="pong",
        metadata={},
        split="default",
        actual_output={"answer": "pong"},
        latency_ms=12,
        eval_results=[
            EvalResult(
                score=1.0,
                reasoning="ok",
                evaluator_name="exact_match",
                evaluator_type="rule",
            )
        ],
    )

    assert result_id == "result_existing_1"
    assert len(conn.fetchval_calls) == 2
    insert_query = conn.fetchval_calls[1][0]
    assert "ON CONFLICT (experiment_id, example_id) WHERE example_id IS NOT NULL DO UPDATE" in insert_query


@pytest.mark.asyncio
async def test_save_result_skips_when_cancel_requested(monkeypatch: pytest.MonkeyPatch):
    conn = FakeConn(fetchval_handler=lambda _query, _args: "cancel_requested")

    async def fake_get_pool() -> FakePool:
        return FakePool(conn)

    monkeypatch.setattr(experiment_repo, "get_pool", fake_get_pool)

    result_id = await experiment_repo.save_result(
        experiment_id="exp_1",
        example_id="example_1",
        input_value={},
        expected_output=None,
        metadata={},
        split="default",
        actual_output=None,
        latency_ms=0,
        eval_results=[],
    )

    assert result_id is None
    assert len(conn.fetchval_calls) == 1


@pytest.mark.asyncio
async def test_fail_job_with_retry_resets_experiment_to_pending(monkeypatch: pytest.MonkeyPatch):
    conn = FakeConn(fetchrow_handler=lambda _query, _args: {"attempts": 1, "max_attempts": 3, "experiment_id": "exp_1"})

    async def fake_get_pool() -> FakePool:
        return FakePool(conn)

    monkeypatch.setattr(experiment_repo, "get_pool", fake_get_pool)

    await experiment_repo.fail_job("job_1", "temporary network error", retry=True)

    assert len(conn.execute_calls) == 2
    job_update_args = conn.execute_calls[0][1]
    experiment_update_args = conn.execute_calls[1][1]
    assert job_update_args[0] == "pending"
    assert experiment_update_args[0] == ExperimentStatus.PENDING.value
    assert experiment_update_args[1] == "exp_1"


@pytest.mark.asyncio
async def test_complete_job_overrides_late_cancel_request(monkeypatch: pytest.MonkeyPatch):
    conn = FakeConn(fetchrow_handler=lambda _query, _args: {"experiment_id": "exp_1", "status": "cancel_requested"})

    async def fake_get_pool() -> FakePool:
        return FakePool(conn)

    monkeypatch.setattr(experiment_repo, "get_pool", fake_get_pool)

    await experiment_repo.complete_job("job_1")

    assert len(conn.execute_calls) == 2
    experiment_update_args = conn.execute_calls[1][1]
    assert experiment_update_args[0] == ExperimentStatus.COMPLETED.value
    assert experiment_update_args[2] == "exp_1"


@pytest.mark.asyncio
async def test_runner_marks_experiment_canceled_when_save_result_is_rejected(monkeypatch: pytest.MonkeyPatch):
    statuses: list[ExperimentStatus] = []

    async def fake_update_experiment_status(_exp_id: str, status: ExperimentStatus) -> None:
        statuses.append(status)

    async def fake_update_experiment_summary(_exp_id: str, _summary: Any) -> None:
        return None

    async def fake_save_result(**_kwargs: Any) -> None:
        return None

    async def fake_get_job_status(_exp_id: str) -> str:
        return "running"

    async def fake_resolve_evaluators(self) -> list[object]:
        return [object()]

    async def fake_fetch_dataset(self) -> list[dict[str, Any]]:
        return [{"id": "example_1", "inputs": {"input": "ping"}, "metadata": {}, "split": "default"}]

    async def fake_call_target(self, _example: dict[str, Any]) -> tuple[Any, str | None, int]:
        return "pong", "trace_1", 18

    async def fake_run_evaluators(self, _evaluators: list[object], _eval_input: Any) -> list[EvalResult]:
        return [
            EvalResult(
                score=1.0,
                reasoning="ok",
                evaluator_name="exact_match",
                evaluator_type="rule",
            )
        ]

    monkeypatch.setattr(runner.experiment_repo, "update_experiment_status", fake_update_experiment_status)
    monkeypatch.setattr(runner.experiment_repo, "update_experiment_summary", fake_update_experiment_summary)
    monkeypatch.setattr(runner.experiment_repo, "get_job_status", fake_get_job_status)
    monkeypatch.setattr(runner.experiment_repo, "save_result", fake_save_result)
    monkeypatch.setattr(runner.ExperimentRunner, "_resolve_evaluators", fake_resolve_evaluators)
    monkeypatch.setattr(runner.ExperimentRunner, "_fetch_dataset", fake_fetch_dataset)
    monkeypatch.setattr(runner.ExperimentRunner, "_call_target", fake_call_target)
    monkeypatch.setattr(runner.ExperimentRunner, "_run_evaluators", fake_run_evaluators)

    instance = runner.ExperimentRunner(
        experiment_id="exp_1",
        project_id="proj_1",
        dataset_id="dataset_1",
        dataset_version=1,
        split="default",
        evaluator_ids=["builtin:exact_match"],
        target_url="http://agent.local/answer",
        concurrency=1,
    )

    await instance.run()

    assert statuses == [ExperimentStatus.RUNNING, ExperimentStatus.CANCELED]


@pytest.mark.asyncio
async def test_runner_rethrows_transient_failure_without_marking_experiment_failed(monkeypatch: pytest.MonkeyPatch):
    statuses: list[ExperimentStatus] = []

    async def fake_update_experiment_status(_exp_id: str, status: ExperimentStatus) -> None:
        statuses.append(status)

    async def fake_resolve_evaluators(self) -> list[object]:
        raise RuntimeError("temporary dataset outage")

    monkeypatch.setattr(runner.experiment_repo, "update_experiment_status", fake_update_experiment_status)
    monkeypatch.setattr(runner.ExperimentRunner, "_resolve_evaluators", fake_resolve_evaluators)

    instance = runner.ExperimentRunner(
        experiment_id="exp_1",
        project_id="proj_1",
        dataset_id="dataset_1",
        dataset_version=1,
        split="default",
        evaluator_ids=["builtin:exact_match"],
        target_url="http://agent.local/answer",
        concurrency=1,
    )

    with pytest.raises(RuntimeError, match="temporary dataset outage"):
        await instance.run()

    assert statuses == [ExperimentStatus.RUNNING]
