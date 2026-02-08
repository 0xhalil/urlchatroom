from __future__ import annotations

import json
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import HTTPException, status

from app.config import settings


def _http_get_json(url: str, headers: dict[str, str] | None = None) -> dict:
    req = Request(url=url, headers=headers or {}, method="GET")
    try:
        with urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="google token is invalid") from exc


def verify_google_access_token(access_token: str) -> dict:
    if not access_token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="missing google access token")

    userinfo = _http_get_json(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        headers={"Authorization": f"Bearer {access_token}"},
    )

    if not userinfo.get("email_verified"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="google email is not verified")
    if not userinfo.get("email"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="google account has no email")
    if not userinfo.get("sub"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="google account has no subject id")

    if settings.google_client_id:
        tokeninfo_url = "https://www.googleapis.com/oauth2/v3/tokeninfo?" + urlencode({"access_token": access_token})
        tokeninfo = _http_get_json(tokeninfo_url)
        aud = tokeninfo.get("aud")
        if aud and aud != settings.google_client_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="google token audience mismatch")

    return userinfo
