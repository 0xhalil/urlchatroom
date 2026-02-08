# URLChatroom

URLChatroom is a Chrome extension + FastAPI backend that lets users chat on the same normalized URL without modifying page DOM.

## Project Structure
- `docs/PLAN.md`: Detailed implementation plan.
- `docs/SMOKE_TEST.md`: Local smoke test checklist.
- `backend/`: FastAPI + PostgreSQL API.
- `extension/`: Chrome MV3 popup extension.

## Backend Run
1. Create and activate a virtual environment.
2. Install deps:
   - `pip install -r backend/requirements.txt`
3. Copy env file:
   - `cp backend/.env.example backend/.env`
4. Start API from `backend/`:
   - `uvicorn app.main:app --port 8000`

## PostgreSQL
- Expected default URL:
  - `postgresql+asyncpg://postgres:postgres@localhost:5432/urlchatroom`
- Create DB manually before starting API.

## Extension Load
1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Click `Load unpacked`.
4. Select `urlchatroom/extension`.

## Current MVP Capabilities
- Generic URL normalization.
- Thread key by normalized URL.
- Message persistence in PostgreSQL.
- Real-time updates with WebSocket.
- Basic in-memory rate limiting.
- Popup-only UX (no page DOM injection).
- Backend canonicalizes `thread_key` on every request.
- Google sign-in using extension OAuth token.
- Bearer token required for posting messages.
- Nickname edit endpoint for signed-in users.
- Popup settings view (nickname + logout).
- WebSocket reconnect and improved UI state handling.

## Auth Environment Variables
- `AUTH_SECRET`: HMAC secret for access tokens.
- `ACCESS_TOKEN_TTL_SECONDS`: access token lifetime.
- `MAGIC_LINK_TTL_MINUTES`: magic link token lifetime.
- `MAGIC_LINK_BASE_URL`: base URL used in generated magic links.
- `GOOGLE_CLIENT_ID`: Google OAuth client id; used to validate Google token audience.
- `SMTP_HOST`: SMTP server host.
- `SMTP_PORT`: SMTP server port.
- `SMTP_USERNAME`: SMTP username.
- `SMTP_PASSWORD`: SMTP password.
- `SMTP_FROM_EMAIL`: sender email address.
- `SMTP_USE_TLS`: use STARTTLS for SMTP.
- `SMTP_USE_SSL`: use SMTP SSL (465 style).

Note:
- Extension UX is currently Google-only.
- Magic link backend endpoints remain available for compatibility but are not shown in the popup.

## Next Steps
- Add DB migrations (Alembic) to evolve schema safely.
- Harden CORS and origin checks for production.

## Smoke Test
- Run automated REST smoke test:
  - `backend/scripts/smoke_test_rest.sh`
- Run full checklist:
  - `docs/SMOKE_TEST.md`
