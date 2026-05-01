from __future__ import annotations

import asyncio
import json
import logging
import re
import statistics as pystats
from typing import Any

import httpx

from app.core.base import BaseEvaluator
from app.models.schemas import EvalInput, EvalResult
from app.settings import settings

logger = logging.getLogger(__name__)


def _render_template(template: str, variables: dict[str, Any]) -> str:
    """Replace {{var}} placeholders with their string values."""
    result = template
    for key, value in variables.items():
        placeholder = "{{" + key + "}}"
        result = result.replace(placeholder, str(value) if value is not None else "")
    return result


def _parse_judge_response(text: str) -> dict:
    """Extract {"score": float, "reasoning": str} from LLM response text."""
    # Try direct JSON parse
    try:
        data = json.loads(text)
        return {
            "score": float(data["score"]),
            "reasoning": str(data.get("reasoning", "")),
        }
    except (json.JSONDecodeError, KeyError, ValueError, TypeError):
        pass

    # Try to find JSON block inside markdown code fences or raw text
    json_pattern = r'\{[^{}]*"score"\s*:\s*[\d.]+[^{}]*\}'
    match = re.search(json_pattern, text, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group())
            return {
                "score": float(data["score"]),
                "reasoning": str(data.get("reasoning", "")),
            }
        except (json.JSONDecodeError, KeyError, ValueError, TypeError):
            pass

    # Last resort: try to extract a numeric score
    score_match = re.search(r'"?score"?\s*[:=]\s*([\d.]+)', text)
    if score_match:
        score = float(score_match.group(1))
        return {"score": min(max(score, 0.0), 1.0), "reasoning": text}

    raise ValueError(f"Could not parse LLM judge response: {text[:200]}")


class LLMJudgeEvaluator(BaseEvaluator):
    """Evaluator that uses an LLM as a judge via an OpenAI-compatible API."""

    def __init__(
        self,
        name: str = "llm_judge",
        protocol: str = "openai",
        system_prompt: str = "",
        user_prompt_template: str = "",
        model: str | None = None,
        base_url: str | None = None,
        api_key: str | None = None,
        temperature: float = 0.0,
        few_shot_examples: list[dict] | None = None,
        jury_models: list[str] | None = None,
        rubric_mode: bool = False,
    ) -> None:
        super().__init__(name=name, type="llm_judge")
        self.protocol = protocol or "openai"
        self.system_prompt = system_prompt
        self.user_prompt_template = user_prompt_template
        self.model = model or settings.llm_default_model
        self.base_url = base_url or settings.llm_api_base_url
        self.api_key = api_key or settings.llm_api_key
        self.temperature = temperature
        self.few_shot_examples = few_shot_examples or []
        self.jury_models = jury_models or []
        self.rubric_mode = rubric_mode

    async def evaluate(self, eval_input: EvalInput) -> EvalResult:
        if self.protocol != "openai":
            return EvalResult(
                score=0.0,
                reasoning=f"Unsupported LLM protocol: {self.protocol}",
                metadata={"error": f"unsupported protocol {self.protocol}"},
            )

        messages = self._build_messages(eval_input)

        if self.jury_models and len(self.jury_models) >= 2:
            return await self._jury_evaluate(messages)

        return await self._single_evaluate(messages, self.model)

    def _build_messages(self, eval_input: EvalInput) -> list[dict[str, str]]:
        variables = {
            "input": eval_input.input,
            "output": eval_input.output,
            "expected": eval_input.expected,
            "context": eval_input.context,
        }
        user_content = _render_template(self.user_prompt_template, variables)

        system_prompt = self.system_prompt
        if self.rubric_mode:
            system_prompt += (
                "\n\nYou MUST follow this 3-step process:\n"
                "Step 1 (Rubric): Restate the scoring criteria.\n"
                "Step 2 (Reasoning): Analyze the output against each criterion.\n"
                "Step 3 (Score): Provide the final JSON score.\n"
            )

        messages: list[dict[str, str]] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})

        for example in self.few_shot_examples:
            if "user" in example:
                messages.append({"role": "user", "content": example["user"]})
            if "assistant" in example:
                messages.append({"role": "assistant", "content": example["assistant"]})

        messages.append({"role": "user", "content": user_content})
        return messages

    async def _single_evaluate(self, messages: list[dict[str, str]], model: str) -> EvalResult:
        try:
            endpoint = f"{settings.resolve_llm_api_base_url(self.base_url)}/chat/completions"
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    endpoint,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "messages": messages,
                        "temperature": self.temperature,
                        "response_format": {"type": "json_object"},
                    },
                )
                response.raise_for_status()
                data = response.json()
                content = data["choices"][0]["message"]["content"]

            parsed = _parse_judge_response(content)
            score = min(max(parsed["score"], 0.0), 1.0)

            return EvalResult(
                score=score,
                reasoning=parsed["reasoning"],
                metadata={"model": model, "raw_response": content},
            )

        except httpx.HTTPStatusError as e:
            logger.error("LLM API HTTP error: %s", e)
            return EvalResult(
                score=0.0,
                reasoning=f"LLM API error: HTTP {e.response.status_code}",
                metadata={"error": str(e)},
            )
        except (httpx.RequestError, ValueError, KeyError) as e:
            logger.error("LLM judge error: %s", e)
            return EvalResult(
                score=0.0,
                reasoning=f"LLM judge error: {e}",
                metadata={"error": str(e)},
            )

    async def _jury_evaluate(self, messages: list[dict[str, str]]) -> EvalResult:
        """Multi-model jury: run all models in parallel, take median score."""
        tasks = [self._single_evaluate(messages, model) for model in self.jury_models]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        scores: list[float] = []
        reasonings: list[str] = []
        models_used: list[str] = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.warning("Jury model %s failed: %s", self.jury_models[i], result)
                continue
            scores.append(result.score)
            reasonings.append(result.reasoning or "")
            models_used.append(self.jury_models[i])

        if not scores:
            return EvalResult(score=0.0, reasoning="All jury models failed.", metadata={"error": "jury_all_failed"})

        final_score = pystats.median(scores)
        variance = pystats.variance(scores) if len(scores) > 1 else 0.0
        disputed = variance > 0.04

        return EvalResult(
            score=min(max(final_score, 0.0), 1.0),
            reasoning=f"Jury consensus (median of {len(scores)} models). Scores: {[round(s, 3) for s in scores]}"
                + (f" DISPUTED (variance={variance:.4f})" if disputed else ""),
            metadata={
                "jury_mode": True,
                "jury_models": models_used,
                "individual_scores": [round(s, 4) for s in scores],
                "variance": round(variance, 4),
                "disputed": disputed,
            },
        )
