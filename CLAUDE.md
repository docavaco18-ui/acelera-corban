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

## Deploy

Local: `docker compose build --no-cache backend frontend && docker compose up -d`
Prod VPS (terminal web Hostinger, SSH externo bloqueado):
```bash
cd /root/acelera-corban && git pull && \
docker compose -f docker-compose.prod.yml build --no-cache backend frontend && \
docker compose -f docker-compose.prod.yml up -d backend frontend
```
