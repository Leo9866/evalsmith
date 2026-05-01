"""Factory to instantiate BaseEvaluator from EvaluatorConfig / DB records."""
from __future__ import annotations

from app.core.base import BaseEvaluator
from app.core.code_evaluator import CodeEvaluator
from app.core.llm_judge import LLMJudgeEvaluator
from app.core.statistical import (
    BLEUEvaluator,
    LevenshteinEvaluator,
    ROUGELEvaluator,
    SemanticSimilarityEvaluator,
)
from app.core.rule import (
    ContainsEvaluator,
    CostThresholdEvaluator,
    ExactMatchEvaluator,
    JSONSchemaValidEvaluator,
    LatencyThresholdEvaluator,
    LengthInRangeEvaluator,
    NotEmptyEvaluator,
    RegexMatchEvaluator,
)
from app.models.schemas import EvaluatorConfig, EvaluatorType, RuleEvaluatorKind
from app.project_models import resolve_project_model


def build_evaluator(name: str, config: EvaluatorConfig) -> BaseEvaluator:
    """Build an evaluator instance from its persisted configuration."""

    if config.type == EvaluatorType.RULE:
        rc = config.rule_config
        if rc is None:
            raise ValueError("rule_config is required for rule evaluators")

        match rc.kind:
            case RuleEvaluatorKind.EXACT_MATCH:
                return ExactMatchEvaluator(name=name, case_sensitive=rc.case_sensitive, strip=rc.strip)
            case RuleEvaluatorKind.CONTAINS:
                return ContainsEvaluator(name=name, keywords=rc.keywords, mode=rc.mode.value)
            case RuleEvaluatorKind.REGEX_MATCH:
                return RegexMatchEvaluator(name=name, pattern=rc.pattern or ".*")
            case RuleEvaluatorKind.JSON_SCHEMA_VALID:
                return JSONSchemaValidEvaluator(name=name, schema=rc.schema_def)
            case RuleEvaluatorKind.NOT_EMPTY:
                return NotEmptyEvaluator(name=name)
            case RuleEvaluatorKind.LENGTH_IN_RANGE:
                return LengthInRangeEvaluator(
                    name=name,
                    min_length=rc.min_length if rc.min_length is not None else 1,
                    max_length=rc.max_length if rc.max_length is not None else 10000,
                )
            case RuleEvaluatorKind.LATENCY_THRESHOLD:
                return LatencyThresholdEvaluator(
                    name=name,
                    threshold_ms=rc.threshold_ms if rc.threshold_ms is not None else 5000,
                )
            case RuleEvaluatorKind.COST_THRESHOLD:
                return CostThresholdEvaluator(
                    name=name,
                    threshold=rc.threshold if rc.threshold is not None else 0.10,
                )
            case _:
                raise ValueError(f"Unknown rule kind: {rc.kind}")

    if config.type == EvaluatorType.LLM_JUDGE:
        lc = config.llm_judge_config
        if lc is None:
            raise ValueError("llm_judge_config is required for llm_judge evaluators")
        protocol_config = lc.protocol_config
        return LLMJudgeEvaluator(
            name=name,
            protocol=lc.protocol,
            system_prompt=lc.system_prompt,
            user_prompt_template=lc.user_prompt_template,
            model=(protocol_config.model if protocol_config and protocol_config.model else lc.model),
            base_url=protocol_config.base_url if protocol_config else None,
            api_key=protocol_config.api_key if protocol_config else None,
            temperature=lc.temperature,
            few_shot_examples=lc.few_shot_examples,
            jury_models=lc.jury_models,
            rubric_mode=lc.rubric_mode,
        )

    if config.type == EvaluatorType.CODE:
        cc = config.code_config
        if cc is None:
            raise ValueError("code_config is required for code evaluators")
        return CodeEvaluator(
            name=name,
            code=cc.code,
            timeout_seconds=cc.timeout_seconds,
        )

    if config.type == EvaluatorType.STATISTICAL:
        sc = config.statistical_config
        kind = sc.kind if sc else "levenshtein"
        match kind:
            case "bleu":
                return BLEUEvaluator(name=name)
            case "rouge_l":
                return ROUGELEvaluator(name=name)
            case "levenshtein":
                return LevenshteinEvaluator(name=name)
            case "semantic_similarity":
                return SemanticSimilarityEvaluator(name=name)
            case _:
                raise ValueError(f"Unknown statistical kind: {kind}")

    raise ValueError(f"Unsupported evaluator type: {config.type}")


async def build_project_evaluator(name: str, config: EvaluatorConfig, project_id: str) -> BaseEvaluator:
    if config.type != EvaluatorType.LLM_JUDGE:
        return build_evaluator(name, config)

    lc = config.llm_judge_config
    if lc is None:
        raise ValueError("llm_judge_config is required for llm_judge evaluators")

    if not lc.project_model_id and not lc.use_project_default_model:
        return build_evaluator(name, config)

    resolved = await resolve_project_model(
        project_id=project_id,
        model_id=lc.project_model_id,
        use_default=lc.use_project_default_model,
    )

    return LLMJudgeEvaluator(
        name=name,
        protocol=resolved.protocol or lc.protocol,
        system_prompt=lc.system_prompt,
        user_prompt_template=lc.user_prompt_template,
        model=resolved.model or lc.model,
        base_url=resolved.base_url,
        api_key=resolved.api_key,
        temperature=lc.temperature,
        few_shot_examples=lc.few_shot_examples,
        jury_models=lc.jury_models,
        rubric_mode=lc.rubric_mode,
    )
