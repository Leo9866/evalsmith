from __future__ import annotations

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "EvalSmith Monitor Service"
    debug: bool = False

    host: str = "0.0.0.0"
    port: int = 8006

    pg_host: str = "localhost"
    pg_port: int = 5432
    pg_user: str = "evalsmith"
    pg_password: str = "__REDACTED_SECRET__"
    pg_database: str = "evalsmith"
    pg_schema: str = "public"

    trace_service_url: str = "http://127.0.0.1:8001"
    eval_engine_url: str = "http://127.0.0.1:8002"
    auth_service_url: str = "http://127.0.0.1:8004"
    internal_service_token: str = Field(
        default="",
        validation_alias=AliasChoices(
            "INTERNAL_SERVICE_TOKEN",
            "EVALSMITH_INTERNAL_TOKEN",
            "EVALSMITH_INTERNAL_SERVICE_TOKEN",
        ),
    )

    worker_poll_interval_seconds: int = 60
    worker_trace_page_size: int = 25

    @property
    def pg_dsn(self) -> str:
        return (
            f"postgresql://{self.pg_user}:{self.pg_password}"
            f"@{self.pg_host}:{self.pg_port}/{self.pg_database}"
        )

    model_config = {"env_prefix": "", "env_file": ".env", "extra": "ignore"}


settings = Settings()
