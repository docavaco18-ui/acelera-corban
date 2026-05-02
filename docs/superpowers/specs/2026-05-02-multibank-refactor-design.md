# Refactor multi-banco — ACELERA CORBAN

**Data:** 2026-05-02
**Status:** Aprovado pelo usuário, aguardando review do spec

## Objetivo

Transformar ACELERA CORBAN (hoje só V8) em plataforma multi-banco. Cada banco é um módulo isolado (V8, VCTex, próximos). Cada usuário cadastra suas próprias credenciais e proxies por banco. Dashboard agrega métricas dos dois bancos.

## Decisões aprovadas

1. **Login** — título muda de `🤖 V8 Bot` pra `ACELERA CORBAN`.
2. **Menu lateral** (ordem fixa): V8, VCTex, Credenciais, Higienizações, Dashboard.
3. **Cada banco isolado** — tela própria, dados próprios, bot próprio. Não há mistura.
4. **Tabelas separadas por banco** — `v8_leads` (existente, intocado), `vctex_leads` (nova). Sem tabela unificada.
5. **Credenciais por usuário** — login/senha de cada banco vivem em `user_bank_credentials` criptografado (Fernet, chave única no `.env`). Bot usa as credenciais do usuário logado, não env global.
6. **Proxies por usuário** — até 5+ proxies por banco. UI tem 5 campos + botão "adicionar mais". Sem proxy = roda no IP do servidor (com aviso).
7. **Admin** — continua vendo tudo de todos os usuários em todos os bancos.
8. **Compatibilidade** — leads V8 já existentes em produção continuam funcionando (mesmo `owner_id`). Deploy não pode quebrar prod.

## Arquitetura

### Banco de dados (migration `002_multibank.sql`)

**Nova tabela `user_bank_credentials`:**
```sql
id UUID PK
user_id UUID NOT NULL  -- FK auth.users
bank_code TEXT NOT NULL CHECK (bank_code IN ('v8','vctex'))
login_enc BYTEA          -- Fernet
password_enc BYTEA       -- Fernet
extra_enc BYTEA          -- Fernet, JSON pra campos extras (token, conta, etc)
proxies_enc BYTEA        -- Fernet, JSON array de URLs
created_at, updated_at
UNIQUE (user_id, bank_code)
```

**Nova tabela `vctex_leads`** (espelho de `v8_leads`, com status próprio do VCTex):
```
id, owner_id, cpf UNIQUE per owner, telefone, nome,
status: 'pendente'|'fase0'|'fase1'|'fase2'|'elegivel'|'inelegivel'|'erro',
valor_liberado, payload JSONB, created_at, updated_at
```

**Nova tabela `vctex_bot_runs`** (espelho de `v8_bot_runs` + `owner_id`).

**Não mexer:** `v8_leads`, `v8_bot_runs` — ficam exatamente como estão.

### Backend (FastAPI)

```
backend/app/
├── banks/
│   ├── v8/        ← código V8 atual movido pra cá
│   │   ├── router.py    (rotas /api/banks/v8/*)
│   │   ├── service.py   (lógica V8 API REST)
│   │   ├── bot.py       (worker V8)
│   │   └── auth.py      (OAuth2 V8 — agora usando creds do usuário)
│   └── vctex/     ← código VCTex copiado de /projetos/vctex
│       ├── router.py
│       ├── service.py
│       ├── bot/        (engine, worker, humanize)
│       └── ...
├── credentials/   ← novo
│   ├── router.py        (GET/PUT /api/credentials)
│   ├── service.py       (encrypt/decrypt, lookup por user+bank)
│   └── crypto.py        (Fernet wrapper)
├── dashboard/     ← novo
│   ├── router.py        (/api/dashboard/summary, /by-bank, /runs)
│   └── service.py       (UNION ALL entre v8_leads e vctex_leads)
├── auth.py        (Supabase JWT — sem mudança)
├── database.py
├── redis_client.py
└── main.py        (registra todos os routers)
```

**Criptografia:**
- Lib: `cryptography.fernet.Fernet`
- Chave: env var `APP_ENCRYPTION_KEY` (gerada com `Fernet.generate_key()`)
- Backup obrigatório da chave (perder a chave = perder credenciais)
- Documentar em README

**Lookup de credenciais no bot:**
- Cada `bot_run` carrega `owner_id`
- Worker pega `owner_id` da run → lê `user_bank_credentials` → descriptografa → usa
- Se faltar credencial: marca run como `erro` com mensagem clara

**Fallback de proxy:**
- Lista vazia → bot roda sem proxy (IP do servidor)
- VCTex sem proxy quase sempre vai falhar (Incapsula) — UI deve avisar

**Compat shim (transição):**
- Mantém rotas atuais (`/api/leads`, `/api/bot`, `/api/stats`) como aliases pro V8 router por 1 ciclo de deploy
- Frontend antigo em produção continua funcionando enquanto migramos
- Depois remove o shim

### Frontend (React + Vite)

```
frontend/src/
├── components/
│   ├── AppLayout.tsx     ← novo: sidebar fixa + header
│   └── Sidebar.tsx       ← novo: menu V8/VCTex/Credenciais/Dashboard
├── banks/
│   ├── v8/
│   │   ├── Records.tsx
│   │   ├── BotControl.tsx
│   │   ├── Upload.tsx
│   │   └── index.tsx     (página V8 completa)
│   └── vctex/
│       ├── Records.tsx
│       ├── MissionControl.tsx
│       ├── BotControl.tsx
│       └── index.tsx
├── pages/
│   ├── Login.tsx         ← título atualizado
│   ├── Credentials.tsx   ← novo
│   ├── Higienizacoes.tsx ← novo: histórico de runs (todos os bancos)
│   └── Dashboard.tsx     ← reescrita: agregação de tudo
├── lib/
│   └── api.ts            ← rotas /api/banks/<code>/*
└── App.tsx               ← rotas: /banks/v8, /banks/vctex, /credentials, /dashboard
```

**Tela Credenciais:**
- Tabs por banco (V8 / VCTex)
- Campos: Login, Senha (mostra `••••` se já cadastrado), 5 inputs de Proxy + botão "+ Adicionar mais"
- Banner informativo:
  > 💡 Pra rodar muitos CPFs sem ser bloqueado, recomendamos cadastrar seus próprios proxies (IPv4). Sem proxy o sistema usa o IP do servidor — funciona, mas em volume alto pode travar.
- Submit → `PUT /api/credentials/{bank}` com payload JSON

**Tela Higienizações (histórico):**
- Lista todas as runs do usuário (V8 + VCTex juntos), ordenadas por data desc
- Colunas: Data, Banco (V8/VCTex), Nome do arquivo, Total CPFs, Elegíveis, Liberado (R$), Status (concluído/rodando/erro), Ações
- Ações por linha:
  - **Ver progresso** — abre modal com detalhes da run (logs, % processado, erros)
  - **Baixar CSV** — exporta resultado da higienização (CPF + status + valor + telefone, etc)
- Filtros simples: banco, data
- Backend: `GET /api/higienizacoes` lê `v8_bot_runs` UNION `vctex_bot_runs` filtrado por `owner_id` (admin vê todos)
- Endpoint download: `GET /api/higienizacoes/{run_id}/download` → CSV gerado dos leads daquela run

**Tela Dashboard (agregada):**
- Cards: Total leads, Total elegíveis, Total liberado (R$)
- Breakdown por banco (V8 vs VCTex)
- Lista de últimas runs (das duas)
- Logs (Redis tail)

**Roteamento pós-login:**
- Se usuário não tem nenhuma credencial cadastrada → redirect pra `/credentials`
- Senão → primeiro banco com credencial cadastrada

## Fluxo de deploy (zero-downtime)

1. **Phase 1** — Migration DB (additive, não quebra nada)
2. **Phase 2.1-2.5** — Backend novo com shim de compat → deploy → prod continua funcionando via shim
3. **Phase 2.6** — VCTex módulo
4. **Phase 2.7** — Dashboard agregada
5. **Phase 3** — Frontend novo → deploy
6. **Phase 4** — Remover shim depois de 1-2 dias estáveis

## Riscos

- **Perda da chave Fernet** → todas credenciais ficam ilegíveis. Mitigação: backup da chave em 2 lugares (cofre local + outro).
- **Bot V8 já rodando durante deploy** → drenar via flag Redis antes do deploy.
- **VCTex sem proxy** → quase sempre vai falhar com Incapsula. Mitigação: aviso claro na UI.
- **Migração de credenciais existentes** → admin precisa cadastrar suas creds V8 atuais via UI no primeiro deploy (ou script seed lendo .env atual).

## Estimativa

~6-8 horas de trabalho focado, com pontos seguros de pausa em cada fase.

## Próximo passo

Após aprovação deste spec, invocar `writing-plans` skill pra detalhar implementação passo-a-passo.
