# Smoke Test Guide

This guide verifies URLChatroom end-to-end in local development.

## Prerequisites
- PostgreSQL is running and database `urlchatroom` exists.
- Backend dependencies installed from `backend/requirements.txt`.
- For Google sign-in, set a valid OAuth client id:
  - `backend/.env` -> `GOOGLE_CLIENT_ID`
  - `extension/manifest.json` -> `oauth2.client_id`
- Backend started:
  - `cd backend`
  - `uvicorn app.main:app --port 8000`

## A) REST Smoke Test (Automated)
Run:
- `cd /Users/halil/aideveloper/urlchatroom`
- `backend/scripts/smoke_test_rest.sh`

Expected:
- Health check `OK`
- Message created with `stored_thread_key`
- Message list contains at least 1 message
- `canonical_thread_key` shows normalized URL key

Failure hints:
- `Connection refused`: backend is not running.
- `500` from API: check DB connection and that DB exists.
- `500 smtp is not configured`: set SMTP env vars.
- `429`: rate limiter triggered; wait one minute.

## B) WebSocket + Extension Smoke Test (Manual)
1. Load extension from `extension/` in `chrome://extensions`.
2. Open any URL in a tab.
3. Click extension icon to open popup.
4. Sign in with Google (`Sign in with Google`).
5. Send a message.
6. Open settings drawer and update nickname.
7. Send another message and verify nickname changed.
8. Open same URL in another Chrome profile/window with extension loaded.
9. Open popup there and verify real-time message appears.

Expected:
- Both popups display same thread messages.
- New message appears instantly (WebSocket push), not only after refresh.

## C) Normalization Check
Test with two URL variants for same page, for example:
- `https://www.example.com/item/42?utm_source=x&ref=abc`
- `http://example.com/item/42`

Expected:
- Both variants map to the same canonical `thread_key` in API responses.

## D) Exit Criteria for Step 1
- REST smoke test passes.
- WebSocket real-time update verified on two active clients.
- URL canonicalization confirmed with at least one variant pair.
