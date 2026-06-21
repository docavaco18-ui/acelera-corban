# Central de Usuários Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Painel admin-only `/central-usuarios` que lista todos os clientes do Acelera Corban com saúde Meta/WhatsApp real de cada um (BM, números, capacidade, templates, CRM, pendências), reusando a engine `command_center.py` por usuário.

**Architecture:** Refatora `command_center.py` extraindo `compute_overview(db, owner_id, *, live_meta)`. Novo router admin itera todos os usuários (Supabase Admin API) e reduz cada overview a um card de resumo + agregado. Frontend extrai o render da Central de Controle num componente compartilhado `OverviewDashboard`, reusado pelo drawer de detalhe da nova página.

**Tech Stack:** FastAPI (Python 3.12), React/Vite + TypeScript, axios, Supabase, pytest.

## Global Constraints

- Backend em `backend/app/`, frontend pages em `frontend/src/pages/`.
- Admin gating: todo endpoint cross-tenant usa `Depends(require_admin)` (`backend/app/auth_deps.py:102`).
- Multi-tenant: fluxo normal continua scoped em `user.user_id`. Cross-tenant só no router novo, só admin.
- Read-only: painel não edita credenciais de cliente.
- Tempo real: dado vem da engine real (`command_center`) — zero dado inventado/mockado em produção.
- Commits: português, prefixo `feat:`/`fix:`/`docs:`/`refactor:`, co-author `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Branch de trabalho: `feat/central-usuarios` (já criada).
- `command_center.py` usa `from ..database import get_db` e `get_db()` retorna o client Supabase sync.
- `admin.py` expõe helpers `_admin_url()` e `_admin_headers()` para a Supabase Admin API.
- Frontend admin endpoints usam o axios `broadcastAxios` (sem bank-prefix), igual `commandCenterApi`.

---

### Task 1: Refatorar command_center — extrair `compute_overview`

**Files:**
- Modify: `backend/app/routers/command_center.py:616-659` (função `overview`)
- Test: `backend/tests/test_command_center_compute.py`

**Interfaces:**
- Produces: `async def compute_overview(db, owner_id: str, *, live_meta: bool = False) -> dict` — retorna o mesmo dict que o endpoint `/api/command-center/overview` sempre retornou (chaves: `generated_at, score, health, deliverability, capacity, meta_audits, templates, error_radar, incidents, checklist, live_meta_requested, live_meta_timed_out`).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_command_center_compute.py
from __future__ import annotations

import asyncio


class _Q:
    """Query builder mock: select/eq/limit/order encadeáveis, execute() vazio."""
    def select(self, *_a, **_k): return self
    def eq(self, *_a, **_k): return self
    def limit(self, *_a, **_k): return self
    def order(self, *_a, **_k): return self
    def gte(self, *_a, **_k): return self
    def execute(self): return type("R", (), {"data": []})()


class _DB:
    def table(self, _name): return _Q()


def test_compute_overview_keys_on_empty_db():
    from app.routers.command_center import compute_overview
    out = asyncio.run(compute_overview(_DB(), "owner-x", live_meta=False))
    assert set(out) >= {
        "generated_at", "score", "health", "deliverability", "capacity",
        "meta_audits", "templates", "error_radar", "incidents", "checklist",
        "live_meta_requested", "live_meta_timed_out",
    }
    assert out["score"]["score"] <= 100 and out["score"]["score"] >= 0
    assert out["live_meta_requested"] is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_command_center_compute.py -v`
Expected: FAIL — `ImportError: cannot import name 'compute_overview'`

- [ ] **Step 3: Extract `compute_overview` and slim the endpoint**

Em `backend/app/routers/command_center.py`, substituir a função `overview` (linhas 616-659) por:

```python
async def compute_overview(db, owner_id: str, *, live_meta: bool = False) -> dict:
    settings = _collect_settings(db, owner_id)
    numbers = _collect_numbers(db, owner_id)

    health = _build_health(db, owner_id, settings, numbers)
    deliverability = _build_deliverability(db, owner_id, numbers)
    capacity = _build_capacity(deliverability, target=10000)

    live_timed_out = False
    if live_meta:
        try:
            meta_audits = await asyncio.wait_for(
                _audit_meta_tokens_live(settings),
                timeout=LIVE_META_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            live_timed_out = True
            meta_audits = _audit_meta_tokens_cached(settings, numbers)
    else:
        meta_audits = _audit_meta_tokens_cached(settings, numbers)

    templates = _build_templates(meta_audits)
    error_radar = _build_error_radar(db, owner_id, numbers)
    incidents = _build_incidents(health, deliverability, error_radar, meta_audits)
    checklist = _build_checklist(health, deliverability, templates, capacity)
    score = _build_score(health, deliverability, checklist, incidents)

    return {
        "generated_at": _iso(_now()),
        "score": score,
        "health": health,
        "deliverability": deliverability,
        "capacity": capacity,
        "meta_audits": meta_audits,
        "templates": templates,
        "error_radar": error_radar,
        "incidents": incidents,
        "checklist": checklist,
        "live_meta_requested": live_meta,
        "live_meta_timed_out": live_timed_out,
    }


@router.get("/overview")
async def overview(live_meta: bool = False, user: AuthUser = Depends(require_user)):
    db = get_db()
    return await compute_overview(db, user.user_id, live_meta=live_meta)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_command_center_compute.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/command_center.py backend/tests/test_command_center_compute.py
git commit -m "refactor: extrai compute_overview reutilizável no command_center

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Engine de resumo por usuário (`summary.py`)

**Files:**
- Create: `backend/app/routers/users_monitor_summary.py`
- Test: `backend/tests/test_users_monitor_summary.py`

**Interfaces:**
- Consumes: dict de `compute_overview` (Task 1).
- Produces:
  - `def build_pending(overview: dict) -> list[dict]` → itens `{severity, label, detail}` derivados de `health`/`meta_audits`/`deliverability`.
  - `def count_bms(db, owner_id: str, settings: dict) -> dict` → `{connected, error, total}`.
  - `def summarize_overview(overview: dict, *, owner_id: str, email: str | None, client_label: str, bms: dict) -> dict` → o card de resumo (shape do spec).
  - `def build_aggregate(summaries: list[dict]) -> dict` → `{users_total, users_healthy, users_warning, users_critical, capacity_total, numbers_total, bms_total, generated_at}`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_users_monitor_summary.py
from __future__ import annotations


def _overview(score_status="ok", **over):
    base = {
        "generated_at": "2026-06-21T00:00:00+00:00",
        "score": {"score": 90, "status": score_status, "label": "ok"},
        "health": [
            {"id": "vendeai-meta", "group": "Meta/BM", "label": "Token Meta VendeAI",
             "status": "critical", "detail": "Token Meta ausente/corrompido"},
            {"id": "aesir-crm", "group": "Disparos", "label": "Credenciais Aesir",
             "status": "warning", "detail": "Credencial do CRM ausente/corrompida"},
            {"id": "vendeai-crm", "group": "Disparos", "label": "Credenciais VendeAI",
             "status": "ok", "detail": "CRM pronto"},
        ],
        "deliverability": {
            "totals": {"all": 3, "healthy": 1, "warning": 1, "critical": 1, "capacity_today": 500, "used_today": 0},
            "channels": [
                {"source": "vendeai", "quality_rating": "GREEN", "risk": "ok", "is_healthy": True, "remaining_today": 500, "has_payment_issue": False},
                {"source": "vendeai", "quality_rating": "YELLOW", "risk": "warning", "is_healthy": False, "remaining_today": 0, "has_payment_issue": False},
                {"source": "aesir", "quality_rating": "RED", "risk": "critical", "is_healthy": False, "remaining_today": 0, "has_payment_issue": True},
            ],
        },
        "capacity": {"capacity_today": 500},
        "meta_audits": [],
        "templates": {"by_status": {"APPROVED": 4}, "by_category": {}, "templates": []},
        "incidents": [
            {"severity": "critical", "title": "x", "detail": "y", "source": "z", "created_at": "t", "action": "a"},
        ],
    }
    base.update(over)
    return base


def test_build_pending_maps_health_issues():
    from app.routers.users_monitor_summary import build_pending
    pend = build_pending(_overview())
    labels = " | ".join(p["label"] for p in pend)
    assert "BM" in labels  # token Meta ausente vira pendência de BM
    assert any(p["severity"] == "critical" for p in pend)
    # check OK não vira pendência
    assert all("VendeAI" not in p["label"] or p["severity"] != "ok" for p in pend)


def test_summarize_overview_shape():
    from app.routers.users_monitor_summary import summarize_overview
    s = summarize_overview(
        _overview(), owner_id="o1", email="c@x.com",
        client_label="BM Teste", bms={"connected": 2, "error": 1, "total": 3},
    )
    assert s["owner_id"] == "o1"
    assert s["numbers"] == {"total": 3, "healthy": 1, "warning": 1, "critical": 1}
    assert s["capacity_today"] == 500
    assert s["quality"]["green"] == 1 and s["quality"]["red"] == 1
    assert s["bms"]["connected"] == 2
    assert s["templates"]["approved"] == 4
    assert isinstance(s["pending"], list) and len(s["pending"]) >= 1
    assert s["error"] is False


def test_build_aggregate_sums():
    from app.routers.users_monitor_summary import build_aggregate, summarize_overview
    a = summarize_overview(_overview("ok"), owner_id="a", email=None, client_label="A", bms={"connected": 1, "error": 0, "total": 1})
    b = summarize_overview(_overview("critical"), owner_id="b", email=None, client_label="B", bms={"connected": 0, "error": 2, "total": 2})
    agg = build_aggregate([a, b])
    assert agg["users_total"] == 2
    assert agg["users_critical"] == 1
    assert agg["users_healthy"] == 1
    assert agg["capacity_total"] == 1000
    assert agg["numbers_total"] == 6
    assert agg["bms_total"] == 3
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_users_monitor_summary.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.routers.users_monitor_summary'`

- [ ] **Step 3: Implement the summary engine**

```python
# backend/app/routers/users_monitor_summary.py
"""Redução de um overview do command_center para o card de resumo da Central de Usuários."""
from __future__ import annotations

from datetime import datetime, timezone

_CRM_FROM_HEALTH_ID = {"vendeai": "VendeAI", "aesir": "Aesir", "chipcare": "Chipcare"}


def _crm_label_from_id(check_id: str) -> str:
    for key, label in _CRM_FROM_HEALTH_ID.items():
        if check_id.startswith(key):
            return label
    return ""


def build_pending(overview: dict) -> list[dict]:
    """Itens 'o que falta' derivados dos health checks + canais com pagamento."""
    pending: list[dict] = []
    for c in overview.get("health", []):
        status = c.get("status")
        if status not in ("warning", "critical"):
            continue
        cid = str(c.get("id") or "")
        crm = _crm_label_from_id(cid)
        if cid.endswith("-meta"):
            label = f"Falta token da BM ({crm})" if crm else "Falta token da BM"
        elif cid.endswith("-crm"):
            label = f"Falta conexão CRM ({crm})" if crm else "Falta conexão CRM"
        elif cid.endswith("-numbers"):
            label = f"Sem números saudáveis ({crm})" if crm else "Sem números saudáveis"
        elif cid == "chatwoot":
            label = "Chatwoot não conectado"
        else:
            label = c.get("label") or "Pendência"
        pending.append({"severity": status, "label": label, "detail": c.get("detail") or ""})

    channels = overview.get("deliverability", {}).get("channels", [])
    payment = sum(1 for ch in channels if ch.get("has_payment_issue"))
    if payment:
        pending.append({
            "severity": "critical",
            "label": f"Problema de pagamento em {payment} número(s)",
            "detail": "Regularize a forma de pagamento da BM na Meta.",
        })

    approved = overview.get("templates", {}).get("by_status", {}).get("APPROVED", 0)
    has_live = any(a.get("live") for a in overview.get("meta_audits", []))
    if has_live and approved == 0:
        pending.append({
            "severity": "warning",
            "label": "Sem templates aprovados",
            "detail": "Nenhum template aprovado encontrado na auditoria ao vivo.",
        })

    rank = {"critical": 0, "warning": 1}
    pending.sort(key=lambda p: rank.get(p["severity"], 9))
    return pending


def _quality_breakdown(overview: dict) -> dict:
    out = {"green": 0, "yellow": 0, "red": 0, "unknown": 0}
    for ch in overview.get("deliverability", {}).get("channels", []):
        q = str(ch.get("quality_rating") or "UNKNOWN").upper()
        if q in ("GREEN", "HIGH"):
            out["green"] += 1
        elif q in ("YELLOW", "MEDIUM"):
            out["yellow"] += 1
        elif q in ("RED", "LOW"):
            out["red"] += 1
        else:
            out["unknown"] += 1
    return out


def _crm_status(overview: dict) -> dict:
    out: dict[str, str] = {}
    for c in overview.get("health", []):
        cid = str(c.get("id") or "")
        if cid.endswith("-crm"):
            key = cid[: -len("-crm")]
            out[key] = "ok" if c.get("status") == "ok" else "missing"
    return out


def count_bms(db, owner_id: str, settings: dict) -> dict:
    """VendeAI = vendeai_meta_tokens (estavel/erro). Aesir/Chipcare = token único 0|1."""
    connected = 0
    error = 0
    try:
        rows = (
            db.table("vendeai_meta_tokens")
            .select("connection_status")
            .eq("owner_id", owner_id)
            .execute().data or []
        )
        for r in rows:
            if str(r.get("connection_status")) == "estavel":
                connected += 1
            elif str(r.get("connection_status")) == "erro":
                error += 1
    except Exception:
        pass
    from ..credentials.crypto import safe_decrypt
    for key in ("aesir", "chipcare"):
        row = settings.get(key) or {}
        if safe_decrypt(row.get("meta_token_enc")):
            connected += 1
    return {"connected": connected, "error": error, "total": connected + error}


def summarize_overview(overview: dict, *, owner_id: str, email: str | None, client_label: str, bms: dict) -> dict:
    totals = overview.get("deliverability", {}).get("totals", {})
    templates = overview.get("templates", {})
    has_live = any(a.get("live") for a in overview.get("meta_audits", []))
    last_check = None
    for ch in overview.get("deliverability", {}).get("channels", []):
        lc = ch.get("last_meta_check_at")
        if lc and (last_check is None or lc > last_check):
            last_check = lc
    return {
        "owner_id": owner_id,
        "email": email,
        "client_label": client_label or email or owner_id,
        "score": overview.get("score", {"score": 0, "status": "critical", "label": ""}),
        "bms": bms,
        "numbers": {
            "total": int(totals.get("all") or 0),
            "healthy": int(totals.get("healthy") or 0),
            "warning": int(totals.get("warning") or 0),
            "critical": int(totals.get("critical") or 0),
        },
        "quality": _quality_breakdown(overview),
        "capacity_today": int(overview.get("capacity", {}).get("capacity_today") or 0),
        "templates": {
            "approved": int(templates.get("by_status", {}).get("APPROVED") or 0),
            "total": len(templates.get("templates") or []),
        } if has_live else None,
        "crm": _crm_status(overview),
        "pending": build_pending(overview),
        "top_incidents": (overview.get("incidents") or [])[:3],
        "last_meta_check_at": last_check,
        "live": has_live,
        "live_failed": bool(overview.get("live_meta_timed_out")),
        "error": False,
    }


def error_summary(owner_id: str, email: str | None, detail: str) -> dict:
    return {
        "owner_id": owner_id, "email": email, "client_label": email or owner_id,
        "score": {"score": 0, "status": "critical", "label": "Erro"},
        "bms": {"connected": 0, "error": 0, "total": 0},
        "numbers": {"total": 0, "healthy": 0, "warning": 0, "critical": 0},
        "quality": {"green": 0, "yellow": 0, "red": 0, "unknown": 0},
        "capacity_today": 0, "templates": None, "crm": {},
        "pending": [{"severity": "critical", "label": "Erro ao carregar cliente", "detail": detail[:240]}],
        "top_incidents": [], "last_meta_check_at": None,
        "live": False, "live_failed": False, "error": True,
    }


def build_aggregate(summaries: list[dict]) -> dict:
    healthy = sum(1 for s in summaries if s["score"]["status"] == "ok")
    warning = sum(1 for s in summaries if s["score"]["status"] == "warning")
    critical = sum(1 for s in summaries if s["score"]["status"] == "critical")
    return {
        "users_total": len(summaries),
        "users_healthy": healthy,
        "users_warning": warning,
        "users_critical": critical,
        "capacity_total": sum(int(s["capacity_today"]) for s in summaries),
        "numbers_total": sum(int(s["numbers"]["total"]) for s in summaries),
        "bms_total": sum(int(s["bms"]["total"]) for s in summaries),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_users_monitor_summary.py -v`
Expected: PASS (3 testes)

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/users_monitor_summary.py backend/tests/test_users_monitor_summary.py
git commit -m "feat: engine de resumo por usuário p/ Central de Usuários

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Router admin `admin_users_monitor.py`

**Files:**
- Create: `backend/app/routers/admin_users_monitor.py`
- Modify: `backend/app/main.py:7` (import) e `:114` (include_router)
- Test: `backend/tests/test_admin_users_monitor_gating.py`

**Interfaces:**
- Consumes: `compute_overview` (Task 1); `summarize_overview`, `count_bms`, `error_summary`, `build_aggregate` (Task 2); `_collect_settings` de `command_center`; `_admin_url`, `_admin_headers` de `admin`.
- Produces: rotas `GET /api/admin/users-monitor`, `GET /api/admin/users-monitor/{owner_id}`, `POST /api/admin/users-monitor/refresh-live` — todas `Depends(require_admin)`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_admin_users_monitor_gating.py
from __future__ import annotations


def test_all_routes_require_admin():
    from app.routers.admin_users_monitor import router
    from app.auth_deps import require_admin
    assert router.routes, "router sem rotas"
    for route in router.routes:
        dep_calls = [d.call for d in route.dependant.dependencies]
        assert require_admin in dep_calls, f"{route.path} não exige require_admin"


def test_router_prefix():
    from app.routers.admin_users_monitor import router
    paths = {r.path for r in router.routes}
    assert "/api/admin/users-monitor" in paths
    assert "/api/admin/users-monitor/{owner_id}" in paths
    assert "/api/admin/users-monitor/refresh-live" in paths
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_admin_users_monitor_gating.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.routers.admin_users_monitor'`

- [ ] **Step 3: Implement the router**

```python
# backend/app/routers/admin_users_monitor.py
"""Central de Usuários — monitoramento cross-tenant (admin-only).

Roda a engine command_center.compute_overview por usuário e agrega.
"""
from __future__ import annotations

import asyncio

import httpx
from fastapi import APIRouter, Depends

from ..auth_deps import AuthUser, require_admin
from ..database import get_db
from .admin import _admin_headers, _admin_url
from .command_center import _collect_settings, compute_overview
from .users_monitor_summary import (
    build_aggregate,
    count_bms,
    error_summary,
    summarize_overview,
)

router = APIRouter(prefix="/api/admin/users-monitor", tags=["users-monitor"])

_LIVE_CONCURRENCY = 5


async def _list_auth_users() -> list[dict]:
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(_admin_url() + "?per_page=200", headers=_admin_headers())
    if not r.is_success:
        return []
    data = r.json()
    users = data.get("users") if isinstance(data, dict) else data
    return users or []


def _client_label(db, owner_id: str, email: str | None, settings: dict) -> str:
    try:
        rows = (
            db.table("vendeai_meta_tokens")
            .select("bm_name")
            .eq("owner_id", owner_id)
            .execute().data or []
        )
        for r in rows:
            if r.get("bm_name"):
                return str(r["bm_name"])
    except Exception:
        pass
    return email or owner_id


async def _summary_for_user(db, user: dict, *, live_meta: bool) -> dict:
    owner_id = str(user.get("id"))
    email = user.get("email")
    try:
        settings = _collect_settings(db, owner_id)
        overview = await compute_overview(db, owner_id, live_meta=live_meta)
        bms = count_bms(db, owner_id, settings)
        label = _client_label(db, owner_id, email, settings)
        return summarize_overview(overview, owner_id=owner_id, email=email, client_label=label, bms=bms)
    except Exception as e:  # cliente isolado não derruba o painel
        return error_summary(owner_id, email, str(e))


async def _build_all(live_meta: bool) -> dict:
    db = get_db()
    users = await _list_auth_users()
    sem = asyncio.Semaphore(_LIVE_CONCURRENCY)

    async def _bounded(u: dict) -> dict:
        async with sem:
            return await _summary_for_user(db, u, live_meta=live_meta)

    summaries = await asyncio.gather(*(_bounded(u) for u in users))
    rank = {"critical": 0, "warning": 1, "ok": 2}
    summaries.sort(key=lambda s: (rank.get(s["score"]["status"], 9), -s["capacity_today"]))
    return {"aggregate": build_aggregate(summaries), "users": summaries}


@router.get("")
async def list_users_monitor(_: AuthUser = Depends(require_admin)):
    return await _build_all(live_meta=False)


@router.post("/refresh-live")
async def refresh_live(_: AuthUser = Depends(require_admin)):
    return await _build_all(live_meta=True)


@router.get("/{owner_id}")
async def user_detail(owner_id: str, live_meta: bool = False, _: AuthUser = Depends(require_admin)):
    db = get_db()
    return await compute_overview(db, owner_id, live_meta=live_meta)
```

Em `backend/app/main.py` linha 7, adicionar `admin_users_monitor` ao import:

```python
from .routers import leads, bot, stats, webhook, ws, admin, batches, crm, chatwoot, command_center, admin_users_monitor
```

E após a linha 114 (`app.include_router(command_center.router)`), adicionar:

```python
app.include_router(admin_users_monitor.router)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_admin_users_monitor_gating.py -v`
Expected: PASS (2 testes)

- [ ] **Step 5: Run full backend suite to confirm no regression**

Run: `cd backend && python -m pytest -q`
Expected: PASS (todos, incluindo Tasks 1-2)

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/admin_users_monitor.py backend/app/main.py backend/tests/test_admin_users_monitor_gating.py
git commit -m "feat: router admin Central de Usuários (cross-tenant gated)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: API frontend `adminUsersMonitorApi`

**Files:**
- Modify: `frontend/src/lib/api.ts` (após `commandCenterApi`, ~linha 722)

**Interfaces:**
- Consumes: rotas da Task 3.
- Produces: `adminUsersMonitorApi = { list, detail, refreshLiveAll }`.

- [ ] **Step 1: Add the API object**

Ao final de `frontend/src/lib/api.ts`, após o bloco `commandCenterApi` (linha 721), adicionar:

```typescript
export const adminUsersMonitorApi = {
  list: () =>
    broadcastAxios.get<any>("/api/admin/users-monitor").then((r) => r.data),
  refreshLiveAll: () =>
    broadcastAxios.post<any>("/api/admin/users-monitor/refresh-live").then((r) => r.data),
  detail: (ownerId: string, liveMeta = false) =>
    broadcastAxios
      .get<any>(`/api/admin/users-monitor/${ownerId}`, { params: { live_meta: liveMeta } })
      .then((r) => r.data),
};
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: sem novos erros referentes a `api.ts`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: adminUsersMonitorApi no client frontend

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Extrair `OverviewDashboard` compartilhado da Central de Controle

**Files:**
- Create: `frontend/src/components/OverviewDashboard.tsx`
- Modify: `frontend/src/pages/CentralControle.tsx`

**Interfaces:**
- Produces: `export interface Overview {...}` (movida de CentralControle), e `export default function OverviewDashboard({ data, loading, error, onRefresh, onLiveAudit, title }: { data: Overview; loading: boolean; error?: string; onRefresh: () => void; onLiveAudit: () => void; title?: string })`.
- Consumes: `disparo-shared` (C, G, glassCard, sectionTitle, btnStyle, INPUT_STYLE, SHARED_CSS, PulseDot, GradientBar).

- [ ] **Step 1: Create the shared component**

Mover para `frontend/src/components/OverviewDashboard.tsx` TODO o conteúdo de render de `CentralControle.tsx` linhas 8-839 EXCETO o componente de página `export default function CentralControle()` (linhas 339-421 da parte de fetch/estado). Concretamente, o novo arquivo contém:
- Os tipos (linhas 8-113) com `export interface Overview`.
- Os helpers `fmt/gradFor/colorFor/tplColor` (115-140).
- Os componentes `PageHeader, BrainBadge, KpiCard, CardShell, StatusPill, RowItem, MiniMetric, SpotlightMetric, TemplateRow, ChannelRow` (142-335, 704-815).
- O `CC_CSS` (818-839).
- O corpo de render JSX (linhas 423-701) embrulhado num componente:

```tsx
export default function OverviewDashboard({
  data, loading, error, onRefresh, onLiveAudit, title = "Central de Controle",
}: {
  data: Overview; loading: boolean; error?: string;
  onRefresh: () => void; onLiveAudit: () => void; title?: string;
}) {
  const target = 10000;
  const simulated = /* ... mesmo useMemo de CentralControle (linhas 360-366) ... */;
  const blockRisk = /* ... mesmo useMemo (linhas 368-386) ... */;
  const totals = data.deliverability.totals || {};
  const category = data.templates.by_category || {};
  const templateStatus = data.templates.by_status || {};
  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text,
      fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", padding: '22px 24px 56px' }}>
      <style>{SHARED_CSS}{CC_CSS}</style>
      <PageHeader scoreNum={data.score.score} scoreStatus={data.score.status}
        scoreLabel={data.score.label} generatedAt={data.generated_at}
        loading={loading} onRefresh={onRefresh} onLiveAudit={onLiveAudit}
        liveTimedOut={!!data.live_meta_timed_out} title={title} />
      {/* ...resto idêntico às linhas 446-699 de CentralControle.tsx... */}
    </div>
  );
}
```

Adicionar prop `title` ao `PageHeader` (usar `{title}` no lugar do literal "Central de Controle" da linha 159). O simulador usa `target` fixo 10000 (era state; manter o input opcional NÃO é necessário aqui — manter como estava com `useState(10000)` dentro do componente para não perder a feature).

- [ ] **Step 2: Slim CentralControle.tsx to consume it**

Reescrever `frontend/src/pages/CentralControle.tsx` para apenas buscar dados e delegar render:

```tsx
import { useEffect, useState } from "react";
import { commandCenterApi } from "../lib/api";
import { C, glassCard, sectionTitle, btnStyle, G, SHARED_CSS } from "../components/disparo-shared";
import OverviewDashboard, { type Overview } from "../components/OverviewDashboard";

export default function CentralControle() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async (liveMeta = false) => {
    setLoading(true); setError("");
    try {
      setData(await commandCenterApi.overview({ live_meta: liveMeta }));
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Falha ao carregar Central de Controle");
    } finally { setLoading(false); }
  };
  useEffect(() => { load(false); }, []);

  if (loading && !data) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, color: C.muted, padding: 32 }}>
        <style>{SHARED_CSS}</style>
        <div style={glassCard(G.primary, 32)}>
          <div style={{ ...sectionTitle(G.primary), marginBottom: 4, fontSize: 12 }}>Central de Controle</div>
          <div style={{ color: C.text, fontSize: 18, fontWeight: 700 }}>Carregando diagnóstico…</div>
        </div>
      </div>
    );
  }
  if (error && !data) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, color: C.text, padding: 32 }}>
        <style>{SHARED_CSS}</style>
        <div style={glassCard(G.red, 28)}>
          <div style={{ ...sectionTitle(G.red), marginBottom: 6 }}>Central de Controle indisponível</div>
          <p style={{ color: C.sec, margin: '0 0 16px', fontSize: 14 }}>{error}</p>
          <button onClick={() => load(false)} className="ds-btn" style={btnStyle(G.red)}>Tentar novamente</button>
        </div>
      </div>
    );
  }
  if (!data) return null;
  return <OverviewDashboard data={data} loading={loading} error={error} onRefresh={() => load(false)} onLiveAudit={() => load(true)} />;
}
```

- [ ] **Step 3: Verify build + visual parity**

Run: `cd frontend && npx tsc --noEmit`
Expected: sem erros novos.
Verificação manual: `/central-controle` renderiza idêntico ao anterior (mesmo header/KPIs/cards).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/OverviewDashboard.tsx frontend/src/pages/CentralControle.tsx
git commit -m "refactor: extrai OverviewDashboard compartilhado da Central de Controle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Página `CentralUsuarios.tsx` + rota + nav

**Files:**
- Create: `frontend/src/pages/CentralUsuarios.tsx`
- Modify: `frontend/src/App.tsx` (lazy import ~linha 23; links admin ~linha 92-94; rotas ~linha 235-236)

**Interfaces:**
- Consumes: `adminUsersMonitorApi` (Task 4), `OverviewDashboard` + `Overview` (Task 5), `disparo-shared`.

- [ ] **Step 1: Create the page**

```tsx
// frontend/src/pages/CentralUsuarios.tsx
import { useEffect, useMemo, useState } from "react";
import { adminUsersMonitorApi } from "../lib/api";
import { C, G, glassCard, sectionTitle, btnStyle, SHARED_CSS, PulseDot } from "../components/disparo-shared";
import OverviewDashboard, { type Overview } from "../components/OverviewDashboard";

interface Pending { severity: string; label: string; detail: string }
interface UserSummary {
  owner_id: string; email: string | null; client_label: string;
  score: { score: number; status: string; label: string };
  bms: { connected: number; error: number; total: number };
  numbers: { total: number; healthy: number; warning: number; critical: number };
  quality: { green: number; yellow: number; red: number; unknown: number };
  capacity_today: number;
  templates: { approved: number; total: number } | null;
  crm: Record<string, string>;
  pending: Pending[];
  live: boolean; live_failed: boolean; error: boolean;
}
interface Aggregate {
  users_total: number; users_healthy: number; users_warning: number; users_critical: number;
  capacity_total: number; numbers_total: number; bms_total: number; generated_at: string;
}

const fmt = (n: number) => Number(n || 0).toLocaleString("pt-BR");
const colorFor = (s: string) => s === "ok" ? C.green : s === "warning" ? C.yellow : s === "critical" ? C.red : C.sec;

export default function CentralUsuarios() {
  const [agg, setAgg] = useState<Aggregate | null>(null);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError("");
    try {
      const d = await adminUsersMonitorApi.list();
      setAgg(d.aggregate); setUsers(d.users);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Falha ao carregar Central de Usuários");
    } finally { setLoading(false); }
  };
  const liveAll = async () => {
    setLive(true); setError("");
    try {
      const d = await adminUsersMonitorApi.refreshLiveAll();
      setAgg(d.aggregate); setUsers(d.users);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Falha na auditoria ao vivo");
    } finally { setLive(false); }
  };
  useEffect(() => { load(); }, []);

  if (loading && !agg) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, color: C.muted, padding: 32 }}>
        <style>{SHARED_CSS}</style>
        <div style={glassCard(G.primary, 32)}>
          <div style={{ ...sectionTitle(G.primary), marginBottom: 4, fontSize: 12 }}>Central de Usuários</div>
          <div style={{ color: C.text, fontSize: 18, fontWeight: 700 }}>Carregando clientes…</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text,
      fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", padding: '22px 24px 56px' }}>
      <style>{SHARED_CSS}</style>

      <div style={{ ...glassCard(G.primary, 28), marginBottom: 22, display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 40 }}>🧠</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...sectionTitle(G.primary), marginBottom: 6 }}>Central de Usuários</div>
          <h1 style={{ margin: 0, color: C.text, fontSize: 30, fontWeight: 800 }}>
            {fmt(agg?.users_total || 0)} clientes ·{' '}
            <span style={{ color: C.red }}>{fmt(agg?.users_critical || 0)} em risco</span>
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={load} disabled={loading} className="ds-btn" style={btnStyle(G.primary, loading)}>
            {loading ? 'Atualizando…' : '↻ Atualizar'}
          </button>
          <button onClick={liveAll} disabled={live} className="ds-btn" style={btnStyle(G.purple, live)}>
            {live ? 'Auditando ao vivo…' : '⚡ Auditar todos ao vivo'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ border: `1px solid ${C.red}55`, color: C.red, background: `${C.red}10`,
          borderRadius: 12, padding: 12, marginBottom: 18, fontSize: 13 }}>{error}</div>
      )}

      <section className="spot-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 14, marginBottom: 18 }}>
        <Kpi label="Clientes saudáveis" value={agg?.users_healthy || 0} color={C.green} icon="✅" />
        <Kpi label="Em risco crítico" value={agg?.users_critical || 0} color={C.red} icon="🚨" />
        <Kpi label="Capacidade total/dia" value={agg?.capacity_total || 0} color={C.yellow} icon="🚀" />
        <Kpi label="Números conectados" value={agg?.numbers_total || 0} color="#7c3aed" icon="📱" />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
        {users.map((u) => (
          <UserCard key={u.owner_id} u={u} onOpen={() => setOpenId(u.owner_id)} />
        ))}
      </section>

      {openId && <DetailDrawer ownerId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function Kpi({ label, value, color, icon }: { label: string; value: number; color: string; icon: string }) {
  return (
    <div className="spot-card" style={{ background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.06)',
      borderRadius: 14, padding: 18, position: 'relative', overflow: 'hidden', '--spot-color': color } as any}>
      <div className="spot-glow" /><div className="spot-shine" />
      <div style={{ color: C.sec, fontSize: 11, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 8 }}>{icon} {label}</div>
      <div style={{ color, fontSize: 30, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{fmt(value)}</div>
    </div>
  );
}

function UserCard({ u, onOpen }: { u: UserSummary; onOpen: () => void }) {
  const color = colorFor(u.score.status);
  return (
    <div className="spot-card" onClick={onOpen} style={{ background: 'rgba(255,255,255,.02)',
      border: `1px solid ${color}33`, borderRadius: 16, padding: 18, cursor: 'pointer', position: 'relative',
      overflow: 'hidden', '--spot-color': color } as any}>
      <div className="spot-glow" /><div className="spot-shine" />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: C.text, fontSize: 15, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.client_label}</div>
          <div style={{ color: C.sec, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email}</div>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999,
          color, background: `${color}14`, border: `1px solid ${color}55`, fontSize: 13, fontWeight: 900 }}>
          <PulseDot color={color} />{u.score.score}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
        <Mini label="BMs" value={`${u.bms.connected}/${u.bms.total}`} />
        <Mini label="Números" value={`${u.numbers.healthy}/${u.numbers.total}`} />
        <Mini label="Cap/dia" value={fmt(u.capacity_today)} />
        <Mini label="Templates" value={u.templates ? `${u.templates.approved}` : '—'} />
        <Mini label="🟢🟡🔴" value={`${u.quality.green}·${u.quality.yellow}·${u.quality.red}`} />
        <Mini label="Live" value={u.live ? (u.live_failed ? '⚠' : '✓') : '—'} />
      </div>
      {u.pending.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {u.pending.slice(0, 4).map((p, i) => (
            <span key={i} style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
              color: colorFor(p.severity), background: `${colorFor(p.severity)}14`, border: `1px solid ${colorFor(p.severity)}44` }}>{p.label}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 10, padding: '8px 10px' }}>
      <div style={{ color: C.sec, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
      <div style={{ color: C.text, fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function DetailDrawer({ ownerId, onClose }: { ownerId: string; onClose: () => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const load = async (liveMeta = false) => {
    setLoading(true);
    try { setData(await adminUsersMonitorApi.detail(ownerId, liveMeta)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(false); }, [ownerId]);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 1000, overflow: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1280, margin: '24px auto', position: 'relative' }}>
        <button onClick={onClose} className="ds-btn" style={{ ...btnStyle(G.red), position: 'sticky', top: 12, left: 12, zIndex: 2, margin: 12 }}>✕ Fechar</button>
        {loading && !data
          ? <div style={{ color: C.muted, padding: 40 }}>Carregando detalhe…</div>
          : data && <OverviewDashboard data={data} loading={loading} onRefresh={() => load(false)} onLiveAudit={() => load(true)} title="Central de Usuários · detalhe" />}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Register route + nav in App.tsx**

Em `frontend/src/App.tsx`:

1. Após a linha 23 (`const CentralControle = lazy(...)`), adicionar:
```tsx
const CentralUsuarios = lazy(() => import("./pages/CentralUsuarios"));
```

2. Linha ~94 — trocar o bloco admin de links de:
```tsx
    ...(isAdmin ? [["/admin", "Admin"]] : []),
```
para:
```tsx
    ...(isAdmin ? [["/central-usuarios", "Central de Usuários"], ["/admin", "Admin"]] : []),
```

3. Após a linha 236 (`<Route path="/central-controle" element={<CentralControle />} />`), adicionar:
```tsx
                  <Route path="/central-usuarios" element={<Protected adminOnly><CentralUsuarios /></Protected>} />
```

- [ ] **Step 3: Verify build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: build sem erro.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/CentralUsuarios.tsx frontend/src/App.tsx
git commit -m "feat: página Central de Usuários (painel admin multi-tenant)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Verificação no localhost (dados reais)

**Files:** nenhum (verificação manual + correções pontuais se necessário).

- [ ] **Step 1: Subir o stack local**

Run: `cd "~/projetos/ACELERA CORBAN PRODUCAO" && docker compose up -d --build backend frontend`
Expected: containers `backend` (8003) e `frontend` (3004) up.

- [ ] **Step 2: Login admin + abrir painel**

Logar com a conta admin (docavaco18) em `http://localhost:3004` → menu deve mostrar **Central de Usuários** (só admin) → abrir.
Expected: cards de clientes reais carregam do cache (instantâneo). KPIs preenchidos. Sem dado inventado.

- [ ] **Step 3: Auditar ao vivo**

Clicar `⚡ Auditar todos ao vivo`.
Expected: templates passam de `—` para número real; qualidade/limite atualizam; cliente com token quebrado mostra pendência "Falta token da BM"; nenhum erro derruba o painel (cliente com falha vira card de erro).

- [ ] **Step 4: Drawer de detalhe**

Clicar num card.
Expected: drawer abre com a Central de Controle completa daquele cliente (dados reais). ⚡ no drawer recarrega ao vivo só daquele cliente.

- [ ] **Step 5: Conferir gating non-admin**

Logar com usuário comum → `/central-usuarios` redireciona pra `/`; link não aparece no menu; chamada direta à API retorna 403.

- [ ] **Step 6: Critério de aceite**

Painel funcional com dados reais → aprovação do Gabriel → deploy VPS:
```bash
# na VPS
cd /root/acelera-corban && git pull && \
docker compose -f docker-compose.prod.yml build --no-cache backend frontend && \
docker compose -f docker-compose.prod.yml up -d backend frontend
```
(merge `feat/central-usuarios` → `main` antes do deploy.)

---

## Self-Review

**Spec coverage:**
- Página admin-only nova → Task 6 (rota + nav adminOnly). ✓
- Híbrido cache + ao vivo → Task 3 (`list` cache, `refresh-live` ao vivo) + Task 6 (botões). ✓
- Só WhatsApp/Meta (sem bots banco) → engine command_center cobre os 3 CRMs; bots banco não entram. ✓
- BM/números/capacidade/templates/CRM/pendências por usuário → Task 2 (`summarize_overview`, `build_pending`, `count_bms`). ✓
- Layout idêntico → Task 5 (OverviewDashboard reutilizado no drawer) + Task 6 (mesmos tokens disparo-shared). ✓
- Real-time da BM/token → Task 1/3 reusam `_audit_meta_tokens_live`. ✓
- Erros/segurança (try/except por user, gating, read-only) → Task 2 `error_summary` + Task 3 `_summary_for_user` try/except + `require_admin`. ✓
- Testes (paridade, pendências, agregado, gating) → Tasks 1,2,3. ✓
- Verificação localhost antes do deploy → Task 7. ✓

**Placeholder scan:** Task 5 referencia "mesmo useMemo / resto idêntico" apontando para linhas exatas de CentralControle.tsx (mover, não reinventar) — é instrução de extração de código existente, não placeholder de lógica nova. Demais steps têm código completo.

**Type consistency:** `compute_overview`, `summarize_overview`, `build_pending`, `count_bms`, `build_aggregate`, `error_summary` consistentes entre Tasks 2 e 3. `adminUsersMonitorApi.{list,detail,refreshLiveAll}` consistente entre Tasks 4 e 6. `Overview`/`OverviewDashboard` consistentes entre Tasks 5 e 6.
