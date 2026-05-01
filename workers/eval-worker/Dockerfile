ARG PYTHON_BASE_IMAGE=python:3.12-slim

FROM ${PYTHON_BASE_IMAGE}

ARG PIP_INDEX_URL=https://pypi.org/simple

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_INDEX_URL=${PIP_INDEX_URL} \
    PYTHONPATH=/app/services/eval-engine

WORKDIR /app/services/eval-engine

COPY services/eval-engine /app/services/eval-engine
COPY workers/eval-worker /app/workers/eval-worker

RUN pip install --no-cache-dir \
    fastapi \
    "uvicorn[standard]" \
    pydantic \
    pydantic-settings \
    asyncpg \
    httpx \
    jsonschema

CMD ["python", "/app/workers/eval-worker/main.py"]
