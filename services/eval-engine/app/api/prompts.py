from __future__ import annotations

import math

from asyncpg.exceptions import UniqueViolationError
from fastapi import APIRouter, Depends, Query

from app.auth import AccessContext, WRITE_ROLES, get_access_context, require_roles
from app.db import prompt_repo
from app.models.responses import ApiResponse, PaginatedData
from app.models.schemas import (
    PromptCreate,
    PromptReleaseRequest,
    PromptRenderPreview,
    PromptRenderPreviewRequest,
    PromptRollbackRequest,
    PromptUpdate,
    PromptVersionCreate,
)
from app.prompting import build_prompt_preview

router = APIRouter(prefix="/api/v1/prompts", tags=["prompts"])


@router.get("", response_model=ApiResponse)
async def list_prompts(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    query: str | None = Query(default=None),
    status: str | None = Query(default=None),
    access: AccessContext = Depends(get_access_context),
):
    items, total = await prompt_repo.list_prompts(
        access.project_id,
        page=page,
        page_size=page_size,
        query=query,
        status=status,
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


@router.post("", response_model=ApiResponse)
async def create_prompt(
    body: PromptCreate,
    access: AccessContext = Depends(require_roles(*WRITE_ROLES)),
):
    try:
        prompt = await prompt_repo.create_prompt(body, access.project_id, access.user_id)
    except UniqueViolationError:
        return ApiResponse.error(message="Prompt 名称已存在，请更换名称", code=409)
    return ApiResponse.success(data=prompt)


@router.get("/{prompt_id}", response_model=ApiResponse)
async def get_prompt(
    prompt_id: str,
    access: AccessContext = Depends(get_access_context),
):
    prompt = await prompt_repo.get_prompt(prompt_id, access.project_id)
    if prompt is None:
        return ApiResponse.error(message="Prompt not found", code=404)
    return ApiResponse.success(data=prompt)


@router.put("/{prompt_id}", response_model=ApiResponse)
async def update_prompt(
    prompt_id: str,
    body: PromptUpdate,
    access: AccessContext = Depends(require_roles(*WRITE_ROLES)),
):
    try:
        prompt = await prompt_repo.update_prompt(prompt_id, access.project_id, body)
    except UniqueViolationError:
        return ApiResponse.error(message="Prompt 名称已存在，请更换名称", code=409)
    if prompt is None:
        return ApiResponse.error(message="Prompt not found", code=404)
    return ApiResponse.success(data=prompt)


@router.get("/{prompt_id}/versions", response_model=ApiResponse)
async def list_prompt_versions(
    prompt_id: str,
    access: AccessContext = Depends(get_access_context),
):
    prompt = await prompt_repo.get_prompt(prompt_id, access.project_id)
    if prompt is None:
        return ApiResponse.error(message="Prompt not found", code=404)
    versions = await prompt_repo.list_prompt_versions(prompt_id, access.project_id)
    return ApiResponse.success(data=versions)


@router.get("/{prompt_id}/versions/{version}", response_model=ApiResponse)
async def get_prompt_version(
    prompt_id: str,
    version: int,
    access: AccessContext = Depends(get_access_context),
):
    prompt_version = await prompt_repo.get_prompt_version(prompt_id, access.project_id, version)
    if prompt_version is None:
        return ApiResponse.error(message="Prompt version not found", code=404)
    return ApiResponse.success(data=prompt_version)


@router.post("/{prompt_id}/versions", response_model=ApiResponse)
async def create_prompt_version(
    prompt_id: str,
    body: PromptVersionCreate,
    access: AccessContext = Depends(require_roles(*WRITE_ROLES)),
):
    version = await prompt_repo.create_prompt_version(prompt_id, access.project_id, body, access.user_id)
    if version is None:
        return ApiResponse.error(message="Prompt not found", code=404)
    return ApiResponse.success(data=version)


@router.post("/{prompt_id}/render-preview", response_model=ApiResponse)
async def render_prompt_preview(
    prompt_id: str,
    body: PromptRenderPreviewRequest,
    access: AccessContext = Depends(get_access_context),
):
    snapshot = await prompt_repo.get_prompt_snapshot(prompt_id, access.project_id, body.version)
    if snapshot is None:
        return ApiResponse.error(message="Prompt version not found", code=404)
    preview = build_prompt_preview(snapshot.model_dump(mode="json"), body.sample.model_dump(mode="json"))
    return ApiResponse.success(data=PromptRenderPreview(**preview))


@router.post("/{prompt_id}/rollback", response_model=ApiResponse)
async def rollback_prompt(
    prompt_id: str,
    body: PromptRollbackRequest,
    access: AccessContext = Depends(require_roles(*WRITE_ROLES)),
):
    version = await prompt_repo.rollback_prompt(
        prompt_id,
        access.project_id,
        body.version,
        body.change_note,
        access.user_id,
    )
    if version is None:
        return ApiResponse.error(message="Prompt or version not found", code=404)
    return ApiResponse.success(data=version)


@router.post("/{prompt_id}/release", response_model=ApiResponse)
async def release_prompt(
    prompt_id: str,
    body: PromptReleaseRequest,
    access: AccessContext = Depends(require_roles(*WRITE_ROLES)),
):
    prompt = await prompt_repo.release_prompt(
        prompt_id,
        access.project_id,
        body.version,
        body.note,
        access.user_id,
    )
    if prompt is None:
        return ApiResponse.error(message="Prompt or version not found", code=404)
    return ApiResponse.success(data=prompt)
