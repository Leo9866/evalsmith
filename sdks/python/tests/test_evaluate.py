from __future__ import annotations

import importlib

import httpx
import pytest

from evalsmith.testing import eval_test

evaluate_module = importlib.import_module("evalsmith.evaluate")


def test_preview_target_includes_authorization_header(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("EVALSMITH_PROJECT", "proj_sdk")
    monkeypatch.setenv("EVALSMITH_API_KEY", "es_live_sdk")
    monkeypatch.setenv("EVALSMITH_EVAL_URL", "http://eval.local")

    captured: dict[str, object] = {}

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "code": 0,
                "message": "success",
                "data": {
                    "request_method": "POST",
                    "request_url": "http://agent.local/answer",
                    "response_status_code": 200,
                    "latency_ms": 123,
                    "output": {"answer": "pong"},
                },
            }

    def fake_post(url: str, **kwargs):
        captured["url"] = url
        captured["headers"] = kwargs.get("headers")
        return FakeResponse()

    monkeypatch.setattr(httpx, "post", fake_post)

    preview = evaluate_module.preview_target(
        "http://agent.local/answer",
        {"inputs": {"question": "ping"}, "expected_outputs": {"answer": "pong"}},
    )

    assert preview.response_status_code == 200
    assert captured["url"] == "http://eval.local/api/v1/experiments/target-preview"
    assert captured["headers"] == {
        "X-Project-ID": "proj_sdk",
        "Authorization": "Bearer es_live_sdk",
    }


def test_eval_test_decorator_raises_when_threshold_fails(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        "evalsmith.testing.Dataset.from_name",
        classmethod(lambda cls, _name: evaluate_module.Dataset("ds_test")),
    )
    monkeypatch.setattr(
        "evalsmith.testing.evaluate",
        lambda **_: evaluate_module.ExperimentSummary(
            experiment_id="exp_1",
            name="eval-test",
            total_examples=10,
            completed=10,
            failed=0,
            avg_scores={"correctness": 0.6},
            pass_rates={"correctness": 0.5},
        ),
    )

    @eval_test(dataset="qa-dataset", evaluators=["correctness"], threshold={"correctness": 0.8})
    def test_agent_quality():
        return "http://agent.local/answer"

    with pytest.raises(AssertionError, match="correctness avg score 0.600"):
        test_agent_quality()
