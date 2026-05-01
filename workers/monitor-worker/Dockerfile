ARG PYTHON_BASE_IMAGE=python:3.12-slim

FROM ${PYTHON_BASE_IMAGE}

ARG PIP_INDEX_URL=https://pypi.org/simple

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_INDEX_URL=${PIP_INDEX_URL} \
    PYTHONPATH=/app/services/monitor-service

WORKDIR /app/services/monitor-service

COPY services/monitor-service /app/services/monitor-service
COPY workers/monitor-worker /app/workers/monitor-worker

RUN pip install --no-cache-dir \
    fastapi \
    "uvicorn[standard]" \
    pydantic \
    pydantic-settings \
    asyncpg \
    httpx

CMD ["python", "/app/workers/monitor-worker/main.py"]
