# ACELERA CORBAN — Instruções para Codex

## Modo de trabalho

**Modo autônomo.** Não pedir confirmação pra edits e bash. Só perguntar antes de:
- Deletar arquivos ou diretórios
- `git reset --hard`, `git push --force`, `--no-verify`
- Dropar tabelas, truncate, migrations destrutivas
- Ações irreversíveis em produção (VPS, Cloudflare, Supabase)
- Mudanças que afetam outros usuários (ex: alterar credenciais alheias)

Em tudo que é local/reversível: tomar decisão e executar.

## Contexto rápido

- Stack: FastAPI (Python 3.12) + React/Vite + Supabase + Redis
- Local dev: ports 3004 (front), 8003 (back), 6381 (redis) — CODEX fork; original usa 3002/8002
- Produção: VPS Hostinger 177.7.58.154, domínio `aceleracorban.com.br` (Caddy + Cloudflare)
- Detalhes completos: `PROGRESS.md` (gitignored, tem credenciais)
- Spec do refactor multi-banco em curso: `docs/superpowers/specs/2026-05-02-multibank-refactor-design.md`

## Convenções

- Commits: português, prefixo `feat:`/`fix:`/`docs:`/`chore:` etc, descrição curta no "porquê"
- Co-author em commits: `Co-Authored-By: Codex Opus 4.7 (1M context) <noreply@anthropic.com>`
- Backend: tudo em `backend/app/`, módulos por banco em `backend/app/banks/<code>/`
- Frontend: pages em `frontend/src/pages/`, componentes por banco em `frontend/src/banks/<code>/`

## Disparo WhatsApp (broadcast)

- Router: `backend/app/routers/broadcast.py`
- Componentes UI: `frontend/src/components/disparo/`
  - `MonitorPanel.tsx` (poll 30s `/api/broadcast/snapshot`)
  - `CampaignHistoryList.tsx` (histórico estilo V8/VCTex)
  - `CsvUploadWizard.tsx` (wizard com variáveis `{{N}}`, preview)
  - `NumberQualityGrid.tsx`, `DispatchMetrics.tsx`, `AlertFeed.tsx`
- Services: `backend/app/services/broadcast/`
  - `meta_client.py` (Meta Graph v19.0)
  - `vendeai_client.py` (BFF JWT + IA API)
  - `claude_advisor.py` (split proporcional a daily_limit, filtra elegíveis)
  - `monitor_loop.py` (leader-elected via Redis SETNX)
  - `intervention.py` (auto-pause em red quality)
- **CSV fatiado por `planned_count`** antes de enviar pra cada número (evita VendeAI dedup)
- **Strip BOM UTF-8** sempre (Excel adiciona)
- **`crypto.safe_decrypt()`** para credentials que podem ter sido salvas com chave Fernet antiga
- Migrations broadcast: 013-019 (todas aplicadas)

### Bugs corrigidos — sessão 2026-06-03

#### `monitor_loop.py`
- Bug: `"now()"` como string literal em vez de timestamp real → Supabase armazenava a string.
  Fix: helper `_utcnow()` retorna `datetime.now(timezone.utc).isoformat()`.
- Bug: poll de mailings não paginava → perdia campanhas ativas.
  Fix: carrega IDs ativos do DB, itera VendeAI até encontrar todos.
- Melhoria: cache de `VendeAIClient` em `_vendeai_cache: dict[str, VendeAIClient]` keyed por `f"{owner_id}:{email}"`.

#### `intervention.py` — `_attempt_failover`
- Bug: novo assignment criado sem `template_id`, `inbox_id`, `display_phone`, `quality_at_start` → VendeAI nunca disparava.
  Fix: copia todos os campos do assignment falho pro novo.
- Bug: falha silenciosa quando nenhum número GREEN disponível.
  Fix: cria alert `failover_no_backup` visível no AlertFeed.
- Regra nova: só faz failover se número backup tem `chatwoot_connected=True`.

#### `broadcast.py` — novo endpoint
```
POST /api/broadcast/numbers/{phone_id}/resume
```
Despausa número (seta `is_paused=False`). Antes o botão "Retomar" no `NumberQualityGrid` chamava `loadData` ignorando o `phone_id`.

#### `frontend/src/hooks/useBroadcastWebSocket.ts`
- Reescrito com reconexão por exponential backoff: 1s → 2s → 4s → ... → 30s max.
- `destroyedRef` impede reconexão após unmount do componente.
- `ws.onerror` chama `ws.close()` para acionar o path de reconexão via `onclose`.

#### `frontend/src/lib/api.ts`
```typescript
resumeNumber: (phoneId: string) => broadcastAxios.post(`/api/broadcast/numbers/${phoneId}/resume`)
```

#### `frontend/src/pages/Disparo.tsx`
```typescript
const handleResumeNumber = async (phoneId: string) => {
  await broadcastApi.resumeNumber(phoneId);
  await loadData();
};
// onResume={handleResumeNumber}  ← era onResume={loadData} (ignorava phone_id)
```

## Banco Mercantil (3º banco — 2026-05-13)

### Credenciais portal
- **URL:** `https://meu.bancomercantil.com.br/login`
- **Login:** ver `PROGRESS.md` (gitignored)
- **Senha:** ver `PROGRESS.md` (gitignored)
- **SMS 2FA:** código 6 dígitos pro celular final (ver PROGRESS.md)

### Arquitetura — BFF Bridge via page.evaluate (decisão 2026-05-13)

**Problema resolvido:** reCAPTCHA Enterprise score-based bloqueava form submit silenciosamente (0 POST após click Consultar). Solução: chamar BFF de dentro do contexto JS autenticado do Playwright.

**Fluxo:**
```
login_with_sms (Playwright, 1x por sessão)
  → fase1_consultar_cpf_api (por CPF):
      wait_for_function(JWT no localStorage)
      → bff_bridge.consultar_cpf(page, cpf):
          page.evaluate(fetch(GET /Convenios/Publicos))
          page.evaluate(fetch(POST /PropostasProspect/IniciarOperacao))
          ↳ tokenValidoConsignadoPrivado=true → Cenário A:
              poll page.evaluate(fetch(GET /PropostasProspect/{uuid}/Detalhes))
              page.evaluate(fetch(GET /PropostasProspect/{uuid}/SimulacaoDetalhes))
              → {status: elegivel, valor_liberado, valor_parcela, ...} COMPLETO
          ↳ tokenValidoConsignadoPrivado=false → Cenário B:
              goto /solicitar-dataprev/{uuid}
              fase3_autorizar_dataprev (Playwright + Plurio)
              fase2_aguardar_produtos + fase4_simular (Playwright)
```

**Por que funciona:** `page.evaluate(fetch(...))` executa no contexto JS de `meu.bancomercantil.com.br`. Origin correto → CORS aceito. JWT extraído do localStorage. reCAPTCHA handler Angular nunca dispara (sem DOM interaction).

### Arquivos-chave
- **Backend:** `backend/app/banks/mercantil/` — config, engine, phases, worker, bot_pool, sms_bridge, bff_bridge (NOVO), bff_client
- **Services:** `services/mercantil_upload_jobs.py`, `services/mercantil_bot_service.py`
- **Router:** `routers/mercantil.py` (prefix `/api/mercantil/*`, 18 endpoints)
- **Frontend:** `components/MercantilSmsModal.tsx`, `hooks/useMercantilSmsBridge.ts`
- **DB:** `mercantil_leads`, `mercantil_batches`, `mercantil_bot_runs` (migration 020 — **aplicar**)
- **Pool:** `app.state.mercantil_pool = MercantilBotPool()`, default 1 worker/user

### BFF Endpoints
- **Base:** `https://api.mercantil.com.br:8443/pcb/sitebff/api`
- `GET /Convenios/Publicos` → lista convênios (MTE = "MINISTERIO DO TRABALHO E EMPREGO MTE")
- `POST /PropostasProspect/IniciarOperacao` → uuid + tokenValidoConsignadoPrivado
- `GET /PropostasProspect/{uuid}/Detalhes` → poll situacaoConsulta
- `GET /PropostasProspect/{uuid}/SimulacaoDetalhes` → dados financeiros

### SMS bridge (CRÍTICO — não pode falhar)
Modelo: **Redis BLPOP/RPUSH** (durável — não perde código se user enviar antes do bot pedir).

```
Worker → tela SMS → emit sms_required → BLPOP mercantil:sms:code:U:R timeout=300s
Frontend modal → user digita → POST /api/mercantil/bot/sms → RPUSH
Worker destrava → fills 6 inputs → Verificar → dashboard (sucesso) ou sms (errado, max 3x)
```

**Recovery on tab reload:** `useMercantilSmsBridge.ts` polla `GET /api/mercantil/bot/sms/state` no mount.

### Storage state + JWT
- **Storage state:** `.bot_state/mercantil/<user_id>.json` — cookies de sessão (reusa entre runs)
- **JWT cache:** `.bot_state/mercantil/last_jwt.json` — salvo automaticamente após login
- **Env override:** `MERCANTIL_STATE_DIR` (absoluto se montar volume separado)
- **Invalidação:** mid-batch se URL = `/login` → drop file → relogin

### Geolocalização
Plurio (`autorizacoesdigitais.*`) exige geolocation. Engine concede São Paulo (-23.5505, -46.6333).

### Test plan local
1. Aplicar `migrations/020_mercantil.sql` no Supabase `gfyharrnkcncpngbvhpj`
2. Cadastrar credenciais em Configurações (toggle pra Mercantil)
3. `docker compose up -d`
4. localhost:3004 → Mercantil → Upload CSV → Iniciar Bot
5. Modal SMS → digita código → aguarda logs: `bff_bridge IniciarOperacao OK CPF=...`

### Obsidian
`BASE DE CONHECIMENTO/ACELERA CORBAN — Mercantil Bot 14-05-2026.md` (nota principal, mapeamento completo)

### API — BFF (confirmado 2026-05-14)

**Base:** `https://api.mercantil.com.br:8443/pcb/sitebff/api`
**ATENÇÃO:** `httpx` Python direto invalida sessão ("SessaoUsuarioInativa"). Usar SOMENTE `page.evaluate(fetch)`.

| Endpoint | Detalhe |
|----------|---------|
| `GET /Convenios` | ⚠️ NÃO `/Convenios/Publicos` — convenioId=**4325761** |
| `POST /PropostasProspect/IniciarOperacao` | uuid + tokenValidoConsignadoPrivado |
| `GET /PropostasProspect/{uuid}/Detalhes` | pronto quando `propostaEmprestimo.valorLiberado != null` |
| `GET /PropostasProspect/{uuid}/SimulacaoDetalhes` | dados financeiros detalhados |

### Mapeamento de Variáveis (E2E testado 2026-05-14)

#### Variável 1 — CPF bloqueado (política do banco)
- **Detecção:** `innerText` check 1.5s após click Consultar (antes de Nova operação)
- **Sinal:** "políticas do banco" / "não é possível digitar"
- **Status:** `inelegivel`

#### Cenário A — `/consignado-privado/{uuid}`
- Poll "Produtos disponíveis" reload 8s/300s
- Angular pode auto-nav pra `/simulacao/` → checar URL no poll

#### Variável 3 — sem vínculo de trabalho (detectado no poll Cenário A)
- **Sinal:** "não possui vínculo" / "vinculo de trabalho" / "algo inesperado" no body
- **Mensagem real:** "Trabalhador não possui vínculo de trabalho válido para empréstimo"
- **Ação:** status=`inelegivel`, PULA Iniciar/Simular → próximo CPF

#### Iniciar — CRÍTICO
- É tag `<a>` NÃO `<button>` → `<a mat-flat-button class="pcb-button">Iniciar</a>`
- Seletor: `a.pcb-button:has-text('Iniciar'), a[mat-flat-button]:has-text('Iniciar')`
- Há 2 botões → `.nth(0).click()` obrigatório (strict=True causa timeout silencioso)

#### Resultado simulação
- Poll `innerText` a **0.3s** (toasts somem em <1s, poll 1s perde)
- Inelegível: "não possui margem" / "política de crédito" / "sem margem"
- Elegível: `strong.valorLiberado` com dígitos

#### Cenário B — `/solicitar-dataprev/{uuid}` → Plurio (fluxo normal)
- Preenche telefone `input[mask='(00) 00000-0000']` com DD+9+8dígitos (só números)
- Click Solicitar → **race 25s** entre `input[readonly]` (link) e redirect consignado-privado
- Se link → nova aba Plurio; etapa1: checkbox (force=True) + Iniciar; etapa2: checkbox + Autorizar; aguarda `div#sucesso`; fecha aba → goto consignado-privado
- Se sem link → Variável 4

#### Variável 4 — DataPrev já autorizado (sem link Plurio)
- **Quando:** após Solicitar, page redireciona direto pra `/consignado-privado/` com "Produtos disponíveis" visíveis
- **Sinal:** URL tem `/consignado-privado/` + heading "Produtos disponíveis" visível (dentro dos 25s de race)
- **Caso real:** CPF já foi processado antes — DataPrev autorizado em sessão anterior
- **Ação:** `_plurio_skip = True` → pula Plurio inteiro → cai no bloco Iniciar/Simular normalmente
- **phases.py:** `fase3_autorizar_dataprev` checa heading após redirect → retorna `{"status": "autorizado"}` sem abrir Plurio

#### Resultado da simulação — campos capturados (confirmados CPF 75858444920)
- `strong.valorLiberado` → valor liberado (ex: R$ 14.445,47)
- `input[currencymask][placeholder="R$ 0,00"]` → valor parcela (ex: R$ 906,52)
- `input[type="number"][min="1"]` → prazo (ex: 48)
- Labels via `_ler_campo_por_label`: Valor financiado, Valor empréstimo, Valor IOF, Qtd parcelas, Data 1º vencimento, Capital Segurado, Valor Seguro Prestamista, Taxa juros (mês)

### Status (2026-05-14)
- ✅ SMS bridge, Login, bff_bridge.py
- ✅ Variável 1, Variável 3, Variável 4
- ✅ Cenário A loop completo testado (CPF 75858444920: R$ 14.445,47 / 48x / 4.74%)
- ✅ Cenário B + Plurio implementado
- ✅ Variável 4: DataPrev já autorizado → skip Plurio
- ✅ Iniciar `<a>` tag corrigido, `.nth(0)`, poll 0.3s
- ✅ Loop 34 CPFs sem parar

### Run Real 14-15/05/2026 — Análise (commit 98cf155)

**Resultado:** 865/5499 CPFs (15.7%) antes de reCAPTCHA Enterprise flagar correspondente

| Status | Count | % |
|--------|-------|---|
| Elegível | 2 | 0.23% |
| Inelegível | 541 | 62.5% |
| Erro técnico | 322 | 37.2% |
| Screenshots | 132 | — |

**Elegíveis:**
- `11018830650` → R$ 2.120,78
- `09328160960` → R$ 4.140,53

**Bugs corrigidos no `tmp_e2e_test.py`:**
1. Var1 não escrevia no CSV (continue pulava `_write_result`)
2. Var1 match no `body.innerText` inteiro → falso positivo cascade
3. Print "R$ R$" duplicado cosmético
4. Elegível sem screenshot
5. Elegível sem captura de valor_parcela/prazo

**Fixes aplicados:**
- Var1 match restrito a `mat-snack-bar-container`, `mat-dialog-container`, `cdk-overlay-container`
- Screenshot full-page em todo erro + elegível em `/tmp/mercantil_screenshots/`
- Captura de `valor_parcela` (input[currencymask]) + `prazo` (input[type=number])
- CSV ganha colunas `valor_parcela` e `prazo`
- SMS via `/tmp/mercantil_sms.txt` (substitui `input()` interativo)

**Bloqueadores operacionais:**
1. **reCAPTCHA Enterprise** — flagou correspondente após ~700 CPFs. Cooldown 24h
2. **Supabase egress quota excedida** — projeto restricted. Impede dashboard

**Solução real:** rodar pelo dashboard produção (BFF Bridge bypassa reCAPTCHA — sem DOM interaction)

---

### Integração Dashboard (2026-05-14 — commit eb7f1a3)

**Página dedicada `/mercantil`** — separada de V8/VCTex. Dois painéis: Sessão + Leads.

**Endpoints novos:**
- `GET /api/mercantil/bot/session-status` → `{status: valid|none, saved_at}` checa `.bot_state/{user_id}.json`
- `POST /api/mercantil/bot/login-visual` → Playwright headful, login+SMS, salva sessão. NÃO processa leads.

**Fluxo:**
1. User vai pra `/mercantil` → SessionPanel mostra status
2. Clica **Login Visual** → Chrome abre visível, bot preenche login/senha, SMS modal aparece, user digita 6 dígitos → storage_state salvo → WS `session_saved`
3. Upload CSV + **Rodar Bot** → headless processa CPFs, WS `lead_result` por CPF
4. Sessão expira mid-run → worker tenta re-login headless 2x → falha → WS `session_expired` → banner frontend → user refaz Login Visual → resume automático

**Worker session expiry detection:**
- `_SESSION_ERROR_KEYWORDS = ("JWT_NOT_FOUND", "SessaoUsuarioInativa", "Unauthorized", ...)`
- `_session_fail_count` por worker, reseta no sucesso
- `_try_headless_relogin(engine, page, user_id)` → goto dashboard, checa `SEL_NOVA_PROPOSTA_BTN`
- 2 falhas consecutivas → emit `session_expired` + break

**Arquivos frontend novos:**
- `pages/Mercantil.tsx`, `components/mercantil/{Session,Leads}Panel.tsx`
- `hooks/useMercantilSession.ts` (poll 15s + WS listener)
- `lib/api.ts` métodos: sessionStatus, loginVisual, botStart/Stop/Status, uploadCsv, uploadStatus, currentBatch

**BankToggle:** quando bank=mercantil → `window.location.href = "/mercantil"` (não usa reload).

### Sessão 15-16/05/2026 — Modo BFF + Live Preview (commit 01b19a1)

**Objetivo:** bypassar reCAPTCHA Enterprise via BFF Bridge puro mantendo modo DOM como fallback.

**Implementado:**
- `worker.py` aceita `mode="dom"|"bff"`. BFF chama `bff_bridge.consultar_cpf` direto. Cenário B faz Plurio DOM + reconsulta BFF.
- `_live_screenshot_loop` 1.5s emit WS `live_frame` por CPF.
- `phases._screenshot` emit WS `screenshot_saved` via contextvars.
- `engine.new_context` lê env `MERCANTIL_PROXY_SERVER/PORTS/USER/PASS` (round-robin por user_id).
- Akamai bot manager block agora opt-in via `MERCANTIL_BLOCK_AKAMAI=1` (default OFF — quebrava reCAPTCHA).
- `_parse_csv` dedupa CPF (evita ON CONFLICT 21000).
- Frontend: 2º botão "⚡ Rodar BFF" verde + painel Live img + coluna Estágio + Capturas thumbnails + zoom modal.

**9 bugs corrigidos:** CSV dup, `creds.get()` AttributeError, asyncio task GC, Login Visual WS broadcast missing, Akamai block quebra reCAPTCHA, Plurio seletor legacy, BFF inelegível cenário forçado, fase3 fail sem cleanup, `creds[...]` subscript.

**Bug pendente — `_fill_sms_and_verify` botão Verificar:** 15 variantes seletor falham, Enter não submete, bot vai pra attempt 2 → 5 → max_attempts. Instrumentação adicionada (screenshot `sms_no_verify_btn` + dump JSON botões visíveis). Próxima sessão: identificar selector real do Angular Material do portal.

**Proxy IPv4:** `200.7.122.129` + 5 portas (TikTok residencial). Latência alta (40s engine.start) — bateu timeout dashboard. Env vars **comentadas no `.env`**, reativar = uncomment + restart.

**Estado DB:** 321 pendentes (CSV 322 erros - 1 dup deduplicado) + 37 erro legado. Nenhum result BFF ainda.

**Próxima sessão:**
1. `docker compose exec -T redis redis-cli DEL "mercantil:login_visual:bc72f4c3-472d-4f1a-831f-5cda1c539b92"`
2. Click Login Visual → digita SMS
3. Se attempt 2 disparar: `docker cp` `/tmp/mercantil_sms_no_verify_btn.png` + grep logs "botões visíveis" → adicionar selector real em `engine._fill_sms_and_verify` button_variants
4. Login OK → ⚡ Rodar BFF
5. Validar live preview no LeadsPanel
6. Escalar 5499 CPFs Janeiro
7. Deploy VPS

## Deploy

Local: `docker compose build --no-cache backend frontend && docker compose up -d`
Prod VPS (terminal web Hostinger, SSH externo bloqueado):
```bash
cd /root/acelera-corban && git pull && \
docker compose -f docker-compose.prod.yml build --no-cache backend frontend && \
docker compose -f docker-compose.prod.yml up -d backend frontend
```


## Sessão 18/05/2026 — Bypass via Import Sessão Chrome Real

**Problema final:** Bot Playwright detectado como device desconhecido pelo Mercantil. Banco mostra tela token mas suprime SMS. Login Manual também rejeita ("usuário inválido"). Escalada antifraude após sessões 14-17/05.

**Solução:** importar sessão do Chrome real do user → storage_state Playwright → BFF roda livre.

### Workflow

1. User loga normal no Chrome dele em `meu.bancomercantil.com.br`.
2. Dashboard `/mercantil` → botão azul **Importar sessão do meu Chrome** copia JS pro clipboard.
3. Console DevTools (F12) → cola JS (se Chrome pedir, digita `allow pasting`) → output vai pro clipboard.
4. Terminal: `python3 scripts/import_mercantil_session.py` → cola JSON → Ctrl+D.
5. Script salva em `backend/.bot_state/mercantil/{user_id}.json`. Frontend vira "✅ Sessão válida".
6. Click ⚡ Rodar BFF.

### Por que funciona

- JWT em `localStorage.PCB_AUTH` é o que `bff_bridge` consome via `wait_for_function`.
- Cookies tracking (`rxVisitor`, `dtCookie`, `nvg83980`) mantêm device-id → banco confia.
- `page.evaluate(fetch)` bypassa reCAPTCHA (handler Angular nunca dispara).
- Sem novo login = sem novo SMS = sem novo score de risco.

### Validade JWT

~12h (campo `exp` no payload). Refaz import quando expirar.

### Commits sessão

- `a16000e` — loop SMS sem relogin + timeout 60s + logs
- `5ec6c08` — pin broadcast tasks + screenshot SMS pré-fill
- `9c4091e` — modo Login Manual (assist) single-shot
- `dfa5877` — script manual_login local host (fallback não usado)
- `07199aa` — import_mercantil_session + botão UI

### Escalada antifraude observada

| Fase | Sintoma |
|------|---------|
| 1 | reCAPTCHA bloqueia DOM submit (silent) |
| 2 | Mostra tela token mas SMS não dispara |
| 3 | "Usuário inválido" genérico |
| 4 | Bloqueio total correspondente |

Reset apenas via suporte Mercantil OU trocar IP+device. Esperar 48h não bastou.

## Presença Bank (4º banco — 2026-05-19)

### Decisão de arquitetura: API REST (sem browser)

Click bot Playwright foi implementado mas arquivado como fallback (4 bugs, 8 riscos, seletores frágeis Angular SPA).
API REST é 4x mais rápida, mais confiável, retorna mais dados.

### Arquivos-chave
- `backend/app/banks/presenca/api_client.py` — `PresencaApiClient` (httpx, verify=False)
- `backend/app/banks/presenca/api_worker.py` — `PresencaApiWorker` (mesma interface que PresencaLeadWorker)
- `backend/app/banks/presenca/worker.py` — click bot (fallback — não usar)
- `backend/app/services/presenca_bot_service.py` — `start_bot(mode="api")` default
- `backend/app/routers/presenca.py` — `/api/presenca/*`, `?mode=api` ou `?mode=bot`

### Fluxo API (5 passos para higienização)

```
POST /login                                                    → JWT (~10h)
POST /consultas/termo-inss                                     → autorizacaoId
PUT  /consultas/termo-inss/{id}                               → assina (device fake)
POST /v3/operacoes/consignado-privado/consultar-vinculos       → vínculos eSocial (400/15s = inelegível)
POST /v3/operacoes/consignado-privado/consultar-margem         → margem + extras
```

**Step 6 (simulação):** `POST /v5/operacoes/simulacao/disponiveis` → ❌ "Prazo não permitido para o originador" — requer configuração de prazos pelo Presença Bank support para conta `072.751.201-35`.

### Endpoints API

**Base:** `https://presenca-bank-api.azurewebsites.net`

### Payloads críticos

**Gerar termo:** `{"cpf": "DIGITS_ONLY", "nome": "...", "telefone": "DIGITS_ONLY", "produtoId": 28}`

**Assinar termo (PUT):** `{"userAgent": "Mozilla/5.0", "OperationalSystem": "Android", "DeviceModel": "Samsung Galaxy", "DeviceName": "samsung", "DeviceType": "mobile", "GeoLocation": {"Latitude": "-23.5505", "Longitude": "-46.6333"}}`

**Consultar vínculos:** `{"cpf": "DIGITS_ONLY"}`

**Consultar margem:** `{"cpf": "DIGITS_ONLY", "matricula": "...", "cnpj": "..."}` — matricula/cnpj vêm da resposta de vínculos (`matricula` e `numeroInscricaoEmpregador`)

### Resposta vinculos (CPF elegível)
```json
{"id": [{"matricula": "...", "numeroInscricaoEmpregador": "...", "elegivel": true, "cpf": "..."}]}
```

### Resposta margem (CPF elegível)
Campos: `valorMargemDisponivel`, `valorMargemBase`, `registroEmpregaticio`, `cnpjEmpregador`, `dataAdmissao`, `dataNascimento`, `nomeMae`, `sexo`

Extras ficam em coluna `payload` JSON no lead (além de `valor_liberado` = `valorMargemDisponivel`).

### Atenção
- API retorna HTTP 500 (não 401) para credenciais inválidas
- `produtoId: 28` = consignado privado — sempre fixo
- `consultar-vinculos` leva até 15s para CPFs sem eSocial (é timeout normal do DataPrev)
- Rate limit: 30 req/min → jitter 10-20s entre CPFs (PRESENCA_CPF_JITTER_MIN/MAX)

### Status (2026-05-20)
- ✅ api_client.py + api_worker.py implementados
- ✅ presenca_bot_service mode="api" default
- ✅ Container importa + valida corretamente
- ❌ Login 500 — senha no Supabase expirou. Atualizar em Configurações → Presença Bank
- ❌ Simulação bloqueada por prazos — contatar suporte Presença

## PowerHub (5º banco — 2026-05-22)

### Decisão de arquitetura: API REST (sem browser)
Enriquecimento de telefone por CPF. Retorna até 4 telefones — exporta 1 linha por telefone.

### Endpoints API
- **Auth:** `POST https://novapowerhub.com.br/api/auth/token {username,password}` → access_token (300s) + refresh_token (24h)
- **Refresh:** `POST https://novapowerhub.com.br/api/auth/refresh?refreshToken={token}`
- **Consulta:** `GET https://higienizacao.novapowerhub.com.br/api/telefonia/dados/{CPF}?whatsapp=true`
- **Resposta:** `{telefones: [{phone: "..."}], nomeCompleto: "..."}`

### Credenciais portal
- **Login:** `1243` / **Senha:** `Nexxo2025`

### Arquivos-chave
- `backend/app/banks/powerhub/api_client.py` — httpx, keep-alive desabilitado, retry 3x em RemoteProtocolError
- `backend/app/banks/powerhub/api_worker.py` — auto-reset leads "processing" no startup (worker_id==0)
- `backend/app/banks/powerhub/bot_pool.py` — max 3 workers/user, 12 total
- `backend/app/routers/powerhub.py` — `/api/powerhub/*`
- `migrations/022_powerhub.sql` — powerhub_leads (phones jsonb), powerhub_batches, powerhub_bot_runs + RLS
- `frontend/src/pages/PowerHub.tsx` — `/powerhub`

### Armadilhas
- `httpx` keepalive → server disconnects após ~25s → `Connection: close` + `http1=True` + `max_keepalive_connections=0`
- Leads ficam em `processing` se worker crasha → `_reset_stuck()` no startup do worker_id==0
- Upload duplicado cria 2 batches `active` → `currentBatch` pega o mais recente por `created_at DESC`
- CSV da base: `~/Downloads/MIL POWERHUB.csv` (sep=`;`, cpf zfill(11))

### Status (2026-05-22)
- ✅ Local funcionando — 40 CPFs testados
- ✅ Migration 022 aplicada Supabase
- ⏳ Deploy VPS pendente

## Scheduler — Agendamento de Batches (26-05-2026)

Feature pra agendar disparo automático de bot. Implementado em **Presença**. Pendente PowerHub/V8/VCTex. Mercantil pulado (antifraude).

### Arquivos Presença
- `migrations/023_presenca_scheduled.sql` — ADD scheduled_for TIMESTAMPTZ NULL + index parcial
- `backend/app/services/presenca_scheduler_loop.py` — loop Redis SETNX leader-elected (padrão `broadcast/monitor_loop.py`), tick 60s
- `backend/app/main.py:96-101` — startup hook `asyncio.create_task(run_presenca_scheduler_loop)`
- `backend/app/routers/presenca.py:233-273` — `POST /api/presenca/batches/{batch_id}/schedule {scheduled_for: ISO8601|null}`
- `frontend/src/components/presenca/LeadsPanel.tsx` — botão ⏰ Agendar + modal datetime-local + banner
- `frontend/src/lib/api.ts` — `presencaApi.scheduleBatch(batchId, isoOrNull)`

### Comportamento
- Scheduler busca batches `WHERE status='pendente' AND scheduled_for <= now()` (max 50/tick)
- Skip se `pool.status(owner_id) is not None` (bot já rodando)
- 1 batch/owner/tick
- Limpa `scheduled_for=NULL` após fire (evita re-fire em retry-errors)
- Endpoint valida: future date, ISO válido, batch existe, batch=pendente
- NULL `scheduled_for` = comportamento atual (start manual via UI)

### Replicar pros outros bancos
- **PowerHub** (~30min): API REST, mesma arquitetura — copy `presenca_scheduler_loop.py` → `powerhub_scheduler_loop.py`, ajusta refs de tabela/service, migration `024_powerhub_scheduled.sql`, endpoint POST, UI button
- **V8 / VCTex** (~30min cada): Playwright headless. Funciona se sessão Chrome viva no horário — UX risco se expirar
- **Mercantil**: ❌ NÃO. Antifraude + JWT 12h. Cron vai falhar relogin

### Deploy VPS (feito 26/05)
1. Fix APP_ENCRYPTION_KEY divergente entre local/VPS (causava 500 em `/api/credentials` e `bot/start`)
2. `git pull && docker compose build --no-cache backend frontend && up -d`
3. Verifica log `presenca scheduler standby` + `leader elected`

⚠️ `/api/credentials` ainda 500 mesmo após fix — outro banco com Fernet antigo. Não bloqueia scheduler. Endpoint usa `decrypt()` simples; trocar pra `safe_decrypt()` em `credentials/service.py:get()` resolve.



<claude-mem-context>
# Memory Context

# [ACELERA CORBAN] recent context, 2026-06-06 11:04pm GMT-3

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 28 obs (11,326t read) | 545,176t work | 98% savings

### Jun 3, 2026
3058 6:49p 🔵 Acelera Corban Project Stack and Context
3059 " 🔴 Broadcast System Bugs Fixed — 2026-06-03 Session
3060 " 🔵 Mercantil Bank Bot — BFF Bridge Architecture via page.evaluate
3061 " 🔵 gstack Skills Not Installed in Codex Environment
3062 6:50p ✅ gstack Installed for Codex + CLAUDE.md Updated with Required Enforcement
3063 " 🔵 Supabase MCP Absent from Codex Config — Only Available in Claude Code
3064 " 🔵 Claude Code MCP Servers — Supabase Connected, Google Drive Needs Auth
3065 6:51p 🔵 Codex MCP — Only node_repl Server, Supabase Not Configured, OAuth Support Available
3066 " ✅ Supabase MCP Added to Codex with Project-Scoped URL
3067 " ✅ gstack Skills Symlinked into ~/.codex/skills for Codex Native Discovery
3068 6:52p 🔵 Supabase MCP Codex OAuth Login Requires Manual Browser Step
3069 " 🔵 Codex Supabase MCP OAuth Login Stuck — Same Session ID Across Multiple Attempts
3070 " 🔵 codex mcp login supabase Stuck — PID 7110 Running, Awaiting Browser Callback
3071 6:54p ✅ Codex Setup Complete — Skills Verified, Supabase MCP Registered, OAuth Pending
3072 6:55p ✅ Supabase MCP OAuth Login Completed Successfully in Codex
3073 6:56p ✅ Supabase MCP Auth Status Changed to OAuth — Codex Setup Complete
3074 " ⚖️ Standardized Agent Handoff Protocol Defined for Acelera Corban
3075 7:14p 🔵 Shape em Dia — Flutter Fitness App State Discovered
3076 " 🔵 Shape em Dia — Pending Staging Artifacts Found at Codex Handoff Location
### Jun 6, 2026
3191 9:39p 🔵 Acelera Corban — Full Project Structure Mapped
3192 " 🔵 Acelera Corban — Complete Feature Map for "Modo de Uso" Documentation
3193 9:40p 🔵 Complete Database Schema — 33 Migrations, All Tables Mapped
3194 " 🔵 Per-Feature Workflow Details — Complete User Action Flows for Each Module
3195 " 🔵 Higienização Module — Business Logic and UI Tabs Explained by Owner
3196 9:55p ✅ Higienização "Modo de Uso" Notes Written to Memory File
3197 9:59p ⚖️ PowerHub module clarified + "Modo de Uso" page implementation approved
3198 10:12p 🔵 Frontend design patterns confirmed for "Modo de Uso" implementation
3199 10:14p 🟣 ModoDeUso.tsx page created — full user guide for ACELERA CORBAN

Access 545k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>

---

## 🔑 REGRA PADRÃO — Token Meta + Refresh Universal (2026-06-04)

**Status:** Aesir ✅ · VendeAI ✅ · Chipcare ✅ (todos 3 disparadores aplicam mesmo pattern)

**Promessa pro usuário:** colou token Meta → salvou → apertou Refresh → puxa todos números da BM. SEM erro. SEM gargalo.

### O que quebrava antes

1. `discover_wabas()` retornava lista vazia pra token CLAUDE DISPARO
   - `granular_scopes[whatsapp_business_management]` SEM `target_ids`
   - `/me/businesses` → `[]`
   - `/me/assigned_whatsapp_business_accounts` → `[]`
   - Meta intencionalmente esconde WABAs desse tipo de System User token

2. Refresh do CRM (Aesir/VendeAI/Chipcare) falhava com 401/500 → `raise HTTPException` matava o endpoint inteiro
   - Meta nunca era chamado
   - Usuário via 0 números mesmo com token válido

3. Bolinha verde quando número estava `can_send: LIMITED` (display name não aprovado) — sinal falso

### Como fizemos funcionar de primeira

#### 1. Backend `meta_client.py` — `discover_wabas()` 4 estratégias

Tenta em sequência, cada uma não-fatal:

```python
async def discover_wabas(self) -> list[str]:
    # Strategy 1: debug_token → granular_scopes target_ids → owned_whatsapp_business_accounts
    # Strategy 2: /me/businesses → /{biz}/owned_whatsapp_business_accounts
    # Strategy 3: /me/assigned_whatsapp_business_accounts
    # Strategy 4: env META_WABA_FALLBACK_IDS validado 1-by-1 via GET /{wid}?fields=id,name
```

**Strategy 4 é a única que funciona pra token CLAUDE DISPARO.** Os 8 WABA IDs ficam em `.env`:

```bash
META_WABA_FALLBACK_IDS=1478112344051517,1530204361861055,1503376931137355,1292638789018602,4272402256310443,1306012624797547,979919711450878,26833705632933404
```

**NUNCA REMOVER** essa env. Sem ela, refresh-numbers retorna 0 pra esse token. Descobertas via header trick (sessão 2026-05-26 — ver `feedback_meta_waba_template_create.md` na memory).

#### 2. Backend resilience — erros NUNCA matam o endpoint

Todos 3 routers seguem:

```python
@router.post("/refresh-...")
async def refresh(user_id):
    # Step 1: Meta discovery (independente do CRM)
    meta_error = None
    try:
        meta_phones = await meta.get_all_phones_auto()
    except Exception as e:
        meta_error = str(e)

    # Step 2: CRM — non-fatal
    crm_error = None
    try:
        crm_data = await crm_client.list_...()
    except Exception as e:
        crm_error = str(e)

    # Step 3: Upsert cross-referenced (CRM + Meta)
    # Step 4: Upsert Meta-only orphans (instance_id="meta:{phone_id}" ou channel_id negativo SHA256)

    return {"ok": True, "meta_total": N, "meta_matched": M, "meta_error": ..., "crm_error": ...}
```

Nunca `raise HTTPException` em erro de API externa.

#### 3. WABA-level enrichment via `get_waba_info()`

`get_all_phones_auto()` enriquece cada phone com: `account_review_status`, `business_verification_status`, `waba_currency`, `waba_country`, `waba_name`.

#### 4. Phone-level via `_parse_phone()` — 18 campos

`phone_id`, `waba_id`, `display_phone`, `verified_name`, `is_official_business_account`, `quality_rating`, `messaging_tier`, `daily_limit`, `can_send`, `name_status`, `restrictions[{code,label,entity}]`, `additional_info[]`, `has_payment_issue`, `display_name_pending`, `account_mode`, `code_verification_status`.

Códigos cosméticos `{138024, 138025}` (SIP) **sempre filtrados**.

#### 5. Frontend `effectiveQuality()` — qualidade efetiva, não rating cru

```ts
function effectiveQuality(inst): 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN' {
  if (inst.has_payment_issue) return 'RED';
  if (inst.can_send === 'BLOCKED') return 'RED';
  if (inst.quality_rating === 'RED') return 'RED';
  if (inst.restrictions?.length > 0) return 'YELLOW';
  if (inst.can_send === 'LIMITED') return 'YELLOW';
  if (inst.display_name_pending) return 'YELLOW';
  if (inst.quality_rating === 'YELLOW') return 'YELLOW';
  if (inst.quality_rating === 'GREEN') return 'GREEN';
  return 'UNKNOWN';
}
```

Bolinha lateral = `QUALITY_COLOR[effectiveQuality(inst)]`. **Nunca rating cru** — esconde LIMITED.

#### 6. UI por número — 4 cards + alertas

```
● 📞 1078234918710712  🏢 1478112344051517
  +55 18 98184-4690 · Diamond ✔   [✓ CRM AESIR] [⏸ Pausar]
  BM Diamond · BR
  ┌──────────┬──────────┬──────────┬──────────┐
  │CAPACIDADE│QUALIDADE │PAGAMENTO │NOME EXIB │
  │ 250/dia  │ Saudável │   OK     │ Aprovado │
  └──────────┴──────────┴──────────┴──────────┘
  [● Conta aprovada] [● BM verificada]
```

### Database — 14 colunas Meta em CADA tabela

Aesir `aesir_instances` (mig 029+030+031) · VendeAI `broadcast_numbers` (mig 032) · Chipcare `chipcare_channels` + `chipcare_settings.meta_token_enc` (mig 033).

Colunas: `phone_id, waba_id, verified_name, name_status, account_mode, restrictions JSONB, additional_info JSONB, has_payment_issue BOOL, display_name_pending BOOL, waba_name, account_review_status, business_verification_status, waba_currency, waba_country, quality_updated_at`.

### Frontend `disparo-shared/` — UI compartilhada

`frontend/src/components/disparo-shared/`:
- `tokens.ts` — C, G (gradients), glassCard, sectionTitle, btnStyle, INPUT_STYLE, SHARED_CSS, QUALITY_COLOR, QUALITY_GRAD
- `quality.ts` — effectiveQuality, statusCards, extraWarnings, topLevel
- `Section.tsx` — Section, PulseDot, GradientBar
- `AICore.tsx` — AICore (cérebro animado), AIMonitorPanel
- `NumberQualityGrid.tsx` — cards 4-col + IDs + alertas
- `index.ts` — re-exports

VendeAI + Chipcare importam do shared. Aesir mantém local (não quebrar o que funciona — refactor diferido).

### Padrão de seções (todos 3 disparadores)

1. Credenciais 2-col (CRM + Meta)
2. Analytics strip (3 métricas grandes 48px)
3. **Inteligência Artificial · Monitora Disparo e Qualidade** (cérebro animado + stats)
4. Novo Disparo (CsvUploadWizard específico do CRM)
5. **Qualidade dos Números da sua BM** (cards 4-col)
6. Histórico de Disparos (sempre último — não polui inputs)

### Botão Refresh

Texto: **"⟳ Atualizar Status (Refresh)"** gradient roxo, 14px 24px, boxShadow.
Loading: "⟳ Sincronizando todos os status..."
Tooltip: "Bate no token Meta + CRM, puxa qualidade, restrições, pagamento, nome de exibição, verificação BM, todos os status."
Header msg: `✅ 8 números · 8 da BM Meta · 0 cruzados c/ Aesir · ⚠ Aesir: 401 ...`

### Restriction codes PT-BR

```python
RESTRICTION_LABELS = {
    131056: "limite de mensagens excedido (24h)",
    133004: "número não verificado",
    133015: "nome de exibição reprovado",
    131048: "qualidade ruim (RED)",
    131049: "spam reportado por usuários",
    130472: "conta bloqueada por falta de pagamento",
    133010: "número desabilitado pela Meta",
    131045: "número não registrado",
    133006: "verificação OTP pendente",
    133007: "número em revisão Meta",
}
COSMETIC_CODES = {138024, 138025}  # SIP — sempre ignorar
```

### Saldo devedor R$

**NÃO É POSSÍVEL** via Graph API. Testei `/credit_lines`, `/payment_methods`, `/billing_status`, `/owned_ad_accounts` — todos falham ou retornam vazio. Detecção é só binária via code 130472 (`has_payment_issue`). Pra R$ real precisaria scrape de business.facebook.com.

### Bug crítico corrigido (Chipcare meta-only synth_id)

`channel_id = -(abs(hash(phone_id)) % 2_000_000_000)` era randomizado per-process → linhas duplicadas a cada Refresh.

Fix:
```python
seed = (p.get("phone_id") or key).encode("utf-8")
digest = hashlib.sha256(seed).digest()
synth_id = -(int.from_bytes(digest[:6], "big") % 2_000_000_000)
```

SHA256 determinístico → mesmo phone_id sempre vira mesmo channel_id.

### Quando replicar pra novo disparador

1. Backend `refresh-...` segue pattern 4 steps (Meta independente + CRM non-fatal + cross-ref + Meta-only orphans com SHA256)
2. Migration: 14 colunas Meta na tabela de instâncias/canais
3. Frontend: importar de `disparo-shared`, mesmo layout de 6 seções, botão Refresh padrão
4. Salvar Meta token: `chipcareApi.saveMetaCredentials(token, waba_ids)` ou equivalente
5. Não esquecer `effectiveQuality()` na bolinha lateral
6. Não esquecer Phone ID + WABA ID acima do número
7. Restriction codes em PT-BR

### NUNCA fazer

- `raise HTTPException` em erro de CRM ou Meta no refresh — capturar em var e devolver JSON
- Usar `quality_rating` cru pra cor de bolinha — usa `effectiveQuality()`
- Esconder restriction codes não-cosméticos
- Esquecer Phone ID + WABA ID acima do número
- Tirar `META_WABA_FALLBACK_IDS` do `.env`
- `hash()` builtin pra IDs persistidos — sempre `hashlib.sha256()`
- Mostrar `additional_info` Meta no UI (vem em inglês)
- Esquecer de aplicar migration antes do upsert

### Arquivos-chave

- `backend/app/services/broadcast/meta_client.py:78-218` — `discover_wabas()` 4 strategies
- `backend/app/services/broadcast/meta_client.py:23-90` — `_parse_phone()`
- `backend/app/services/broadcast/meta_client.py:180-194` — `get_waba_info()` + `get_all_phones_auto()` enrichment
- `backend/app/routers/aesir_broadcast.py:204` — refresh_numbers (referência)
- `backend/app/routers/broadcast.py:140` — refresh_numbers VendeAI
- `backend/app/routers/chipcare_broadcast.py:252` — refresh_channels Chipcare (channel_id SHA256)
- `frontend/src/components/disparo-shared/quality.ts:14` — `effectiveQuality()`
- `frontend/src/components/disparo-shared/NumberQualityGrid.tsx` — UI compartilhada
- `frontend/src/components/disparo-shared/AICore.tsx` — Cérebro animado + AIMonitorPanel + CapacityBlock (bárras por número)
- `frontend/src/components/disparo-shared/CollapsedChip.tsx` — Chip colapsável reusado em todas credenciais
- `frontend/src/components/disparo-shared/BMSummary.tsx` — 5 cards (Total/Capacidade/OK/Graves/Leves)
- `migrations/029_aesir_instance_waba_id.sql` até `033_chipcare_meta_fields.sql`
- `.env:META_WABA_FALLBACK_IDS=...` — 8 WABA IDs CLAUDE DISPARO

---

## 🆕 Adições 2026-06-05 (sessão final)

### Painel "Qualidade dos Números da sua BM" — 5 cards no topo

`BMSummary` mostra: Total · Capacidade/dia · OK p/ Disparar · Problemas Graves · Problemas Leves.

Classificação (`disparo-shared/quality.ts`):
- **Grave:** `can_send=BLOCKED` OU `quality_rating=RED` OU conta suspensa OU BM expirada
- **Leve:** `has_payment_issue` OU `display_name_pending` OU `can_send=LIMITED` OU `name_status` em (DECLINED, EXPIRED, PENDING_REVIEW)
- **OK:** `quality_rating=GREEN` + `can_send=AVAILABLE` + sem problemas

Capacidade total = soma `daily_limit` dos números **não-pausados E não-graves** (bloqueados não disparam → não contam).

Ordem da lista: GREEN → YELLOW → RED → UNKNOWN (saudáveis primeiro).

### Cérebro IA como botão de Refresh

`AICore` agora recebe `{ refreshing, onClick }`. Click no cérebro = chama `onRefresh` (mesmo handler do botão "⟳ Atualizar Status").

Bloco "Capacidade Hoje" abaixo das campanhas — barras por número com `sent_today/daily_limit`, cor pela qualidade efetiva, % colorido (verde<70, amarelo 70-90, vermelho 90+).

### Credenciais colapsáveis (`CollapsedChip`)

Pattern unificado em todos os 4 panels (VendeAI · Aesir · Chipcare · Chatwoot):
- Já configurado → chip compacto verde com botão `✎ Editar`
- Primeira vez OR `✎ Editar` → painel completo expande
- Após salvar → auto-colapsa 800ms

Email pré-preenchido (identifier, NÃO secret). Senhas/tokens com placeholder `••••••••  (salvo — em branco = manter)`.

### Multi-tenant validado

Auditado por agente: 0 critical findings, 0 data leaks.
- `_seed_admin_credentials` em `main.py` REMOVIDO
- `ADMIN_OWNER_ID/EMAIL/PASSWORD/META_TOKEN/CRM_TOKEN` no `.env` COMENTADOS
- `ADMIN_USER_IDS` mantido (só controle de acesso a rotas /admin)
- Cada user salva credenciais em DB scoped por `owner_id` (RLS ativo)
- JWT cache Chipcare keyed por user_id
- WABA fallback validado per-token

### Chatwoot CRM (`/chatwoot`)

Painel inline `ChatwootCredsPanel` (substitui modal antigo "⚙️ Configurar"). 4 campos: URL · Account ID · API Token · Inbox IDs (opcional). Colapsa após salvar.

Multi-tenant: `chatwoot_settings` PK `owner_id` + RLS + token Fernet-encrypted. `getSettings` NUNCA retorna o token plaintext.

### Credenciais VendeAI estendidas

`POST /api/broadcast/credentials` aceita `email`, `password`, `meta_token`, `account_id`, `crm_token` — partial update.

`GET /api/broadcast/credentials` retorna `configured`, `meta_configured`, `account_id`, `crm_token_configured`, `email` (decifrado como identifier). NUNCA retorna senhas/tokens.

Campos extras (account_id Chatwoot + CRM token) movidos de `/configuracoes` pra `/disparo` direto. Configurações antigas removidas.

### Fix crítico Chipcare

`chipcare_broadcast.py:317` — `_get_client_and_settings` chamava client antes de checar creds. Quebrava modo Meta-only (sem Chipcare). Fix: `if not chipcare_email or not chipcare_pass: chipcare_error = "Modo Meta-only"`.

### Sincronização WABA IDs

Aesir/Chipcare ganharam os mesmos 16 WABA IDs do VendeAI via SQL:
```sql
UPDATE aesir_settings SET waba_ids = (SELECT waba_ids FROM vendeai_settings WHERE owner_id=...) WHERE owner_id=...
```

Antes: Aesir mostrava 8 (fallback env), VendeAI mostrava 14. Agora ambos puxam dos mesmos 16 IDs (14 acessíveis pelo token).

### Bugs corrigidos

- `batches.py:57` — `NameError: MAX_ROWS` não importado → adicionado
- `chipcare_broadcast.py:389` — `hash()` builtin randomizado per-process → `hashlib.sha256()` determinístico
- DisparoAesir AIMonitorPanel/AICore local removido → importa shared (consistência)

### Estado final

| Disparador | Token Meta | Refresh | UI shared | Multi-tenant | Cérebro clicável | Capacidade bars | 5 cards summary |
|---|---|---|---|---|---|---|---|
| VendeAI | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Aesir | ✅ | ✅ | ✅ (parcial — local NumberQualityGrid) | ✅ | ✅ | ✅ | ✅ |
| Chipcare | ✅ (Meta-only OK também) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Chatwoot | N/A | ✅ (sync) | ✅ (chip colapsável) | ✅ | N/A | N/A | N/A |
---

## Clientes Cadastrados

### EDVAN — Fênix Soluções (onboarding 2026-06-06)

| Campo | Valor |
|-------|-------|
| UID | `436f1900-b571-412a-be27-35542ffb7a93` |
| Email app | `edvan@gmail.com` |
| VendeAI email | `nova_9343@vendeai.com` |
| Account ID | `448` |
| WABA | `2166149357452585` (Fênix Soluções) |
| Número | `+55 91 8107-0115` (phone_id `1201964722996302`) |
| can_send | LIMITED · 250/dia · pagamento regularizado |
| Templates | ❌ 0 aprovados — bloqueia disparo |
| BFF JWT | ❌ 401 — senha BFF não confirmada |
| IA API | ✅ funciona via crm_token |

**Credenciais completas:** `/Users/macbookdegabriel/projetos/EDVAN fenix/CREDENTIALS.md`

**Pendências:**
1. Templates Meta criados e aprovados
2. Confirmar senha BFF VendeAI (`bff.vendeaitecnologia.com.br`)

---

## Sessão 06/06/2026 — Dashboard Métricas Disparo (estado pós-sessão)

**Commits:** `1689d4c` → `6bd326f` → `97563cc`  
**Local:** ✅ funcionando — 1.421 enviados visíveis no dashboard  
**VPS:** ❌ deploy pendente

### Bugs corrigidos

**1. vendeai_mailing_id sempre null (`broadcast.py`)**
- VendeAI `/schedule-csv` não retorna ID do mailing na resposta
- Fix: após dispatch, busca mailing por `inbox_phone` + `created_at >= now-3min`
- Match: `re.sub(r"\D", "", display_phone) == re.sub(r"\D", "", inbox_phone)`

**2. AIMonitorPanel campos errados (`disparo-shared/AICore.tsx`)**
- `assignments_json` → `broadcast_dispatch_assignments`
- `a.sent` → `a.sent_count`
- `a.planned` → `a.planned_count`
- ⚠️ Frontend rebuild obrigatório: `docker compose build frontend && up -d`

**3. sent_today não existe em broadcast_numbers (`broadcast.py` snapshot)**
- Agrega em runtime no endpoint `/api/broadcast/snapshot`
- Soma `sent_count` das assignments do dia por `phone_id`
- Sem migration, sem coluna extra

**4. monitor_loop.py**
- `POLL_INTERVAL`: 60s → 20s
- `failed_count`: usa campo direto da API (não `dispatch_total - sent_count`)

### Deploy VPS (próxima sessão)

```bash
cd /root/acelera-corban && git pull && \
docker compose -f docker-compose.prod.yml build --no-cache backend frontend && \
docker compose -f docker-compose.prod.yml up -d backend frontend
```

---

## Sessão 07/06/2026 — Cópia CODEX + Central de Controle

**Contexto:** o projeto original foi duplicado para `/Users/macbookdegabriel/projetos/ACELERA CORBAN CODEX` para evoluir melhorias comerciais sem risco de quebrar o original. O original permanece em `/Users/macbookdegabriel/projetos/ACELERA CORBAN`.

### Runtime local da cópia CODEX

- Frontend: `http://localhost:3004`
- Backend: `http://localhost:8003`
- Redis: `redis://localhost:6381`
- A tela aprovada pelo usuário foi `http://localhost:3004/central-controle`
- Manter **Modo de Uso** como último item da navegação. **Central de Controle** fica antes dele.

### Feature criada — Central de Controle

Arquivos:

- `backend/app/routers/command_center.py`
- `backend/app/main.py`
- `backend/app/services/broadcast/meta_client.py`
- `frontend/src/pages/CentralControle.tsx`
- `frontend/src/App.tsx`
- `frontend/src/lib/api.ts`

Escopo da tela:

- Score Geral da Operação
- Health Check das Integrações
- Central de Entregabilidade BM
- Checklist Pré-Disparo
- Alerta de Risco de Bloqueio
- Simulador de Capacidade de Disparo
- Auditoria de Token Meta
- Monitor de Templates, principalmente utilidade vs marketing
- Radar de Erros por Motivo
- Central de Incidentes

### Decisões técnicas

- Sem migrations.
- Sem mudanças destrutivas.
- A Central de Controle agrega dados existentes e diagnosticos derivados.
- Endpoint rápido padrão: `GET /api/command-center/overview`
- Auditoria Meta ao vivo apenas sob demanda: `GET /api/command-center/overview?live_meta=true`
- Motivo: consultas live de Meta/templates podem demorar e pareciam Network Error quando eram feitas no carregamento inicial.
- Erros externos devem degradar o diagnóstico e não derrubar a tela inteira.

### Network Error corrigido na cópia CODEX

1. `frontend/.env.local` herdado apontava `VITE_API_URL=http://localhost:8002`, fazendo o frontend CODEX falar com backend antigo.
2. Backend local precisou rodar com `SSL_CERT_FILE` e `REQUESTS_CA_BUNDLE` do certifi para validar JWKS/Supabase.
3. Auditoria Meta ao vivo foi movida para botão manual para manter o primeiro load rápido.

### Validações já feitas

- `curl http://localhost:3004/api/health` retornou `{"status":"ok"}`.
- `curl -I http://localhost:3004/central-controle` retornou HTTP 200.
- Requisição autenticada para `/api/command-center/overview` retornou HTTP 200 com JSON de score/diagnóstico.
- Corrigido TypeScript em `CentralControle.tsx`: retry usa `() => load(false)`.

### Atenção

- Não misturar automaticamente a pasta CODEX com o projeto original.
- Não commitar automaticamente essa feature até o usuário pedir.
- `backend/app/services/broadcast/intervention.py` já estava modificado antes dessa feature; não considerar como parte da Central de Controle sem revisar diff.
- Não salvar tokens/JWTs/credenciais em resumos ou notas novas.

---

## Sessão 07/06/2026 — Audit + Redesign + Modo de Uso + Spotlight

### Runtime confirmado

- Frontend CODEX agora em `http://localhost:3004` (vite dev, não nginx) — `npm run dev -- --port 3004 --strictPort`
- Backend CODEX agora em `http://localhost:8003` (uvicorn local) — não 8001 como na nota anterior. CORS_ORIGINS deve incluir `http://localhost:3004` no `.env` ou via env override.
- `frontend/.env.local` precisa apenas `VITE_API_URL=http://localhost:8003`. `VITE_WS_URL` foi removido — o hook `useBroadcastWebSocket` constrói a URL internamente a partir de `VITE_API_URL`.
- Redis 6381 compartilhado com o stack do original (sem conflito).

### Audit do código do Codex — 3 bugs críticos corrigidos

1. **Multi-tenant scoping bug em `_build_health` (command_center.py)** — Codex puxava até 1000 linhas de `user_bank_credentials` de TODOS os usuários (RLS bypassed pelo service_role) e filtrava em Python pelo `user_id`. Tabela usa coluna `user_id` (não `owner_id`). Fix: query direta `db.table(...).select(...).eq("user_id", owner_id).execute()`. Sem pull-all-then-filter.
2. **Sem timeout no `live_meta=true`** — 3 dispatchers × até 20 WABAs × chamadas httpx sequenciais podia travar minutos. Fix: `asyncio.wait_for(_audit_meta_tokens_live(settings), timeout=45)` com fallback automático para cache + flag `live_meta_timed_out: true` na resposta.
3. **Dead key `assignments_table`** em DISPATCHERS nunca lida — removido.

### Outras correções

- `_build_capacity` gerava 7 linhas vazias quando `total == 0`. Agora retorna `plan=[]` + `estimated_days=None`.
- Badge "live/cache" no header de Auditoria Meta agora deriva de `data.meta_audits.some(a => a.live)` em vez do estado local — cobre fallback por timeout.

### Redesign Central de Controle

Codex tinha entregado UI funcional mas com paleta própria flat (#070712, #101225) ignorando o design system existente `frontend/src/components/disparo-shared/`. Redesenhada usando `glassCard()`, `sectionTitle()`, `PulseDot`, `GradientBar`, gradientes `G.*`. Hero hero com cérebro animado 🧠. Tipagem TS completa (saiu `any[]` em todo lado). Responsivo via `@media` queries proper (não brittle attribute selectors). Usuário aprovou: "ficou pika".

### Modo de Uso redesenhado

Mesmo design system. Sidebar glassmorphism com gradient borders. Brain badge. Progress bar. Adicionado **novo guia "Central de Controle"** (8º item da sidebar, ícone 🧠) com manual completo de 11 blocos: Score, KPIs, Checklist, Simulador, Risco, Health, Incidentes, Entregabilidade, Radar, Auditoria, Templates. Checklist de 7 passos pra rotina diária com a Central. Guia "Rotina recomendada" atualizado mencionando abrir Central antes de disparos grandes.

### Bug de contraste corrigido

Primeira versão de botões `LinkButton` no Modo de Uso usava `color: active.accent` sobre fundo `${color}17`. Resultado: texto verde sobre fundo verde (Higienização), laranja sobre laranja (CRM), roxo sobre roxo (Central Controle). Ilegível. Fix: texto branco solid + border gradient + text-shadow + box-shadow accent. Aplicado também em títulos pequenos (`Fluxo recomendado`, `Como funciona`, `Checklist rápido`) que usavam `sectionTitle()` gradient — agora solid white uppercase. Mantido gradient apenas nos kickers grandes do Hero.

### Spotlight pattern shipped

Usuário pediu efeito hover (card brilha + outros escurecem). Aplicado primeiro nos 4 cards do Monitor de Templates (Marketing/Utility/Auth/Rejeitados). Aprovado: "MUITO FODA". Pattern extraído pra `frontend/src/components/disparo-shared/tokens.ts` no `SHARED_CSS` como CSS reusable:

- `.spot-grid` + `.spot-card` + `.spot-glow` + `.spot-shine` — para grids de cards
- `.spot-list` + `.spot-row` + `.spot-glow` — para listas de rows
- CSS var `--spot-color` controla cor do glow por card
- Cubic-bezier(.2,.7,.2,1) easing tipo Apple
- CSS-only, zero re-render React

### TODO próxima sessão

Aplicar `.spot-*` em TODOS os cards/listas do CODEX. Lista completa em `~/.claude/projects/-Users-macbookdegabriel/memory/next_session_codex_spotlight.md`.

### Validações 07/06

- ✅ `npx tsc --noEmit` zero erros em todas as iterações
- ✅ `npx vite build` 1.4MB bundle / 386KB gzip
- ✅ `python -c "from app.main import app"` rota `/api/command-center/overview` registrada
- ✅ `curl /api/health` 200 OK no backend 8003
- ✅ CORS liberado pra 3004
- ✅ Usuário validou visualmente Central de Controle + Modo de Uso + Spotlight

### Não esquecer

- Não commitar até pedido explícito do usuário
- Original em `/Users/macbookdegabriel/projetos/ACELERA CORBAN` permanece intocado
- Decisão de merge CODEX → original ainda pendente

---

## Ultra Review — Sessão 07/06/2026 (commit 5b9c2d5)

### Bugs corrigidos

| Arquivo | Linha | Severidade | Problema | Fix |
|---------|-------|-----------|----------|-----|
| `DashboardAgregado.tsx` | 276 | 🔴 | Barra de progresso por plataforma usava `src.total * 1000` como denominador (campaigns count, não sends) → barra sempre 0% | Substituído por `dispatchStats.totalSent` |
| `Configuracoes.tsx` | 260 | 🟡 | Texto instrui "Deixe vazio para remover a proteção" mas validação (linha 290) rejeita campo vazio | Texto corrigido: "Use o botão Remover Senha abaixo" |
| `DisparoAesir.tsx` | 237-342 | 🟡 | ~106 linhas de código duplicado (effectiveQuality, statusCards, extraWarnings, topLevel, AlertLevel, ALERT_COLOR) — já exportadas em disparo-shared/quality.ts | Removido código local, adicionado import |

### TypeScript pós-fix
```
npx tsc --noEmit → 0 errors
```

### Pendências pós-review
- ⏳ Deploy VPS: `git pull && docker compose -f docker-compose.prod.yml build --no-cache backend frontend && up -d`
- ⏳ Aplicar `migrations/034_broadcast_recipients.sql` no Supabase `gfyharrnkcncpngbvhpj`
