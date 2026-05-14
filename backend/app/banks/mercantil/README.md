# Mercantil Bot — Documentação Técnica

Implementação 2026-05-12 | 3º banco do Acelera Corban (ao lado de V8 e VCTex)

## TL;DR

Bot Playwright que automatiza consultas de crédito CLT no portal Meu Mercantil
(convênio MINISTERIO DO TRABALHO E EMPREGO MTE). Particularidade vs V8/VCTex:
**login requer SMS 2FA humano de 6 dígitos**, resolvido via ponte Redis BLPOP/RPUSH
entre worker Playwright e modal frontend.

---

## Arquivos do módulo

| Arquivo | Linhas | Função |
|---------|--------|--------|
| `config.py` | ~110 | Seletores CSS, URLs, timeouts, DDDs válidos, `gerar_celular_aleatorio()` |
| `humanize.py` | ~40 | Delays + User-Agents (cópia verbatim de vctex) |
| `credentials_helper.py` | ~15 | `get_mercantil_runtime_creds(user_id, db)` |
| `sms_bridge.py` | ~100 | Redis BLPOP/RPUSH (`request_sms_code`, `submit_sms_code`) + state |
| `engine.py` | ~290 | `MercantilEngine` — Playwright lifecycle, `login_with_sms()`, storage_state |
| `phases.py` | ~450 | `fase1_consultar_cpf`, `fase2_aguardar_produtos`, `fase3_autorizar_dataprev`, `fase4_simular` |
| `worker.py` | ~210 | `MercantilLeadWorker` — login uma vez, processa queue de CPFs |
| `bot_pool.py` | ~80 | `MercantilBotPool` (1 worker/user, 4 totais default) |
| `MAPEAMENTO.md` | ~250 | Documentação visual do portal (screenshots + seletores) |

Externamente referenciado:
- `backend/app/services/mercantil_upload_jobs.py` — CSV upload
- `backend/app/services/mercantil_bot_service.py` — orquestração + broadcast events
- `backend/app/routers/mercantil.py` — 18 endpoints REST (incluindo `/bot/sms` + `/bot/sms/state`)
- `frontend/src/components/MercantilSmsModal.tsx` — modal 6 dígitos
- `frontend/src/hooks/useMercantilSmsBridge.ts` — WS listener + mount recovery
- `migrations/020_mercantil.sql` — 3 tabelas + RLS

---

## Fluxo end-to-end

```
[Frontend] Upload CSV → POST /api/mercantil/leads/upload
                       → mercantil_upload_jobs cria batch + insere mercantil_leads (status=pendente)

[Frontend] Click "Iniciar Bot Mercantil"
                       → POST /api/mercantil/bot/start
                       → bot_service.start_bot() cria run + spawn worker

[Worker] engine.start(headless=True)
       → engine.new_context(user_id)
                  └─ se tem .bot_state/mercantil/<user>.json: load storage_state
       → page = ctx.new_page()
       → engine.login_with_sms(page, user_id, run_id, emit)
                  └─ tenta goto /dashboard direto (storage_state pode ter sessão)
                  └─ se /login, fluxo full:
                        ① page.fill(user/pass) + click "Entrar"
                        ② race: dashboard OU SMS screen
                        ③ se SMS: emit {sms_required} via Redis bot:events
                        ④ sms_bridge.request_sms_code(timeout=300s)  ← BLPOP

[Frontend] WS recebe sms_required → MercantilSmsModal abre
[User]     Digita 6 dígitos → POST /api/mercantil/bot/sms {run_id, code}
[Backend]  routers/mercantil.submit_sms valida run ownership + RPUSH na fila

[Worker] BLPOP destrava → fills 6 inputs → click "Verificar código"
       → race: dashboard (✓) OU SMS de novo (código errado)
       → se errado: emit sms_wrong_code → loop (max 3 tentativas)
       → se ✓: save storage_state pra próximas runs sem SMS

[Worker loop por CPF]
  ensure_logged_in(page) ← detecta sessão expirou
  fase1_consultar_cpf(page, cpf)
    ├─ Cenário A → fase4_simular(page, uuid)
    └─ Cenário B → fase3_autorizar_dataprev → fase2_aguardar_produtos → fase4_simular

  resultado: elegivel (11 campos extraídos) OR inelegivel (motivo) OR erro
  → save em mercantil_leads via scoped(db, "mercantil_leads", user_id).update()
  → emit lead_result em bot:events
  → jitter humano 8-16s
```

---

## Cenários de portal (Angular Material)

### Cenário A — lead já autorizado
```
/dashboard
  → "Digite aqui uma nova proposta"
  → /simular-proposta (form mat-select + input com mask)
  → Consultar → "Nova operação"
  → /consignado-privado/{UUID}     ← captura UUID
  → "Produtos disponíveis" visível
  → Iniciar Contrato Novo
  → /simulacao/{UUID}/simulacao
  → Simular
  → resultado (elegível ou inelegível)
```

### Cenário B — lead não autorizado (requer DataPrev/Plurio)
```
... mesmo fluxo até "Nova operação"
  → /solicitar-dataprev/{UUID}     ← URL diferente identifica cenário
  → preenche telefone (random se vazio) + Solicitar
  → /consignado-privado/{UUID} mostra QR + link curto bml.b.br/XXXXX
  → bot copia link → ctx.new_page() → goto link
                              [DOMÍNIO DIFERENTE: autorizacoesdigitais.meu.bancomercantil.com.br]
                              [GEOLOCATION OBRIGATÓRIA — context tem permissions=['geolocation']]
  → Etapa 1/2: marca input.mdc-checkbox__native-control → click Iniciar
  → Etapa 2/2: marca checkbox (ID se reutiliza) → click Autorizar
  → div#sucesso aparece → fecha aba
  → polling /consignado-privado/{UUID} até "Produtos disponíveis" (até 5 min)
  → resto igual cenário A
```

---

## Mensagens conhecidas

### Elegível (11 campos extraídos)
- `strong.valorLiberado` (texto formato `R$ 13.012,36`)
- `input[currencymask][placeholder="R$ 0,00"]` → valor_parcela
- `input[type="number"][min="1"][max="48"]` → prazo
- Label traversal em "Resumo da operação": valor_financiado, valor_emprestimo,
  qtd_parcelas, taxa_juros_mes, valor_iof, capital_segurado,
  valor_seguro_prestamista, data_vencimento

### Inelegível (mensagens visíveis após Simular)
| Mensagem exata | Motivo |
|---------------|--------|
| `Trabalhador não possui margem disponível.` | sem margem consignável |
| `Simulação não atendida pela política de crédito no momento.` | reprovado por política |

Bot detecta via regex case-insensitive `(não possui margem|política de crédito)`.

---

## SMS Bridge — design detalhado

### Por que Redis LIST (BLPOP/RPUSH) e não pub/sub

| Modelo | Drop risk | Restart survival | Multi-tenant |
|--------|-----------|------------------|--------------|
| LIST (escolhido) | **Zero** — fila enfileira | List persiste | Key por user+run |
| Pub/sub | **Alto** — broadcast só notifica subscribers presentes | Não | Channel namespacing |
| asyncio Futures in-mem | Zero (intra-process) | **Sai com restart** | dict por user |
| Postgres LISTEN/NOTIFY | Médio | OK | Channel namespacing |

Requisito explícito do user: "ESSA PARTE DO SMS TEM QUE FUNCIONAR" → LIST é o único modelo sem drop window.

### Chaves Redis

```
mercantil:sms:code:<user_id>:<run_id>    # LIST — código(s) enviados pelo user
                                          # TTL 600s
                                          # Worker BLPOPs, frontend RPUSHs
                                          
mercantil:sms:state:<user_id>:<run_id>   # STRING — JSON {"status": "waiting"|...}
                                          # TTL variável (waiting=300s, done=5s, etc)
                                          # Frontend GET via /bot/sms/state pra recovery
```

### Estados possíveis (`SmsState` literal)
- `waiting` — bot em BLPOP, modal pendente
- `submitting` — frontend acabou de POSTar código
- `wrong` — portal rejeitou; bot vai re-tentar
- `timeout` — BLPOP expirou (sem código em 5min)
- `done` — login OK, modal pode dismiss
- `max_attempts` — 3 erros consecutivos, run falha

### Recovery on tab reload

`useMercantilSmsBridge.ts` no mount:
1. `GET /api/mercantil/bot/status` → tem run rodando?
2. Se sim → `GET /api/mercantil/bot/sms/state?run_id=X`
3. Se `status == "waiting"` → mostra modal de novo

Sem isso, user reload de aba enquanto SMS pending = bot trava no BLPOP até timeout (5min). Com recovery, modal reaparece em <1s.

---

## Storage state (cookies persistidos)

### Path
```
.bot_state/mercantil/<user_id>.json
```
Path relativo ao cwd:
- **Local (cd backend && uvicorn ...)** → `./backend/.bot_state/mercantil/`
- **Docker (WORKDIR=/app, volume `./backend:/app`)** → `/app/.bot_state/mercantil/` que mapeia em `./backend/.bot_state/` no host
- **Override:** env var `MERCANTIL_STATE_DIR` aceita absoluto

### Lifecycle
1. **1ª run de um user:** sem state → fluxo SMS completo → save state
2. **2ª+ runs:** load state → goto /dashboard → se sessão válida, pula SMS
3. **Mid-batch session expire:** `ensure_logged_in()` detecta /login → delete state → relogin (novo SMS)

### Sensibilidade
Cookies podem dar acesso ao portal sem credenciais (~24h típico). **NUNCA committar.**
`.gitignore` cobre `.bot_state/` e `backend/.bot_state/`.

---

## Geolocalização

Página Plurio (`autorizacoesdigitais.meu.bancomercantil.com.br`) **exige** permissão
de geolocalização — sem isso, botão "Iniciar" fica desabilitado.

`engine.new_context()` concede automaticamente:
```python
permissions=["clipboard-read", "clipboard-write", "geolocation"]
geolocation={"latitude": -23.5505, "longitude": -46.6333}  # São Paulo
```

---

## Multi-worker considerations

Default `mercantil_max_workers_per_user=1` porque:
- Cada worker abre Chromium próprio (~300MB RAM)
- Cada worker triggera SMS humano no login (multi-SMS = ruim UX)
- Single session do portal pode ser dropada com 2 logins paralelos

Para aumentar: editar `config.py:Settings.mercantil_max_workers_per_user`. Cada worker
adicional vai pedir SMS separado. Não recomendado em v1.

---

## Status enum (`mercantil_leads.status`)

```
pendente             → CSV inserido, ainda não processado
fase1_consulta       → worker está em /simular-proposta
fase2_check_auth     → em /consignado-privado/{UUID} verificando cenário
fase3_dataprev       → em /solicitar-dataprev/{UUID} (cenário B)
aguardando_autorizacao → Plurio assinado, polling produtos
fase4_simular        → em /simulacao/{UUID}/simulacao
elegivel             → resultado final ✓
inelegivel           → resultado final ✗ (com motivo em campo `erro`)
erro                 → falha técnica (retry-errors reseta pra pendente)
```

---

## Endpoints REST

| Método | Path | Descrição |
|--------|------|-----------|
| POST | `/api/mercantil/leads/upload` | Upload CSV (job_id + batch_id) |
| GET | `/api/mercantil/leads/upload/{job_id}` | Polling status upload |
| GET | `/api/mercantil/leads/` | List leads (paginado) |
| GET | `/api/mercantil/leads/export` | Download CSV elegíveis |
| POST | `/api/mercantil/leads/retry-errors` | Reset status=erro → pendente |
| POST | `/api/mercantil/bot/start` | Inicia bot (workers, batch_id) |
| POST | `/api/mercantil/bot/stop` | Para bot |
| GET | `/api/mercantil/bot/status` | Estado atual do run |
| GET | `/api/mercantil/bot/events` | Eventos recentes (REST fallback p/ WS) |
| GET | `/api/mercantil/bot/runs` | Histórico de runs |
| **POST** | **`/api/mercantil/bot/sms`** | **Envia código SMS (frontend modal)** |
| **GET** | **`/api/mercantil/bot/sms/state`** | **Consulta estado SMS (recovery)** |
| GET | `/api/mercantil/stats/dashboard` | Stats agregadas |
| GET | `/api/mercantil/batches/` | List batches |
| GET | `/api/mercantil/batches/current` | Batch ativa |
| GET | `/api/mercantil/batches/{id}` | Get batch |
| GET | `/api/mercantil/batches/{id}/stats` | Stats da batch |
| PATCH | `/api/mercantil/batches/{id}` | Rename/cancel batch |
| DELETE | `/api/mercantil/batches/{id}` | Delete batch + leads |

---

## Test plan local

```bash
# 1. Aplicar migration (uma vez)
# Via Supabase Dashboard SQL Editor ou via supabase CLI:
# psql ... < migrations/020_mercantil.sql

# 2. Subir stack
cd ~/projetos/ACELERA\ CORBAN
docker compose up -d

# 3. Cadastrar credenciais (browser)
# http://localhost:3002 → toggle Mercantil → Configurações
# Login: 35275CF.GABRIEL
# Senha: zZB|;v8eoe5~J1$[_4/_%

# 4. Testar
# Higienização → upload CSV pequeno (3 CPFs)
# Iniciar Bot → modal SMS aparece quando bot pedir
# Digita 6 dígitos do celular -5744
# Bot processa → veja resultados no dashboard

# 5. Exportar elegíveis
# Aba Histórico → download CSV da batch
```

---

## Troubleshooting

### Bot trava em "Aguardando código SMS"
- Verifica se `/api/mercantil/bot/sms/state?run_id=X` retorna `{"status":"waiting"}`
- Verifica logs do worker: deve ter linha `mercantil sms_bridge.request waiting`
- Frontend modal apareceu? Se sim, código está sendo digitado e POSTado?
- Verifica Redis: `redis-cli LLEN mercantil:sms:code:<user>:<run>` deve crescer
- Se passou 5min sem código, bot retenta automaticamente (até 3x)

### "Trabalhador não possui margem disponível" pra CPFs que deveriam ser elegíveis
- CPF realmente sem margem (CLT recente, salário todo comprometido)? Normal
- Ou portal está com lentidão DataPrev — bot pega state stale do pipeline
- Workaround: retry-errors + esperar (DataPrev às vezes leva mais que os 5min de polling)

### `ModuleNotFoundError: app` ao testar localmente
- Pre-existente em `broadcast.py` (usa `from app.config` em vez de `..config`)
- Solução: rodar com `cd backend && PYTHONPATH=. python ...` ou via docker

### Cookies não persistem entre runs
- Verifica `ls .bot_state/mercantil/` — `<user_id>.json` existe?
- Permissões: bot precisa write access nesse diretório
- Em docker, volume deve estar montado: `./backend:/app` ou path explícito

---

## Próximas melhorias possíveis

- **Headless mode opcional** — `headed=True` pra debug local com browser visível
- **Pre-cadastro DataPrev em batch** — gerar TODOS os links primeiro, autorizar paralelamente, depois simular (reduz tempo total)
- **Retry com backoff** em fase3 quando Plurio falha (não há retry automático hoje)
- **Multi-correspondente** — hoje só 1 conta Mercantil; suportar contas diferentes por user_id (passa pela alteração de `MercantilEngine` pra aceitar storage_state path por (user, account))
- **Frontend tab "Mercantil"** dentro de Higienização (atualmente toggle global)

---

## Referências

- Mapeamento visual: [MAPEAMENTO.md](./MAPEAMENTO.md)
- Obsidian: `~/Documents/Obsidian Vault/BASE DE CONHECIMENTO/ACELERA CORBAN — Mercantil Bot 12-05-2026.md`
- Memória Claude: `~/.claude/projects/-Users-macbookdegabriel/memory/project_mercantil_bot.md`
