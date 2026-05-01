from __future__ import annotations

import math
from typing import Any

from fastapi import APIRouter, Depends, Query

from app.auth import AccessContext, WRITE_ROLES, get_access_context, require_roles
from app.core.factory import build_evaluator, build_project_evaluator
from app.core.registry import registry
from app.db import evaluator_repo
from app.models.responses import ApiResponse, PaginatedData
from app.models.schemas import (
    LLMJudgeConfig,
    LLMProtocolConfig,
    EvaluatorConfig,
    EvaluatorCreate,
    EvaluatorRegressionSampleResult,
    EvaluatorRegressionTestRequest,
    EvaluatorRegressionTestResponse,
    EvaluatorRegressionVersionResult,
    EvaluatorResponse,
    EvaluatorTestRequest,
    EvaluatorVersionDiffEntry,
    EvaluatorVersionDiffResponse,
    EvaluatorType,
    EvalResult,
    RuleConfig,
    RuleEvaluatorKind,
    StatisticalConfig,
)

router = APIRouter(prefix="/api/v1/evaluators", tags=["evaluators"])
MISSING = object()


# ---------------------------------------------------------------------------
# List evaluators (built-in + custom for project)
# ---------------------------------------------------------------------------

@router.get("", response_model=ApiResponse)
async def list_evaluators(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    query: str | None = Query(default=None),
    evaluator_type: EvaluatorType | None = Query(default=None, alias="type"),
    access: AccessContext = Depends(get_access_context),
):
    normalized_query = query.strip().lower() if query and query.strip() else None

    builtin = []
    for ev in registry.list_all():
        response = _builtin_to_response(ev)
        if evaluator_type is not None and response.type != evaluator_type:
            continue
        if normalized_query:
            haystacks = [response.name.lower(), response.description.lower()]
            if not any(normalized_query in item for item in haystacks):
                continue
        builtin.append(response)
    builtin.sort(key=lambda item: item.name.lower())

    offset = (page - 1) * page_size
    builtin_page = builtin[offset: offset + page_size] if offset < len(builtin) else []
    custom_limit = page_size - len(builtin_page)
    custom_offset = max(0, offset - len(builtin))
    custom_items, custom_total = await evaluator_repo.list_evaluators(
        access.project_id,
        offset=custom_offset,
        limit=custom_limit if custom_limit > 0 else 0,
        query=query.strip() if query and query.strip() else None,
        evaluator_type=evaluator_type.value if evaluator_type else None,
    )
    total = len(builtin) + custom_total

    return ApiResponse.success(
        data=PaginatedData(
            items=builtin_page + custom_items,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=math.ceil(total / page_size) if total > 0 else 0,
        )
    )


# ---------------------------------------------------------------------------
# Create custom evaluator
# ---------------------------------------------------------------------------

@router.post("", response_model=ApiResponse)
async def create_evaluator(
    body: EvaluatorCreate,
    access: AccessContext = Depends(require_roles(*WRITE_ROLES)),
):
    evaluator = await evaluator_repo.create_evaluator(
        name=body.name,
        description=body.description,
        config=body.config,
        project_id=access.project_id,
    )
    return ApiResponse.success(data=evaluator)


# ---------------------------------------------------------------------------
# Get evaluator detail
# ---------------------------------------------------------------------------

@router.get("/{evaluator_id}", response_model=ApiResponse)
async def get_evaluator(
    evaluator_id: str,
    access: AccessContext = Depends(get_access_context),
):
    # Check built-in first
    if evaluator_id.startswith("builtin:"):
        name = evaluator_id.removeprefix("builtin:")
        ev = registry.get(name)
        if ev:
            return ApiResponse.success(data=_builtin_to_response(ev))
        return ApiResponse.error(message="Evaluator not found", code=404)

    evaluator = await evaluator_repo.get_evaluator(evaluator_id, access.project_id)
    if not evaluator:
        return ApiResponse.error(message="Evaluator not found", code=404)
    return ApiResponse.success(data=evaluator)


# ---------------------------------------------------------------------------
# Evaluator version history
# ---------------------------------------------------------------------------

@router.get("/{evaluator_id}/versions", response_model=ApiResponse)
async def list_evaluator_versions(
    evaluator_id: str,
    access: AccessContext = Depends(get_access_context),
):
    context = await _load_version_context(evaluator_id, access.project_id)
    if not context:
        return ApiResponse.error(message="Evaluator not found", code=404)
    return ApiResponse.success(data=context["entries"])


@router.get("/{evaluator_id}/versions/{version}/diff", response_model=ApiResponse)
async def get_evaluator_version_diff(
    evaluator_id: str,
    version: int,
    base_version: int | None = Query(default=None, ge=1),
    access: AccessContext = Depends(get_access_context),
):
    context = await _load_version_context(evaluator_id, access.project_id)
    if not context:
        return ApiResponse.error(message="Evaluator not found", code=404)

    entries = context["entries"]
    target_entry = _find_version_entry(entries, version)
    if not target_entry:
        return ApiResponse.error(message=f"Evaluator version v{version} not found", code=404)

    if base_version is not None:
        base_entry = _find_version_entry(entries, base_version)
        if not base_entry:
            return ApiResponse.error(message=f"Base evaluator version v{base_version} not found", code=404)
    else:
        base_entry = next((entry for entry in entries if entry["version"] != version and entry["is_current"]), None)
        if base_entry is None:
            base_entry = next((entry for entry in entries if entry["version"] != version), target_entry)

    diff = EvaluatorVersionDiffResponse(
        evaluator_id=context["evaluator_id"],
        base_version=base_entry["version"],
        target_version=target_entry["version"],
        base_is_current=bool(base_entry["is_current"]),
        target_is_current=bool(target_entry["is_current"]),
        changes=_collect_config_changes(base_entry["config"], target_entry["config"]),
    )
    return ApiResponse.success(data=diff)


# ---------------------------------------------------------------------------
# Update evaluator
# ---------------------------------------------------------------------------

@router.put("/{evaluator_id}", response_model=ApiResponse)
async def update_evaluator(
    evaluator_id: str,
    body: EvaluatorCreate,
    access: AccessContext = Depends(require_roles(*WRITE_ROLES)),
):
    if evaluator_id.startswith("builtin:"):
        return ApiResponse.error(message="Built-in evaluator is read-only. Clone it to create a custom evaluator.", code=409)

    updated = await evaluator_repo.update_evaluator(
        evaluator_id=evaluator_id,
        project_id=access.project_id,
        name=body.name,
        description=body.description,
        config=body.config,
    )
    if not updated:
        return ApiResponse.error(message="Evaluator not found", code=404)
    return ApiResponse.success(data=updated)


# ---------------------------------------------------------------------------
# Delete evaluator
# ---------------------------------------------------------------------------

@router.delete("/{evaluator_id}", response_model=ApiResponse)
async def delete_evaluator(
    evaluator_id: str,
    access: AccessContext = Depends(require_roles(*WRITE_ROLES)),
):
    if evaluator_id.startswith("builtin:"):
        return ApiResponse.error(message="Built-in evaluator is read-only. Clone it to create a custom evaluator.", code=409)

    deleted = await evaluator_repo.delete_evaluator(evaluator_id, access.project_id)
    if not deleted:
        return ApiResponse.error(message="Evaluator not found", code=404)
    return ApiResponse.success(message="Evaluator deleted")


# ---------------------------------------------------------------------------
# Playground: test an evaluator on a sample input
# ---------------------------------------------------------------------------

@router.post("/{evaluator_id}/test", response_model=ApiResponse)
async def test_evaluator(
    evaluator_id: str,
    body: EvaluatorTestRequest,
    access: AccessContext = Depends(get_access_context),
):
    # Resolve evaluator instance
    if evaluator_id.startswith("builtin:"):
        name = evaluator_id.removeprefix("builtin:")
        ev = registry.get(name)
        if not ev:
            return ApiResponse.error(message="Built-in evaluator not found", code=404)
    else:
        db_eval = await evaluator_repo.get_evaluator(evaluator_id, access.project_id)
        if not db_eval:
            return ApiResponse.error(message="Evaluator not found", code=404)
        try:
            ev = await build_project_evaluator(db_eval.name, db_eval.config, access.project_id)
        except ValueError as e:
            return ApiResponse.error(message=str(e))

    result: EvalResult = await ev.run(body.eval_input)
    return ApiResponse.success(data=result)


@router.post("/{evaluator_id}/regression-test", response_model=ApiResponse)
async def regression_test_evaluator(
    evaluator_id: str,
    body: EvaluatorRegressionTestRequest,
    access: AccessContext = Depends(get_access_context),
):
    context = await _load_version_context(evaluator_id, access.project_id)
    if not context:
        return ApiResponse.error(message="Evaluator not found", code=404)

    entries = context["entries"]
    requested_versions = body.versions or [entry["version"] for entry in entries[:3]]
    selected_entries: list[dict[str, Any]] = []
    seen_versions: set[int] = set()

    for requested_version in requested_versions:
        if requested_version in seen_versions:
            continue
        entry = _find_version_entry(entries, requested_version)
        if not entry:
            return ApiResponse.error(message=f"Evaluator version v{requested_version} not found", code=404)
        selected_entries.append(entry)
        seen_versions.add(requested_version)

    version_results: list[EvaluatorRegressionVersionResult] = []
    for entry in selected_entries:
        try:
            evaluator = await _build_evaluator_for_entry(context, entry, access.project_id)
        except ValueError as exc:
            return ApiResponse.error(message=str(exc), code=422)

        sample_results: list[EvaluatorRegressionSampleResult] = []
        score_values: list[float] = []
        passed = 0
        failed = 0

        for index, sample in enumerate(body.samples):
            try:
                result = await evaluator.run(sample.eval_input)
                score_values.append(result.score)
                if result.score >= 0.5:
                    passed += 1
                else:
                    failed += 1
                sample_results.append(
                    EvaluatorRegressionSampleResult(
                        index=index,
                        label=sample.label,
                        result=result,
                    )
                )
            except Exception as exc:  # pragma: no cover - defensive boundary for evaluator runtime failures
                failed += 1
                sample_results.append(
                    EvaluatorRegressionSampleResult(
                        index=index,
                        label=sample.label,
                        error=str(exc),
                    )
                )

        version_results.append(
            EvaluatorRegressionVersionResult(
                version=entry["version"],
                is_current=bool(entry["is_current"]),
                avg_score=round(sum(score_values) / len(score_values), 4) if score_values else None,
                passed=passed,
                failed=failed,
                sample_results=sample_results,
            )
        )

    return ApiResponse.success(
        data=EvaluatorRegressionTestResponse(
            evaluator_id=context["evaluator_id"],
            sample_count=len(body.samples),
            versions=version_results,
        )
    )


@router.post("/test-config", response_model=ApiResponse)
async def test_evaluator_config(
    body: dict,
    access: AccessContext = Depends(get_access_context),
):
    config_payload = body.get("config")
    eval_input_payload = body.get("eval_input")
    if not isinstance(config_payload, dict) or not isinstance(eval_input_payload, dict):
        return ApiResponse.error(message="config and eval_input are required", code=400)

    try:
        config = EvaluatorConfig(**config_payload)
        eval_input = EvaluatorTestRequest(eval_input=eval_input_payload).eval_input
        ev = await build_project_evaluator("playground", config, access.project_id)
    except ValueError as exc:
        return ApiResponse.error(message=str(exc), code=400)
    except Exception as exc:
        return ApiResponse.error(message=f"Invalid payload: {exc}", code=400)

    result: EvalResult = await ev.run(eval_input)
    return ApiResponse.success(data=result)


def _builtin_to_response(ev) -> EvaluatorResponse:
    return EvaluatorResponse(
        id=f"builtin:{ev.name}",
        name=ev.name,
        type=EvaluatorType(ev.type),
        description=f"Built-in {ev.type} evaluator",
        config=_builtin_config(ev),
        is_builtin=True,
        version=1,
    )


def _builtin_config(ev) -> EvaluatorConfig:
    evaluator_type = EvaluatorType(ev.type)

    if evaluator_type == EvaluatorType.RULE:
        kind_by_name = {
            "exact_match": RuleEvaluatorKind.EXACT_MATCH,
            "contains": RuleEvaluatorKind.CONTAINS,
            "regex_match": RuleEvaluatorKind.REGEX_MATCH,
            "json_schema_valid": RuleEvaluatorKind.JSON_SCHEMA_VALID,
            "not_empty": RuleEvaluatorKind.NOT_EMPTY,
            "length_in_range": RuleEvaluatorKind.LENGTH_IN_RANGE,
            "latency_threshold": RuleEvaluatorKind.LATENCY_THRESHOLD,
            "cost_threshold": RuleEvaluatorKind.COST_THRESHOLD,
        }
        kind = kind_by_name.get(ev.name)
        if kind is None:
            raise ValueError(f"Unsupported built-in rule evaluator: {ev.name}")

        return EvaluatorConfig(
            type=evaluator_type,
            rule_config=RuleConfig(
                kind=kind,
                case_sensitive=getattr(ev, "case_sensitive", True),
                strip=getattr(ev, "strip", True),
                keywords=list(getattr(ev, "keywords", []) or []),
                mode=getattr(ev, "mode", "any"),
                pattern=getattr(ev, "pattern", None),
                schema=getattr(ev, "schema", None),
                min_length=getattr(ev, "min_length", None),
                max_length=getattr(ev, "max_length", None),
                threshold_ms=getattr(ev, "threshold_ms", None),
                threshold=getattr(ev, "threshold", None),
            ),
        )

    if evaluator_type == EvaluatorType.LLM_JUDGE:
        return EvaluatorConfig(
            type=evaluator_type,
            llm_judge_config=LLMJudgeConfig(
                protocol=getattr(ev, "protocol", "openai"),
                protocol_config=LLMProtocolConfig(),
                system_prompt=getattr(ev, "system_prompt", ""),
                user_prompt_template=getattr(ev, "user_prompt_template", ""),
                model=None,
                temperature=getattr(ev, "temperature", 0.0),
                few_shot_examples=list(getattr(ev, "few_shot_examples", []) or []),
                jury_models=list(getattr(ev, "jury_models", []) or []),
                rubric_mode=bool(getattr(ev, "rubric_mode", False)),
            ),
        )

    if evaluator_type == EvaluatorType.STATISTICAL:
        return EvaluatorConfig(
            type=evaluator_type,
            statistical_config=StatisticalConfig(kind=ev.name),
        )

    raise ValueError(f"Unsupported built-in evaluator type: {ev.type}")


async def _load_version_context(evaluator_id: str, project_id: str) -> dict[str, Any] | None:
    if evaluator_id.startswith("builtin:"):
        name = evaluator_id.removeprefix("builtin:")
        ev = registry.get(name)
        if not ev:
            return None
        builtin = _builtin_to_response(ev)
        return {
            "evaluator_id": builtin.id,
            "name": builtin.name,
            "is_builtin": True,
            "builtin": ev,
            "entries": [
                _serialize_version_entry(
                    evaluator_id=builtin.id,
                    version=builtin.version,
                    config=builtin.config.model_dump(mode="json"),
                    description=builtin.description,
                    changelog="Current built-in version",
                    created_at=None,
                    is_current=True,
                )
            ],
        }

    current = await evaluator_repo.get_evaluator(evaluator_id, project_id)
    if not current:
        return None

    history = await evaluator_repo.list_evaluator_versions(evaluator_id, project_id)
    return {
        "evaluator_id": current.id,
        "name": current.name,
        "is_builtin": False,
        "entries": [
            _serialize_version_entry(
                evaluator_id=current.id,
                version=current.version,
                config=current.config.model_dump(mode="json"),
                description=current.description,
                changelog="Current version",
                created_at=current.updated_at.isoformat() if current.updated_at else None,
                is_current=True,
            ),
            *[
                _serialize_version_entry(
                    evaluator_id=item["evaluator_id"],
                    version=item["version"],
                    config=item["config"],
                    description=current.description,
                    changelog=item.get("changelog"),
                    created_at=item.get("created_at"),
                    is_current=False,
                )
                for item in history
            ],
        ],
    }


def _serialize_version_entry(
    *,
    evaluator_id: str,
    version: int,
    config: dict[str, Any],
    description: str | None,
    changelog: str | None,
    created_at: str | None,
    is_current: bool,
) -> dict[str, Any]:
    suffix = "current" if is_current else f"v{version}"
    return {
        "id": f"{evaluator_id}:{suffix}",
        "evaluator_id": evaluator_id,
        "version": version,
        "config": config,
        "description": description,
        "changelog": changelog,
        "created_at": created_at,
        "is_current": is_current,
    }


def _find_version_entry(entries: list[dict[str, Any]], version: int) -> dict[str, Any] | None:
    return next((entry for entry in entries if entry["version"] == version), None)


async def _build_evaluator_for_entry(context: dict[str, Any], entry: dict[str, Any], project_id: str):
    if context["is_builtin"]:
        if entry["version"] != 1:
            raise ValueError(f"Built-in evaluator only exposes v1, got v{entry['version']}")
        return context["builtin"]

    config = EvaluatorConfig(**entry["config"])
    return await build_project_evaluator(str(context["name"]), config, project_id)


def _collect_config_changes(before: dict[str, Any], after: dict[str, Any]) -> list[EvaluatorVersionDiffEntry]:
    changes: list[EvaluatorVersionDiffEntry] = []
    _append_diff("", before, after, changes)
    return changes


def _append_diff(path: str, before: Any, after: Any, changes: list[EvaluatorVersionDiffEntry]) -> None:
    if before is MISSING and after is not MISSING:
        changes.append(EvaluatorVersionDiffEntry(path=path, change_type="added", after=after))
        return
    if after is MISSING and before is not MISSING:
        changes.append(EvaluatorVersionDiffEntry(path=path, change_type="removed", before=before))
        return

    if isinstance(before, dict) and isinstance(after, dict):
        keys = sorted(set(before.keys()) | set(after.keys()))
        for key in keys:
            child_path = f"{path}.{key}" if path else key
            _append_diff(child_path, before.get(key, MISSING), after.get(key, MISSING), changes)
        return

    if isinstance(before, list) and isinstance(after, list):
        if before != after:
            changes.append(EvaluatorVersionDiffEntry(path=path, change_type="changed", before=before, after=after))
        return

    if before != after:
        changes.append(EvaluatorVersionDiffEntry(path=path, change_type="changed", before=before, after=after))
