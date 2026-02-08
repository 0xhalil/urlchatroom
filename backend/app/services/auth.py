from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import HTTPException, status

from app.config import settings


def now_utc() -> datetime:
    return datetime.now(UTC)


def token_hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def create_magic_token() -> str:
    return secrets.token_urlsafe(32)


def normalize_email(email: str) -> str:
    return email.strip().lower()


def derive_display_name(email: str) -> str:
    local = email.split("@", 1)[0].strip()
    if not local:
        return "user"
    return local[:64]


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def _unb64url(data: str) -> bytes:
    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode((data + pad).encode("utf-8"))


def create_access_token(*, user_id: int, email: str, display_name: str) -> tuple[str, datetime]:
    expires_at = now_utc() + timedelta(seconds=settings.access_token_ttl_seconds)
    payload = {
        "sub": str(user_id),
        "email": email,
        "display_name": display_name,
        "exp": int(expires_at.timestamp()),
        "iat": int(now_utc().timestamp()),
    }
    payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    encoded = _b64url(payload_bytes)
    signature = hmac.new(
        settings.auth_secret.encode("utf-8"),
        encoded.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{encoded}.{signature}", expires_at


def decode_access_token(raw_token: str) -> dict[str, Any]:
    try:
        encoded, signature = raw_token.split(".", 1)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token format") from exc

    expected_sig = hmac.new(
        settings.auth_secret.encode("utf-8"),
        encoded.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(signature, expected_sig):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token signature")

    try:
        payload = json.loads(_unb64url(encoded).decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token payload") from exc

    exp = payload.get("exp")
    if not isinstance(exp, int) or exp < int(now_utc().timestamp()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="token expired")
    return payload


def build_magic_link(raw_token: str) -> str:
    return f"{settings.magic_link_base_url}?token={raw_token}"
