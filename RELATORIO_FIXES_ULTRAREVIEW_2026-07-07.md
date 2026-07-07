# Relatório de Correções — Ultra Review Acelera Corban (07/07/2026)

**Executor:** Claude Fable 5
**Base:** ultra review de 06/07 (`RELATORIO_ULTRAREVIEW_2026-07-06.md`, 70 achados confirmados)
**Baseline antes:** commit `e79bafb` — 148 testes ✅ tsc ✅
**Estado final:** commit `e5e14f9` — **162 testes ✅ tsc ✅**
**Escopo:** SÓ LOCAL. Nada deployado na VPS — aguarda OK do usuário.

> Para o Codex: este documento é o roteiro de conferência. Cada lote = 1 commit.
> A ordem foi risco crescente (safe → estrutural), com testes rodados após cada lote.

---

## Como conferir (na VPS, após deploy autorizado)

```bash
cd /root/acelera-corban
git log --oneline e79bafb..e5e14f9      # deve listar os 7 commits abaixo
cd backend && python3 -m pytest tests -q # deve dar 162 passed
cd ../frontend && npx tsc --noEmit       # deve sair 0
```

Deploy (só quando o usuário autorizar):
```bash
cd /root/acelera-corban && git pull && \
docker compose -f docker-compose.prod.yml build --no-cache backend frontend && \
docker compose -f docker-compose.prod.yml up -d backend frontend
docker compose -f docker-compose.prod.yml logs -f backend   # observar
```

---

## Os 7 commits (lotes)

| # | Commit | Lote | Arquivos-chave |
|---|--------|------|----------------|
| 1 | `f326c23` | SAFE (24 fixes) | command_center, admin_users_monitor, users_monitor_summary, db_scoped, assignment_validator, aesir_broadcast, AICore, NumberQualityGrid, OverviewDashboard, CentralUsuarios, CampaignHistoryList, Disparo/Aesir/Chipcare |
| 2 | `55b1879` | MULTI-BM | meta_client, broadcast, aesir_broadcast, chipcare_broadcast |
| 3 | `64e6c61` | CAPACIDADE | claude_advisor, assignment_validator, aesir/chipcare_broadcast, broadcast + 5 testes |
| 4 | `f314308` | PAUSE REAL | aesir_client, chipcare_client, aesir/chipcare_broadcast, broadcast |
| 5 | `f806fb6` | MONITOR | monitor_loop + 9 testes (compute_dispatch_terminal) |
| 6 | `70b58fc` | CENTRAIS | command_center, admin_users_monitor, broadcast |
| 7 | `e5e14f9` | FRONTEND | broadcast (novo /pause), api.ts, Disparo/Aesir/Chipcare, quality.ts |

---

## Detalhe por lote

### Lote 1 — SAFE (`f326c23`) — 24 correções sem efeito colateral
**Backend:**
- `command_center.py`: `used_today` com filtro `created_at >= hoje` server-side (antes query sem data → zerava pra clientes com >5000 assignments). KPI "canais saudáveis" alinhado com `_is_number_healthy` (pausado/sem-tier não conta como saudável). `_safe_select` loga exceção em vez de virar "não configurado". Incidente fantasma no live audit (CRM não configurado) eliminado. Expõe `has_payment_issue` e `last_meta_check_at` por canal.
- `assignment_validator.py`: gate de qualidade RED + can_send BLOCKED no validator Chipcare.
- `aesir_broadcast.py`: split exclui instâncias meta-only/desconectadas; stop_event só após validação de ownership.
- `admin_users_monitor.py`: snapshot de erro NÃO é cacheado (falha transiente ≠ "0 clientes"); paginação real (>200 usuários); `?force=1` faz bypass do cache.
- `users_monitor_summary.py`: BMs "pending" (porta legada backfilled) contam no total.
- `db_scoped.py`: `TENANT_TABLES` cobre `vendeai_meta_tokens`, `aesir_settings`, `chatwoot_settings`.
- `broadcast.py`: porta com token indecifrável vira aviso no refresh (não some silenciosa).

**Frontend:**
- `AICore.tsx`: `assignments_json` normalizado (Aesir/Chipcare mostravam 0 mensagens/0%); polling pausa com aba oculta + guard de request em voo.
- `NumberQualityGrid.tsx`: badge "CRM VendeAI" respeita `chatwoot_connected`.
- `OverviewDashboard.tsx` + `CentralUsuarios.tsx`: idade real do dado Meta ("sincronizado há Xh", âmbar >24h).
- `CampaignHistoryList.tsx` + Aesir/Chipcare: erros de pause/cancel/load não são mais engolidos (banner vermelho).
- `Disparo.tsx`: "Total Erros" usa `failed` (era `errors`, sempre 0); card renomeado "Números ativos".
- `DisparoAesir.tsx`: template resolvido por nome+idioma (evita idioma errado).

### Lote 2 — MULTI-BM (`55b1879`) — porta = 1 BM de verdade ⭐ core do pedido
- `meta_client.py:discover_wabas`: com `bm_id` explícito usa **só a Strategy 0** (early-return). As Strategies 1–3 varriam TODAS as businesses do token e contaminavam a porta com WABAs de outras BMs (token de agência multi-BM). Vazio agora = erro honesto, nunca número na BM errada.
- `broadcast.py`: dedup de porta re-checado com o `bm_id` **resolvido** pela Meta (antes só pegava se o usuário digitasse); PATCH também deduplica e, ao trocar BM, limpa os números órfãos + rebaixa o badge; **badge da porta rebaixado pra `erro` quando o token falha** no refresh (e `estavel` quando sincroniza); limpeza de órfãos por-porta (erro numa porta não desliga a limpeza das outras).
- `aesir_broadcast.py` + `chipcare_broadcast.py`: Step de limpeza de órfãos replicado (BM trocada não deixa número fantasma).

### Lote 3 — CAPACIDADE (`64e6c61`) — APROVADO pelo usuário
Decisão: replicar a regra VendeAI (16-18/06) nos 3 CRMs.
- Aesir/Chipcare refresh: **tier null → "aguardando Meta" + capacidade 0**. NUNCA mais 500/dia fabricado (estouro de tier real → queda de quality → ban). Preserva o último tier REAL quando a Meta falha só na rodada.
- Validators (3 CRMs): `daily_limit 0` → 400 "sem capacidade confirmada"; `planned` comparado ao limite **restante** do dia (desconta `sent_today`).
- Splits (3 CRMs): proporcionais ao limite restante — 2º disparo do dia não estoura o tier.
- VendeAI validator ganha gate RED; Chipcare split exclui RED/BLOCKED.
- PATCH `bm_daily_limit`: override "(BM)" não é mais confundido com tier real.
- Cruzamento Chipcare×Meta por bloco contíguo de 10-13 dígitos do título (dígito solto não quebra o match).
- **+5 testes** (capacidade/sent_today/RED).

### Lote 4 — PAUSE REAL (`f314308`) — APROVADO pelo usuário
Decisão: parada real no Aesir e Chipcare.
- **Aesir:** pause/cancel do modo template chamam `cancel_campaign` no Aesir (persiste `campaign_id` por assignment). Se o Aesir não confirmar, retorna `ok=false` + aviso honesto. `dispatch_csv`: circuit breaker (aborta após 10 erros consecutivos — token revogado/instância off) + dedup de telefone. Sem `campaign_id` → status `sem_confirmacao` com `sent=0` (não fabrica mais `sent=len(recipients)`).
- **Chipcare:** `cancel_dispatch` tenta desativar TODAS as campanhas (`deactivate_campaign`, SA configurável `sa_deactivate`). Sem o hash ou falhando → status `cancel_requested` + aviso pro operador (**nunca mais "cancelled" silencioso**). `activate_dispatch` ativa TODAS as campanhas do multi-canal (antes só a 1ª).
- **VendeAI:** pause/revoke com mailings sem `vendeai_mailing_id` não marcam `paused` silenciosamente — `ok=false` + aviso.

> ⚠️ **Pendência conhecida (Chipcare):** o SA hash de desativar campanha não foi descoberto (precisa de sessão de browser ao vivo — técnica `curl + grep createServerReference`). Quando descoberto, salvar em `chipcare_settings.sa_deactivate` e o cancel passa a parar sozinho. Até lá, o cancel avisa "desative no painel do Chipcare".

### Lote 5 — MONITOR (`f806fb6`) — APROVADO pelo usuário
Decisão: estender monitor + auto-pause aos 3 CRMs.
- Monitor observa agora `running` + `dispatching` + `partial_error` (antes só `running`).
- `compute_dispatch_terminal` (função pura, **9 testes**): dispatch VendeAI que terminou vira `done`/`partial_error`/`error` em vez de ficar `running` pra sempre (deferido 8 — alimentava o N+1 do polling). Só marca terminal quando NENHUM assignment está vivo.
- `_monitor_crm_quality`: durante disparo Aesir/Chipcare ativo, poll de qualidade Meta por número (throttle 120s) + auto-pause (is_paused + dispatch paused + alerta crítico) quando cai pra RED. Mesma proteção anti-ban que só o VendeAI tinha.

### Lote 6 — CENTRAIS (`70b58fc`)
- `used_today` conta Aesir/Chipcare (assignments_json de hoje) — capacidade restante deixa de ser superestimada.
- Radar de erros/incidentes com janela de 7 dias; `cancelled`/`revoked` (ações do usuário) não contam como erro.
- Templates: sem auditoria ao vivo, o cache reporta 0 — não penaliza mais o checklist/score ("info" em vez de -4 fantasma).
- Auditoria live cobre portas multi-BM (`vendeai_meta_tokens`) quando não há token legado (deferido 4).
- Live audit com cooldown Redis 120s por owner; `/refresh-live` com lock Redis 5min (deferido 7).
- `broadcast.py`: 6× `.single()` → `.maybe_single()` (dispatch/creds inexistentes = 404/400 honesto, não 500).

### Lote 7 — FRONTEND (`e5e14f9`)
- Botão Pausar número (VendeAI): novo `POST /numbers/{id}/pause` (espelho do resume) — antes era no-op.
- Wizards Aesir/Chipcare: removido `|| 500` (alinhado com backend).
- `bmSummary`: capacidade ignora números "SÓ META" (não disparáveis).
- Chipcare: banner de risco vermelho nas velocidades Agressivo/Máximo.

---

## O que ficou DEFERIDO (não mexido — precisa decisão/infra)

| Achado | Arquivo | Por quê |
|--------|---------|---------|
| Score triplo-conta causa raiz | `command_center.py:613` | Decisão de produto sobre a semântica do score |
| JWT sem revogação (deferido 2) | `auth_deps.py:62` | Precisa migration `token_version`/blacklist — mudança estrutural |
| App Secret hardcoded (deferido 3) | `main.py:127` | Checar se `META_APP_SECRET` existe na env da VPS ANTES de mover (senão derruba `/api/data-deletion`) |
| SA hash de desativar Chipcare | `chipcare_client.py` | Descobrir via browser ao vivo → salvar em `chipcare_settings.sa_deactivate` |

**Segurança — pra decidir com o usuário:** rotacionar `META_APP_SECRET` (pendência antiga da memória).

---

## Resumo de números

- **70 achados** confirmados no review → **~60 corrigidos** neste ciclo (safe + careful + os 3 delicados aprovados).
- **4 deferidos** por decisão de produto/infra (acima).
- Testes: **148 → 162** (+14 novos: capacidade, sent_today, RED, terminal de dispatch).
- tsc: limpo.
- **0 quebras** — cada lote rodou a suíte completa antes do commit.
