#!/bin/bash
# Dispara o bot V8 com 10 workers (cap atual do servidor)
# Login automatico via Supabase, sem dependencia de token JWT manual
# Endpoint via dominio publico — Caddy so atende aceleracorban.com.br
#
# Credenciais via env (NUNCA hardcode neste arquivo — ele esta no git):
#   BOT_EMAIL=user@dominio.com BOT_PASS='senha' ./bot-start.sh
# Ou exporte no crontab / num arquivo fora do repo com `source`.

API_URL="${API_URL:-https://aceleracorban.com.br}"
WORKERS="${WORKERS:-10}"
ENV_FILE="${ENV_FILE:-/root/acelera-corban/frontend/.env}"

if [ -z "$BOT_EMAIL" ] || [ -z "$BOT_PASS" ]; then
  echo "[$(date)] ERRO: defina BOT_EMAIL e BOT_PASS no ambiente (sem hardcode no script)" >&2
  exit 1
fi

SUPABASE_URL=$(grep VITE_SUPABASE_URL "$ENV_FILE" | cut -d= -f2)
SUPABASE_ANON=$(grep VITE_SUPABASE_ANON_KEY "$ENV_FILE" | cut -d= -f2-)

TOKEN=$(curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$BOT_EMAIL\",\"password\":\"$BOT_PASS\"}" | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "[$(date)] ERRO: falha ao logar no Supabase" >&2
  exit 1
fi

RESP=$(curl -s -X POST "$API_URL/api/bot/start?num_workers=$WORKERS" \
  -H "Authorization: Bearer $TOKEN")
echo "[$(date)] $RESP"
