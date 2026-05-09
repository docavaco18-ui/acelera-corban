# Spec: Disparo WhatsApp — Acelera Corban
**Data**: 2026-05-08  
**Status**: Aprovado pelo usuário  
**Projeto**: `/Users/macbookdegabriel/projetos/ACELERA CORBAN`

---

## 1. Objetivo

Adicionar uma aba **"Disparo WhatsApp"** ao dashboard Acelera Corban que permita:

1. Upload de CSV → análise inteligente (Claude) → divisão proposta por número → disparo via VendeAI API
2. Monitoramento em tempo real: qualidade dos números (Meta API), métricas de disparo (VendeAI), conversões (Chatwoot labels)
3. Intervenção automática: pausar disparo + failover se número cair ou taxa de falha disparar

---

## 2. Escopo

### Dentro do escopo
- Nova aba `/disparo` no nav do Acelera Corban
- Nova seção "Disparo WhatsApp" na página `/configuracoes`
- 12 novos arquivos (backend + frontend)
- 7 arquivos modificados
- 5 novas tabelas Supabase (migration `013_broadcast.sql`)
- Loop de monitoramento asyncio (60s)
- Integração Claude API (tool-use, prompt caching)
- Integração Meta Graph API (qualidade de número)
- Integração VendeAI BFF API (disparos)
- Integração Chatwoot API (labels de conversão)

### Fora do escopo
- Novo serviço separado (tudo dentro do FastAPI existente na porta 8001)
- APScheduler (asyncio puro)
- Novo WebSocket (estende o existente)
- Autenticação separada (reusa Supabase JWT)

---

## 3. Arquitetura

### Backend — novos arquivos

```
backend/app/
├── routers/
│   └── broadcast.py                  ← todas as rotas /api/broadcast/*
├── services/broadcast/
│   ├── __init__.py
│   ├── vendeai_client.py             ← HTTP client VendeAI BFF + cache de token
│   ├── meta_client.py                ← Meta Graph API quality/tier polling
│   ├── claude_advisor.py             ← Claude API split decision (tool-use)
│   ├── monitor_loop.py               ← asyncio background task (60s)
│   └── intervention.py               ← lógica de pausa/failover com idempotência
migrations/
└── 013_broadcast.sql                 ← 5 tabelas + RLS
```

### Backend — arquivos modificados

| Arquivo | O que muda |
|---|---|
| `main.py` | Adiciona router broadcast, lifespan com monitor task |
| `config.py` | Adiciona `anthropic_api_key: str = ""` |
| `routers/ws.py` | Subscribe em `broadcast:events` além de `bot:events` |
| `requirements.txt` | Adiciona `anthropic>=0.40.0` |

### Frontend — novos arquivos

```
frontend/src/
├── pages/Disparo.tsx                       ← página principal (3 painéis)
├── components/disparo/
│   ├── CsvUploadWizard.tsx                 ← wizard 5 estados
│   ├── NumberQualityGrid.tsx               ← grid de cards por número
│   ├── DispatchMetrics.tsx                 ← Recharts bar + conversões
│   └── AlertFeed.tsx                       ← feed de alertas em tempo real
└── hooks/useBroadcastWebSocket.ts          ← wrapper do WS existente
```

### Frontend — arquivos modificados

| Arquivo | O que muda |
|---|---|
| `App.tsx` | Adiciona rota `/disparo`, renomeia "Disparo Chatwoot" → "CRM Chatwoot" |
| `lib/api.ts` | Adiciona `broadcastApi` (sem bankPrefix interceptor) |
| `pages/Configuracoes.tsx` | Adiciona seção "Disparo WhatsApp" |

---

## 4. Banco de Dados — `013_broadcast.sql`

### `vendeai_settings`
Credenciais do usuário para VendeAI + Meta. Uma linha por usuário.

| Campo | Tipo | Descrição |
|---|---|---|
| `owner_id` | UUID PK | FK auth.users |
| `email_enc` | TEXT | Email VendeAI (Fernet) |
| `password_enc` | TEXT | Senha VendeAI (Fernet) |
| `bearer_token_enc` | TEXT | Token Bearer cacheado (Fernet) |
| `token_expires_at` | TIMESTAMPTZ | Expiry do token |
| `meta_token_enc` | TEXT | Meta Graph API token (Fernet) |

### `broadcast_numbers`
Estado atual de cada número WhatsApp. Atualizado a cada 60s.

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | UUID PK | |
| `owner_id` | UUID | FK auth.users |
| `phone_id` | TEXT | Meta phone_id |
| `display_phone` | TEXT | "+55 17 9823..." |
| `quality_rating` | TEXT | GREEN / YELLOW / RED / UNKNOWN |
| `messaging_tier` | TEXT | 1K / 10K / 100K |
| `daily_limit` | INTEGER | 1000 / 10000 / 100000 |
| `is_paused` | BOOLEAN | Pausado por intervenção |
| `last_meta_check_at` | TIMESTAMPTZ | Último poll Meta |

### `broadcast_dispatches`
Uma sessão de disparo por upload de CSV.

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | UUID PK | |
| `owner_id` | UUID | FK auth.users |
| `csv_filename` | TEXT | Nome do arquivo |
| `total_leads` | INTEGER | Total de linhas do CSV |
| `claude_split_json` | JSONB | Decisão do Claude: `{numbers:[{phone_id, planned_count, reason}], justification, risks}` |
| `status` | TEXT | pending_confirm / running / paused / completed / failed / revoked |
| `started_at` | TIMESTAMPTZ | |
| `finished_at` | TIMESTAMPTZ | |
| `error` | TEXT | Mensagem de erro se falhou |

### `broadcast_dispatch_assignments`
Um mailing por número por dispatch. Atualizado pelo monitor loop.

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | UUID PK | |
| `dispatch_id` | UUID | FK broadcast_dispatches |
| `owner_id` | UUID | FK auth.users |
| `phone_id` | TEXT | |
| `vendeai_mailing_id` | TEXT | UUID do mailing no VendeAI |
| `planned_count` | INTEGER | Leads planejados por Claude |
| `sent_count` | INTEGER | Enviados (do VendeAI) |
| `failed_count` | INTEGER | Falhas (do VendeAI) |
| `open_count` | INTEGER | Conversas abertas (Chatwoot) |
| `converted_count` | INTEGER | Label PAGO ou OFERTADO (Chatwoot) |
| `status` | TEXT | scheduled / running / paused / completed / failed |
| `last_poll_at` | TIMESTAMPTZ | |

### `broadcast_alerts`
Log imutável de eventos e intervenções.

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | UUID PK | |
| `owner_id` | UUID | FK auth.users |
| `dispatch_id` | UUID | FK broadcast_dispatches (nullable) |
| `phone_id` | TEXT | Número afetado |
| `alert_type` | TEXT | quality_drop / rate_limit / failed_spike / block_detected |
| `severity` | TEXT | warn / critical |
| `message` | TEXT | Descrição legível |
| `action_taken` | TEXT | paused / failover_to:\<phone_id\> / none |
| `action_id` | TEXT UNIQUE | Chave de idempotência: `<dispatch_id>:<phone_id>:<alert_type>:<window_hour>` |
| `ts` | TIMESTAMPTZ | |

---

## 5. Rotas da API

```
POST   /api/broadcast/credentials           ← salva VendeAI email+senha+meta_token
GET    /api/broadcast/credentials           ← retorna {configured: bool} (sem secrets)
GET    /api/broadcast/numbers               ← lista broadcast_numbers do usuário
POST   /api/broadcast/numbers/refresh       ← força poll imediato na Meta API
POST   /api/broadcast/analyze               ← upload CSV → retorna claude_split_json
POST   /api/broadcast/dispatch              ← confirma + dispara (cria dispatch + chama VendeAI)
GET    /api/broadcast/dispatches            ← lista dispatches do usuário
GET    /api/broadcast/dispatches/{id}       ← detalhe com assignments
POST   /api/broadcast/dispatches/{id}/pause ← pausa manual todos os mailings
POST   /api/broadcast/dispatches/{id}/resume← retoma manual
POST   /api/broadcast/dispatches/{id}/revoke← cancela definitivo
GET    /api/broadcast/analytics             ← métricas agregadas
GET    /api/broadcast/alerts                ← lista broadcast_alerts do usuário
```

---

## 6. Monitor Loop (asyncio, 60s)

```
loop tick para cada usuário com dispatch ativo:
  1. poll VendeAI mailings → atualiza sent_count, failed_count em broadcast_dispatch_assignments
  2. poll Meta API → atualiza quality_rating, messaging_tier em broadcast_numbers
  3. poll Chatwoot labels → atualiza open_count, converted_count
  4. avalia intervenção (intervention.py)
  5. publica snapshot no Redis canal broadcast:events → WebSocket → frontend
```

### Triggers de intervenção

| Sinal | Threshold | Severidade | Ação |
|---|---|---|---|
| quality_rating → RED | imediato | critical | pausa mailing + failover |
| quality_rating → YELLOW | imediato | warn | alerta (sem pausa) |
| failed_count/sent_count > 10% por 3 ticks | 3 consecutivos | critical | pausa mailing |
| Chatwoot mensagem com "blocked" / "rate limit" | qualquer | critical | pausa mailing |
| delta failed_count > 50 em um tick | 1 tick | critical | pausa + failover |

**Idempotência**: `action_id = f"{dispatch_id}:{phone_id}:{alert_type}:{window_hour}"` — UNIQUE constraint garante que cada intervenção ocorre no máximo uma vez por hora por sinal.

**Failover**: seleciona número com `quality_rating=GREEN`, `is_paused=FALSE`, ordenado por `daily_limit` DESC.

---

## 7. Claude API (claude_advisor.py)

- **Modelo**: `claude-sonnet-4-6`
- **Pattern**: tool-use com `propose_split` tool — garante JSON estruturado sem parsing frágil
- **Prompt caching**: system prompt com `cache_control: ephemeral` — reduz custo em ~90% nas chamadas repetidas
- **Input**: lista de números `[{phone_id, quality_rating, tier, daily_limit, is_paused}]` + total de leads
- **Output**: `{assignments: [{phone_id, planned_count, reason}], justification, risks}`
- **Regra**: exclui números RED e pausados salvo se não houver alternativas

---

## 8. Frontend — Disparo.tsx (3 painéis)

### Painel 1 — CsvUploadWizard
Estado: `idle → uploading → analyzing → confirming → dispatching`

- `idle`: dropzone CSV
- `analyzing`: spinner "Claude está analisando o disparo..."
- `confirming`: tabela com divisão proposta, qualidade de cada número, justificativa Claude, counts editáveis
- `dispatching`: chama `/api/broadcast/dispatch`, transição para monitoramento

### Painel 2 — NumberQualityGrid
Grid de cards por número:
- Badge qualidade: GREEN `#00ff88` / YELLOW `#ffd700` / RED `#ff2d78`
- Chip tier: "1k/dia" / "10k/dia" / "100k/dia"
- Enviados / Falhas hoje
- Botão retomar se pausado por intervenção

Atualizado via `useBroadcastWebSocket` eventos `broadcast.snapshot`.

### Painel 3 — DispatchMetrics + AlertFeed
- Recharts BarChart: enviados / falhas / abertos / convertidos por número
- % conversão (PAGO ou OFERTADO / total disparado)
- AlertFeed: log scrollável com cor por severidade (`warn=#ffd700`, `critical=#ff2d78`)

---

## 9. Configurações — nova seção

Na página `/configuracoes`, novo card "Disparo WhatsApp":
- VendeAI E-mail (text)
- VendeAI Senha (password, blank = manter existente)
- Meta Graph API Token (password)
- Botão "Salvar" → PUT `/api/broadcast/credentials`
- Nota: "Credenciais Chatwoot: configure na seção CRM Chatwoot"

---

## 10. WebSocket — eventos broadcast

Canal Redis: `broadcast:events`

```json
// Snapshot a cada tick
{
  "user_id": "<uuid>",
  "type": "broadcast.snapshot",
  "numbers": [...],
  "dispatches": [...],
  "alerts": []
}

// Alerta imediato
{
  "user_id": "<uuid>",
  "type": "broadcast.alert",
  "alert_type": "quality_drop",
  "phone_id": "...",
  "severity": "critical",
  "message": "Número +5517... caiu para RED — disparo pausado"
}
```

`useBroadcastWebSocket` filtra eventos com `type.startsWith("broadcast.")`.

---

## 11. Segurança

- Todas as credenciais armazenadas com Fernet encryption (`credentials/crypto.py` existente)
- `ANTHROPIC_API_KEY` apenas em `.env`, nunca exposto ao frontend
- Todas as tabelas com RLS: `owner_id = auth.uid()`
- `broadcastApi` no frontend usa o mesmo interceptor de auth Supabase JWT
- `bankPrefix` interceptor bypassed em `broadcastApi` (dispatch é bank-agnostic)

---

## 12. Deploy

1. **Localhost**: `npm run dev` (frontend) + uvicorn (backend) — testar, usuário aprova
2. **VPS Hostinger**: `git pull` + `docker compose up --build` — mesmos passos do deploy atual do Acelera Corban
3. Variável `.env` nova: `ANTHROPIC_API_KEY=...`
4. Migration: `psql $DATABASE_URL -f migrations/013_broadcast.sql`

---

## 13. Ordem de implementação sugerida

1. Migration SQL + tabelas
2. `vendeai_client.py` + `meta_client.py` (clientes HTTP puros, testáveis)
3. `claude_advisor.py` (tool-use)
4. `routers/broadcast.py` (rotas credentials + numbers + analyze + dispatch)
5. `monitor_loop.py` + `intervention.py` + wiring em `main.py`
6. `routers/ws.py` (adicionar canal broadcast:events)
7. Frontend: `broadcastApi` + `useBroadcastWebSocket`
8. Frontend: `Configuracoes.tsx` nova seção
9. Frontend: `CsvUploadWizard` + `NumberQualityGrid`
10. Frontend: `DispatchMetrics` + `AlertFeed`
11. Frontend: `Disparo.tsx` montando os 3 painéis + rota em `App.tsx`
12. Testes end-to-end localhost → aprovação → deploy VPS
