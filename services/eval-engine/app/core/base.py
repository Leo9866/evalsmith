from __future__ import annotations

import time
from abc import ABC, abstractmethod

from app.models.schemas import EvalInput, EvalResult


class BaseEvaluator(ABC):
    """Abstract base class for all evaluators."""

    name: str
    type: str  # rule, llm_judge, code, statistical

    def __init__(self, name: str, type: str) -> None:
        self.name = name
        self.type = type

    async def run(self, eval_input: EvalInput) -> EvalResult:
        """Run the evaluator and record latency."""
        start = time.perf_counter_ns()
        result = await self.evaluate(eval_input)
        elapsed_ms = int((time.perf_counter_ns() - start) / 1_000_000)
        result.evaluator_name = self.name
        result.evaluator_type = self.type
        result.latency_ms = elapsed_ms
        return result

    @abstractmethod
    async def evaluate(self, eval_input: EvalInput) -> EvalResult:
        """Evaluate and return a result. Subclasses must implement this."""
        ...

    def to_dict(self) -> dict:
        return {"name": self.name, "type": self.type}
