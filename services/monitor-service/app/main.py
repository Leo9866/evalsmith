from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.auth import AccessContext, WRITE_ROLES, get_access_context, require_roles
from app.db import close_db, init_db
from app.responses import ApiResponse, PaginatedData
from app.schemas import MonitorRuleCreate, MonitorRuleUpdate
from app.service import MonitorService
from app.settings import settings

service = MonitorService()


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_db()
    yield
    await service.close()
    await close_db()


app = FastAPI(title=settings.app_name, debug=settings.debug, lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/api/v1/monitoring/overview", response_model=ApiResponse)
async def get_overview(access: AccessContext = Depends(get_access_context)):
    return ApiResponse.success(data=await service.get_overview(access.project_id))


@app.get("/api/v1/monitoring/rules", response_model=ApiResponse)
async def list_rules(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    query: str | None = Query(default=None),
    status: str | None = Query(default=None),
    access: AccessContext = Depends(get_access_context),
):
    items, total = await service.list_rules(
        access.project_id,
        page=page,
        page_size=page_size,
        query=query.strip() if query and query.strip() else None,
        status=status,
    )
    return ApiResponse.success(
        data=PaginatedData(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=(total + page_size - 1) // page_size if total > 0 else 0,
        )
    )


@app.post("/api/v1/monitoring/rules", response_model=ApiResponse)
async def create_rule(
    body: MonitorRuleCreate,
    access: AccessContext = Depends(require_roles(*WRITE_ROLES)),
):
    return ApiResponse.success(data=await service.create_rule(access.project_id, body))


@app.get("/api/v1/monitoring/rules/{rule_id}", response_model=ApiResponse)
async def get_rule(
    rule_id: str,
    access: AccessContext = Depends(get_access_context),
):
    rule = await service.get_rule(access.project_id, rule_id)
    if rule is None:
        return ApiResponse.error(message="Rule not found", code=404)
    return ApiResponse.success(data=rule)


@app.put("/api/v1/monitoring/rules/{rule_id}", response_model=ApiResponse)
async def update_rule(
    rule_id: str,
    body: MonitorRuleUpdate,
    access: AccessContext = Depends(require_roles(*WRITE_ROLES)),
):
    rule = await service.update_rule(access.project_id, rule_id, body)
    if rule is None:
        return ApiResponse.error(message="Rule not found", code=404)
    return ApiResponse.success(data=rule)


@app.post("/api/v1/monitoring/rules/{rule_id}/run", response_model=ApiResponse)
async def run_rule(
    rule_id: str,
    access: AccessContext = Depends(require_roles(*WRITE_ROLES)),
):
    try:
        result = await service.process_rule_by_id(access.project_id, rule_id)
    except ValueError:
        return ApiResponse.error(message="Rule not found", code=404)
    return ApiResponse.success(data=result)


@app.get("/api/v1/monitoring/runs", response_model=ApiResponse)
async def list_runs(
    rule_id: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    query: str | None = Query(default=None),
    access: AccessContext = Depends(get_access_context),
):
    items, total = await service.list_runs(
        access.project_id,
        rule_id=rule_id,
        page=page,
        page_size=page_size,
        query=query.strip() if query and query.strip() else None,
    )
    return ApiResponse.success(
        data=PaginatedData(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=(total + page_size - 1) // page_size if total > 0 else 0,
        )
    )


@app.get("/api/v1/monitoring/alerts", response_model=ApiResponse)
async def list_alerts(
    status: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    query: str | None = Query(default=None),
    access: AccessContext = Depends(get_access_context),
):
    items, total = await service.list_alerts(
        access.project_id,
        status=status,
        page=page,
        page_size=page_size,
        query=query.strip() if query and query.strip() else None,
    )
    return ApiResponse.success(
        data=PaginatedData(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=(total + page_size - 1) // page_size if total > 0 else 0,
        )
    )


@app.post("/api/v1/monitoring/alerts/{alert_id}/resolve", response_model=ApiResponse)
async def resolve_alert(
    alert_id: str,
    access: AccessContext = Depends(require_roles(*WRITE_ROLES)),
):
    alert = await service.resolve_alert(access.project_id, alert_id)
    if alert is None:
        return ApiResponse.error(message="Alert not found", code=404)
    return ApiResponse.success(data=alert)


@app.exception_handler(HTTPException)
async def http_exception_handler(_: Request, exc: HTTPException):
    detail = exc.detail
    message = "request failed"
    details = None
    code = -1

    if isinstance(detail, dict):
        message = str(detail.get("message") or message)
        details = detail.get("details")
        raw_code = detail.get("code")
        if isinstance(raw_code, int):
            code = raw_code
    elif isinstance(detail, str) and detail.strip():
        message = detail

    return JSONResponse(
        status_code=exc.status_code,
        content={
            "code": code,
            "message": message,
            "details": details,
        },
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={
            "code": -1,
            "message": "invalid request",
            "details": exc.errors(),
        },
    )
