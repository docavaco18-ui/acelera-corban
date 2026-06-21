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
- 🟡 **Task 5** `b649a08` — extraído `frontend/src/components/OverviewDashboard.tsx` (410 ln) da Central de Controle; CentralControle.tsx slim (~55 ln). tsc 0 erros. **REVIEW INTERROMPIDO — refazer review (paridade visual).**
- ⬜ **Task 6** — criar `frontend/src/pages/CentralUsuarios.tsx` (header 🧠 + 4 KPIs + grid de UserCards + DetailDrawer reusando OverviewDashboard) + rota `/central-usuarios` em `<Protected adminOnly>` no App.tsx + link de menu admin-only. **Código completo no plano (Task 6).**
- ⬜ **Task 7** — subir localhost, login admin (docavaco18), validar cards reais + ⚡ ao vivo + drawer + gating 403 non-admin. Se OK → merge main + deploy VPS prod.

## Backend: 136 testes passando. tsc frontend: limpo.

## RETOMAR AMANHÃ
1. Refazer review Task 5 (já tem brief/report/diff em `.superpowers/sdd/`; gerar package: `scripts/review-package e35c3f9 b649a08`).
2. Implementar Task 6 (código pronto no plano).
3. Task 7 localhost: `docker compose up -d --build backend frontend` (front 3004 / back 8003) → testar.
4. Aprovado → merge `feat/central-usuarios`→`main` → deploy prod (`docker compose -f docker-compose.prod.yml build --no-cache backend frontend && up -d`).

Stack subagent-driven: sonnet implementer+reviewer, opus final review.
