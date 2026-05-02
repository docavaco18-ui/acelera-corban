# V8 Multi-Tenant — Spec de Design

**Data:** 2026-05-02
**Autor:** Gabriel (via Claude)
**Plano:** 2 de 5 (Foundation ✅ → **V8 module** → VCTex → Frontend → Cleanup)

## Objetivo

Transformar o módulo V8 do ACELERA CORBAN em multi-tenant: cada cliente cadastra suas próprias credenciais V8 e processa seus próprios leads, sem possibilidade de vazamento de dados entre clientes. Eliminar o fallback global pro `.env` — sem credencial cadastrada, nada roda.

## Requisitos do produto (decididos pelo usuário)

| # | Decisão | Escolha |
|---|---------|---------|
| 1 | Dados que já existem em prod | Atribuir todos ao admin |
| 2 | Cliente sem proxy cadastrado | Bot roda direto (sem proxy) |
| 3 | Bot quando 2+ clientes rodam | Cada cliente tem seu pool de workers em paralelo |
| 4 | Sem credencial cadastrada | HTTP 400, bot não inicia |
| 5 | Isolamento de dados | Crítico — DB-level + Python-level (cinto+suspensório) |

## Arquitetura

### Camadas de isolamento (defesa em profundidade)

```
┌─────────────────────────────────────────────────────┐
│ 1. JWT Supabase (require_user)                      │
│    extrai user_id de cada request                   │
├─────────────────────────────────────────────────────┤
│ 2. scoped() helper Python (ENFORCEMENT REAL)        │
│    toda query a tabela tenant filtra owner_id       │
│    backend usa service_role, bypassa RLS,           │
│    então scoped() é a defesa que importa            │
├─────────────────────────────────────────────────────┤
│ 3. RLS no Supabase (defesa secundária)              │
│    só ativa se frontend ler Supabase direto         │
│    com JWT do user (futuro, não agora)              │
├─────────────────────────────────────────────────────┤
│ 4. Pytest de lint (CI gate)                         │
│    falha se alguém escreve db.table("v8_leads")     │
│    fora do allowlist                                │
└─────────────────────────────────────────────────────┘
```

### Modelo de dados

**Migration `003_multitenant.sql`** (aplicada manualmente no Supabase pelo usuário):

```sql
-- 1. owner_id em todas as tabelas tenant-isolated
ALTER TABLE public.v8_leads    ADD COLUMN IF NOT EXISTS owner_id UUID;
ALTER TABLE public.v8_bot_runs ADD COLUMN IF NOT EXISTS owner_id UUID;

-- 2. Backfill: tudo que existe vira do admin
--    SUBSTITUIR <ADMIN_USER_ID> pelo UUID do admin (settings.admin_ids[0])
--    antes de rodar a migration
UPDATE public.v8_leads    SET owner_id = '<ADMIN_USER_ID>' WHERE owner_id IS NULL;
UPDATE public.v8_bot_runs SET owner_id = '<ADMIN_USER_ID>' WHERE owner_id IS NULL;

-- 3. NOT NULL depois do backfill
ALTER TABLE public.v8_leads    ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE public.v8_bot_runs ALTER COLUMN owner_id SET NOT NULL;

-- 4. CPF deixa de ser global, vira único POR cliente
ALTER TABLE public.v8_leads DROP CONSTRAINT IF EXISTS v8_leads_cpf_key;
ALTER TABLE public.v8_leads
    ADD CONSTRAINT v8_leads_cpf_owner_unique UNIQUE (cpf, owner_id);

-- 4b. consult_id precisa ser único (webhook V8 resolve owner por ele).
--     Usa índice parcial pra ignorar NULLs (leads sem consulta ainda).
DROP INDEX IF EXISTS v8_leads_consult_id_unique;
CREATE UNIQUE INDEX v8_leads_consult_id_unique
    ON public.v8_leads(consult_id)
    WHERE consult_id IS NOT NULL;

-- 5. Índices para performance de filtro por owner
CREATE INDEX IF NOT EXISTS v8_leads_owner_idx    ON public.v8_leads(owner_id);
CREATE INDEX IF NOT EXISTS v8_bot_runs_owner_idx ON public.v8_bot_runs(owner_id);

-- 6. RLS habilitado (defesa secundária, só fira via JWT)
ALTER TABLE public.v8_leads    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v8_bot_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY v8_leads_owner    ON public.v8_leads    USING (owner_id = auth.uid());
CREATE POLICY v8_bot_runs_owner ON public.v8_bot_runs USING (owner_id = auth.uid());
```

**Runbook de aplicação** (etapa manual, fora do código):
1. **Parar o container backend** na VPS (`docker compose stop backend`) — evita race entre INSERTs novos e o `SET NOT NULL`. Sem essa parada, qualquer upload de CSV no meio quebra a migration.
2. Backup do schema: `pg_dump --schema-only` ou snapshot do Supabase.
3. No console Supabase, rodar `SELECT id FROM auth.users WHERE email = '<email do admin>';` para obter o UUID.
4. Substituir `<ADMIN_USER_ID>` no SQL pelo UUID.
5. Verificar se há `consult_id` duplicado antes do passo 4b: `SELECT consult_id, COUNT(*) FROM v8_leads WHERE consult_id IS NOT NULL GROUP BY consult_id HAVING COUNT(*) > 1;`. Se houver, decidir caso a caso (provavelmente NULLificar duplicatas antigas).
6. Rodar a migration no SQL editor do Supabase, idealmente como uma única transação (`BEGIN; ... COMMIT;`).
7. Subir o container (`docker compose up -d backend`) e smoke-testar `/api/credentials` + `/api/leads`.

### Estrutura de pastas (após Plano 2)

```
backend/app/
├── credentials/                 (Plano 1 — intacto)
│   ├── crypto.py
│   ├── service.py
│   └── router.py
├── banks/
│   ├── __init__.py
│   └── v8/
│       ├── __init__.py
│       ├── credentials_helper.py    # get_v8_runtime_creds(user_id, db) → BankCredentials | raise 400
│       ├── auth.py                  # get_token(user_id, login, password) com cache por user
│       ├── worker.py                # LeadWorker(user_id, creds, db, run_id)
│       └── bot_pool.py              # gerencia pools por user_id (dict)
├── db_scoped.py                     # scoped(db, "v8_leads", user_id)
├── auth_deps.py                     (intacto)
├── routers/
│   ├── leads.py                     (refatorar: extrai user_id, scoped queries)
│   ├── bot.py                       (refatorar: pool por user, valida creds)
│   ├── stats.py                     (refatorar: scoped queries)
│   ├── webhook.py                   (refatorar: resolve owner_id por consult_id)
│   ├── ws.py                        (refatorar: canal por user_id)
│   └── admin.py                     (intacto)
└── services/
    ├── auth_service.py              (DEPRECATED: shim importa de banks/v8/auth.py)
    ├── worker.py                    (DEPRECATED: shim importa de banks/v8/worker.py)
    ├── bot_service.py               (refatorar pra bot_pool.py)
    └── v8_api_service.py            (recebe creds.token explicitamente)
```

Shims em `services/` evitam quebrar imports espalhados durante a transição. Removidos no Plano 5.

### Fluxo de execução

**1. Cliente faz upload de CSV:**
```
POST /api/leads/upload
  → require_user → user_id
  → para cada linha: insert v8_leads {cpf, owner_id=user_id, ...}
  → response: {inseridos: N}
```

**2. Cliente inicia o bot:**
```
POST /api/bot/start {num_workers: 5}
  → require_user → user_id
  → CredentialService.get(user_id, "v8") → creds | None
  → creds is None? → raise HTTPException(400, "credenciais V8 não cadastradas")
  → bot_pool.get(user_id) já rodando? → raise HTTPException(409, "bot já em execução")
  → bot_pool.start(user_id, num_workers, creds, db)
      ├── cria run em v8_bot_runs com owner_id=user_id
      ├── spawn N LeadWorker(user_id=user_id, creds=creds, ...)
      └── cada worker:
           - puxa leads via scoped(db, "v8_leads", user_id).select().eq("status","pendente").limit(1)
           - autentica via banks/v8/auth.get_token(user_id, creds.login, creds.password)
              cache por user_id: dict[user_id → (token, expires_at)]
           - proxy = creds.proxies[worker_idx % len] if creds.proxies else None
           - chama V8 API
           - update via scoped(db, "v8_leads", user_id).update(...).eq("cpf", cpf)
  → response: {run_id, num_workers, started_at}
```

**3. V8 chama webhook (sem auth):**
```
POST /api/webhook/v8 {consult_id, ...}
  → SEM require_user (V8 não tem JWT do nosso sistema)
  → resolve linha: db.table("v8_leads").select("id, owner_id").eq("consult_id", consult_id).single()
     (UNIQUE em consult_id garante 0 ou 1 linha — ver migration passo 4b)
  → encontrou? → scoped(db, "v8_leads", row.owner_id).update(...).eq("id", row.id)
     (filtra por id, NÃO por consult_id de novo — evita TOCTOU/redundância)
  → não encontrou? → 404 (consult_id desconhecido, ignora silenciosamente)

NOTA: webhook.py é o ÚNICO arquivo que pode chamar db.table("v8_leads") direto
(pra resolver owner antes do scoped). Está no allowlist do test de lint.
```

**4. Cliente baixa CSV:**
```
GET /api/leads/export
  → require_user → user_id
  → rows = scoped(db, "v8_leads", user_id).select("*").execute()
  → stream CSV
```

**5. WebSocket (eventos do bot):**
```
WS /ws?token=<JWT>
  → valida JWT, extrai user_id
  → conexão entra em channels[user_id]
  → bot_pool.emit(user_id, evento) → broadcasta SÓ pro channels[user_id]
```

### `scoped()` helper

Superfície completa (todos os métodos que `routers/*.py`, `services/worker.py`, `services/bot_service.py` usam hoje no postgrest-py — auditados pelo grep `\.table\(.*\)\.` em todo o backend):

```python
# backend/app/db_scoped.py
TENANT_TABLES = {"v8_leads", "v8_bot_runs"}

def scoped(db, table_name: str, user_id: str):
    if table_name not in TENANT_TABLES:
        raise ValueError(f"{table_name} não é tabela tenant; use db.table() direto")
    return _ScopedQuery(db.table(table_name), user_id)

class _ScopedQuery:
    def __init__(self, q, user_id):
        self._q = q
        self._user_id = user_id

    # operações DML — owner_id forçado
    def select(self, cols="*"):
        return _wrap(self._q.select(cols).eq("owner_id", self._user_id), self._user_id)
    def insert(self, payload):
        if isinstance(payload, list):
            payload = [{**p, "owner_id": self._user_id} for p in payload]
        else:
            payload = {**payload, "owner_id": self._user_id}
        return _wrap(self._q.insert(payload), self._user_id)
    def update(self, payload):
        return _wrap(self._q.update(payload).eq("owner_id", self._user_id), self._user_id)
    def upsert(self, payload, on_conflict=None):
        if isinstance(payload, list):
            payload = [{**p, "owner_id": self._user_id} for p in payload]
        else:
            payload = {**payload, "owner_id": self._user_id}
        return _wrap(self._q.upsert(payload, on_conflict=on_conflict), self._user_id)
    def delete(self):
        return _wrap(self._q.delete().eq("owner_id", self._user_id), self._user_id)

    # filtros — passam direto, mas continuam scoped pq o owner_id já foi forçado acima
    def eq(self, col, val):     return _wrap(self._q.eq(col, val), self._user_id)
    def neq(self, col, val):    return _wrap(self._q.neq(col, val), self._user_id)
    def gt(self, col, val):     return _wrap(self._q.gt(col, val), self._user_id)
    def gte(self, col, val):    return _wrap(self._q.gte(col, val), self._user_id)
    def lt(self, col, val):     return _wrap(self._q.lt(col, val), self._user_id)
    def lte(self, col, val):    return _wrap(self._q.lte(col, val), self._user_id)
    def in_(self, col, vals):   return _wrap(self._q.in_(col, vals), self._user_id)
    def is_(self, col, val):    return _wrap(self._q.is_(col, val), self._user_id)
    def like(self, col, pat):   return _wrap(self._q.like(col, pat), self._user_id)
    def ilike(self, col, pat):  return _wrap(self._q.ilike(col, pat), self._user_id)
    def order(self, *a, **k):   return _wrap(self._q.order(*a, **k), self._user_id)
    def limit(self, n):         return _wrap(self._q.limit(n), self._user_id)
    def range(self, lo, hi):    return _wrap(self._q.range(lo, hi), self._user_id)
    def single(self):           return _wrap(self._q.single(), self._user_id)
    def maybe_single(self):     return _wrap(self._q.maybe_single(), self._user_id)

    def execute(self):          return self._q.execute()

def _wrap(q, user_id): return _ScopedQuery(q, user_id)
```

Se um método novo do postgrest aparecer e não estiver aqui, o test de lint (abaixo) falha forçando inclusão.

### Lint anti-bypass (AST, não regex)

Regex em `db.table("v8_leads")` é fácil escapar (`t = "v8_leads"; db.table(t)`). O test usa AST:

```python
# backend/tests/test_no_unscoped_tenant_access.py
import ast, pathlib
TENANT_TABLES = {"v8_leads", "v8_bot_runs"}
ALLOWLIST = {"backend/app/db_scoped.py", "backend/app/routers/webhook.py"}  # webhook resolve owner antes do scoped

def test_no_unscoped_tenant_table_access():
    offenders = []
    for py in pathlib.Path("backend/app").rglob("*.py"):
        rel = str(py.relative_to(".")).replace("\\","/")
        if rel in ALLOWLIST: continue
        tree = ast.parse(py.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) \
               and node.func.attr == "table" and node.args \
               and isinstance(node.args[0], ast.Constant) \
               and node.args[0].value in TENANT_TABLES:
                offenders.append(f"{rel}:{node.lineno} db.table({node.args[0].value!r})")
    assert not offenders, "Use scoped() em vez de db.table() pra tabelas tenant:\n" + "\n".join(offenders)
```

Variáveis (`t = "v8_leads"; db.table(t)`) ainda escapam, mas levantam o flag em code review — aceito como tradeoff (custo/benefício de full taint analysis não compensa).

### Bot pool (per-tenant) com tetos de capacidade

```python
# backend/app/banks/v8/bot_pool.py
class V8BotPool:
    def __init__(self):
        self._runs: dict[str, RunHandle] = {}  # user_id → RunHandle
        self._lock = asyncio.Lock()  # protege _runs em start/stop concorrentes

    async def start(self, user_id, num_workers, creds, db) -> RunHandle:
        async with self._lock:
            if user_id in self._runs:
                raise HTTPException(409, "bot já em execução")
            n = min(num_workers, settings.max_workers_per_user)
            total_running = sum(r.num_workers for r in self._runs.values())
            if total_running + n > settings.max_total_workers:
                raise HTTPException(503, f"capacidade do servidor cheia ({total_running}/{settings.max_total_workers}). Tente novamente em instantes.")
            handle = RunHandle(...)  # cria run em v8_bot_runs com owner_id=user_id (= initiator)
            self._runs[user_id] = handle
        return handle

    async def stop(self, user_id) -> None: ...
    def status(self, user_id) -> RunStatus | None: ...
    def emit(self, user_id, event) -> None: ...  # WS broadcast filtrado
```

Settings:
- `max_workers_per_user = 10` (default)
- `max_total_workers = 50` (default; teto global do processo pra não derrubar a VPS)

Singleton em `app.state.v8_pool`. `v8_bot_runs.owner_id` = user_id de quem deu start (initiator), nunca admin (mesmo que o admin tenha leads de muitos clientes — admin que rodar bot tem run só do admin).

### Token cache (lock por user)

5 workers do mesmo user spawnando juntos no primeiro `start` causariam 5 requests `/oauth/token` paralelos pra V8 (rate-limit/lock-out). Solução: lock por user com double-check pattern (mesmo padrão do `services/auth_service.py` antigo, mas indexado por user_id).

```python
# backend/app/banks/v8/auth.py
_token_cache: dict[str, tuple[str, datetime]] = {}  # user_id → (token, expires_at)
_locks: dict[str, asyncio.Lock] = {}
_locks_meta_lock = asyncio.Lock()

async def _lock_for(user_id: str) -> asyncio.Lock:
    async with _locks_meta_lock:
        if user_id not in _locks:
            _locks[user_id] = asyncio.Lock()
        return _locks[user_id]

async def get_token(user_id: str, login: str, password: str) -> str:
    cached = _token_cache.get(user_id)
    if cached and cached[1] > datetime.now() + timedelta(seconds=30):
        return cached[0]
    lock = await _lock_for(user_id)
    async with lock:
        # double-check: alguém pode ter populado enquanto esperávamos
        cached = _token_cache.get(user_id)
        if cached and cached[1] > datetime.now() + timedelta(seconds=30):
            return cached[0]
        token, expires_at = await _fetch_token(login, password)
        _token_cache[user_id] = (token, expires_at)
        return token

def invalidate(user_id: str) -> None:
    """Chamada em 401 OU 429 da V8 — força refetch no próximo get_token."""
    _token_cache.pop(user_id, None)
```

Workers chamam `invalidate(user_id)` em 401 (cred inválida) **e 429** (rate-limit/possível token comprometido). Cache cresce sem evict — aceito por enquanto (YAGNI). Em produção com >100 users simultâneos vira problema; resolvemos depois.

### Endpoints — mudanças resumidas

| Endpoint | Hoje | Depois |
|----------|------|--------|
| `POST /api/leads/upload` | insere sem owner | scoped insert com user_id |
| `GET /api/leads` | retorna tudo | scoped select |
| `GET /api/leads/export` | tudo (CSV) | scoped select (CSV) |
| `POST /api/leads/consult` | usa creds .env | usa creds do user |
| `POST /api/bot/start` | bot único global | pool.start(user_id) |
| `POST /api/bot/stop` | para o único | pool.stop(user_id) |
| `GET /api/bot/status` | status global | pool.status(user_id) |
| `GET /api/stats` | conta tudo | scoped count |
| `POST /api/webhook/v8` | update direto | resolve owner via consult_id, scoped update |
| `WS /ws` | broadcast geral | channel por user_id |

## Tratamento de erros

| Cenário | Resposta |
|---------|----------|
| User sem credencial V8 ao iniciar bot | `400 {"detail": "credenciais V8 não cadastradas em /api/credentials"}` |
| User sem credencial V8 ao consultar individual | `400 {"detail": "credenciais V8 não cadastradas"}` |
| Login/senha inválidos na V8 | `401 {"detail": "credenciais V8 rejeitadas pela API V8"}` + invalida cache do user |
| Rate-limit V8 (429) | invalida cache do user, retry com backoff exponencial; persistente → marca lead `erro` |
| User já tem bot rodando | `409 {"detail": "bot já em execução"}` |
| Capacidade global cheia (>= max_total_workers) | `503 {"detail": "servidor cheio, tente novamente"}` |
| Webhook com consult_id desconhecido | `404`, log info, ignora |
| Tentativa de query sem scoped() | pytest CI falha antes do deploy |

## Testes (TDD obrigatório)

### Isolamento (críticos — exigência do usuário)

1. **`test_isolation_leads_select`** — user A insere lead, user B faz GET /api/leads → não vê
2. **`test_isolation_leads_export`** — user A insere lead, user B faz GET /api/leads/export → CSV vazio
3. **`test_isolation_stats`** — user A tem 10 leads, user B tem 5; cada um vê só os seus
4. **`test_isolation_bot_runs`** — user A inicia bot, user B vê pool vazio pra ele
5. **`test_isolation_webhook_resolves_correct_owner`** — webhook com consult_id de A só atualiza lead de A
6. **`test_isolation_ws_channel`** — evento emitido pra user A não chega no socket de user B
7. **`test_cpf_duplicado_entre_tenants`** — user A e B podem ter o mesmo CPF (rows separadas)

### Sem fallback

8. **`test_bot_start_sem_credencial`** — 400, bot não inicia
9. **`test_consult_individual_sem_credencial`** — 400
10. **`test_credencial_invalida_invalida_cache`** — 401 da V8 limpa entry do cache

### Migration / backfill

11. **`test_backfill_atribui_admin`** — registros pré-existentes ficam com owner_id = admin
12. **`test_cpf_unique_por_owner`** — UNIQUE(cpf, owner_id) funciona; UNIQUE global removido

### Lint

13. **`test_no_unscoped_tenant_table_access`** — pytest grep: falha se acharem `db.table("v8_leads")` ou `db.table("v8_bot_runs")` em arquivos fora de `db_scoped.py` e tests

### Pool

14. **`test_pool_dois_users_paralelo`** — A e B startam, ambos status=running
15. **`test_pool_user_segundo_start_409`** — A startou, A startou de novo → 409
16. **`test_pool_stop_isolado`** — A para, B continua
17. **`test_pool_capacidade_global_503`** — preencher até `max_total_workers`, próximo start retorna 503

### Concorrência de token

18. **`test_token_lock_serializa_fetch`** — 5 chamadas paralelas a `get_token(user_id)` causam só 1 `_fetch_token` (mock contador)
19. **`test_token_429_invalida_cache`** — V8 retorna 429 → cache do user limpo → próximo get_token refetch

## Riscos

| Risco | Mitigação |
|-------|-----------|
| Refactor toca core do bot, pode quebrar prod | Cada arquivo migrado em commit separado, suite de testes antes; shims em `services/` durante transição |
| Migration em prod com dados existentes | Runbook manual com backup antes; aplicar fora do horário comercial |
| `service_role` bypassa RLS | `scoped()` obrigatório + pytest CI grep como gate |
| Cache de token cresce sem evict | Aceito por ora; flag em `MEMORY.md` pra revisitar quando >100 users |
| Bot pool em memória — reinício do container perde runs | Aceito (mesmo comportamento do hoje); persistir no Plano 5 |
| Webhook resolve owner via consult_id; se 2 leads diferentes têm mesmo consult_id (bug histórico) | UNIQUE em consult_id já existe? verificar; se não, adicionar na migration |

## Fora de escopo (planos seguintes)

- VCTex (Plano 3)
- UI de credenciais (Plano 4)
- Remoção de shims `services/auth_service.py`, `services/worker.py` (Plano 5)
- Remoção de `settings.v8_username/password/proxy_list` (Plano 5)
- Persistência de bot runs entre restarts (futuro)
- Eviction de cache de token (futuro)

## Critérios de sucesso

- ✅ Todos os 16 testes passam
- ✅ Pytest de lint impede regressão
- ✅ Em ambiente local: 2 users diferentes podem ter credenciais V8 diferentes, rodam bots em paralelo, dados isolados
- ✅ User sem credencial cadastrada recebe 400 ao tentar qualquer ação que dependa de V8
- ✅ Migration aplicável em prod com runbook documentado
