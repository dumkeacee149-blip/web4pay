#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
API_KEY="${API_KEY:-dev-token-1}"

AUTH_HEADER=( -H "Authorization: Bearer ${API_KEY}" )
JSON_HEADER=( -H "Content-Type: application/json" )

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

need curl
need uuidgen
need sed
need grep

idempotency() {
  uuidgen | tr '[:upper:]' '[:lower:]'
}

post() {
  local path="$1"; shift
  local body="$1"; shift
  curl -sS "${BASE_URL}${path}" \
    "${AUTH_HEADER[@]}" \
    "${JSON_HEADER[@]}" \
    -H "Idempotency-Key: $(idempotency)" \
    -d "$body"
}

get() {
  local path="$1"; shift
  curl -sS "${BASE_URL}${path}" \
    "${AUTH_HEADER[@]}"
}

extract_json_field() {
  # naive JSON field extractor; fine for our small smoke responses
  local field="$1"
  sed -nE "s/.*\"${field}\"\s*:\s*\"([^\"]+)\".*/\1/p" | head -n1
}

echo "[1/6] /v1/chain"
get "/v1/chain" | tee /dev/stderr >/tmp/web4pay_chain.json

if ! grep -q '"chainId"' /tmp/web4pay_chain.json; then
  echo "Failed: /v1/chain did not return expected payload" >&2
  exit 1
fi

echo "[2/6] Create agent"
AGENT_RES=$(post "/v1/agents" '{"name":"payer-agent"}')
AGENT_ID=$(echo "$AGENT_RES" | extract_json_field agentId)

if [[ -z "$AGENT_ID" ]]; then
  echo "Failed: could not extract agentId" >&2
  echo "$AGENT_RES" >&2
  exit 1
fi

echo "agentId=$AGENT_ID"

echo "[3/6] Create quote"
QUOTE_RES=$(post "/v1/quotes" "{\"payerAgentId\":\"${AGENT_ID}\",\"payeeAddress\":\"0x1111111111111111111111111111111111111111\",\"amount\":\"1.23\",\"currency\":\"USDC\",\"expiresInSec\":600,\"deadlineInSec\":3600,\"orderId\":\"ord_demo_1\",\"metadata\":{\"purpose\":\"demo\"}}")
QUOTE_ID=$(echo "$QUOTE_RES" | extract_json_field quoteId)

if [[ -z "$QUOTE_ID" ]]; then
  echo "Failed: could not extract quoteId" >&2
  echo "$QUOTE_RES" >&2
  exit 1
fi

echo "quoteId=$QUOTE_ID"

echo "[4/6] Create escrow (mock deposit)"
ESCROW_RES=$(post "/v1/escrows" "{\"quoteId\":\"${QUOTE_ID}\"}")
ESCROW_ID=$(echo "$ESCROW_RES" | extract_json_field escrowId)

if [[ -z "$ESCROW_ID" ]]; then
  echo "Failed: could not extract escrowId" >&2
  echo "$ESCROW_RES" >&2
  exit 1
fi

echo "escrowId=$ESCROW_ID"

echo "[5/6] Mark deposited (dev helper)"
post "/internal/dev/escrows/${ESCROW_ID}/markDeposited" '{"ok":true}' >/dev/null || true

sleep 0.2

echo "[6/6] Release escrow (mock)"
RELEASE_RES=$(post "/v1/escrows/${ESCROW_ID}/release" '{"deliverableHash":"0xabc"}')
echo "$RELEASE_RES"

echo "Done."
