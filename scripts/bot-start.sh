#!/bin/bash
# Dispara o bot V8 com 20 workers
# Login automatico via Supabase, sem dependencia de token JWT manual

SUPABASE_URL=$(grep VITE_SUPABASE_URL /root/acelera-corban/frontend/.env | cut -d= -f2)
SUPABASE_ANON=$(grep VITE_SUPABASE_ANON_KEY /root/acelera-corban/frontend/.env | cut -d= -f2-)
EMAIL='diamond.credioficial@gmail.com'
PASS='123456'

TOKEN=$(curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "[$(date)] ERRO: falha ao logar no Supabase" >&2
  exit 1
fi

RESP=$(curl -s -X POST "http://localhost:3002/api/bot/start?num_workers=20" \
  -H "Authorization: Bearer $TOKEN")
echo "[$(date)] $RESP"
