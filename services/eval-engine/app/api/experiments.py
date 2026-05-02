from __future__ import annotations

import math
from statistics import mean

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import AccessContext, WRITE_ROLES, get_access_context, require_roles
from app.db import experiment_repo, prompt_repo
from app.models.responses import ApiResponse, PaginatedData
from app.models.schemas import (
    ExperimentBaselineSetRequest,
    ExperimentCompareRequest,
    ExperimentCompareResponse,
    ExperimentCompareDelta,
    ExperimentCompareItem,
    ExperimentCompareSample,
    ExperimentCreate,
    ExperimentPromptRef,
    ExperimentStatus,
    ExperimentSummary,
    ExperimentTargetPreviewRequest,
    ExperimentTargetPreviewResponse,
    PromptRenderPreview,
)
from app.workflow.runner import (
    TargetConfigError,
    TargetEndpointHTTPError,
    TargetEndpointUnavailableError,
    invoke_target_endpoint,
    validate_target_config,
)

router = APIRouter(prefix="/api/v1/experiments", tags=["experiments"])
_TERMINAL_EXPERIMENT_STATUSES = {
    ExperimentStatus.COMPLETED.value,
    ExperimentStatus.FAILED.value,
    ExperimentStatus.CANCELED.value,
}


async def _resolve_prompt_binding(
    prompt_ref: ExperimentPromptRef | None,
    project_id: str,
):
    if prompt_ref is None:
        return None, None
    snapshot = await prompt_repo.get_prompt_snapshot(prompt_ref.prompt_id, project_id, prompt_ref.version)
    if snapshot is None:
        return None, None
    return (
        ExperimentPromptRef(prompt_id=snapshot.prompt_id, version=snapshot.version),
        snapshot,
    )


@router.post("/target-preview", response_model=ApiResponse)
async def preview_experiment_target(
    body: ExperimentTargetPreviewRequest,
    _access: AccessContext = Depends(require_roles(*WRITE_ROLES)),
):
    resolved_prompt_ref, prompt_snapshot = await _resolve_prompt_binding(body.prompt_ref, _access.project_id)
    if body.prompt_ref and prompt_snapshot is None:
        return ApiResponse.error(message="Prompt or version not found", code=404)
    try:
        preview = await invoke_target_endpoint(
            target_url=body.target_url,
            target_method=body.target_method.value,
            target_headers=body.target_headers,
            target_body_template=body.target_body_template,
            target_response_path=body.target_response_path,
            target_timeout_ms=body.target_timeout_ms,
            prompt_snapshot=prompt_snapshot.model_dump(mode="json") if prompt_snapshot else None,
            example=body.example.model_dump(mode="json"),
        )
    except TargetEndpointHTTPError as exc:
        raise HTTPException(
            status_code=422 if 400 <= exc.status_code < 500 else 502,
            detail={
                "message": "target endpoint returned an error",
                "details": {
                    "status_code": exc.status_code,
                    "response": exc.response_body,
                },
            },
        ) from exc
    except TargetEndpointUnavailableError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "target endpoint is unavailable",
                "details": {
                    "error": str(exc),
                    "reason": exc.reason,
                },
            },
        ) from exc
    except TargetConfigError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "target preview validation failed",
                "details": {"error": str(exc)},
            },
        ) from exc

    return ApiResponse.success(
        data=ExperimentTargetPreviewResponse(
            request_method=preview.request_method,
            request_url=preview.request_url,
            request_body=preview.request_body,
            response_status_code=preview.response_status_code,
            response_path_used=preview.response_path_used,
            latency_ms=preview.latency_ms,
            trace_id=preview.trace_id,
            output=preview.output,
            raw_response=preview.raw_response,
            prompt_preview=PromptRenderPreview(**preview.prompt_preview) if preview.prompt_preview else None,
        )
    )


# ---------------------------------------------------------------------------
# Create and run experiment
# ---------------------------------------------------------------------------

@router.post("", response_model=ApiResponse)
async def create_experiment(
    body: ExperimentCreate,
    access: AccessContext = Depends(require_roles(*WRITE_ROLES)),
):
    project_id = access.project_id
    resolved_prompt_ref, prompt_snapshot = await _resolve_prompt_binding(body.prompt_ref, project_id)
    if body.prompt_ref and prompt_snapshot is None:
        return ApiResponse.error(message="Prompt or version not found", code=404)
    try:
        validate_target_config(
            target_url=body.target_url,
            target_method=body.target_method.value,
            target_headers=body.target_headers,
            target_body_template=body.target_body_template,
            target_response_path=body.target_response_path,
            target_timeout_ms=body.target_timeout_ms,
        )
    except TargetConfigError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "experiment target config is invalid",
                "details": {"error": str(exc)},
            },
        ) from exc
    experiment = await experiment_repo.create_experiment(
        body,
        project_id=project_id,
        prompt_ref=resolved_prompt_ref,
        prompt_snapshot=prompt_snapshot,
    )
    await experiment_repo.enqueue_experiment_job(
        experiment_id=experiment.id,
        project_id=project_id,
        payload={
            "dataset_id": body.dataset_id,
            "dataset_version": body.dataset_version,
            "split": body.split,
            "evaluator_ids": body.evaluator_ids,
            "target_url": body.target_url,
            "target_method": body.target_method,
            "target_headers": body.target_headers,
            "target_body_template": body.target_body_template,
            "target_response_path": body.target_response_path,
            "target_timeout_ms": body.target_timeout_ms,
            "concurrency": body.concurrency,
            "prompt_ref": resolved_prompt_ref.model_dump(mode="json") if resolved_prompt_ref else None,
            "prompt_snapshot": prompt_snapshot.model_dump(mode="json") if prompt_snapshot else None,
        },
    )
    return ApiResponse.success(data=experiment)


# ---------------------------------------------------------------------------
# List experiments
# ---------------------------------------------------------------------------

@router.get("", response_model=ApiResponse)
async def list_experiments(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    query: str | None = Query(default=None),
    status: ExperimentStatus | None = Query(default=None),
    access: AccessContext = Depends(get_access_context),
):
    items, total = await experiment_repo.list_experiments_paginated(
        project_id=access.project_id,
        page=page,
        page_size=page_size,
        query=query.strip() if query and query.strip() else None,
        status=status.value if status else None,
    )
    return ApiResponse.success(
        data=PaginatedData(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=math.ceil(total / page_size) if total > 0 else 0,
        )
    )


# ---------------------------------------------------------------------------
# Get dataset baseline experiment
# ---------------------------------------------------------------------------

@router.get("/baselines", response_model=ApiResponse)
async def get_baseline(
    dataset_id: str = Query(...),
    access: AccessContext = Depends(get_access_context),
):
    baseline = await experiment_repo.get_baseline(access.project_id, dataset_id)
    if baseline is None:
        return ApiResponse.success(data=None)
    return ApiResponse.success(data=baseline)


# ---------------------------------------------------------------------------
# Get experiment with summary
# ---------------------------------------------------------------------------

@router.get("/{experiment_id}", response_model=ApiResponse)
async def get_experiment(
    experiment_id: str,
    access: AccessContext = Depends(get_access_context),
):
    experiment = await experiment_repo.get_experiment(experiment_id, access.project_id)
    if not experiment:
        return ApiResponse.error(message="Experiment not found", code=404)
    return ApiResponse.success(data=experiment)


# ---------------------------------------------------------------------------
# Get paginated results
# ---------------------------------------------------------------------------

@router.get("/{experiment_id}/results", response_model=ApiResponse)
async def get_experiment_results(
    experiment_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    sort_by: str = Query(default="created_at", pattern="^(created_at|latency_ms|score)$"),
    sort_order: str = Query(default="asc", pattern="^(asc|desc)$"),
    max_score: float | None = Query(default=None, ge=0.0, le=1.0),
    access: AccessContext = Depends(get_access_context),
):
    items, total = await experiment_repo.get_results(
        experiment_id,
        access.project_id,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        sort_order=sort_order,
        max_score=max_score,
    )
    total_pages = math.ceil(total / page_size) if total > 0 else 0

    paginated = PaginatedData(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )
    return ApiResponse.success(data=paginated)


# ---------------------------------------------------------------------------
# Compare experiments
# ---------------------------------------------------------------------------

@router.post("/compare", response_model=ApiResponse)
async def compare_experiments(
    body: ExperimentCompareRequest,
    access: AccessContext = Depends(get_access_context),
):
    if len(body.experiment_ids) != 2:
        return ApiResponse.error(message="Compare currently supports exactly two experiments", code=422)

    baseline_id = body.baseline_experiment_id or body.experiment_ids[0]
    if baseline_id not in body.experiment_ids:
        return ApiResponse.error(message="Baseline experiment must be included in compare set", code=422)

    items = []
    for exp_id in body.experiment_ids:
        exp = await experiment_repo.get_experiment(exp_id, access.project_id)
        if exp is None:
            return ApiResponse.error(message=f"Experiment {exp_id} not found", code=404)
        if exp.status.value not in _TERMINAL_EXPERIMENT_STATUSES:
            return ApiResponse.error(
                message=f"Experiment {exp.name} is still running and cannot be compared yet",
                code=409,
            )
        items.append(ExperimentCompareItem(
            experiment_id=exp.id,
            name=exp.name,
            summary=exp.summary or ExperimentSummary(),
            dataset_id=exp.dataset_id,
            status=exp.status,
        ))
    dataset_ids = {item.dataset_id for item in items}
    if len(dataset_ids) != 1:
        return ApiResponse.error(message="Compared experiments must use the same dataset", code=422)

    candidate_ids = [exp_id for exp_id in body.experiment_ids if exp_id != baseline_id]
    evaluator_deltas: list[ExperimentCompareDelta] = []
    sample_diffs: list[ExperimentCompareSample] = []

    if candidate_ids:
        baseline_results = await experiment_repo.list_all_results(baseline_id, access.project_id)
        candidate_results = await experiment_repo.list_all_results(candidate_ids[0], access.project_id)
        baseline_by_example = {item.example_id: item for item in baseline_results}
        candidate_by_example = {item.example_id: item for item in candidate_results}

        evaluator_names = sorted({
            score.evaluator_name
            for result in baseline_results + candidate_results
            for score in result.scores
        })
        for evaluator_name in evaluator_names:
            baseline_scores: list[float] = []
            candidate_scores: list[float] = []
            improved = 0
            regressed = 0
            unchanged = 0
            for example_id, candidate in candidate_by_example.items():
                baseline = baseline_by_example.get(example_id)
                if baseline is None:
                    continue
                baseline_score = next((score.score for score in baseline.scores if score.evaluator_name == evaluator_name), 0.0)
                candidate_score = next((score.score for score in candidate.scores if score.evaluator_name == evaluator_name), 0.0)
                baseline_scores.append(baseline_score)
                candidate_scores.append(candidate_score)
                delta = candidate_score - baseline_score
                if delta > 0.02:
                    improved += 1
                elif delta < -0.02:
                    regressed += 1
                else:
                    unchanged += 1
            evaluator_deltas.append(ExperimentCompareDelta(
                evaluator_name=evaluator_name,
                baseline_score=round(mean(baseline_scores), 4) if baseline_scores else 0.0,
                candidate_score=round(mean(candidate_scores), 4) if candidate_scores else 0.0,
                delta=round((mean(candidate_scores) - mean(baseline_scores)), 4) if baseline_scores and candidate_scores else 0.0,
                improved=improved,
                regressed=regressed,
                unchanged=unchanged,
            ))

        ranked_samples: list[tuple[tuple[int, float, str], ExperimentCompareSample]] = []
        for example_id in sorted(set(baseline_by_example) & set(candidate_by_example)):
            candidate = candidate_by_example[example_id]
            baseline = baseline_by_example.get(example_id)
            if baseline is None:
                continue
            score_deltas = {}
            evaluator_names_for_example = sorted({
                score.evaluator_name
                for score in baseline.scores + candidate.scores
            })
            for evaluator_name in evaluator_names_for_example:
                baseline_score = next((item.score for item in baseline.scores if item.evaluator_name == evaluator_name), 0.0)
                candidate_score = next((item.score for item in candidate.scores if item.evaluator_name == evaluator_name), 0.0)
                score_deltas[evaluator_name] = round(candidate_score - baseline_score, 4)
            verdict = "unchanged"
            if any(delta > 0.02 for delta in score_deltas.values()):
                verdict = "improved"
            if any(delta < -0.02 for delta in score_deltas.values()):
                verdict = "regressed"
            sample = ExperimentCompareSample(
                example_id=example_id,
                input=candidate.input,
                expected_output=candidate.expected_output,
                baseline_output=baseline.actual_output,
                candidate_output=candidate.actual_output,
                baseline_trace_id=baseline.trace_id,
                candidate_trace_id=candidate.trace_id,
                score_deltas=score_deltas,
                verdict=verdict,
            )
            max_abs_delta = max((abs(delta) for delta in score_deltas.values()), default=0.0)
            verdict_rank = 0 if verdict == "regressed" else 1 if verdict == "improved" else 2
            ranked_samples.append(((verdict_rank, -max_abs_delta, example_id), sample))

        sample_diffs = [sample for _rank, sample in sorted(ranked_samples)[:25]]

    return ApiResponse.success(data=ExperimentCompareResponse(
        experiments=items,
        baseline_experiment_id=baseline_id,
        evaluator_deltas=evaluator_deltas,
        sample_diffs=sample_diffs,
    ))


@router.post("/{experiment_id}/baseline", response_model=ApiResponse)
async def set_baseline(
    experiment_id: str,
    body: ExperimentBaselineSetRequest,
    access: AccessContext = Depends(require_roles(*WRITE_ROLES)),
):
    project_id = access.project_id
    experiment = await experiment_repo.get_experiment(experiment_id, project_id)
    if experiment is None:
        return ApiResponse.error(message="Experiment not found", code=404)
    if experiment.dataset_id != body.dataset_id:
        return ApiResponse.error(message="Baseline dataset does not match experiment dataset", code=422)
    if experiment.status != ExperimentStatus.COMPLETED:
        return ApiResponse.error(message="Only completed experiments can be set as baseline", code=409)
    baseline = await experiment_repo.set_baseline(project_id, body.dataset_id, experiment_id)
    return ApiResponse.success(data=baseline)


# ---------------------------------------------------------------------------
# Delete experiment
# ---------------------------------------------------------------------------

@router.delete("/{experiment_id}", response_model=ApiResponse)
async def delete_experiment(
    experiment_id: str,
    access: AccessContext = Depends(require_roles(*WRITE_ROLES)),
):
    deleted = await experiment_repo.delete_experiment(experiment_id, access.project_id)
    if not deleted:
        return ApiResponse.error(message="Experiment not found", code=404)
    return ApiResponse.success(message="Experiment deleted")


@router.post("/{experiment_id}/cancel", response_model=ApiResponse)
async def cancel_experiment(
    experiment_id: str,
    access: AccessContext = Depends(require_roles(*WRITE_ROLES)),
):
    canceled = await experiment_repo.request_cancel(experiment_id, access.project_id)
    if not canceled:
        return ApiResponse.error(message="Experiment cannot be canceled", code=400)
    return ApiResponse.success(message="Cancellation requested")
