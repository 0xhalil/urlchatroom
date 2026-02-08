#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:8000}"
RAW_URL="${RAW_URL:-https://www.example.com/listing/123?utm_source=ad&ref=campaign#section}"
CLIENT_ID="${CLIENT_ID:-smoke-client}"
CONTENT="${CONTENT:-smoke message $(date +%s)}"
AUTH_TOKEN="${AUTH_TOKEN:-}"

THREAD_KEY="url:${RAW_URL}"
ENCODED_THREAD_KEY=$(python3 - << 'PY' "$THREAD_KEY"
import sys
from urllib.parse import quote
print(quote(sys.argv[1], safe=""))
PY
)

echo "== URLChatroom REST Smoke Test =="
echo "API_BASE: $API_BASE"
echo "THREAD_KEY(raw): $THREAD_KEY"
echo

if [ -z "$AUTH_TOKEN" ]; then
  echo "AUTH_TOKEN is required."
  echo "Get it by signing in via extension, then run:"
  echo 'AUTH_TOKEN="<bearer_token>" backend/scripts/smoke_test_rest.sh'
  exit 1
fi

echo "1) Health check"
curl -fsS "$API_BASE/health" >/dev/null
echo "OK"
echo

echo "2) Create message"
CREATE_RESPONSE=$(curl -fsS -X POST "$API_BASE/api/messages" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{\"thread_key\":\"$THREAD_KEY\",\"client_id\":\"$CLIENT_ID\",\"content\":\"$CONTENT\"}")

echo "$CREATE_RESPONSE" | python3 -c 'import json,sys
obj=json.loads(sys.stdin.read())
print("created_id:",obj["id"])
print("stored_thread_key:",obj["thread_key"])
print("content:",obj["content"])'

echo

echo "3) Read messages"
LIST_RESPONSE=$(curl -fsS "$API_BASE/api/messages?thread_key=$ENCODED_THREAD_KEY&limit=10")
echo "$LIST_RESPONSE" | python3 -c 'import json,sys
arr=json.loads(sys.stdin.read())
print("message_count:",len(arr))
if not arr:
    raise SystemExit("No messages returned")
print("last_message:",arr[-1]["content"])
print("canonical_thread_key:",arr[-1]["thread_key"])'

echo
echo "Smoke test passed."
