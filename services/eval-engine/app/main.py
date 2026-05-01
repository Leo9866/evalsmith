from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.evaluators import router as evaluators_router
from app.api.experiments import router as experiments_router
from app.api.prompts import router as prompts_router
from app.core.registry import init_registry
from app.db.connection import close_db, init_db
from app.settings import settings

logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s - %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting %s", settings.app_name)
    init_registry()
    await init_db()
    yield
    # Shutdown
    await close_db()
    logger.info("Shutdown complete.")


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(evaluators_router)
app.include_router(experiments_router)
app.include_router(prompts_router)


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


@app.get("/health")
async def health():
    return {"status": "ok", "service": "eval-engine"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=settings.debug)
