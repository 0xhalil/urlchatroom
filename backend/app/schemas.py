from datetime import datetime

from pydantic import BaseModel, Field, field_validator


def _validate_email_like(value: str) -> str:
    normalized = value.strip().lower()
    if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@"):
        raise ValueError("invalid email")
    local, _, domain = normalized.partition("@")
    if not local or "." not in domain:
        raise ValueError("invalid email")
    return normalized


class MessageCreate(BaseModel):
    thread_key: str = Field(min_length=1, max_length=1200)
    client_id: str = Field(min_length=1, max_length=128)
    content: str = Field(min_length=1, max_length=1000)

    @field_validator("content")
    @classmethod
    def content_not_blank(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("content cannot be empty")
        return normalized


class MessageRead(BaseModel):
    id: int
    thread_key: str
    client_id: str
    content: str
    created_at: datetime


class ErrorResponse(BaseModel):
    detail: str


class UserRead(BaseModel):
    id: int
    email: str
    display_name: str
    created_at: datetime
    last_login_at: datetime | None


class SessionRead(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: UserRead


class MagicLinkRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    display_name: str | None = Field(default=None, min_length=2, max_length=64)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        return _validate_email_like(value)

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            return None
        return normalized


class MagicLinkRequestResponse(BaseModel):
    message: str


class MagicLinkVerifyRequest(BaseModel):
    token: str = Field(min_length=16, max_length=512)


class GoogleVerifyRequest(BaseModel):
    access_token: str = Field(min_length=20, max_length=4096)
    display_name: str | None = Field(default=None, min_length=2, max_length=64)


class UserUpdate(BaseModel):
    display_name: str = Field(min_length=2, max_length=64)

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str) -> str:
        normalized = value.strip()
        if len(normalized) < 2:
            raise ValueError("display_name must be at least 2 chars")
        return normalized
