from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from typing import Any

import httpx

CORRECTNESS_SYSTEM_PROMPT = (
    "You are an expert evaluator assessing the correctness of AI assistant responses.\n"
    "Scoring: 1.0=completely correct, 0.8=mostly correct minor issues, "
    "0.6=partially correct, 0.4=significant errors, 0.2=mostly incorrect, "
    "0.0=completely wrong.\n"
    'You MUST respond in JSON: {"score": <float>, "reasoning": "<detailed reasoning>"}'
)

CORRECTNESS_USER_TEMPLATE = (
    "Evaluate the correctness of the following AI response.\n\n"
    "**User Input:** {{input}}\n\n"
    "**AI Output:** {{output}}\n\n"
    "**Expected Answer:** {{expected}}\n\n"
    "**Context:** {{context}}\n\n"
    "Provide your evaluation as JSON."
)


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


@dataclass(frozen=True)
class LLMTarget:
    protocol: str
    base_url: str
    api_key: str
    model: str
    temperature: float

    @property
    def evaluator_name(self) -> str:
        return f"correctness_{self.model.replace('.', '_')}"


TARGETS = [
    LLMTarget(
        protocol=os.environ.get("LLM_PRIMARY_PROTOCOL", "openai"),
        base_url=os.environ.get("LLM_PRIMARY_BASE_URL", "https://api.openai.com/v1"),
        api_key="",
        model=os.environ.get("LLM_PRIMARY_MODEL", "example-judge-model"),
        temperature=float(os.environ.get("LLM_PRIMARY_TEMPERATURE", "0.0")),
    ),
    LLMTarget(
        protocol=os.environ.get("LLM_SECONDARY_PROTOCOL", "openai"),
        base_url=os.environ.get("LLM_SECONDARY_BASE_URL", "https://api.openai.com/v1"),
        api_key="",
        model=os.environ.get("LLM_SECONDARY_MODEL", "example-judge-model-alt"),
        temperature=float(os.environ.get("LLM_SECONDARY_TEMPERATURE", "1.0")),
    ),
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

    return extract_data(
        client.post(
            f"{DATASET_URL}/api/v1/datasets",
            headers={"X-Project-ID": PROJECT_ID},
            json={
                "name": DATASET_NAME,
                "description": "Deterministic support and platform QA dataset for LLM regression runs.",
                "schema_def": {
                    "inputs": {"type": "object"},
                    "expected_outputs": {"type": "string"},
                    "metadata": {"type": "object"},
                },
            },
        )
    )


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


def list_evaluators(client: httpx.Client) -> list[dict[str, Any]]:
    return extract_data(
        client.get(
            f"{EVAL_URL}/api/v1/evaluators",
            headers={"X-Project-ID": PROJECT_ID},
        )
    )


def upsert_correctness_evaluator(client: httpx.Client, target: LLMTarget) -> dict[str, Any]:
    payload = {
        "name": target.evaluator_name,
        "description": (
            f"LLM correctness evaluator via {target.protocol} protocol for {target.model}. "
            f"Requested base_url={target.base_url}"
        ),
        "config": {
            "type": "llm_judge",
            "llm_judge_config": {
                "protocol": target.protocol,
                "protocol_config": {
                    "base_url": target.base_url,
                    "api_key": target.api_key,
                    "model": target.model,
                },
                "system_prompt": CORRECTNESS_SYSTEM_PROMPT,
                "user_prompt_template": CORRECTNESS_USER_TEMPLATE,
                "model": target.model,
                "temperature": target.temperature,
                "few_shot_examples": [],
            },
        },
    }

    existing = None
    for evaluator in list_evaluators(client):
        if evaluator.get("name") == target.evaluator_name and not evaluator.get("is_builtin"):
            existing = evaluator
            break

    if existing:
        return extract_data(
            client.put(
                f"{EVAL_URL}/api/v1/evaluators/{existing['id']}",
                headers={"X-Project-ID": PROJECT_ID},
                json=payload,
            )
        )

    return extract_data(
        client.post(
            f"{EVAL_URL}/api/v1/evaluators",
            headers={"X-Project-ID": PROJECT_ID},
            json=payload,
        )
    )


def create_experiment(client: httpx.Client, dataset_id: str, target: LLMTarget, evaluator_id: str) -> dict[str, Any]:
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    return extract_data(
        client.post(
            f"{EVAL_URL}/api/v1/experiments",
            headers={"X-Project-ID": PROJECT_ID},
            json={
                "name": f"LLM 回归 - {target.model} - {timestamp}",
                "description": (
                    f"OpenAI-compatible regression for {target.model} with exact_match, not_empty, "
                    f"and {target.evaluator_name}."
                ),
                "dataset_id": dataset_id,
                "split": "default",
                "evaluator_ids": ["builtin:exact_match", "builtin:not_empty", evaluator_id],
                "target_url": AGENT_URL,
                "target_headers": {},
                "target_body_template": '{"input": {{inputs.input}}}',
                "concurrency": 2,
            },
        )
    )


def wait_for_experiment(client: httpx.Client, experiment_id: str, timeout_seconds: int = 300) -> dict[str, Any]:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        experiment = extract_data(
            client.get(
                f"{EVAL_URL}/api/v1/experiments/{experiment_id}",
                headers={"X-Project-ID": PROJECT_ID},
            )
        )
        status = experiment.get("status")
        if status in {"completed", "failed"}:
            return experiment
        time.sleep(1)
    raise TimeoutError(f"Experiment {experiment_id} did not complete within {timeout_seconds} seconds")


def fetch_results(client: httpx.Client, experiment_id: str) -> list[dict[str, Any]]:
    data = extract_data(
        client.get(
            f"{EVAL_URL}/api/v1/experiments/{experiment_id}/results",
            headers={"X-Project-ID": PROJECT_ID},
            params={"page_size": 100},
        )
    )
    return data.get("items", [])


def resolve_targets() -> list[LLMTarget]:
    api_key = (
        os.environ.get("LLM_API_KEY")
        or os.environ.get("OPENAI_API_KEY")
        or os.environ.get("EVALSMITH_LLM_API_KEY")
        or ""
    ).strip()
    if not api_key:
        raise RuntimeError(
            "Missing LLM API key. Set LLM_API_KEY, OPENAI_API_KEY, or EVALSMITH_LLM_API_KEY before running."
        )

    configured_base_url = (
        os.environ.get("LLM_API_BASE_URL")
        or os.environ.get("OPENAI_BASE_URL")
        or os.environ.get("OPENAI_API_BASE")
        or os.environ.get("EVALSMITH_LLM_API_BASE_URL")
        or TARGETS[0].base_url
    ).strip()

    return [
        LLMTarget(
            protocol=target.protocol,
            base_url=configured_base_url,
            api_key=api_key,
            model=target.model,
            temperature=target.temperature,
        )
        for target in TARGETS
    ]


def main() -> None:
    targets = resolve_targets()
    with httpx.Client(timeout=120.0) as client:
        dataset = ensure_dataset(client)
        ensure_examples(client, dataset["id"])

        summaries = []
        for target in targets:
            evaluator = upsert_correctness_evaluator(client, target)
            experiment = create_experiment(client, dataset["id"], target, evaluator["id"])
            completed = wait_for_experiment(client, experiment["id"])
            results = fetch_results(client, experiment["id"])
            summaries.append(
                {
                    "requested_protocol": target.protocol,
                    "requested_base_url": target.base_url,
                    "model": target.model,
                    "temperature": target.temperature,
                    "dataset_id": dataset["id"],
                    "evaluator_id": evaluator["id"],
                    "experiment_id": completed["id"],
                    "status": completed["status"],
                    "summary": completed.get("summary") or {},
                    "sample_scores": results[0].get("scores", []) if results else [],
                }
            )

    print(json.dumps({"project_id": PROJECT_ID, "agent_url": AGENT_URL, "runs": summaries}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
