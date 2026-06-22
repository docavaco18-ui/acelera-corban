# HANDOFF — Central de Usuários (painel admin multi-tenant)

**Data:** 2026-06-21 · **Branch:** `feat/central-usuarios` · **Repo:** `~/projetos/ACELERA CORBAN PRODUCAO`

## O que é
Painel admin-only `/central-usuarios` (irmão da Central de Controle) que lista TODOS os clientes do Acelera Corban num só lugar: status BM, nº BMs conectadas, números (saudáveis/total + qualidade), capacidade real/dia, templates, CRM, **pendências ("o que falta")**, score 0-100. Só WhatsApp/Meta (sem bots banco). Dado real via engine `command_center` por usuário. Híbrido: cache instantâneo + botão ⚡ ao vivo (bate Meta API por token de cada cliente).

## Docs
- Spec: `docs/superpowers/specs/2026-06-21-central-usuarios-design.md`
- Plano (7 tasks, TDD, código completo): `docs/superpowers/plans/2026-06-21-central-usuarios.md`
- Ledger progresso: `.superpowers/sdd/progress.md` (+ briefs/reports task-N-*.md)

## Estado (commits na branch)
- ✅ **Task 1** `d039743` — refactor `compute_overview(db, owner_id, *, live_meta)` no command_center. Review clean.
- ✅ **Task 2** `8291043`+`aaca0b0` — `users_monitor_summary.py`: build_pending, count_bms, summarize_overview, error_summary, build_aggregate. Review clean.
- ✅ **Task 3** `f204d4c`+`f84b4ee` — router `admin_users_monitor.py` (GET `/api/admin/users-monitor`, POST `/refresh-live`, GET `/{owner_id}`), todos `require_admin`. Registrado em main.py. Review clean.
- ✅ **Task 4** `e35c3f9` — `adminUsersMonitorApi {list,refreshLiveAll,detail}` em frontend/src/lib/api.ts. Review clean.
- ✅ **Task 5** `b649a08`+`be0960a` — extraído `frontend/src/components/OverviewDashboard.tsx` da Central de Controle; CentralControle.tsx slim. Review clean (Important: import auto-referencial `../components/`→`./disparo-shared` corrigido em `be0960a`). tsc limpo.
- ✅ **Task 6** `2741bac`+`ee6bf92` — `frontend/src/pages/CentralUsuarios.tsx` (header 🧠 + 4 KPIs + grid UserCards + DetailDrawer reusando OverviewDashboard) + rota `/central-usuarios` em `<Protected adminOnly>` + link nav admin-only. Review clean (Important: DetailDrawer sem catch → corrigido com drawerError+retry em `ee6bf92`). tsc+build limpos.
- 🟡 **Task 7** — verificação localhost EM ANDAMENTO (pausada). Stack docker up. **PORTAS REAIS: front 3002 / back 8002 / redis 6381** (NÃO 8003/3004). Já verde autônomo: /health=200, front=200, gating API 401 nos 3 endpoints admin. **GOTCHA resolvido**: `--build` cacheia `npm run build` Vite → rebuild `--no-cache frontend` necessário (feito). FALTA: login admin docavaco18 no browser → cards cache + ⚡ ao vivo + drawer + redirect non-admin.

## Review final whole-branch (opus, 5a8a723..ee6bf92): READY TO MERGE = YES. 0 Critical, 0 Important. Backend 136 testes. tsc+build frontend limpos.
Minors não-bloqueantes: `summarize_overview` templates condition `or templates.get("by_status")` extra vs plano (benigno/dead prod, só dispara em test fixture); `simulated?.cap` optional-chain morto; loading splash sem BrainBadge (plan-mandated); useCallback/key={i}.

## RETOMAR (Task 7)
1. Garantir stack up: `docker compose ps` (front 3002 / back 8002). Se frontend stale: `docker compose build --no-cache frontend && docker compose up -d frontend`.
2. Browser `http://localhost:3002`, login admin docavaco18 (Ctrl+Shift+R p/ furar cache). Confirmar badge ADMIN + link "Central de Usuários" na barra topo.
3. Validar: cards reais carregam (cache) → ⚡ Auditar todos ao vivo (templates `—`→número, pendências) → clica card → drawer detalhe → ⚡ no drawer. Gating: usuário comum → redirect `/` + link some.
4. Gabriel aprova → merge `feat/central-usuarios`→`main` **SÓ LOCAL** (decisão: sem deploy VPS por enquanto). Deploy prod depois com OK explícito (`docker compose -f docker-compose.prod.yml build --no-cache backend frontend && up -d`).

Branch limpa, tudo commitado até `ee6bf92`. Ledger: `.superpowers/sdd/progress.md`. Stack subagent-driven: sonnet implementer+reviewer, opus final review.
