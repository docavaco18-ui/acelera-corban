# Ultra Review — Acelera Corban Disparo + Centrais (2026-07-06)

**Auditor:** Claude Fable 5 (workflow multi-agente, 200 agentes totais, 11M tokens)
**Baseline:** 148 testes ✅ | tsc ✅ | commit `8d0a42d`
**Foco:** disparo multi-BM por porta, capacidade/qualidade real dos números, pause/cancel real, Central de Controle fidelidade, Central de Usuários, isolamento multi-tenant
**Status:** SÓ LEITURA — zero código alterado. Fixes aguardam próxima sessão.

---

## SUMÁRIO EXECUTIVO

| Severidade | Qtd | Fix risk breakdown |
|---|---|---|
| 🔴 critical | 1 | delicate |
| 🟠 high | 24 | 5 safe · 15 careful · 4 delicate |
| 🟡 medium | 33 | 10 safe · 20 careful · 3 delicate |
| ⚪ low | 12 | 7 safe · 4 careful · 1 delicate |
| **Total** | **70** | **24 safe · 39 careful · 7 delicate** |

Decisões do usuário (já aprovadas):
- ✅ Replicar regra VendeAI de tier (null → 0/"aguardando Meta") no Aesir e Chipcare
- ✅ Pause/cancel real no Aesir template + Chipcare (para o envio de verdade)
- ✅ Estender monitor de qualidade + auto-pause aos 3 CRMs

---

## CRITICAL

### 🔴 [critical][delicate][ban-risk] `aesir_broadcast.py:777`
**Pause/Cancel do disparo Aesir em modo template NÃO para o envio — só para o polling**
- Botão "Pausar" e "Cancelar" no Aesir (modo template) marcam o DB como paused/cancelled mas NÃO param o envio real no CRM. Mensagens continuam saindo após o usuário achar que pausou.
- Fix aprovado: checar stop_event no loop de envio do Aesir template.

---

## HIGH (24)

### 🟠 [high][careful][correctness] `meta_client.py:185` ⭐ CORE MULTI-BM
**discover_wabas não restringe à BM da porta — contamina com WABAs de outras BMs**
- Strategies 1–3 executam incondicionalmente após Strategy 0, puxando WABAs de TODAS as BMs do token. Token agência com múltiplas BMs: números aparecem sob BM/porta errada, limite manual de uma BM vaza pra outra, badge inflado.
- Fix: early-return após Strategy 0 quando bm_id está presente.

### 🟠 [high][careful][ban-risk] `chipcare_broadcast.py:108`
**Chipcare: número RED/BLOCKED entra no split — zero gate de qualidade**

### 🟠 [high][careful][ban-risk] `aesir_broadcast.py:329`
**Aesir: fabrica daily_limit=500 quando Meta não reporta tier (viola regra VendeAI)**

### 🟠 [high][careful][ban-risk] `chipcare_broadcast.py:379`
**Chipcare: mesma fabricação de daily_limit=500 no refresh, split e DEFAULT da tabela**

### 🟠 [high][careful][ban-risk] `claude_advisor.py:49`
**Split não desconta sent_today — segundo disparo no dia planeja o tier CHEIO e estoura**

### 🟠 [high][delicate][ban-risk] `monitor_loop.py:37`
**Monitor + auto-pause cobrem SÓ VendeAI — Aesir/Chipcare rodam sem vigilância de qualidade**
- Fix aprovado: estender aos 3 CRMs.

### 🟠 [high][careful][ban-risk] `command_center.py:260`
**Capacidade restante ignora envios do dia via Aesir/Chipcare (used_today=0 nesses CRMs)**

### 🟠 [high][safe][ban-risk] `command_center.py:148`
**used_today zera para clientes com >5000 assignments (query sem filtro de data nem ORDER)**

### 🟠 [high][careful][data-fidelity] `aesir_broadcast.py:329`
**Card 'Capacidade hoje' soma daily_limit fabricado (500) do Aesir**

### 🟠 [high][delicate][ban-risk] `aesir_broadcast.py:329`
**KPI 'Capacidade total/dia' da Central soma daily_limit fabricado e nunca desconta uso**

### 🟠 [high][delicate][ban-risk] `chipcare_broadcast.py:805`
**Cancel do Chipcare é cosmético: não desativa campanha no CRM**
- Fix aprovado: chamar API do CRM para desativar.

### 🟠 [high][careful][ban-risk] `broadcast.py:1115`
**VendeAI Pause/Revoke: mailings sem vendeai_mailing_id continuam disparando no CRM**

### 🟠 [high][careful][ban-risk] `monitor_loop.py:38`
**monitor_loop não monitora 'partial_error' e 'dispatching' — ficam enviando sem polling**

### 🟠 [high][careful][ban-risk] `assignment_validator.py:106` *(deferido 1 — confirmado ainda existe)*
**Validador não desconta sent_today: múltiplos disparos no mesmo número estouram o tier**

### 🟠 [high][careful][data-fidelity] `command_center.py:393` *(deferido 4)*
**Auditoria Meta live só usa token legado, ignora portas vendeai_meta_tokens**

### 🟠 [high][delicate][ban-risk] `monitor_loop.py:37` *(deferido 8)*
**Dispatch VendeAI nunca termina — fica 'running' pra sempre, alimenta N+1 no polling**

### 🟠 [high][careful][ban-risk] `Disparo.tsx:530`
**Botão ⏸ Pausar número no VendeAI é no-op silencioso — número degradado continua recebendo leads**

### 🟠 [high][careful][data-fidelity] `AICore.tsx:272`
**'enviadas hoje' + 'Capacidade Hoje' mostram 0 nas 3 páginas (sent_today nunca chega à UI)**

### 🟠 [high][careful][data-fidelity] `DisparoAesir.tsx:504`
**Frontend Aesir faz `|| 500` — fabricação de capacidade duplicada (backend + frontend)**

### 🟠 [high][safe][data-fidelity] `AICore.tsx:141`
**AIMonitorPanel mostra 0 mensagens e 0% progresso para disparos Aesir/Chipcare ativos (campo errado)**

### 🟠 [high][safe][ban-risk] `assignment_validator.py:216`
**Chipcare permite disparo em canal RED/can_send bloqueado**

### 🟠 [high][careful][ban-risk] `aesir_broadcast.py:329` *(dup evidência Aesir tier)*
**Aesir fabrica tier 'nao reportado' violando regra VendeAI**

### 🟠 [high][careful][data-fidelity] `chipcare_broadcast.py:379` *(dup evidência Chipcare tier)*
**Chipcare fabrica tier 'nao reportado' no refresh e split**

---

## MEDIUM (33) — listagem resumida

| Arquivo:linha | Título |
|---|---|
| `broadcast.py:205` | Dedup porta por BM usa bm_id do body, não o resolvido |
| `broadcast.py:535` | Limpeza de órfãos desligada globalmente se qualquer porta tiver erro |
| `broadcast.py:410` | Badge "CONEXÃO OK ESTÁVEL" nunca rebaixado automaticamente |
| `broadcast.py:151` | Porta com token indecifrável omitida silenciosamente do refresh |
| `aesir_broadcast.py:300` | Aesir/Chipcare não limpam órfãos ao trocar BM |
| `broadcast.py:283` | PATCH bm_daily_limit: check `any(c.isdigit())` trata override "(BM)" como tier |
| `aesir_broadcast.py:56` | Split Aesir inclui instâncias meta-only/desconectadas |
| `monitor_loop.py:248` | sent_today não vai no snapshot WS nem em /numbers |
| `command_center.py:264` | KPI 'Canais saudáveis' conta pausados/sem-tier como saudáveis |
| `command_center.py:491` | Radar de erros sem janela temporal: falhas antigas viram incidentes "ativos" |
| `command_center.py:389` | Auditoria Meta live sem cooldown: até 120+ chamadas Graph por clique |
| `OverviewDashboard.tsx:169` | 'Atualizado em' mostra hora do request, não a do dado |
| `command_center.py:383` | Templates sempre 0 no modo cache (-4 no score indevidamente) |
| `users_monitor_summary.py:99` | Central mostra 'BMs 0/0' para clientes com porta legada |
| `command_center.py:148` | used_today sobre 5000 assignments sem filtro de data |
| `admin_users_monitor.py:102` | Snapshot de erro cacheado 5 min — falha transiente vira dado permanente |
| `command_center.py:264` | 'Números saudáveis' conta pausados/banidos/sem-tier |
| `CentralUsuarios.tsx:8` | UI descarta generated_at — dado de cache sem indicação de idade |
| `aesir_client.py:181` | dispatch_csv Aesir sem circuit breaker: erro fatal percorre o CSV inteiro |
| `aesir_client.py:140` | Aesir não deduplica leads — telefone repetido recebe msg múltiplas vezes |
| `aesir_broadcast.py:552` | Aesir template sem campaign_id retorna sent=len(recipients) fabricado |
| `chipcare_broadcast.py:784` | activate_dispatch ativa só 1ª campanha de N mas marca tudo como running |
| `CampaignHistoryList.tsx:196` | Pausar/Cancelar engole erro silenciosamente |
| `Disparo.tsx:441` | 'Total Erros' VendeAI sempre 0 (campo errado), 'Campanhas' conta telefones |
| `quality.ts:169` | BMSummary soma números 'SÓ META' (não disparáveis) na capacidade |
| `DisparoAesir.tsx:696` | Template Aesir colapsa por nome — idioma enviado pode divergir |
| `DisparoChipcare.tsx:325` | Opção MÁXIMO (~3600 msgs/h) sem aviso de risco |
| `auth_deps.py:62` | JWT sem revogação (deferido 2) |
| `main.py:127` | App Secret hardcoded + token em query string (deferido 3) |
| `command_center.py:451` | Incidente CRM fantasma ainda no live (deferido 5) |
| `db_scoped.py:3` | vendeai_meta_tokens fora de TENANT_TABLES (deferido 6) |
| `admin_users_monitor.py:106` | /refresh-live sem teto (deferido 7) |
| `users_monitor_summary.py:40` | Alerta pagamento nunca dispara + last_meta_check_at null (deferido 9) |

---

## LOW (12) — listagem

`broadcast.py:263` `NumberQualityGrid.tsx:47` `chipcare_broadcast.py:344` `command_center.py:78` `command_center.py:613` `admin_users_monitor.py:98` `admin_users_monitor.py:37` `aesir_broadcast.py:779` `broadcast.py:675` `db_scoped.py:17` `DisparoChipcare.tsx:695` `AICore.tsx:129`

---

## PLANO DE FIXES (7 lotes — ordem de execução)

### Lote 1 — SAFE (24 fixes, zero risco)
Executar primeiro: sem efeito colateral, todos reversíveis localmente.

### Lote 2 — MULTI-BM (5 fixes, careful)
`meta_client.py:185` early-return Strategies 1–3 quando bm_id presente
`broadcast.py:205/263` dedup por bm_id resolvido + PATCH
`broadcast.py:535` órfãos por-porta (não global)
`broadcast.py:410` badge rebaixar automaticamente
`aesir_broadcast.py:300` limpeza órfãos Aesir/Chipcare

### Lote 3 — CAPACIDADE (APROVADO pelo usuário)
Replicar regra VendeAI: tier null → 0/"aguardando Meta" no Aesir, Chipcare, assignment_validator
Descontar sent_today no split (claude_advisor) e no validator
Chipcare RED gate no split

### Lote 4 — PAUSE REAL (APROVADO pelo usuário)
Aesir template: stop_event no loop
Chipcare: desativar campanha no CRM no cancel + N campanhas no activate
VendeAI: mailings sem mailing_id
Aesir: dedup leads + circuit breaker + contagem otimista

### Lote 5 — MONITOR 3 CRMs (APROVADO pelo usuário)
Incluir partial_error/dispatching no monitor_loop
Transição terminal VendeAI
Estender qualidade + auto-pause pra Aesir/Chipcare

### Lote 6 — CENTRAIS (dados reais)
used_today com filtro de data, templates no cache, auditoria multi-token live,
incidente CRM fantasma, /refresh-live teto, alerta pagamento, radar temporal

### Lote 7 — FRONTEND
Fixes confirmados: enviadas hoje, fabricação 500, no-op pausar, AIMonitorPanel campo errado, etc.

---

## PARA O CODEX VERIFICAR NA VPS

Após deploy (a ser feito pelo usuário após OK):
```bash
cd /root/acelera-corban
# 1. Verificar versão do backend deployada
docker compose -f docker-compose.prod.yml ps backend
docker compose -f docker-compose.prod.yml logs --tail=30 backend

# 2. Verificar que discover_wabas respeita bm_id (grep na imagem rodando)
docker compose -f docker-compose.prod.yml exec backend grep -n "early-return" /app/app/services/broadcast/meta_client.py

# 3. Verificar tier null → 0 no Aesir
docker compose -f docker-compose.prod.yml exec backend grep -n "aguardando" /app/app/routers/aesir_broadcast.py

# 4. Verificar stop_event no Aesir template
docker compose -f docker-compose.prod.yml exec backend grep -n "stop_event" /app/app/routers/aesir_broadcast.py

# 5. Baseline de testes (rodar no checkout local antes de deployar)
# cd backend && python3 -m pytest tests -q — deve dar >= 148 passed
```

---

## O QUE NÃO FOI TOCADO (deferidos estruturais — decidir separado)
- JWT sem revogação (`auth_deps.py:62`) — precisa migration token_version
- App Secret hardcoded (`main.py:127`) — checar se env META_APP_SECRET existe na VPS antes de mover
- Score triplo-conta causa raiz (`command_center.py:613`) — decisão de produto
- Velocidade MÁXIMO sem aviso (`DisparoChipcare.tsx:325`) — decisão de produto

---

*Gerado automaticamente — 200 agentes, 11M tokens, 2 rounds de verificação adversarial + deep review nos critical/high*
