# ACELERA CORBAN — Instruções para Claude

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
- Local dev: ports 3002 (front), 8002 (back), 6381 (redis)
- Produção: VPS Hostinger 177.7.58.154, domínio `aceleracorban.com.br` (Caddy + Cloudflare)
- Detalhes completos: `PROGRESS.md` (gitignored, tem credenciais)
- Spec do refactor multi-banco em curso: `docs/superpowers/specs/2026-05-02-multibank-refactor-design.md`

## Convenções

- Commits: português, prefixo `feat:`/`fix:`/`docs:`/`chore:` etc, descrição curta no "porquê"
- Co-author em commits: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
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

## Banco Mercantil (3º banco — 2026-05-13)

### Credenciais portal
- **URL:** `https://meu.bancomercantil.com.br/login`
- **Login:** `35275CF.GABRIEL`
- **Senha:** `zZB|;v8eoe5~J1$[_4/_%`
- **SMS 2FA:** código 6 dígitos pro celular final **-5744** (pode levar até 5 min)

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
4. localhost:3002 → Mercantil → Upload CSV → Iniciar Bot
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

