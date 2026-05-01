from __future__ import annotations

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Application
    app_name: str = "EvalSmith Eval Engine"
    debug: bool = False

    # Server
    host: str = "0.0.0.0"
    port: int = 8002

    # PostgreSQL
    pg_host: str = "localhost"
    pg_port: int = 5432
    pg_user: str = "evalsmith"
    pg_password: str = "__REDACTED_SECRET__"
    pg_database: str = "evalsmith"
    pg_schema: str = "public"

    # LLM API
    llm_api_base_url: str = "https://api.openai.com/v1"
    llm_api_key: str = ""
    llm_default_model: str = "gpt-4o"

    # Dataset service
    dataset_service_url: str = "http://localhost:8003"
    auth_service_url: str = "http://localhost:8004"
    internal_service_token: str = Field(
        default="",
        validation_alias=AliasChoices(
            "INTERNAL_SERVICE_TOKEN",
            "EVALSMITH_INTERNAL_TOKEN",
            "EVALSMITH_INTERNAL_SERVICE_TOKEN",
        ),
    )

    # CORS
    cors_origins: list[str] = ["*"]

    @property
    def pg_dsn(self) -> str:
        return (
            f"postgresql://{self.pg_user}:{self.pg_password}"
            f"@{self.pg_host}:{self.pg_port}/{self.pg_database}"
        )

    def resolve_llm_api_base_url(self, base_url: str | None = None) -> str:
        return (base_url or self.llm_api_base_url).rstrip("/")

    @property
    def resolved_llm_api_base_url(self) -> str:
        return self.resolve_llm_api_base_url()

    model_config = {"env_prefix": "", "env_file": ".env", "extra": "ignore"}


settings = Settings()
