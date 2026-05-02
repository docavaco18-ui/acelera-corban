# VCTex Port — Implementation Plan

**Goal:** Portar a lógica VCTex (do projeto antigo `~/projetos/vctex/`) pro ACELERA CORBAN seguindo a mesma arquitetura multi-tenant + batch do V8.

**Diferença crítica vs V8:** VCTex é **Playwright-based** (browser automation), não API REST. Cada worker abre um Chromium isolado, faz login UI, navega phases (fase0/fase1/fase2). Isso muda muito a infra:
- Docker image precisa Chromium + dependências
- Workers consomem RAM significativa (~150-300MB cada)
- Pool global precisa ser mais conservador (`max_total_workers` menor pra VCTex)
- Latência por lead é maior (segundos vs ms)

**Source de referência:** `~/projetos/vctex/backend/app/`
- `bot/engine.py` (127L) — Chromium launch + login portal
- `bot/phases.py` (508L) — fluxo das 3 fases (consulta CPF, simulação, contratação)
- `bot/worker.py` (190L) — worker loop
- `services/bot_service.py` (245L) — orchestration
- `routers/{bot,cpf,stats,ws}.py` — endpoints

## Pré-requisitos

- ✅ Migration 006 (schema vctex_batches + batch_id) — criada, **não aplicada em prod**
- ✅ Tabelas vctex_leads, vctex_bot_runs já existem (do 002_multibank)
- ✅ db_scoped já suporta vctex_leads/vctex_bot_runs no TENANT_TABLES após task 1 abaixo

## Decisões de arquitetura (recomendadas)

1. **Pool separado:** `VCTexBotPool` em `app/banks/vctex/bot_pool.py`, com tetos próprios (ex: `max_workers_per_user_vctex=2`, `max_total_workers_vctex=10`). Compartilhar `app.state` mas instâncias separadas.

2. **Routers paralelos:** `/api/vctex/{leads,bot,stats,batches}` espelhando V8. Frontend tem seletor de banco no topo (V8 / VCTex), URL params `?bank=vctex` ou rotas paralelas.

3. **Credenciais:** já temos `bank_code='vctex'` em `user_bank_credentials`. `get_vctex_runtime_creds(user_id, db)` análogo ao V8.

4. **Auth:** VCTex login é UI (`engine.login_page()`), sem token cache global. Sessão fica no Playwright context per worker. Não precisa cache módulo-level como V8.

5. **Webhook:** VCTex não tem webhook — todo polling/reading é via UI. Pular essa parte.

6. **Docker:** Adicionar `playwright` ao `requirements.txt` e rodar `playwright install --with-deps chromium` no Dockerfile. Imagem base `python:3.12-slim-bookworm` precisa de mais libs (libnss3, libatk1.0, etc — playwright manda).

## Tasks

### T1: db_scoped já cobre vctex_*
Validar que `TENANT_TABLES` inclui `vctex_leads`, `vctex_bot_runs`, e adicionar `vctex_batches`:
```python
TENANT_TABLES = {"v8_leads","v8_bot_runs","v8_batches","vctex_leads","vctex_bot_runs","vctex_batches"}
```
Atualizar teste `test_tenant_tables_constant`.

### T2: Migration 006 em prod
Aplicar via Supabase MCP (idempotente, aditivo). Verifica:
- `vctex_batches` existe
- `vctex_leads.batch_id` existe (nullable, FK)
- 3 policies RLS ativas

### T3: `app/banks/vctex/credentials_helper.py`
Cópia do V8 com `bank_code='vctex'`:
```python
def get_vctex_runtime_creds(user_id, db) -> BankCredentials:
    creds = CredentialService(db).get(user_id, "vctex")
    if not creds or not creds.login or not creds.password:
        raise HTTPException(400, "credenciais VCTex não cadastradas...")
    return creds
```
4 testes paralelos aos do V8.

### T4: `app/banks/vctex/engine.py` + `phases.py` + `humanize.py` + `config.py`
Copiar dos arquivos do projeto vctex original. Mudanças:
- `BotEngine.__init__` aceita `proxy_url` por user (já aceita) — usar `creds.proxies[worker_id % len]`
- Phases que escrevem em DB devem usar `scoped(db, "vctex_leads", user_id)` em vez de `db.table()` direto.

### T5: `app/banks/vctex/worker.py` — VCTexLeadWorker per-user
Estrutura espelhando `app/banks/v8/worker.py`:
```python
class VCTexLeadWorker:
    def __init__(self, worker_id, user_id, creds, db, on_event, batch_id=None):
        self.worker_id = worker_id
        self.user_id = user_id
        self.creds = creds
        self.db = db
        self.batch_id = batch_id
        self.engine = BotEngine(creds.login, creds.password, proxy_url=...)
    async def process(self, lead): ...  # roda phases.run(...)
```
Engine reusable per worker (start/stop por run).

### T6: `app/banks/vctex/bot_pool.py` — VCTexBotPool
Cópia adaptada do V8BotPool com tetos próprios.

### T7: `app/services/vctex_bot_service.py` (ou unificar?)
Espelha `app/services/bot_service.py`. Per-user runtime, fila Redis, scope batch_id.

### T8: Routers paralelos
- `app/routers/vctex_leads.py` — upload CSV (vctex_leads), list, export
- `app/routers/vctex_bot.py` — start/stop com `?batch_id=`
- `app/routers/vctex_stats.py` — dashboard scoped vctex_leads
- `app/routers/vctex_batches.py` — espelho do batches.py mas pra vctex
- Registrar em `main.py`. Pool: `app.state.vctex_pool = VCTexBotPool()`.

### T9: Dockerfile playwright
```dockerfile
FROM python:3.12-slim-bookworm
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    playwright install --with-deps chromium
COPY . .
```
Imagem fica ~1.5GB (vs ~250MB hoje). Build time ~5min (vs ~1min). VPS Hostinger KVM2 tem 100GB NVMe, ok.

### T10: Settings do Playwright
- `vctex_max_workers_per_user`, `vctex_max_total_workers` (defaults 2, 10)
- Variáveis VCTex no .env: `VCTEX_PORTAL_URL`, etc (já no projeto vctex original)
- Documentar no `.env.example`

### T11: Frontend — seletor de banco
Adicionar global state (zustand ou context) `selectedBank: 'v8' | 'vctex'`. TopBar mostra dropdown. Routes/API calls passam param ou prefixo.

Alternativa mais simples: rotas paralelas `/v8/higienizacao`, `/vctex/higienizacao` etc. Dashboard agregado tem seletor inline.

### T12: Testes E2E paralelos
- `test_vctex_credentials_helper.py` (4 testes)
- `test_vctex_isolation_e2e.py` (5 testes paralelos ao V8)
- AST lint atualizado pra incluir `vctex_leads`, `vctex_bot_runs`, `vctex_batches` no banlist

### T13: Deploy
1. Push origin
2. User redeploy (web terminal): build vai demorar mais (Chromium install)
3. Aplicar migration 006 via Supabase MCP
4. Cadastrar cred VCTex via PUT /api/credentials/vctex (ainda manual via curl)
5. Smoke: GET /api/vctex/batches/, etc

## Riscos

- **Imagem Docker triplica de tamanho.** Tempo de build/pull aumenta. Considerar layer separada pra Chromium (multi-stage com cache).
- **VPS KVM2 8GB RAM.** Cada Chromium ~300MB. Pool de 10 workers global = 3GB. Bot V8 também consome. Cuidado com OOM.
- **Playwright é frágil em headless.** Selectors podem quebrar com mudanças de UI VCTex. Tem retry built-in mas vale validar com run pequeno antes de escala.
- **Cred VCTex é UI login** — diferentes daquela do V8 (que era OAuth/API). Pode haver MFA/captcha em algum momento. O bot original não trata.

## Estimativa

Trabalho total: 4-6 horas focadas. Tasks 1-2 são triviais (10min). Tasks 3-7 são copy+adapt do V8 (1-2h). Task 8 é boilerplate de roteamento (1h). Tasks 9-10 envolvem Dockerfile + settings (30min). Task 11 é frontend (1-2h dependendo da abordagem). Task 12-13 fechamento (1h).

## Suite final esperada

- ~9 novos testes (vctex_credentials_helper, vctex_bot_pool, vctex_isolation_e2e)
- AST lint com 6 tabelas tenant
- Build Docker passa com Chromium
- Smoke em prod: GET /api/vctex/batches retorna []
