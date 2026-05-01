"""pytest helpers for SDK-driven regression checks."""

from __future__ import annotations

from collections.abc import Callable
from functools import wraps
from typing import Any

from evalsmith.evaluate import Dataset, ExperimentSummary, evaluate


def eval_test(
    *,
    dataset: str | Dataset,
    evaluators: list[str],
    threshold: dict[str, float],
    experiment_name: str | None = None,
    split: str = "default",
    max_concurrency: int = 5,
    target_headers: dict[str, str] | None = None,
    target_body_template: str = '{"input": {{inputs.input}}}',
):
    """Run a remote evaluation and fail the test when score thresholds are not met."""

    def decorator(fn: Callable[..., Any]):
        @wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> ExperimentSummary:
            target = fn(*args, **kwargs)
            resolved_dataset = dataset if isinstance(dataset, Dataset) else Dataset.from_name(dataset)
            summary = evaluate(
                target=target,
                dataset=resolved_dataset,
                evaluators=evaluators,
                experiment_name=experiment_name or getattr(target, "__name__", "eval-test"),
                max_concurrency=max_concurrency,
                split=split,
                target_headers=target_headers,
                target_body_template=target_body_template,
            )

            failures: list[str] = []
            for evaluator_name, min_score in threshold.items():
                actual = summary.avg_scores.get(evaluator_name, 0.0)
                if actual < min_score:
                    failures.append(
                        f"{evaluator_name} avg score {actual:.3f} is below required threshold {min_score:.3f}"
                    )

            if failures:
                raise AssertionError(
                    "EvalSmith regression thresholds failed for "
                    f"{summary.name} ({summary.experiment_id}):\n" + "\n".join(failures)
                )

            return summary

        return wrapper

    return decorator
