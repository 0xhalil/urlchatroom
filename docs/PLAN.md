# URLChatroom Detailed Plan

## 1) Product Scope (MVP)
- Chrome extension only.
- No DOM injection into visited websites.
- Chat opens from extension popup only.
- Generic URL normalization for all websites.
- Google sign-in for identity.
- Editable nickname via settings drawer.
- Real-time messaging via WebSocket.
- Message persistence in PostgreSQL.

## 2) URL Normalization Spec
- Force scheme to `https`.
- Remove `www.` prefix from hostname.
- Remove URL fragment (`#...`).
- Remove tracking params: `utm_*`, `ref`, `fbclid`, `gclid`, `yclid`, `mc_cid`, `mc_eid`.
- Sort remaining query params by key and value.
- Remove trailing slash from path except root `/`.
- Output format: `https://host/path?sorted=params`.
- Thread key format: `url:<normalized_url>`.
- Backend also normalizes any incoming `thread_key` to enforce canonical storage.

## 3) Backend Contract
- `GET /health`
- `GET /api/messages?thread_key=<key>&limit=50`
- `POST /api/messages`
  - body: `{ "thread_key": "...", "client_id": "...", "content": "..." }`
- `WS /ws/{thread_key}?client_id=<id>`
  - Pushes new messages to active subscribers for that thread.

## 4) Data Model
- `threads`
  - `id` (PK)
  - `thread_key` (unique, indexed)
  - `created_at`
- `messages`
  - `id` (PK)
  - `thread_id` (FK -> threads.id, indexed)
  - `client_id` (indexed)
  - `content`
  - `created_at` (indexed)

## 5) Security and Abuse MVP
- Basic in-memory rate limit for posting (per IP + client_id).
- Message max length 1000 chars.
- Empty/whitespace-only content rejected.
- CORS currently permissive for local development.
- No site scraping and no page DOM interference.

## 6) Delivery Steps
1. Scaffold repository structure.
2. Implement backend database and APIs.
3. Implement WebSocket hub.
4. Implement extension popup UI and API integration.
5. Run local smoke tests and document run instructions.
6. Add next-step items (auth, moderation panel, deployment hardening).

## 7) Non-Goals (MVP)
- No domain-specific URL rules.
- No admin dashboard.
- No advanced moderation workflow.
