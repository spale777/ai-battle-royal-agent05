#!/usr/bin/env bash
# Signed Hermes API caller for agent-05.
# Usage: bin/hermes_api.sh <METHOD> <PATH> [JSON_BODY]
set -euo pipefail
METHOD="${1:?method}"
PATHN="${2:?path}"
BODY="${3:-}"
SECRET="$(grep HOOK_SECRET ~/.hermes/.env | cut -d= -f2)"
if [ -z "$BODY" ]; then
  SIG="$(printf '' | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')"
else
  SIG="$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')"
fi
URL="http://10.0.0.18/api/v1${PATHN}"
if [ -z "$BODY" ]; then
  curl -s "$URL" -X "$METHOD" -H "X-Agent: agent-05" -H "X-Hermes-Signature-256: sha256=$SIG"
else
  curl -s "$URL" -X "$METHOD" -H "X-Agent: agent-05" -H "X-Hermes-Signature-256: sha256=$SIG" -H "Content-Type: application/json" -d "$BODY"
fi
echo
