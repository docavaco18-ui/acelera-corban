# Higienização em Lote CLT — Design Spec (v2)

**Data:** 2026-04-28

## Objetivo

Sistema completo (backend + dashboard) para higienizar leads CLT em lote via API V8 Digital. O operador faz upload de um CSV com CPFs, os workers Python processam em paralelo (enriquecimento → consentimento → webhook de margem → simulação) e o dashboard exibe progresso em tempo real com download do CSV de elegíveis ao final.

## Stack (igual VCTex)

| Camada | Tecnologia |
|--------|-----------|
| Backend | Python 3.12, FastAPI, asyncio |
| Workers | asyncio tasks (sem Playwright — puro HTTP) |
| Banco | Supabase (PostgreSQL) |
| Cache/Estado | Redis |
| Webhook | FastAPI endpoint (recebe callbacks da V8) |
| Frontend | React 19 + TypeScript + Vite |
| Charts | Recharts |
| Containers | Docker Compose |

## Estrutura de Pastas

```
projetos/V8/
├── docker-compose.yml
├── .env / .env.example
│
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py           # FastAPI + lifespan + CORS + routers
│       ├── config.py         # Settings Pydantic (V8 creds, Supabase, Redis)
│       ├── database.py       # Supabase singleton
│       ├── redis_client.py   # Redis singleton
│       │
│       ├── models/
│       │   └── lead.py       # LeadRecord, LeadUpdate, StatsResponse
│       │
│       ├── routers/
│       │   ├── leads.py      # /api/leads (upload CSV, list, export)
│       │   ├── bot.py        # /api/bot/start, stop, status
│       │   ├── stats.py      # /api/stats/dashboard
│       │   ├── webhook.py    # /webhook (recebe callbacks da V8)
│       │   └── ws.py         # /ws/events (WebSocket broadcast)
│       │
│       └── services/
│           ├── auth_service.py      # OAuth2 token com cache
│           ├── v8_api_service.py    # Chamadas API V8
│           ├── worker.py            # LeadWorker (enrich→consent→simulate)
│           └── bot_service.py      # Coordena N workers + Redis state
│
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── App.tsx
│       ├── pages/
│       │   └── Dashboard.tsx       # Tabs: Geral, Workers, Leads, Upload
│       ├── components/
│       │   ├── BotControl.tsx      # Start/Stop + nº workers
│       │   ├── WorkersLive.tsx     # Cards por worker (XP, status, log)
│       │   ├── MetricsDashboard.tsx # Cards: total, elegíveis, erros, %
│       │   ├── UploadPanel.tsx     # Drag-and-drop CSV upload
│       │   ├── LeadsTable.tsx      # Tabela de leads com status
│       │   └── WsEventFeed.tsx     # Feed de eventos ao vivo
│       ├── hooks/
│       │   └── useBotWebSocket.ts  # WS + worker state management
│       └── lib/
│           ├── api.ts
│           └── types.ts
│
└── migrations/
    └── 001_schema.sql
```

## Fluxo por Lead

```
Upload CSV (CPF + telefone)
        ↓
Supabase: leads inseridos com status "pendente"
        ↓
Worker asyncio:
  1. GET /consult/client-data/basic/{cpf}  → enriquece nome, email, DOB
  2. POST /private-consignment/consult      → cria consentimento (consult_id)
  3. POST /consult/{id}/authorize           → autoriza
  4. Aguarda webhook na fila Redis          → status SUCCESS + availableMarginValue
  5. GET /simulation/configs                → config_id
  6. POST /simulation                       → simulação completa
  7. Supabase: atualiza lead com resultados
        ↓
WebSocket broadcast → dashboard atualiza worker card
        ↓
Export CSV só com leads "elegivel"
```

## Webhook V8 → Backend

- V8 chama `POST /webhook` quando margem é consultada
- Backend identifica o `consult_id` e publica resultado em Redis pubsub
- Worker que aguardava assina o canal e avança para simulação

## Supabase Schema

```sql
-- leads
id, cpf (UNIQUE), telefone, nome, email, data_nascimento,
status (pendente|enriquecido|consentido|autorizado|elegivel|inelegivel|erro),
consult_id, margem_disponivel, valor_liberado, valor_parcela,
num_parcelas, cet_mensal, erro, created_at, updated_at

-- bot_runs
id, started_at, finished_at, status, num_workers,
total_processed, total_elegiveis, total_inelegiveis
```

## Variáveis de Ambiente

```
V8_USERNAME, V8_PASSWORD, V8_AUDIENCE, V8_CLIENT_ID
V8_PROVIDER=QI
WEBHOOK_URL=https://seu-ngrok.app/webhook
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY
REDIS_URL=redis://redis:6379
MAX_WORKERS=6
API_KEY=chave-interna
```
