# Central de Usuários — Painel Admin de Monitoramento Multi-Tenant

**Data:** 2026-06-21
**Autor:** Gabriel + Claude
**Status:** Aprovado (design) → implementação localhost antes de deploy

## Objetivo

Painel **admin-only** que mostra **todos os clientes do Acelera Corban num único lugar**, com a saúde Meta/WhatsApp de cada um: status da BM, números conectados, capacidade real de disparo, templates, qualidade, e principalmente **"o que falta"** (pendências de configuração — ex: falta conexão CRM, falta token da BM). Dado **real em tempo real**, puxado da BM via token de usuário de sistema de cada cliente. Zero dado inventado.

Layout **idêntico** à Central de Controle (`CentralControle.tsx`) — mesmos componentes visuais, mesma linguagem (glassmorphism, 🧠 BrainBadge, KpiCard, StatusPill, spotlight, sistema de cores `C`/`G`).

## Escopo

**Inclui:** VendeAI + Aesir + Chipcare (3 CRMs WhatsApp). Por cliente: BM status, nº de BMs conectadas, números (saudáveis/total + qualidade), capacidade real hoje, templates aprovados/total, status CRM, lista de pendências, score 0-100, incidentes.

**Fora de escopo (YAGNI v1):** bots banco (V8/VCTex/Mercantil/Presença/PowerHub), gráficos históricos, notificações push, editar/impersonar cliente. Painel é **read-only**.

## Decisões aprovadas

1. **Navegação:** página nova `/central-usuarios`, admin-only, irmã da Central de Controle. Link de menu só aparece pra admin.
2. **Tempo real:** híbrido — cache instantâneo no load (mantido pelo `monitor_loop` já existente) + botão `⚡ Auditar todos ao vivo` que bate Meta API por token de cada cliente.
3. **Escopo:** só WhatsApp/Meta. Sem bots banco.

## Arquitetura

### Princípio central
`command_center.py` **já computa toda a saúde por usuário** — `overview()` recebe `owner_id = user.user_id` e monta health, deliverability, capacity, meta_audits, templates, error_radar, incidents, checklist, score. A Central de Usuários **roda a mesma engine por cada `owner_id`** e agrega. Nenhuma engine nova.

### Backend

**Refactor (`backend/app/routers/command_center.py`):**
- Extrair o corpo de `overview()` numa função reutilizável:
  ```python
  async def compute_overview(db, owner_id: str, *, live_meta: bool) -> dict
  ```
  Retorna exatamente o mesmo dict que o endpoint hoje retorna.
- Endpoint `GET /api/command-center/overview` passa a chamar `compute_overview(db, user.user_id, live_meta=live_meta)`. **Saída inalterada** (teste de paridade garante).

**Router novo (`backend/app/routers/admin_users_monitor.py`):** prefixo `/api/admin/users-monitor`, **todos os endpoints com `Depends(require_admin)`** (403 pra não-admin).

- `GET /api/admin/users-monitor`
  - Lista usuários via Supabase auth admin API (mesmo padrão de `adminApi.listUsers` / `admin.py`).
  - Pra cada usuário: monta **resumo via cache** (`compute_overview(..., live_meta=False)` → reduzido ao shape de card). Só leitura de DB, rápido.
  - Cada usuário em `try/except` — usuário que falhar vira card `{ error: true }`, não derruba o painel.
  - Retorna `{ generated_at, aggregate, users: [summary...] }`.
  - **Performance:** ~20 clientes esperados. Loop sync de Supabase aceitável (poucos segundos). Se ficar lento, paralelizar com `asyncio.to_thread` + `gather` (semáforo). Flag no plano; não otimizar prematuramente.

- `GET /api/admin/users-monitor/{owner_id}?live_meta=bool`
  - `compute_overview(db, owner_id, live_meta=live_meta)` → overview **completo** de 1 cliente. Alimenta o drawer de detalhe e o ⚡ ao vivo individual.

- `POST /api/admin/users-monitor/refresh-live`
  - Roda auditoria Meta ao vivo de **todos** em paralelo: `asyncio.gather` com semáforo (ex: 5 simultâneos) + timeout por usuário (reusa `LIVE_META_TIMEOUT_SECONDS`).
  - Usuário cujo live falhar/expirar → retorna cache + flag `live_failed: true` (espelha `live_meta_timed_out` existente).
  - Retorna mesmo shape de `GET /users-monitor` com templates/qualidade frescos.

**Shape do resumo por usuário (card):**
```jsonc
{
  "owner_id": "uuid",
  "email": "cliente@...",
  "client_label": "Nome da BM ou email",
  "score": { "score": 0-100, "status": "ok|warning|critical", "label": "..." },
  "bms": { "connected": 0, "error": 0, "total": 0 },
  "numbers": { "total": 0, "healthy": 0, "warning": 0, "critical": 0 },
  "quality": { "green": 0, "yellow": 0, "red": 0, "unknown": 0 },
  "capacity_today": 0,
  "templates": { "approved": 0, "total": 0 },   // null no cache (Meta não persiste templates)
  "crm": { "vendeai": "ok|missing", "aesir": "ok|missing", "chipcare": "ok|missing" },
  "pending": [ { "severity": "warning|critical", "label": "Falta token da BM (Aesir)", "detail": "..." } ],
  "top_incidents": [ /* até 3 incidentes do command_center */ ],
  "last_meta_check_at": "iso|null",
  "live": false,
  "live_failed": false,
  "error": false
}
```

**Shape do agregado:**
```jsonc
{
  "users_total": 0, "users_healthy": 0, "users_warning": 0, "users_critical": 0,
  "capacity_total": 0, "numbers_total": 0, "bms_total": 0, "generated_at": "iso"
}
```

**Engine de pendências ("o que falta"):** derivada dos `health` checks (status != ok) + `meta_audits` + `deliverability` já computados pelo command_center, remapeados pra linguagem acionável:
- token Meta ausente/corrompido → `Falta token da BM ({CRM})` (critical)
- credencial CRM ausente → `Falta conexão CRM ({CRM})` (warning)
- nenhum número saudável → `Sem números saudáveis ({CRM})`
- Chatwoot ausente → `Chatwoot não conectado`
- 0 templates aprovados (só ao vivo) → `Sem templates aprovados`
- problema de pagamento em número → `Problema de pagamento em N número(s)`

**Contagem de BMs por cliente:** VendeAI usa `vendeai_meta_tokens` (multi-token, migração 036) — `connected` = status `estavel`, `error` = status `erro`. Aesir/Chipcare usam token único em `*_settings` → conta 0 ou 1 cada. `total` = soma.

### Frontend

**Refactor:** extrair o render da Central de Controle num componente compartilhado `frontend/src/components/OverviewDashboard.tsx` que recebe `{ data: Overview, loading, onRefresh, onLiveAudit }`. Usado por:
- `CentralControle.tsx` (dados do próprio admin) — passa a só buscar dados e renderizar `<OverviewDashboard/>`.
- O drawer de detalhe da Central de Usuários (dados de qualquer cliente).

**Página nova `frontend/src/pages/CentralUsuarios.tsx`:**
- **Header:** 🧠 BrainBadge + título "Central de Usuários" + agregado ("N clientes · M em risco") + botões `↻ Atualizar` (recarrega cache) e `⚡ Auditar todos ao vivo`.
- **4 KPIs** (KpiCard): clientes saudáveis · clientes em risco crítico · capacidade total da plataforma · total de números.
- **Grid de cards de cliente** (1 por usuário), ordenado risco→saudável (critical primeiro), spotlight hover. Cada card mostra os campos do shape de resumo (score pill, BMs, números+qualidade, capacidade, templates, CRM, chips de pendência).
- Clicar num card → **drawer** com `<OverviewDashboard/>` completa daquele cliente (busca `/users-monitor/{owner_id}`) + botão ⚡ ao vivo individual.
- Card com `error: true` → estado "erro ao carregar este cliente".

**`frontend/src/lib/api.ts`:** `adminUsersMonitorApi = { list(), detail(ownerId, liveMeta), refreshLiveAll() }`.

**`frontend/src/App.tsx`:** rota `/central-usuarios` dentro de `<Protected adminOnly>` (mesmo padrão de `/admin`). Link de menu admin-only perto da Central de Controle.

### Fluxo de dados
1. Admin abre `/central-usuarios` → `GET /api/admin/users-monitor` (cache) → cards renderizam instantâneo.
2. `⚡ Auditar todos ao vivo` → `POST /refresh-live` → backend bate Meta paralelo por cliente → cards atualizam (templates preenchidos, qualidade fresca).
3. Clicar card → `GET /users-monitor/{owner_id}?live_meta=false` → drawer com detalhe completo. ⚡ no drawer → `live_meta=true` pra aquele cliente.

## Erros / segurança

- Cross-tenant acontece **só** neste router e **só** com `require_admin`. Fluxo normal de usuário continua scoped em `user.user_id` — sem vazamento entre tenants.
- Cada usuário computado em `try/except` (padrão `_safe_select` tolerante a falha).
- Live audit: timeout por usuário + concorrência limitada (semáforo). Falha individual não quebra o lote.
- Read-only: painel não edita credenciais de cliente.

## Testes

**Backend (`backend/tests/`):**
- Paridade: `/api/command-center/overview` retorna o mesmo shape antes/depois do refactor.
- Engine de pendências: mapeamento health→pending correto pros casos principais.
- Agregado: soma de capacidade/números/clientes correta.
- Gating: `/api/admin/users-monitor*` retorna 403 pra usuário não-admin, 200 pra admin.

**Frontend:**
- `tsc` limpo, build sem erro.
- **Verificação localhost com conta admin real** (docavaco18): cards com dados reais, ⚡ batendo Meta de verdade, drawer real. Critério de aceite antes do deploy.

## Critério de aceite
Painel funcional no localhost mostrando clientes reais com dados reais da Meta; aprovação visual/funcional do Gabriel → deploy VPS (`docker compose -f docker-compose.prod.yml build --no-cache backend frontend && up -d`).
