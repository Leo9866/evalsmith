from __future__ import annotations

import asyncio
import os
import time
from pathlib import Path

import asyncpg
import httpx


ROOT = Path(__file__).resolve().parents[1]
POSTGRES_SQL = ROOT / "migrations" / "postgresql" / "001_init.sql"
CLICKHOUSE_SQL = ROOT / "migrations" / "clickhouse" / "001_init.sql"


def split_sql_statements(raw_sql: str) -> list[str]:
    statements: list[str] = []
    buffer: list[str] = []
    in_single = False
    in_double = False
    in_line_comment = False
    previous = ""
    i = 0

    while i < len(raw_sql):
        char = raw_sql[i]
        nxt = raw_sql[i + 1] if i + 1 < len(raw_sql) else ""

        if in_line_comment:
            if char == "\n":
                in_line_comment = False
            i += 1
            continue

        if not in_single and not in_double and char == "-" and nxt == "-":
            in_line_comment = True
            i += 2
            continue

        if char == "'" and not in_double and previous != "\\":
            in_single = not in_single
        elif char == '"' and not in_single and previous != "\\":
            in_double = not in_double

        if char == ";" and not in_single and not in_double:
            statement = "".join(buffer).strip()
            if statement:
                statements.append(statement)
            buffer = []
            previous = ""
            i += 1
            continue

        buffer.append(char)
        previous = char
        i += 1

    trailing = "".join(buffer).strip()
    if trailing:
        statements.append(trailing)

    return statements


def quote_identifier(identifier: str) -> str:
    escaped = identifier.replace('"', '""')
    return f'"{escaped}"'


async def wait_for_postgres(dsn: str, retries: int = 60, delay_seconds: float = 2.0) -> None:
    last_error: Exception | None = None
    for _ in range(retries):
        try:
            conn = await asyncpg.connect(dsn, ssl=False)
            await conn.close()
            return
        except Exception as exc:  # pragma: no cover - bootstrapping path
            last_error = exc
            await asyncio.sleep(delay_seconds)
    raise RuntimeError(f"PostgreSQL did not become ready: {last_error}")


async def migrate_postgres(dsn: str, schema: str) -> None:
    sql = POSTGRES_SQL.read_text(encoding="utf-8")
    statements = split_sql_statements(sql)
    conn = await asyncpg.connect(dsn, ssl=False)
    try:
        if schema and schema != "public":
            quoted_schema = quote_identifier(schema)
            await conn.execute(f"CREATE SCHEMA IF NOT EXISTS {quoted_schema}")
            await conn.execute(f"SET search_path TO {quoted_schema}, public")
        for statement in statements:
            await conn.execute(statement)
    finally:
        await conn.close()


def build_clickhouse_auth(user: str, password: str) -> httpx.BasicAuth | None:
    if not user:
        return None
    return httpx.BasicAuth(user, password)


def wait_for_clickhouse(
    url: str,
    user: str,
    password: str,
    retries: int = 60,
    delay_seconds: float = 2.0,
) -> None:
    last_error: Exception | None = None
    auth = build_clickhouse_auth(user, password)
    for _ in range(retries):
        try:
            response = httpx.post(url, content="SELECT 1", timeout=5.0, auth=auth)
            response.raise_for_status()
            return
        except Exception as exc:  # pragma: no cover - bootstrapping path
            last_error = exc
            time.sleep(delay_seconds)
    raise RuntimeError(f"ClickHouse did not become ready: {last_error}")


def migrate_clickhouse(url: str, user: str, password: str) -> None:
    sql = CLICKHOUSE_SQL.read_text(encoding="utf-8")
    statements = split_sql_statements(sql)
    auth = build_clickhouse_auth(user, password)
    with httpx.Client(timeout=30.0, auth=auth) as client:
        for statement in statements:
            response = client.post(url, content=statement)
            response.raise_for_status()


async def main() -> None:
    pg_host = os.environ.get("EVALSMITH_PG_HOST", "127.0.0.1")
    pg_port = int(os.environ.get("EVALSMITH_PG_PORT", "15432"))
    pg_user = os.environ.get("EVALSMITH_PG_USER", "evalsmith")
    pg_password = os.environ.get("EVALSMITH_PG_PASSWORD", "__REDACTED_SECRET__")
    pg_database = os.environ.get("EVALSMITH_PG_DATABASE", "evalsmith")
    pg_schema = os.environ.get("EVALSMITH_PG_SCHEMA", "public")
    ch_host = os.environ.get("EVALSMITH_CH_HOST", "127.0.0.1")
    ch_http_port = int(os.environ.get("EVALSMITH_CH_HTTP_PORT", "18123"))
    ch_user = os.environ.get("CLICKHOUSE_USER", "")
    ch_password = os.environ.get("CLICKHOUSE_PASSWORD", "")
    skip_clickhouse = os.environ.get("EVALSMITH_SKIP_CLICKHOUSE", "false").lower() == "true"

    pg_dsn = f"postgresql://{pg_user}:{pg_password}@{pg_host}:{pg_port}/{pg_database}"
    ch_url = f"http://{ch_host}:{ch_http_port}/"

    print("Waiting for PostgreSQL...")
    await wait_for_postgres(pg_dsn)
    print("Migrating PostgreSQL...")
    await migrate_postgres(pg_dsn, pg_schema)

    if not skip_clickhouse:
        print("Waiting for ClickHouse...")
        wait_for_clickhouse(ch_url, ch_user, ch_password)
        print("Migrating ClickHouse...")
        migrate_clickhouse(ch_url, ch_user, ch_password)

    print("Development stack migrations complete.")


if __name__ == "__main__":
    asyncio.run(main())
