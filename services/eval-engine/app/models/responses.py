from __future__ import annotations

from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    """Standard API response wrapper."""

    code: int = Field(default=0, description="0 means success, non-zero means error")
    message: str = Field(default="success")
    data: T | None = None

    @classmethod
    def success(cls, data: Any = None, message: str = "success") -> ApiResponse:
        return cls(code=0, message=message, data=data)

    @classmethod
    def error(cls, message: str, code: int = -1, data: Any = None) -> ApiResponse:
        return cls(code=code, message=message, data=data)


class PaginatedData(BaseModel, Generic[T]):
    """Paginated list wrapper."""

    items: list[T]
    total: int
    page: int
    page_size: int
    total_pages: int
