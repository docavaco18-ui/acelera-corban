# Mercantil Bot — Dashboard Integration Design
**Data:** 2026-05-14  
**Status:** Aprovado pelo usuário

---

## Contexto

Bot Mercantil (CLT MTE) usa BFF Bridge via `page.evaluate` — arquitetura diferente de V8/VCTex. Portal Angular com reCAPTCHA Enterprise exige contexto JS autenticado. Login tem SMS 2FA obrigatório que pode falhar se não inserido corretamente na primeira tentativa. Por isso, o fluxo de sessão é separado do fluxo de processamento.

---

## Decisão de Arquitetura

**Página dedicada `/mercantil`** — nenhum arquivo de V8/VCTex é tocado. Separação total.

---

## Componentes

### Frontend — novos arquivos

| Arquivo | Responsabilidade |
|---------|-----------------|
| `pages/Mercantil.tsx` | Página raiz, dois painéis lado a lado |
| `components/mercantil/SessionPanel.tsx` | Login Visual, status sessão, SMS modal trigger |
| `components/mercantil/LeadsPanel.tsx` | Upload CSV, Rodar Bot, tabela resultados |
| `hooks/useMercantilSession.ts` | Poll `/api/mercantil/bot/session-status` |
| `hooks/useMercantilBot.ts` | Start/stop bot, WebSocket resultados por CPF |

### Frontend — arquivos existentes modificados

| Arquivo | Mudança |
|---------|---------|
| `App.tsx` | Adiciona rota `/mercantil` → `<Mercantil />` |
| `App.tsx` | BankToggle "Mercantil" navega para `/mercantil` em vez de `/` |
| `components/MercantilSmsModal.tsx` | Já existe — sem mudança |
| `hooks/useMercantilSmsBridge.ts` | Já existe — sem mudança |

### Backend — novos endpoints

| Método | Path | Descrição |
|--------|------|-----------|
| `POST` | `/api/mercantil/bot/login-visual` | Inicia Playwright headful, preenche login/senha, aguarda SMS via Redis |
| `GET` | `/api/mercantil/bot/session-status` | Retorna `{ status: "valid"\|"expired"\|"logging_in"\|"none", saved_at: ISO }` |
| `POST` | `/api/mercantil/bot/start` | Inicia processamento headless usando storage state salvo |
| `POST` | `/api/mercantil/bot/stop` | Para o bot |

### Backend — arquivos existentes

| Arquivo | Status |
|---------|--------|
| `routers/mercantil.py` | Adiciona 4 endpoints acima |
| `banks/mercantil/engine.py` | Adiciona `login_visual()` — headful, sem timeout |
| `banks/mercantil/worker.py` | Adiciona detecção de sessão expirada + retry 2x headless |
| `services/mercantil_bot_service.py` | Adiciona `get_session_status()` |

---

## Fluxo de Sessão (Login Visual)

```
Usuário clica "Login Visual"
  → POST /api/mercantil/bot/login-visual
  → Backend: Playwright headful, browser visível
  → Bot auto-preenche login + senha
  → Portal exibe tela SMS (bot não fecha, fica aguardando)
  → Frontend: SMS Modal aparece (Redis BLPOP timeout=infinito)
  → Usuário digita 6 dígitos no dashboard → POST /api/mercantil/bot/sms
  → Redis RPUSH → bot preenche SMS → clica Verificar
  → Sucesso: storage state salvo em .bot_state/mercantil/{user_id}.json
  → WS event: session_saved → SessionPanel mostra "✅ Sessão válida"
  → Browser fecha (bot não processa leads)
```

**Regra:** Login Visual NUNCA inicia processamento de leads. Só salva sessão.

---

## Fluxo de Processamento (Modo Furtivo)

```
Usuário clica "Rodar Bot"
  → POST /api/mercantil/bot/start
  → Backend: carrega storage state do disco
  → Playwright headless (invisível)
  → Para cada CPF pendente em mercantil_leads:
      → BFF Bridge (page.evaluate fetch)
      → Cenário A ou B
      → Salva resultado no DB
      → WS event: { cpf, status, valor_liberado } → tabela live no frontend
  → Progresso: [idx/total] | elegíveis: N
```

---

## Tratamento de Sessão Expirada Mid-Run

```
Bot detecta JWT inválido (401 no BFF ou redirect /login)
  → Tenta re-login headless 2x (sem SMS, usando storage state)
  → Se sucesso: continua do CPF atual
  → Se falha (precisa SMS):
      → WS event: session_expired
      → Bot pausa (salva posição no DB)
      → Frontend: banner "⚠️ Sessão expirou — faça Login Visual"
      → Usuário: Login Visual → SMS → Rodar Bot
      → Bot retoma: query WHERE status='pendente' → continua
```

---

## Resume Automático

Bot sempre consulta `SELECT * FROM mercantil_leads WHERE status='pendente' AND batch_id=?` ao iniciar. CPFs já processados (`elegivel`, `inelegivel`, `erro`) são pulados automaticamente.

---

## Banco de Dados

Migration `020_mercantil.sql` — deve ser aplicada no Supabase `gfyharrnkcncpngbvhpj` antes do deploy.

Tabelas: `mercantil_leads`, `mercantil_batches`, `mercantil_bot_runs`.

---

## UX da Página `/mercantil`

```
┌──────────────────────────────────────────────────────────────┐
│  Mercantil Bot                                               │
├─────────────────────────┬────────────────────────────────────┤
│  SESSÃO                 │  LEADS                             │
│                         │                                    │
│  Status: ✅ Válida      │  [Upload CSV]   [Rodar Bot]        │
│  Salva às 14:23         │                                    │
│                         │  Progress: 142/5499 | elegíveis: 3 │
│  [Login Visual]         │                                    │
│                         │  CPF          Status    Valor      │
│  (SMS Modal aparece     │  758.584...   ✅ elegível R$14.4k  │
│   aqui quando ativo)    │  186.997...   ❌ inelegível        │
│                         │  395.849...   ❌ inelegível        │
└─────────────────────────┴────────────────────────────────────┘
```

---

## Ordem de Implementação

1. Aplicar migration 020 no Supabase
2. Backend: endpoint `session-status` + `login-visual` + `start` + `stop`
3. Backend: engine `login_visual()` headful sem timeout
4. Backend: worker com detecção sessão expirada + retry + pausa
5. Frontend: `Mercantil.tsx` + `SessionPanel` + `LeadsPanel`
6. Frontend: hooks `useMercantilSession` + `useMercantilBot`
7. Frontend: rota `/mercantil` no App.tsx + BankToggle redirect
8. Teste local end-to-end
9. Deploy VPS
