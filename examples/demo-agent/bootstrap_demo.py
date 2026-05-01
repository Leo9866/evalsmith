from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

import httpx

ROOT = Path(__file__).resolve().parents[2]
SDK_PATH = ROOT / "sdks" / "python"
if str(SDK_PATH) not in sys.path:
    sys.path.insert(0, str(SDK_PATH))

import evalsmith  # noqa: E402


def service_url(service_env: str, fallback: str) -> str:
    return (os.environ.get(service_env) or os.environ.get("EVALSMITH_BASE_URL") or fallback).rstrip("/")


DATASET_URL = service_url("EVALSMITH_DATASET_URL", "http://127.0.0.1:8003")
EVAL_URL = service_url("EVALSMITH_EVAL_URL", "http://127.0.0.1:8002")
PROJECT_ID = os.environ.get("EVALSMITH_PROJECT", "proj_default")
DATASET_NAME = os.environ.get("EVALSMITH_DEMO_DATASET", "Support QA Demo")
AGENT_URL = os.environ.get("EVALSMITH_TARGET_URL", "http://127.0.0.1:8010/answer")


EXAMPLES = [
    {
        "inputs": {"input": "How should I handle a customer asking for a billing plan change?"},
        "expected_outputs": (
            "Recommended action: keep the current billing cycle stable and apply the plan change on the next invoice. "
            "Billing changes take effect at the next invoice. For urgent adjustments, create a support ticket with the workspace ID."
        ),
        "metadata": {"topic": "billing"},
        "split": "default",
    },
    {
        "inputs": {"input": "The agent feels slow in production. What should I check first?"},
        "expected_outputs": (
            "Recommended action: inspect the slowest trace first, then reduce prompt size and retrieval breadth. "
            "High latency is usually caused by oversized prompts, slow retrieval, or a cold downstream model. "
            "Start by checking trace duration, retrieval fan-out, and model queue time."
        ),
        "metadata": {"topic": "latency"},
        "split": "default",
    },
    {
        "inputs": {"input": "What is the safest way to deploy a new prompt version?"},
        "expected_outputs": (
            "Recommended action: gate the rollout behind a regression run and only promote the candidate if quality is stable. "
            "For production rollout, pin the prompt version, run a regression experiment, and compare exact-match plus not-empty scores before promoting traffic."
        ),
        "metadata": {"topic": "deployment"},
        "split": "default",
    },
    {
        "inputs": {"input": "What should we do if the model starts leaking secrets?"},
        "expected_outputs": (
            "Recommended action: stop the unsafe response path and escalate it for review before serving users. "
            "When a response might reveal secrets or unsafe guidance, block the final answer, log the trace, and hand the case to a human reviewer."
        ),
        "metadata": {"topic": "safety"},
        "split": "default",
    },
]


def extract_data(response: httpx.Response) -> Any:
    response.raise_for_status()
    payload = response.json()
    if payload.get("code") != 0:
        raise RuntimeError(payload.get("message", "request failed"))
    return payload.get("data")


def ensure_dataset(client: httpx.Client) -> dict[str, Any]:
    data = extract_data(
        client.get(
            f"{DATASET_URL}/api/v1/datasets",
            params={"name": DATASET_NAME, "page_size": 100},
            headers={"X-Project-ID": PROJECT_ID},
        )
    )
    for item in data.get("items", []):
        if item.get("name") == DATASET_NAME:
            return item

    dataset = extract_data(
        client.post(
            f"{DATASET_URL}/api/v1/datasets",
            headers={"X-Project-ID": PROJECT_ID},
            json={
                "name": DATASET_NAME,
                "description": "Deterministic support and platform QA dataset for the demo flow.",
                "schema_def": {
                    "inputs": {"type": "object"},
                    "expected_outputs": {"type": "string"},
                    "metadata": {"type": "object"},
                },
            },
        )
    )
    return dataset


def ensure_examples(client: httpx.Client, dataset_id: str) -> None:
    payload = extract_data(
        client.get(
            f"{DATASET_URL}/api/v1/datasets/{dataset_id}/examples",
            headers={"X-Project-ID": PROJECT_ID},
            params={"page_size": 100},
        )
    )
    if payload.get("items"):
        return

    extract_data(
        client.post(
            f"{DATASET_URL}/api/v1/datasets/{dataset_id}/examples",
            headers={"X-Project-ID": PROJECT_ID},
            json={"examples": EXAMPLES},
        )
    )


def run_experiment(dataset_id: str) -> evalsmith.ExperimentSummary:
    os.environ.setdefault("EVALSMITH_DATASET_URL", DATASET_URL)
    os.environ.setdefault("EVALSMITH_EVAL_URL", EVAL_URL)
    os.environ.setdefault("EVALSMITH_PROJECT", PROJECT_ID)
    return evalsmith.evaluate(
        target=AGENT_URL,
        dataset=evalsmith.Dataset(dataset_id),
        evaluators=["exact_match", "not_empty"],
        experiment_name="Demo Agent Regression",
        max_concurrency=2,
        target_body_template='{"input": {{inputs.input}}}',
    )


def main() -> None:
    with httpx.Client(timeout=120.0) as client:
        dataset = ensure_dataset(client)
        ensure_examples(client, dataset["id"])
        experiment = run_experiment(dataset["id"])
        print("Dataset:", dataset["id"], DATASET_NAME)
        print("Evaluation API:", EVAL_URL)
        print("Experiment:", experiment.experiment_id, experiment.name)
        print(experiment)


if __name__ == "__main__":
    main()
