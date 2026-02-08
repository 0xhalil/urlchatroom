from datetime import timedelta
from html import escape

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, WebSocket, WebSocketDisconnect, status
from fastapi.responses import HTMLResponse
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db
from app.models import MagicLinkToken, Message, Thread, User
from app.schemas import (
    GoogleVerifyRequest,
    MagicLinkRequest,
    MagicLinkRequestResponse,
    MagicLinkVerifyRequest,
    MessageCreate,
    MessageRead,
    SessionRead,
    UserUpdate,
    UserRead,
)
from app.services.auth import (
    build_magic_link,
    create_access_token,
    create_magic_token,
    decode_access_token,
    derive_display_name,
    normalize_email,
    now_utc,
    token_hash,
)
from app.services.google_auth import verify_google_access_token
from app.services.mailer import send_magic_link_email
from app.services.normalization import normalize_thread_key
from app.services.rate_limiter import InMemoryRateLimiter
from app.services.ws_hub import WebSocketHub

router = APIRouter(prefix="/api", tags=["chat"])
ws_router = APIRouter(tags=["ws"])
ws_hub = WebSocketHub()
post_limiter = InMemoryRateLimiter(max_events=15, window_seconds=60)


def _to_user_read(user: User) -> UserRead:
    return UserRead(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        created_at=user.created_at,
        last_login_at=user.last_login_at,
    )


def _parse_bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing authorization header")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid authorization header")
    return token


async def _get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def _get_current_user(authorization: str | None, db: AsyncSession) -> User:
    raw_token = _parse_bearer_token(authorization)
    payload = decode_access_token(raw_token)
    user_id = int(payload["sub"])
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="user not found")
    return user


async def get_or_create_thread(session: AsyncSession, thread_key: str) -> Thread:
    result = await session.execute(select(Thread).where(Thread.thread_key == thread_key))
    thread = result.scalar_one_or_none()
    if thread:
        return thread
    thread = Thread(thread_key=thread_key)
    session.add(thread)
    await session.flush()
    return thread


@router.get("/messages", response_model=list[MessageRead])
async def list_messages(
    thread_key: str = Query(min_length=1, max_length=1200),
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
) -> list[MessageRead]:
    try:
        thread_key = normalize_thread_key(thread_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    result = await db.execute(select(Thread).where(Thread.thread_key == thread_key))
    thread = result.scalar_one_or_none()
    if thread is None:
        return []

    messages_q = (
        select(Message)
        .where(Message.thread_id == thread.id)
        .order_by(Message.created_at.desc())
        .limit(limit)
    )
    messages_res = await db.execute(messages_q)
    rows = list(reversed(messages_res.scalars().all()))
    return [
        MessageRead(
            id=m.id,
            thread_key=thread_key,
            client_id=m.client_id,
            content=m.content,
            created_at=m.created_at,
        )
        for m in rows
    ]


@router.post("/messages", response_model=MessageRead)
async def create_message(
    payload: MessageCreate,
    request: Request,
    authorization: str | None = Header(default=None, alias="Authorization"),
    db: AsyncSession = Depends(get_db),
) -> MessageRead:
    auth_user = await _get_current_user(authorization, db)

    try:
        payload.thread_key = normalize_thread_key(payload.thread_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    client_ip = request.client.host if request.client else "unknown"
    payload.client_id = auth_user.display_name
    rate_key = f"{auth_user.id}:{client_ip}"
    if not post_limiter.allow(rate_key):
        raise HTTPException(status_code=429, detail="rate limit exceeded")

    thread = await get_or_create_thread(db, payload.thread_key)

    message = Message(thread_id=thread.id, client_id=payload.client_id, content=payload.content)
    db.add(message)
    await db.commit()
    await db.refresh(message)

    response = MessageRead(
        id=message.id,
        thread_key=thread.thread_key,
        client_id=message.client_id,
        content=message.content,
        created_at=message.created_at,
    )

    await ws_hub.broadcast(
        thread.thread_key,
        {
            "type": "message",
            "data": response.model_dump(mode="json"),
        },
    )
    return response


@router.post("/auth/magic/request", response_model=MagicLinkRequestResponse)
async def request_magic_link(payload: MagicLinkRequest, db: AsyncSession = Depends(get_db)) -> MagicLinkRequestResponse:
    email = normalize_email(payload.email)
    user = await _get_user_by_email(db, email)
    if user is None:
        display_name = payload.display_name or derive_display_name(email)
        user = User(email=email, display_name=display_name[:64])
        db.add(user)
        await db.flush()

    raw_token = create_magic_token()
    expires_at = now_utc() + timedelta(minutes=settings.magic_link_ttl_minutes)
    db.add(MagicLinkToken(user_id=user.id, token_hash=token_hash(raw_token), expires_at=expires_at, used=False))
    await db.commit()
    send_magic_link_email(
        to_email=user.email,
        magic_link_url=build_magic_link(raw_token),
        expires_minutes=settings.magic_link_ttl_minutes,
    )

    return MagicLinkRequestResponse(
        message="If the email is valid, a sign-in link has been sent.",
    )


@router.post("/auth/magic/verify", response_model=SessionRead)
async def verify_magic_link(payload: MagicLinkVerifyRequest, db: AsyncSession = Depends(get_db)) -> SessionRead:
    token_digest = token_hash(payload.token)
    result = await db.execute(
        select(MagicLinkToken, User)
        .join(User, User.id == MagicLinkToken.user_id)
        .where(
            and_(
                MagicLinkToken.token_hash == token_digest,
                MagicLinkToken.used.is_(False),
                MagicLinkToken.expires_at >= now_utc(),
            )
        )
    )
    row = result.first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="magic token is invalid or expired")

    magic_token, user = row
    magic_token.used = True
    user.last_login_at = now_utc()
    access_token, expires_at = create_access_token(user_id=user.id, email=user.email, display_name=user.display_name)
    await db.commit()
    return SessionRead(access_token=access_token, expires_at=expires_at, user=_to_user_read(user))


@router.post("/auth/google/verify", response_model=SessionRead)
async def verify_google(payload: GoogleVerifyRequest, db: AsyncSession = Depends(get_db)) -> SessionRead:
    info = verify_google_access_token(payload.access_token)
    email = normalize_email(info["email"])
    google_sub = str(info["sub"])
    requested_display_name = (payload.display_name or "").strip()
    google_display_name = str(info.get("name") or "").strip()
    fallback_display_name = (google_display_name or derive_display_name(email))[:64]

    result = await db.execute(select(User).where(User.google_sub == google_sub))
    user = result.scalar_one_or_none()
    if user is None:
        user = await _get_user_by_email(db, email)
        if user is None:
            selected_name = (requested_display_name or fallback_display_name)[:64]
            user = User(email=email, display_name=selected_name, google_sub=google_sub)
            db.add(user)
            await db.flush()
        else:
            user.google_sub = google_sub
            if not user.display_name:
                user.display_name = requested_display_name[:64] if requested_display_name else fallback_display_name

    user.last_login_at = now_utc()
    access_token, expires_at = create_access_token(user_id=user.id, email=user.email, display_name=user.display_name)
    await db.commit()
    return SessionRead(access_token=access_token, expires_at=expires_at, user=_to_user_read(user))


@router.get("/auth/me", response_model=UserRead)
async def auth_me(
    authorization: str | None = Header(default=None, alias="Authorization"),
    db: AsyncSession = Depends(get_db),
) -> UserRead:
    user = await _get_current_user(authorization, db)
    return _to_user_read(user)


@router.patch("/auth/me", response_model=UserRead)
async def update_me(
    payload: UserUpdate,
    authorization: str | None = Header(default=None, alias="Authorization"),
    db: AsyncSession = Depends(get_db),
) -> UserRead:
    user = await _get_current_user(authorization, db)
    user.display_name = payload.display_name[:64]
    await db.commit()
    await db.refresh(user)
    return _to_user_read(user)


@ws_router.get("/auth/magic", response_class=HTMLResponse)
async def magic_link_page(token: str = Query(default="")) -> HTMLResponse:
    safe_token = escape(token)
    body = f"""<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>URLChatroom Magic Link</title></head>
  <body style="font-family: sans-serif; margin: 24px;">
    <h1>Magic Link</h1>
    <p>Copy this token into the extension popup to complete sign-in:</p>
    <pre style="background:#f4f4f4; padding:12px; border-radius:8px;">{safe_token}</pre>
    <p>You can close this tab after copying the token.</p>
  </body>
</html>"""
    return HTMLResponse(content=body)


@ws_router.websocket("/ws/{thread_key:path}")
async def websocket_endpoint(websocket: WebSocket, thread_key: str) -> None:
    client_id = websocket.query_params.get("client_id", "anonymous")
    try:
        thread_key = normalize_thread_key(thread_key)
    except ValueError as exc:
        await websocket.accept()
        await websocket.send_json({"type": "error", "data": {"detail": str(exc)}})
        await websocket.close(code=1008)
        return
    await ws_hub.connect(thread_key, websocket)
    await websocket.send_json({"type": "system", "data": {"client_id": client_id, "status": "connected"}})

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_hub.disconnect(thread_key, websocket)
