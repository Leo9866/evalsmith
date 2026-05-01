from __future__ import annotations

import json
import re
from typing import Any

import jsonschema

from app.core.base import BaseEvaluator
from app.models.schemas import EvalInput, EvalResult


class ExactMatchEvaluator(BaseEvaluator):
    """Score 1.0 if output exactly matches expected, else 0.0."""

    def __init__(
        self,
        name: str = "exact_match",
        case_sensitive: bool = True,
        strip: bool = True,
    ) -> None:
        super().__init__(name=name, type="rule")
        self.case_sensitive = case_sensitive
        self.strip = strip

    async def evaluate(self, eval_input: EvalInput) -> EvalResult:
        output = str(eval_input.output)
        expected = str(eval_input.expected) if eval_input.expected is not None else ""

        if self.strip:
            output = output.strip()
            expected = expected.strip()

        if not self.case_sensitive:
            output = output.lower()
            expected = expected.lower()

        match = output == expected
        return EvalResult(
            score=1.0 if match else 0.0,
            reasoning=f"Output {'matches' if match else 'does not match'} expected.",
            metadata={"case_sensitive": self.case_sensitive, "strip": self.strip},
        )


class ContainsEvaluator(BaseEvaluator):
    """Score 1.0 if output contains the required keywords."""

    def __init__(
        self,
        name: str = "contains",
        keywords: list[str] | None = None,
        mode: str = "any",
    ) -> None:
        super().__init__(name=name, type="rule")
        self.keywords = keywords or []
        self.mode = mode  # "any" or "all"

    async def evaluate(self, eval_input: EvalInput) -> EvalResult:
        output = str(eval_input.output).lower()
        if not self.keywords:
            return EvalResult(score=1.0, reasoning="No keywords to check.")

        found = [kw for kw in self.keywords if kw.lower() in output]
        missing = [kw for kw in self.keywords if kw.lower() not in output]

        if self.mode == "all":
            match = len(missing) == 0
            score = len(found) / len(self.keywords)
        else:  # any
            match = len(found) > 0
            score = 1.0 if match else 0.0

        return EvalResult(
            score=score,
            reasoning=f"Found {len(found)}/{len(self.keywords)} keywords. Missing: {missing}",
            metadata={"found": found, "missing": missing, "mode": self.mode},
        )


class RegexMatchEvaluator(BaseEvaluator):
    """Score 1.0 if output matches the regex pattern."""

    def __init__(self, name: str = "regex_match", pattern: str = ".*") -> None:
        super().__init__(name=name, type="rule")
        self.pattern = pattern

    async def evaluate(self, eval_input: EvalInput) -> EvalResult:
        output = str(eval_input.output)
        try:
            match = bool(re.search(self.pattern, output))
        except re.error as e:
            return EvalResult(
                score=0.0,
                reasoning=f"Invalid regex pattern: {e}",
                metadata={"pattern": self.pattern, "error": str(e)},
            )

        return EvalResult(
            score=1.0 if match else 0.0,
            reasoning=f"Output {'matches' if match else 'does not match'} pattern /{self.pattern}/",
            metadata={"pattern": self.pattern},
        )


class JSONSchemaValidEvaluator(BaseEvaluator):
    """Score 1.0 if output is valid JSON conforming to the given JSON Schema."""

    def __init__(
        self,
        name: str = "json_schema_valid",
        schema: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(name=name, type="rule")
        self.schema = schema or {}

    async def evaluate(self, eval_input: EvalInput) -> EvalResult:
        output = eval_input.output

        # Parse JSON string if needed
        if isinstance(output, str):
            try:
                output = json.loads(output)
            except json.JSONDecodeError as e:
                return EvalResult(
                    score=0.0,
                    reasoning=f"Output is not valid JSON: {e}",
                    metadata={"error": "json_parse_error"},
                )

        if not self.schema:
            return EvalResult(
                score=1.0,
                reasoning="No schema provided; output is valid JSON.",
            )

        try:
            jsonschema.validate(instance=output, schema=self.schema)
            return EvalResult(
                score=1.0,
                reasoning="Output conforms to the JSON schema.",
            )
        except jsonschema.ValidationError as e:
            return EvalResult(
                score=0.0,
                reasoning=f"Schema validation failed: {e.message}",
                metadata={"path": list(e.absolute_path), "error": e.message},
            )


class NotEmptyEvaluator(BaseEvaluator):
    """Score 1.0 if output is not empty / None / blank."""

    def __init__(self, name: str = "not_empty") -> None:
        super().__init__(name=name, type="rule")

    async def evaluate(self, eval_input: EvalInput) -> EvalResult:
        output = eval_input.output
        is_empty = output is None or (isinstance(output, str) and output.strip() == "")

        return EvalResult(
            score=0.0 if is_empty else 1.0,
            reasoning="Output is empty." if is_empty else "Output is not empty.",
        )


class LengthInRangeEvaluator(BaseEvaluator):
    """Score 1.0 if output string length is within [min_length, max_length]."""

    def __init__(
        self,
        name: str = "length_in_range",
        min_length: int = 1,
        max_length: int = 10000,
    ) -> None:
        super().__init__(name=name, type="rule")
        self.min_length = min_length
        self.max_length = max_length

    async def evaluate(self, eval_input: EvalInput) -> EvalResult:
        length = len(str(eval_input.output)) if eval_input.output is not None else 0
        in_range = self.min_length <= length <= self.max_length
        return EvalResult(
            score=1.0 if in_range else 0.0,
            reasoning=f"Length {length} is {'within' if in_range else 'outside'} [{self.min_length}, {self.max_length}].",
            metadata={"length": length, "min": self.min_length, "max": self.max_length},
        )


class LatencyThresholdEvaluator(BaseEvaluator):
    """Score 1.0 if latency_ms (from metadata) is below the threshold."""

    def __init__(
        self,
        name: str = "latency_threshold",
        threshold_ms: int = 5000,
    ) -> None:
        super().__init__(name=name, type="rule")
        self.threshold_ms = threshold_ms

    async def evaluate(self, eval_input: EvalInput) -> EvalResult:
        meta = eval_input.metadata or {}
        latency = meta.get("latency_ms", 0)
        try:
            latency = int(latency)
        except (TypeError, ValueError):
            latency = 0
        passed = latency <= self.threshold_ms
        return EvalResult(
            score=1.0 if passed else 0.0,
            reasoning=f"Latency {latency}ms {'<=' if passed else '>'} threshold {self.threshold_ms}ms.",
            metadata={"latency_ms": latency, "threshold_ms": self.threshold_ms},
        )


class CostThresholdEvaluator(BaseEvaluator):
    """Score 1.0 if cost (from metadata) is below the threshold."""

    def __init__(
        self,
        name: str = "cost_threshold",
        threshold: float = 0.10,
    ) -> None:
        super().__init__(name=name, type="rule")
        self.threshold = threshold

    async def evaluate(self, eval_input: EvalInput) -> EvalResult:
        meta = eval_input.metadata or {}
        cost = meta.get("cost", meta.get("cost_usd", 0))
        try:
            cost = float(cost)
        except (TypeError, ValueError):
            cost = 0.0
        passed = cost <= self.threshold
        return EvalResult(
            score=1.0 if passed else 0.0,
            reasoning=f"Cost ${cost:.4f} {'<=' if passed else '>'} threshold ${self.threshold:.4f}.",
            metadata={"cost": cost, "threshold": self.threshold},
        )
