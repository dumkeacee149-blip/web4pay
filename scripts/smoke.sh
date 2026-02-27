#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
API_KEY="${API_KEY:-dev-token-1}"
RETRIES="${RETRIES:-3}"
RETRY_DELAY_MS="${RETRY_DELAY_MS:-400}"

AUTH_HEADER=( -H "Authorization: Bearer ${API_KEY}" )
AGENT_HEADER=( -H "X-Actor: agent" )
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

safe_request() {
  local method="$1"
  local path="$2"
  local body="${3-}"
  local retries="${4-1}"
  local idem_key="${5-$(idempotency)}"

  local tmp_body
  tmp_body="/tmp/web4pay_request_$$.json"

  local attempt=1
  while true; do
    local http_code
    if [[ "$method" == "GET" ]]; then
      http_code=$(curl -sS -o "$tmp_body" -w '%{http_code}' "${BASE_URL}${path}" "${AUTH_HEADER[@]}")
    else
      http_code=$(curl -sS -o "$tmp_body" -w '%{http_code}' -X "$method" "${BASE_URL}${path}" \
        "${AUTH_HEADER[@]}" \
        "${AGENT_HEADER[@]}" \
        "${JSON_HEADER[@]}" \
        -H "Idempotency-Key: ${idem_key}" \
        -d "$body")
    fi

    local resp
    resp=$(cat "$tmp_body")

    if [[ "$http_code" =~ ^2[0-9]{2}$ ]]; then
      cat "$tmp_body"
      rm -f "$tmp_body"
      return 0
    fi

    if (( attempt >= retries )) || [[ ! "$http_code" =~ ^5[0-9]{2}$ ]]; then
      echo "[HTTP $http_code] ${path}" >&2
      echo "$resp" >&2
      rm -f "$tmp_body"
      return 1
    fi

    echo "Retry ${attempt}/${retries} for ${path} after 5xx (${http_code})" >&2
    sleep "$(awk "BEGIN { printf \"%.3f\", ${RETRY_DELAY_MS}/1000 * ${attempt} }")"
    attempt=$((attempt + 1))
  done
}

extract_json_field() {
  # naive JSON field extractor; fine for our small smoke responses
  local field="$1"
  sed -nE "s/.*\"${field}\"\s*:\s*\"([^\"]+)\".*/\1/p" | head -n1
}

echo "[1/6] /v1/chain"
CHAIN_RES=$(safe_request GET "/v1/chain" "" 1 "" )
echo "$CHAIN_RES" | tee /dev/stderr >/tmp/web4pay_chain.json

if ! echo "$CHAIN_RES" | grep -q '"chainId"'; then
  echo "Failed: /v1/chain did not return expected payload" >&2
  exit 1
fi

echo "[2/6] Create agent"
AGENT_NAME="payer-agent-$(date +%s%N)"
AGENT_RES=$(safe_request POST "/v1/agents" "{\"name\":\"${AGENT_NAME}\"}" 3)
AGENT_ID=$(echo "$AGENT_RES" | extract_json_field agentId)

if [[ -z "$AGENT_ID" ]]; then
  echo "Failed: could not extract agentId" >&2
  echo "$AGENT_RES" >&2
  exit 1
fi

echo "agentId=$AGENT_ID"

echo "[3/6] Create quote"
QUOTE_RES=$(safe_request POST "/v1/quotes" "{\"payerAgentId\":\"${AGENT_ID}\",\"payeeAddress\":\"0x1111111111111111111111111111111111111111\",\"amount\":\"1.23\",\"currency\":\"USDC\",\"expiresInSec\":600,\"deadlineInSec\":3600,\"orderId\":\"ord_demo_1-$(date +%s%N)\",\"metadata\":{\"purpose\":\"demo\"}}")
QUOTE_ID=$(echo "$QUOTE_RES" | extract_json_field quoteId)

if [[ -z "$QUOTE_ID" ]]; then
  echo "Failed: could not extract quoteId" >&2
  echo "$QUOTE_RES" >&2
  exit 1
fi

echo "quoteId=$QUOTE_ID"

echo "[4/6] Create escrow (mock deposit)"
ESCROW_RES=$(safe_request POST "/v1/escrows" "{\"quoteId\":\"${QUOTE_ID}\"}")
ESCROW_ID=$(echo "$ESCROW_RES" | extract_json_field escrowId)

if [[ -z "$ESCROW_ID" ]]; then
  echo "Failed: could not extract escrowId" >&2
  echo "$ESCROW_RES" >&2
  exit 1
fi

echo "escrowId=$ESCROW_ID"

echo "[5/6] Mark deposited (dev helper)"
safe_request POST "/internal/dev/escrows/${ESCROW_ID}/markDeposited" '{"ok":true}' >/dev/null

sleep 0.2

echo "[6/6] Release escrow (mock)"
RELEASE_RES=$(safe_request POST "/v1/escrows/${ESCROW_ID}/release" '{"deliverableHash":"0xabc"}')
echo "$RELEASE_RES"

echo "Done."
