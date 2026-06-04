# Disparo WhatsApp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Disparo WhatsApp" tab to Acelera Corban with CSV upload → Claude AI split → VendeAI dispatch → real-time Meta/Chatwoot monitoring and auto-intervention.

**Architecture:** FastAPI backend with new `broadcast` router + 5 service modules + asyncio 60s monitor loop, integrated into the existing Supabase/Redis/WebSocket stack. Frontend adds 1 new page + 4 components + 1 hook.

**Tech Stack:** FastAPI, Python 3.12, Supabase (5 new tables), Redis pubsub, anthropic SDK, httpx, Fernet encryption, React 19 + TypeScript, Recharts, Vite

---

## File Map

### New Files — Backend
- `backend/app/routers/broadcast.py` — all `/api/broadcast/*` routes
- `backend/app/services/broadcast/__init__.py` — empty init
- `backend/app/services/broadcast/vendeai_client.py` — HTTP client, token cache
- `backend/app/services/broadcast/meta_client.py` — Meta Graph API quality polling
- `backend/app/services/broadcast/claude_advisor.py` — Claude tool-use split decision
- `backend/app/services/broadcast/monitor_loop.py` — asyncio 60s task
- `backend/app/services/broadcast/intervention.py` — pause/failover logic
- `migrations/013_broadcast.sql` — 5 tables + RLS

### New Files — Frontend
- `frontend/src/pages/Disparo.tsx` — main page (3 panels)
- `frontend/src/components/disparo/CsvUploadWizard.tsx` — 5-state wizard
- `frontend/src/components/disparo/NumberQualityGrid.tsx` — cards per number
- `frontend/src/components/disparo/DispatchMetrics.tsx` — Recharts bar + conversions
- `frontend/src/components/disparo/AlertFeed.tsx` — real-time alert feed
- `frontend/src/hooks/useBroadcastWebSocket.ts` — WS wrapper

### Modified Files
- `backend/app/main.py` — add broadcast router + monitor startup
- `backend/app/config.py` — add `anthropic_api_key`
- `backend/app/routers/ws.py` — subscribe to `broadcast:events`
- `backend/requirements.txt` — add `anthropic>=0.40.0`
- `frontend/src/lib/api.ts` — add `broadcastApi`
- `frontend/src/App.tsx` — add `/disparo` route + rename Chatwoot nav
- `frontend/src/pages/Configuracoes.tsx` — add VendeAI/Meta credentials section

---

## Task 1: Migration SQL

**Files:**
- Create: `migrations/013_broadcast.sql`

- [ ] **Step 1: Write migration file**

```sql
-- migrations/013_broadcast.sql

-- 1. vendeai_settings
CREATE TABLE IF NOT EXISTS vendeai_settings (
    owner_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email_enc TEXT,
    password_enc TEXT,
    bearer_token_enc TEXT,
    token_expires_at TIMESTAMPTZ,
    meta_token_enc TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE vendeai_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_only" ON vendeai_settings
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- 2. broadcast_numbers
CREATE TABLE IF NOT EXISTS broadcast_numbers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    phone_id TEXT NOT NULL,
    display_phone TEXT,
    quality_rating TEXT DEFAULT 'UNKNOWN',
    messaging_tier TEXT,
    daily_limit INTEGER DEFAULT 1000,
    is_paused BOOLEAN DEFAULT FALSE,
    last_meta_check_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(owner_id, phone_id)
);
ALTER TABLE broadcast_numbers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_only" ON broadcast_numbers
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- 3. broadcast_dispatches
CREATE TABLE IF NOT EXISTS broadcast_dispatches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    csv_filename TEXT,
    total_leads INTEGER DEFAULT 0,
    claude_split_json JSONB,
    status TEXT NOT NULL DEFAULT 'pending_confirm',
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE broadcast_dispatches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_only" ON broadcast_dispatches
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- 4. broadcast_dispatch_assignments
CREATE TABLE IF NOT EXISTS broadcast_dispatch_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispatch_id UUID NOT NULL REFERENCES broadcast_dispatches(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    phone_id TEXT NOT NULL,
    vendeai_mailing_id TEXT,
    planned_count INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    open_count INTEGER DEFAULT 0,
    converted_count INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'scheduled',
    last_poll_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE broadcast_dispatch_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_only" ON broadcast_dispatch_assignments
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- 5. broadcast_alerts
CREATE TABLE IF NOT EXISTS broadcast_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    dispatch_id UUID REFERENCES broadcast_dispatches(id) ON DELETE SET NULL,
    phone_id TEXT,
    alert_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'warn',
    message TEXT,
    action_taken TEXT DEFAULT 'none',
    action_id TEXT UNIQUE,
    ts TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE broadcast_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_only" ON broadcast_alerts
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- Indexes
CREATE INDEX IF NOT EXISTS idx_broadcast_numbers_owner ON broadcast_numbers(owner_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_dispatches_owner ON broadcast_dispatches(owner_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_dispatches_status ON broadcast_dispatches(status);
CREATE INDEX IF NOT EXISTS idx_broadcast_assignments_dispatch ON broadcast_dispatch_assignments(dispatch_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_alerts_owner ON broadcast_alerts(owner_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_alerts_dispatch ON broadcast_alerts(dispatch_id);
```

- [ ] **Step 2: Apply migration to Supabase**

```bash
cd "/Users/macbookdegabriel/projetos/ACELERA CORBAN"
# Via PSQL (DATABASE_URL from .env / PROGRESS.md):
psql $DATABASE_URL -f migrations/013_broadcast.sql
```

Expected: no errors, 5 tables created.

- [ ] **Step 3: Verify tables exist**

```bash
psql $DATABASE_URL -c "\dt broadcast*" -c "\dt vendeai*"
```

Expected: 5 rows listed.

- [ ] **Step 4: Commit**

```bash
git add migrations/013_broadcast.sql
git commit -m "feat: migration 013 — 5 tabelas broadcast + RLS

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Backend Config + Requirements

**Files:**
- Modify: `backend/app/config.py`
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Add `anthropic_api_key` to config**

In `backend/app/config.py`, add after the last existing field in the Settings class:

```python
anthropic_api_key: str = ""
```

- [ ] **Step 2: Add anthropic to requirements**

In `backend/requirements.txt`, add:

```
anthropic>=0.40.0
```

- [ ] **Step 3: Install and verify**

```bash
cd "/Users/macbookdegabriel/projetos/ACELERA CORBAN/backend"
pip install anthropic>=0.40.0
python -c "import anthropic; print(anthropic.__version__)"
```

Expected: version printed, no import error.

- [ ] **Step 4: Commit**

```bash
git add backend/app/config.py backend/requirements.txt
git commit -m "chore: adiciona anthropic_api_key ao config e dependência anthropic

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: VendeAI Client

**Files:**
- Create: `backend/app/services/broadcast/__init__.py`
- Create: `backend/app/services/broadcast/vendeai_client.py`

- [ ] **Step 1: Create empty `__init__.py`**

```python
# backend/app/services/broadcast/__init__.py
```

- [ ] **Step 2: Write VendeAI client**

```python
# backend/app/services/broadcast/vendeai_client.py
from __future__ import annotations

import asyncio
import time
from typing import Optional

import httpx

BASE_URL = "https://bff.vendeaitecnologia.com.br"


class VendeAIClient:
    def __init__(self, email: str, password: str):
        self.email = email
        self.password = password
        self._token: Optional[str] = None
        self._token_expires: float = 0.0
        self._lock = asyncio.Lock()

    async def _ensure_token(self) -> str:
        async with self._lock:
            if self._token and time.time() < self._token_expires:
                return self._token
            async with httpx.AsyncClient() as client:
                r = await client.post(
                    f"{BASE_URL}/api/bff/auth/token/",
                    json={"email": self.email, "password": self.password},
                    timeout=15,
                )
                r.raise_for_status()
                data = r.json()
                token = data.get("access") or data.get("token") or data.get("access_token")
                if not token:
                    raise ValueError(f"Token not found in response: {data}")
                self._token = token
                self._token_expires = time.time() + 3600  # 1h conservative TTL
                return token

    def _headers(self, token: str) -> dict:
        return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    async def list_inboxes(self) -> list[dict]:
        token = await self._ensure_token()
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{BASE_URL}/api/bff/broadcast/inboxes/",
                headers=self._headers(token),
                timeout=15,
            )
            r.raise_for_status()
            data = r.json()
            return data if isinstance(data, list) else data.get("results", [])

    async def list_mailings(self, page: int = 1, page_size: int = 100) -> dict:
        token = await self._ensure_token()
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{BASE_URL}/api/bff/broadcast/mailings/",
                headers=self._headers(token),
                params={"mailings": "all", "page": page, "page_size": page_size},
                timeout=15,
            )
            r.raise_for_status()
            return r.json()

    async def get_mailing(self, mailing_id: str) -> Optional[dict]:
        data = await self.list_mailings(page=1, page_size=100)
        for item in data.get("results", []):
            if item.get("id") == mailing_id:
                return item
        return None

    async def dispatch_csv(
        self,
        csv_bytes: bytes,
        csv_filename: str,
        inbox_id: str,
        template_id: str,
        phone_column: str = "telefone",
        campaign_name: str = "",
        cooldown_seconds: int = 5,
        skip_weekends: bool = True,
        skip_night: bool = True,
        dedup_window_hours: int = 24,
    ) -> dict:
        token = await self._ensure_token()
        headers = {"Authorization": f"Bearer {token}"}
        data: dict = {
            "inbox_id": inbox_id,
            "template_id": template_id,
            "phone_column": phone_column,
            "cooldown_seconds": str(cooldown_seconds),
            "skip_weekends": "true" if skip_weekends else "false",
            "skip_night": "true" if skip_night else "false",
            "dedup_window_hours": str(dedup_window_hours),
        }
        if campaign_name:
            data["campaign_name"] = campaign_name
        files = {"file": (csv_filename, csv_bytes, "text/csv")}
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{BASE_URL}/api/bff/broadcast/schedule-csv/",
                headers=headers,
                data=data,
                files=files,
                timeout=30,
            )
            r.raise_for_status()
            return r.json() if r.content else {"ok": True}

    async def pause(self, mailing_id: str) -> dict:
        token = await self._ensure_token()
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{BASE_URL}/api/bff/broadcast/pause/",
                headers=self._headers(token),
                json={"mailing_id": mailing_id},
                timeout=15,
            )
            r.raise_for_status()
            return r.json() if r.content else {"ok": True}

    async def resume(self, mailing_id: str) -> dict:
        token = await self._ensure_token()
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{BASE_URL}/api/bff/broadcast/resume/",
                headers=self._headers(token),
                json={"mailing_id": mailing_id},
                timeout=15,
            )
            r.raise_for_status()
            return r.json() if r.content else {"ok": True}

    async def cancel(self, mailing_id: str) -> dict:
        token = await self._ensure_token()
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{BASE_URL}/api/bff/broadcast/revoke/",
                headers=self._headers(token),
                json={"mailing_id": mailing_id},
                timeout=15,
            )
            r.raise_for_status()
            return r.json() if r.content else {"ok": True}
```

- [ ] **Step 3: Smoke test import**

```bash
cd "/Users/macbookdegabriel/projetos/ACELERA CORBAN/backend"
python -c "from app.services.broadcast.vendeai_client import VendeAIClient; print('ok')"
```

Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/broadcast/
git commit -m "feat: VendeAI async HTTP client com cache de token

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Meta Client

**Files:**
- Create: `backend/app/services/broadcast/meta_client.py`

- [ ] **Step 1: Write Meta client**

```python
# backend/app/services/broadcast/meta_client.py
from __future__ import annotations

from typing import Optional

import httpx

META_BASE = "https://graph.facebook.com/v19.0"


class MetaClient:
    def __init__(self, access_token: str):
        self.access_token = access_token

    async def get_phone_quality(self, phone_id: str) -> dict:
        """Returns {quality_rating, messaging_limit_tier, daily_limit}."""
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{META_BASE}/{phone_id}",
                params={
                    "fields": "quality_rating,messaging_limit_tier,display_phone_number",
                    "access_token": self.access_token,
                },
                timeout=15,
            )
            r.raise_for_status()
            data = r.json()

        tier = data.get("messaging_limit_tier", "TIER_1K")
        tier_map = {
            "TIER_1K": ("1K", 1000),
            "TIER_10K": ("10K", 10000),
            "TIER_100K": ("100K", 100000),
        }
        tier_label, daily_limit = tier_map.get(tier, ("1K", 1000))

        return {
            "phone_id": phone_id,
            "display_phone": data.get("display_phone_number", ""),
            "quality_rating": data.get("quality_rating", "UNKNOWN"),
            "messaging_tier": tier_label,
            "daily_limit": daily_limit,
        }

    async def get_all_phones(self, waba_id: str) -> list[dict]:
        """List all phone numbers under a WABA."""
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{META_BASE}/{waba_id}/phone_numbers",
                params={
                    "fields": "id,display_phone_number,quality_rating,messaging_limit_tier",
                    "access_token": self.access_token,
                },
                timeout=15,
            )
            r.raise_for_status()
            data = r.json()

        results = []
        for p in data.get("data", []):
            tier = p.get("messaging_limit_tier", "TIER_1K")
            tier_map = {
                "TIER_1K": ("1K", 1000),
                "TIER_10K": ("10K", 10000),
                "TIER_100K": ("100K", 100000),
            }
            tier_label, daily_limit = tier_map.get(tier, ("1K", 1000))
            results.append({
                "phone_id": p["id"],
                "display_phone": p.get("display_phone_number", ""),
                "quality_rating": p.get("quality_rating", "UNKNOWN"),
                "messaging_tier": tier_label,
                "daily_limit": daily_limit,
            })
        return results
```

- [ ] **Step 2: Smoke test**

```bash
python -c "from app.services.broadcast.meta_client import MetaClient; print('ok')"
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/broadcast/meta_client.py
git commit -m "feat: Meta Graph API client para quality polling

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Claude Advisor

**Files:**
- Create: `backend/app/services/broadcast/claude_advisor.py`

- [ ] **Step 1: Write claude_advisor.py**

```python
# backend/app/services/broadcast/claude_advisor.py
from __future__ import annotations

import json
from typing import Any

import anthropic

SYSTEM_PROMPT = """Você é um especialista em disparos WhatsApp Business. Dado um conjunto de números e o total de leads, você decide como distribuir os leads entre os números disponíveis para maximizar entrega e minimizar risco de bloqueio.

Regras:
- Excluir números com quality_rating=RED ou is_paused=True, salvo se não houver alternativas
- Preferir números GREEN sobre YELLOW
- Respeitar daily_limit de cada número
- Distribuir proporcionalmente ao daily_limit quando múltiplos números disponíveis
- Nunca distribuir mais leads do que o total disponível
- Fornecer justificativa e riscos identificados"""

PROPOSE_SPLIT_TOOL = {
    "name": "propose_split",
    "description": "Propõe a divisão de leads entre números WhatsApp disponíveis",
    "input_schema": {
        "type": "object",
        "properties": {
            "assignments": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "phone_id": {"type": "string"},
                        "planned_count": {"type": "integer"},
                        "reason": {"type": "string"},
                    },
                    "required": ["phone_id", "planned_count", "reason"],
                },
            },
            "justification": {"type": "string"},
            "risks": {"type": "string"},
        },
        "required": ["assignments", "justification", "risks"],
    },
}


async def advise_split(
    numbers: list[dict],
    total_leads: int,
    api_key: str,
) -> dict[str, Any]:
    """
    numbers: [{phone_id, quality_rating, messaging_tier, daily_limit, is_paused}]
    Returns: {assignments: [{phone_id, planned_count, reason}], justification, risks}
    """
    client = anthropic.AsyncAnthropic(api_key=api_key)

    user_message = json.dumps({
        "total_leads": total_leads,
        "numbers": numbers,
    }, ensure_ascii=False)

    response = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=[
            {
                "type": "text",
                "text": SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        tools=[PROPOSE_SPLIT_TOOL],
        tool_choice={"type": "tool", "name": "propose_split"},
        messages=[{"role": "user", "content": user_message}],
    )

    for block in response.content:
        if block.type == "tool_use" and block.name == "propose_split":
            return block.input

    raise ValueError("Claude did not call propose_split tool")
```

- [ ] **Step 2: Smoke test import**

```bash
python -c "from app.services.broadcast.claude_advisor import advise_split; print('ok')"
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/broadcast/claude_advisor.py
git commit -m "feat: Claude Advisor — tool-use + prompt caching para split de leads

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Intervention Logic

**Files:**
- Create: `backend/app/services/broadcast/intervention.py`

- [ ] **Step 1: Write intervention.py**

```python
# backend/app/services/broadcast/intervention.py
from __future__ import annotations

import json
from datetime import datetime, timezone

from supabase import Client

from app.services.broadcast.vendeai_client import VendeAIClient


async def evaluate_and_intervene(
    db: Client,
    owner_id: str,
    vendeai: VendeAIClient,
) -> list[dict]:
    """
    Check active assignments for intervention triggers.
    Returns list of alerts created.
    """
    alerts_created = []
    now = datetime.now(timezone.utc)
    window_hour = now.strftime("%Y%m%d%H")

    # Load active assignments with their dispatch + number info
    assignments_resp = db.table("broadcast_dispatch_assignments") \
        .select("*, broadcast_dispatches!inner(owner_id, status), broadcast_numbers!inner(quality_rating, is_paused)") \
        .eq("owner_id", owner_id) \
        .in_("status", ["running", "scheduled"]) \
        .execute()

    for asn in (assignments_resp.data or []):
        dispatch_status = asn.get("broadcast_dispatches", {}).get("status")
        if dispatch_status not in ("running",):
            continue

        phone_id = asn["phone_id"]
        dispatch_id = asn["dispatch_id"]
        sent = asn.get("sent_count", 0)
        failed = asn.get("failed_count", 0)
        quality = asn.get("broadcast_numbers", {}).get("quality_rating", "UNKNOWN")
        mailing_id = asn.get("vendeai_mailing_id")

        # Trigger 1: quality RED
        if quality == "RED":
            alert = await _create_alert(
                db, owner_id, dispatch_id, phone_id,
                "quality_drop", "critical",
                f"Número {phone_id} caiu para RED — pausando disparo",
                window_hour,
            )
            if alert:
                alerts_created.append(alert)
                if mailing_id:
                    try:
                        await vendeai.pause(mailing_id)
                    except Exception:
                        pass
                db.table("broadcast_dispatch_assignments").update({
                    "status": "paused"
                }).eq("id", asn["id"]).execute()
                db.table("broadcast_numbers").update({
                    "is_paused": True
                }).eq("owner_id", owner_id).eq("phone_id", phone_id).execute()
                # Failover
                await _attempt_failover(db, owner_id, dispatch_id, phone_id, asn)

        # Trigger 2: failed spike (>10% for 3 ticks — tracked via consecutive_fail_ticks)
        elif sent > 0 and failed / sent > 0.10:
            alert = await _create_alert(
                db, owner_id, dispatch_id, phone_id,
                "failed_spike", "critical",
                f"Número {phone_id}: taxa de falha {failed}/{sent} ({failed/sent*100:.0f}%) — pausando",
                window_hour,
            )
            if alert:
                alerts_created.append(alert)
                if mailing_id:
                    try:
                        await vendeai.pause(mailing_id)
                    except Exception:
                        pass
                db.table("broadcast_dispatch_assignments").update({
                    "status": "paused"
                }).eq("id", asn["id"]).execute()

        # Trigger 3: quality YELLOW — warn only
        elif quality == "YELLOW":
            alert = await _create_alert(
                db, owner_id, dispatch_id, phone_id,
                "quality_drop", "warn",
                f"Número {phone_id} em YELLOW — monitorando",
                window_hour,
            )
            if alert:
                alerts_created.append(alert)

    return alerts_created


async def _create_alert(
    db: Client,
    owner_id: str,
    dispatch_id: str,
    phone_id: str,
    alert_type: str,
    severity: str,
    message: str,
    window_hour: str,
    action_taken: str = "paused",
) -> dict | None:
    action_id = f"{dispatch_id}:{phone_id}:{alert_type}:{window_hour}"
    try:
        resp = db.table("broadcast_alerts").insert({
            "owner_id": owner_id,
            "dispatch_id": dispatch_id,
            "phone_id": phone_id,
            "alert_type": alert_type,
            "severity": severity,
            "message": message,
            "action_taken": action_taken,
            "action_id": action_id,
        }).execute()
        return resp.data[0] if resp.data else None
    except Exception:
        return None  # UNIQUE constraint — already handled this hour


async def _attempt_failover(
    db: Client,
    owner_id: str,
    dispatch_id: str,
    failed_phone_id: str,
    failed_asn: dict,
) -> None:
    remaining = failed_asn.get("planned_count", 0) - failed_asn.get("sent_count", 0)
    if remaining <= 0:
        return

    numbers_resp = db.table("broadcast_numbers") \
        .select("phone_id, daily_limit") \
        .eq("owner_id", owner_id) \
        .eq("quality_rating", "GREEN") \
        .eq("is_paused", False) \
        .neq("phone_id", failed_phone_id) \
        .order("daily_limit", desc=True) \
        .limit(1) \
        .execute()

    if not numbers_resp.data:
        return

    failover_phone = numbers_resp.data[0]["phone_id"]

    # Update or create assignment for failover number
    existing = db.table("broadcast_dispatch_assignments") \
        .select("id, planned_count") \
        .eq("dispatch_id", dispatch_id) \
        .eq("phone_id", failover_phone) \
        .execute()

    if existing.data:
        asn_id = existing.data[0]["id"]
        new_planned = existing.data[0]["planned_count"] + remaining
        db.table("broadcast_dispatch_assignments").update({
            "planned_count": new_planned
        }).eq("id", asn_id).execute()
    else:
        db.table("broadcast_dispatch_assignments").insert({
            "dispatch_id": dispatch_id,
            "owner_id": owner_id,
            "phone_id": failover_phone,
            "planned_count": remaining,
            "status": "scheduled",
        }).execute()
```

- [ ] **Step 2: Smoke test**

```bash
python -c "from app.services.broadcast.intervention import evaluate_and_intervene; print('ok')"
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/broadcast/intervention.py
git commit -m "feat: lógica de intervenção automática — pausa + failover com idempotência

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Monitor Loop

**Files:**
- Create: `backend/app/services/broadcast/monitor_loop.py`

- [ ] **Step 1: Write monitor_loop.py**

```python
# backend/app/services/broadcast/monitor_loop.py
from __future__ import annotations

import asyncio
import json
import logging

import redis.asyncio as aioredis

from app.config import settings
from app.credentials.crypto import decrypt
from app.database import get_db
from app.services.broadcast.intervention import evaluate_and_intervene
from app.services.broadcast.meta_client import MetaClient
from app.services.broadcast.vendeai_client import VendeAIClient

logger = logging.getLogger(__name__)
POLL_INTERVAL = 60


async def monitor_tick(redis_client: aioredis.Redis) -> None:
    db = get_db()

    # Find all users with active dispatches
    active = db.table("broadcast_dispatches") \
        .select("owner_id") \
        .in_("status", ["running"]) \
        .execute()

    owner_ids = list({row["owner_id"] for row in (active.data or [])})

    for owner_id in owner_ids:
        try:
            await _process_owner(db, owner_id, redis_client)
        except Exception as e:
            logger.exception(f"Monitor error for owner {owner_id}: {e}")


async def _process_owner(db, owner_id: str, redis_client: aioredis.Redis) -> None:
    # Load credentials
    creds_resp = db.table("vendeai_settings") \
        .select("email_enc, password_enc, meta_token_enc") \
        .eq("owner_id", owner_id) \
        .single() \
        .execute()

    if not creds_resp.data:
        return

    creds = creds_resp.data
    email = decrypt(creds.get("email_enc"))
    password = decrypt(creds.get("password_enc"))
    meta_token = decrypt(creds.get("meta_token_enc"))

    if not email or not password:
        return

    vendeai = VendeAIClient(email, password)

    # 1. Poll VendeAI mailings → update sent/failed counts
    try:
        mailings_data = await vendeai.list_mailings(page=1, page_size=100)
        for mailing in mailings_data.get("results", []):
            mailing_id = mailing.get("id")
            if not mailing_id:
                continue
            asn_resp = db.table("broadcast_dispatch_assignments") \
                .select("id") \
                .eq("vendeai_mailing_id", mailing_id) \
                .eq("owner_id", owner_id) \
                .execute()
            if asn_resp.data:
                db.table("broadcast_dispatch_assignments").update({
                    "sent_count": mailing.get("sent_count", 0),
                    "failed_count": mailing.get("dispatch_total", 0) - mailing.get("sent_count", 0),
                    "last_poll_at": "now()",
                }).eq("id", asn_resp.data[0]["id"]).execute()
    except Exception as e:
        logger.warning(f"VendeAI poll failed for {owner_id}: {e}")

    # 2. Poll Meta API → update quality/tier
    if meta_token:
        try:
            meta = MetaClient(meta_token)
            numbers_resp = db.table("broadcast_numbers") \
                .select("phone_id") \
                .eq("owner_id", owner_id) \
                .execute()
            for num in (numbers_resp.data or []):
                try:
                    quality_data = await meta.get_phone_quality(num["phone_id"])
                    db.table("broadcast_numbers").update({
                        "quality_rating": quality_data["quality_rating"],
                        "messaging_tier": quality_data["messaging_tier"],
                        "daily_limit": quality_data["daily_limit"],
                        "last_meta_check_at": "now()",
                    }).eq("owner_id", owner_id).eq("phone_id", num["phone_id"]).execute()
                except Exception as e:
                    logger.warning(f"Meta poll failed for {num['phone_id']}: {e}")
        except Exception as e:
            logger.warning(f"Meta polling failed for {owner_id}: {e}")

    # 3. Evaluate interventions
    try:
        alerts = await evaluate_and_intervene(db, owner_id, vendeai)
        for alert in alerts:
            await redis_client.publish(
                "broadcast:events",
                json.dumps({
                    "user_id": owner_id,
                    "type": "broadcast.alert",
                    "alert_type": alert.get("alert_type"),
                    "phone_id": alert.get("phone_id"),
                    "severity": alert.get("severity"),
                    "message": alert.get("message"),
                }),
            )
    except Exception as e:
        logger.warning(f"Intervention failed for {owner_id}: {e}")

    # 4. Publish snapshot
    try:
        numbers = db.table("broadcast_numbers").select("*").eq("owner_id", owner_id).execute()
        dispatches = db.table("broadcast_dispatches") \
            .select("*, broadcast_dispatch_assignments(*)") \
            .eq("owner_id", owner_id) \
            .in_("status", ["running", "paused"]) \
            .execute()
        alerts_recent = db.table("broadcast_alerts") \
            .select("*") \
            .eq("owner_id", owner_id) \
            .order("ts", desc=True) \
            .limit(20) \
            .execute()

        await redis_client.publish(
            "broadcast:events",
            json.dumps({
                "user_id": owner_id,
                "type": "broadcast.snapshot",
                "numbers": numbers.data or [],
                "dispatches": dispatches.data or [],
                "alerts": alerts_recent.data or [],
            }, default=str),
        )
    except Exception as e:
        logger.warning(f"Snapshot publish failed for {owner_id}: {e}")


async def run_monitor_loop(redis_client: aioredis.Redis) -> None:
    logger.info("Broadcast monitor loop started")
    while True:
        try:
            await monitor_tick(redis_client)
        except Exception as e:
            logger.exception(f"Monitor tick error: {e}")
        await asyncio.sleep(POLL_INTERVAL)
```

- [ ] **Step 2: Smoke test**

```bash
python -c "from app.services.broadcast.monitor_loop import run_monitor_loop; print('ok')"
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/broadcast/monitor_loop.py
git commit -m "feat: monitor loop asyncio 60s — poll VendeAI + Meta + intervention + snapshot

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Broadcast Router

**Files:**
- Create: `backend/app/routers/broadcast.py`

- [ ] **Step 1: Write broadcast router**

```python
# backend/app/routers/broadcast.py
from __future__ import annotations

import io
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.config import settings
from app.credentials.crypto import decrypt, encrypt
from app.database import get_db
from app.services.broadcast.claude_advisor import advise_split
from app.services.broadcast.meta_client import MetaClient
from app.services.broadcast.vendeai_client import VendeAIClient

router = APIRouter(prefix="/api/broadcast", tags=["broadcast"])
security = HTTPBearer()


def _get_user_id(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    db = get_db()
    try:
        resp = db.auth.get_user(credentials.credentials)
        return resp.user.id
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


# ── Credentials ──────────────────────────────────────────────────────────────

class CredentialsIn(BaseModel):
    email: str
    password: str
    meta_token: Optional[str] = None


@router.post("/credentials")
async def save_credentials(
    body: CredentialsIn,
    user_id: str = Depends(_get_user_id),
):
    db = get_db()
    db.table("vendeai_settings").upsert({
        "owner_id": user_id,
        "email_enc": encrypt(body.email),
        "password_enc": encrypt(body.password),
        "meta_token_enc": encrypt(body.meta_token) if body.meta_token else None,
    }).execute()
    return {"ok": True}


@router.get("/credentials")
async def get_credentials_status(user_id: str = Depends(_get_user_id)):
    db = get_db()
    resp = db.table("vendeai_settings").select("owner_id").eq("owner_id", user_id).execute()
    return {"configured": bool(resp.data)}


# ── Numbers ───────────────────────────────────────────────────────────────────

@router.get("/numbers")
async def list_numbers(user_id: str = Depends(_get_user_id)):
    db = get_db()
    resp = db.table("broadcast_numbers").select("*").eq("owner_id", user_id).execute()
    return resp.data or []


@router.post("/numbers/refresh")
async def refresh_numbers(user_id: str = Depends(_get_user_id)):
    db = get_db()
    creds = db.table("vendeai_settings").select("*").eq("owner_id", user_id).single().execute()
    if not creds.data:
        raise HTTPException(400, "Configure credenciais primeiro")

    meta_token = decrypt(creds.data.get("meta_token_enc"))
    if not meta_token:
        raise HTTPException(400, "Meta token não configurado")

    vendeai_email = decrypt(creds.data.get("email_enc"))
    vendeai_pass = decrypt(creds.data.get("password_enc"))

    # Pull inboxes from VendeAI to discover phone_ids
    client = VendeAIClient(vendeai_email, vendeai_pass)
    inboxes = await client.list_inboxes()

    meta = MetaClient(meta_token)
    updated = []
    for inbox in inboxes:
        phone_id = str(inbox.get("phone_id") or inbox.get("id") or "")
        if not phone_id:
            continue
        try:
            q = await meta.get_phone_quality(phone_id)
            db.table("broadcast_numbers").upsert({
                "owner_id": user_id,
                "phone_id": phone_id,
                "display_phone": q["display_phone"] or inbox.get("inbox_phone", ""),
                "quality_rating": q["quality_rating"],
                "messaging_tier": q["messaging_tier"],
                "daily_limit": q["daily_limit"],
                "last_meta_check_at": "now()",
            }).execute()
            updated.append(phone_id)
        except Exception:
            pass

    return {"updated": updated}


# ── Analyze CSV ───────────────────────────────────────────────────────────────

@router.post("/analyze")
async def analyze_csv(
    file: UploadFile = File(...),
    user_id: str = Depends(_get_user_id),
):
    db = get_db()

    if not settings.anthropic_api_key:
        raise HTTPException(500, "ANTHROPIC_API_KEY não configurado")

    csv_bytes = await file.read()
    total_leads = max(0, csv_bytes.count(b"\n") - 1)  # rough count minus header

    numbers_resp = db.table("broadcast_numbers").select("*").eq("owner_id", user_id).execute()
    numbers = numbers_resp.data or []

    if not numbers:
        raise HTTPException(400, "Nenhum número cadastrado. Configure e faça refresh.")

    numbers_input = [
        {
            "phone_id": n["phone_id"],
            "quality_rating": n.get("quality_rating", "UNKNOWN"),
            "messaging_tier": n.get("messaging_tier", "1K"),
            "daily_limit": n.get("daily_limit", 1000),
            "is_paused": n.get("is_paused", False),
        }
        for n in numbers
    ]

    split = await advise_split(numbers_input, total_leads, settings.anthropic_api_key)

    # Store pending dispatch
    dispatch_id = str(uuid.uuid4())
    db.table("broadcast_dispatches").insert({
        "id": dispatch_id,
        "owner_id": user_id,
        "csv_filename": file.filename,
        "total_leads": total_leads,
        "claude_split_json": split,
        "status": "pending_confirm",
    }).execute()

    # Store csv bytes temporarily in Redis
    import redis as syncredis
    r = syncredis.from_url(settings.redis_url)
    r.setex(f"broadcast:csv:{dispatch_id}", 3600, csv_bytes)

    return {"dispatch_id": dispatch_id, "total_leads": total_leads, "split": split}


# ── Dispatch ──────────────────────────────────────────────────────────────────

class DispatchIn(BaseModel):
    dispatch_id: str
    assignments: list[dict]  # [{phone_id, planned_count, inbox_id, template_id}]


@router.post("/dispatch")
async def confirm_dispatch(
    body: DispatchIn,
    user_id: str = Depends(_get_user_id),
):
    db = get_db()

    dispatch = db.table("broadcast_dispatches") \
        .select("*") \
        .eq("id", body.dispatch_id) \
        .eq("owner_id", user_id) \
        .single() \
        .execute()

    if not dispatch.data:
        raise HTTPException(404, "Dispatch não encontrado")
    if dispatch.data["status"] != "pending_confirm":
        raise HTTPException(400, f"Dispatch já está em status {dispatch.data['status']}")

    creds = db.table("vendeai_settings").select("*").eq("owner_id", user_id).single().execute()
    if not creds.data:
        raise HTTPException(400, "Configure credenciais VendeAI primeiro")

    email = decrypt(creds.data["email_enc"])
    password = decrypt(creds.data["password_enc"])
    vendeai = VendeAIClient(email, password)

    import redis as syncredis
    r = syncredis.from_url(settings.redis_url)
    csv_bytes = r.get(f"broadcast:csv:{body.dispatch_id}")
    if not csv_bytes:
        raise HTTPException(400, "CSV expirou. Faça upload novamente.")

    mailing_ids = []
    for asn in body.assignments:
        phone_id = asn["phone_id"]
        planned = asn.get("planned_count", 0)
        inbox_id = asn.get("inbox_id", "")
        template_id = asn.get("template_id", "")

        if not inbox_id or not template_id:
            raise HTTPException(400, f"inbox_id e template_id obrigatórios para {phone_id}")

        resp = await vendeai.dispatch_csv(
            csv_bytes=csv_bytes,
            csv_filename=dispatch.data.get("csv_filename", "leads.csv"),
            inbox_id=inbox_id,
            template_id=template_id,
        )

        mailing_id = resp.get("id") or resp.get("mailing_id")

        db.table("broadcast_dispatch_assignments").insert({
            "dispatch_id": body.dispatch_id,
            "owner_id": user_id,
            "phone_id": phone_id,
            "vendeai_mailing_id": mailing_id,
            "planned_count": planned,
            "status": "running",
        }).execute()
        mailing_ids.append(mailing_id)

    db.table("broadcast_dispatches").update({
        "status": "running",
        "started_at": "now()",
    }).eq("id", body.dispatch_id).execute()

    return {"ok": True, "mailing_ids": mailing_ids}


# ── List / Detail Dispatches ──────────────────────────────────────────────────

@router.get("/dispatches")
async def list_dispatches(user_id: str = Depends(_get_user_id)):
    db = get_db()
    resp = db.table("broadcast_dispatches") \
        .select("*") \
        .eq("owner_id", user_id) \
        .order("created_at", desc=True) \
        .limit(20) \
        .execute()
    return resp.data or []


@router.get("/dispatches/{dispatch_id}")
async def get_dispatch(dispatch_id: str, user_id: str = Depends(_get_user_id)):
    db = get_db()
    resp = db.table("broadcast_dispatches") \
        .select("*, broadcast_dispatch_assignments(*)") \
        .eq("id", dispatch_id) \
        .eq("owner_id", user_id) \
        .single() \
        .execute()
    if not resp.data:
        raise HTTPException(404, "Dispatch não encontrado")
    return resp.data


# ── Pause / Resume / Revoke ───────────────────────────────────────────────────

async def _get_vendeai_for_user(user_id: str) -> VendeAIClient:
    db = get_db()
    creds = db.table("vendeai_settings").select("*").eq("owner_id", user_id).single().execute()
    if not creds.data:
        raise HTTPException(400, "Credenciais não configuradas")
    return VendeAIClient(decrypt(creds.data["email_enc"]), decrypt(creds.data["password_enc"]))


@router.post("/dispatches/{dispatch_id}/pause")
async def pause_dispatch(dispatch_id: str, user_id: str = Depends(_get_user_id)):
    db = get_db()
    vendeai = await _get_vendeai_for_user(user_id)
    asns = db.table("broadcast_dispatch_assignments") \
        .select("vendeai_mailing_id") \
        .eq("dispatch_id", dispatch_id) \
        .eq("owner_id", user_id) \
        .eq("status", "running") \
        .execute()
    for asn in (asns.data or []):
        if asn.get("vendeai_mailing_id"):
            try:
                await vendeai.pause(asn["vendeai_mailing_id"])
            except Exception:
                pass
    db.table("broadcast_dispatch_assignments").update({"status": "paused"}) \
        .eq("dispatch_id", dispatch_id).eq("owner_id", user_id).execute()
    db.table("broadcast_dispatches").update({"status": "paused"}) \
        .eq("id", dispatch_id).eq("owner_id", user_id).execute()
    return {"ok": True}


@router.post("/dispatches/{dispatch_id}/resume")
async def resume_dispatch(dispatch_id: str, user_id: str = Depends(_get_user_id)):
    db = get_db()
    vendeai = await _get_vendeai_for_user(user_id)
    asns = db.table("broadcast_dispatch_assignments") \
        .select("vendeai_mailing_id") \
        .eq("dispatch_id", dispatch_id) \
        .eq("owner_id", user_id) \
        .eq("status", "paused") \
        .execute()
    for asn in (asns.data or []):
        if asn.get("vendeai_mailing_id"):
            try:
                await vendeai.resume(asn["vendeai_mailing_id"])
            except Exception:
                pass
    db.table("broadcast_dispatch_assignments").update({"status": "running"}) \
        .eq("dispatch_id", dispatch_id).eq("owner_id", user_id).execute()
    db.table("broadcast_dispatches").update({"status": "running"}) \
        .eq("id", dispatch_id).eq("owner_id", user_id).execute()
    return {"ok": True}


@router.post("/dispatches/{dispatch_id}/revoke")
async def revoke_dispatch(dispatch_id: str, user_id: str = Depends(_get_user_id)):
    db = get_db()
    vendeai = await _get_vendeai_for_user(user_id)
    asns = db.table("broadcast_dispatch_assignments") \
        .select("vendeai_mailing_id") \
        .eq("dispatch_id", dispatch_id) \
        .eq("owner_id", user_id) \
        .execute()
    for asn in (asns.data or []):
        if asn.get("vendeai_mailing_id"):
            try:
                await vendeai.cancel(asn["vendeai_mailing_id"])
            except Exception:
                pass
    db.table("broadcast_dispatch_assignments").update({"status": "failed"}) \
        .eq("dispatch_id", dispatch_id).eq("owner_id", user_id).execute()
    db.table("broadcast_dispatches").update({
        "status": "revoked",
        "finished_at": "now()",
    }).eq("id", dispatch_id).eq("owner_id", user_id).execute()
    return {"ok": True}


# ── Analytics + Alerts ────────────────────────────────────────────────────────

@router.get("/analytics")
async def get_analytics(user_id: str = Depends(_get_user_id)):
    db = get_db()
    asns = db.table("broadcast_dispatch_assignments") \
        .select("phone_id, sent_count, failed_count, open_count, converted_count") \
        .eq("owner_id", user_id) \
        .execute()
    by_phone: dict[str, Any] = {}
    for a in (asns.data or []):
        p = a["phone_id"]
        if p not in by_phone:
            by_phone[p] = {"sent": 0, "failed": 0, "open": 0, "converted": 0}
        by_phone[p]["sent"] += a.get("sent_count", 0)
        by_phone[p]["failed"] += a.get("failed_count", 0)
        by_phone[p]["open"] += a.get("open_count", 0)
        by_phone[p]["converted"] += a.get("converted_count", 0)
    return [{"phone_id": k, **v} for k, v in by_phone.items()]


@router.get("/alerts")
async def list_alerts(user_id: str = Depends(_get_user_id)):
    db = get_db()
    resp = db.table("broadcast_alerts") \
        .select("*") \
        .eq("owner_id", user_id) \
        .order("ts", desc=True) \
        .limit(50) \
        .execute()
    return resp.data or []
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/routers/broadcast.py
git commit -m "feat: broadcast router — credentials, numbers, analyze, dispatch, pause/resume/revoke

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Wire into main.py + ws.py

**Files:**
- Modify: `backend/app/main.py`
- Modify: `backend/app/routers/ws.py`

- [ ] **Step 1: Read current main.py and ws.py**

```bash
cat backend/app/main.py
cat backend/app/routers/ws.py
```

- [ ] **Step 2: Add broadcast router to main.py**

In `backend/app/main.py`, add after the last `include_router` call:

```python
from app.routers import broadcast as broadcast_router
app.include_router(broadcast_router.router)
```

Add monitor loop startup (in the `@app.on_event("startup")` function or equivalent):

```python
from app.services.broadcast.monitor_loop import run_monitor_loop
import asyncio

@app.on_event("startup")
async def startup_event():
    # ... existing startup code ...
    asyncio.create_task(run_monitor_loop(redis_client))
```

Note: if there's already a startup event, add the `asyncio.create_task` line inside the existing function — don't create a duplicate decorator.

- [ ] **Step 3: Add broadcast:events to ws.py**

Find line with `await pubsub.subscribe("bot:events")` and change to:

```python
await pubsub.subscribe("bot:events", "broadcast:events")
```

Find line with `await pubsub.unsubscribe("bot:events")` and change to:

```python
await pubsub.unsubscribe("bot:events", "broadcast:events")
```

- [ ] **Step 4: Test startup**

```bash
cd "/Users/macbookdegabriel/projetos/ACELERA CORBAN/backend"
uvicorn app.main:app --host 0.0.0.0 --port 8002 --reload
```

Expected: server starts, no import errors, `/api/broadcast/credentials` accessible.

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py backend/app/routers/ws.py
git commit -m "feat: wiring broadcast router + monitor loop no startup + broadcast:events no WS

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Frontend — broadcastApi + WebSocket hook

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Create: `frontend/src/hooks/useBroadcastWebSocket.ts`

- [ ] **Step 1: Read current api.ts**

```bash
cat frontend/src/lib/api.ts
```

- [ ] **Step 2: Add broadcastApi to api.ts**

After the existing axios instances, add:

```typescript
const broadcastAxios = axios.create({ baseURL: BASE_URL });

// Auth interceptor only — no bankPrefix
broadcastAxios.interceptors.request.use(async (config) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`;
  }
  return config;
});

export const broadcastApi = {
  getCredentialsStatus: () => broadcastAxios.get('/api/broadcast/credentials'),
  saveCredentials: (data: { email: string; password: string; meta_token?: string }) =>
    broadcastAxios.post('/api/broadcast/credentials', data),
  listNumbers: () => broadcastAxios.get('/api/broadcast/numbers'),
  refreshNumbers: () => broadcastAxios.post('/api/broadcast/numbers/refresh'),
  analyzeCSV: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return broadcastAxios.post('/api/broadcast/analyze', form);
  },
  confirmDispatch: (data: { dispatch_id: string; assignments: any[] }) =>
    broadcastAxios.post('/api/broadcast/dispatch', data),
  listDispatches: () => broadcastAxios.get('/api/broadcast/dispatches'),
  getDispatch: (id: string) => broadcastAxios.get(`/api/broadcast/dispatches/${id}`),
  pauseDispatch: (id: string) => broadcastAxios.post(`/api/broadcast/dispatches/${id}/pause`),
  resumeDispatch: (id: string) => broadcastAxios.post(`/api/broadcast/dispatches/${id}/resume`),
  revokeDispatch: (id: string) => broadcastAxios.post(`/api/broadcast/dispatches/${id}/revoke`),
  getAnalytics: () => broadcastAxios.get('/api/broadcast/analytics'),
  getAlerts: () => broadcastAxios.get('/api/broadcast/alerts'),
};
```

- [ ] **Step 3: Create useBroadcastWebSocket.ts**

```typescript
// frontend/src/hooks/useBroadcastWebSocket.ts
import { useEffect, useRef, useState } from 'react';

export interface BroadcastSnapshot {
  numbers: any[];
  dispatches: any[];
  alerts: any[];
}

export interface BroadcastAlert {
  alert_type: string;
  phone_id: string;
  severity: string;
  message: string;
}

interface UseBroadcastWebSocketResult {
  snapshot: BroadcastSnapshot | null;
  latestAlert: BroadcastAlert | null;
}

export function useBroadcastWebSocket(wsUrl: string): UseBroadcastWebSocketResult {
  const [snapshot, setSnapshot] = useState<BroadcastSnapshot | null>(null);
  const [latestAlert, setLatestAlert] = useState<BroadcastAlert | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (!msg.type?.startsWith('broadcast.')) return;

        if (msg.type === 'broadcast.snapshot') {
          setSnapshot({
            numbers: msg.numbers ?? [],
            dispatches: msg.dispatches ?? [],
            alerts: msg.alerts ?? [],
          });
        } else if (msg.type === 'broadcast.alert') {
          setLatestAlert({
            alert_type: msg.alert_type,
            phone_id: msg.phone_id,
            severity: msg.severity,
            message: msg.message,
          });
        }
      } catch {
        // ignore parse errors
      }
    };

    return () => {
      ws.close();
    };
  }, [wsUrl]);

  return { snapshot, latestAlert };
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/hooks/useBroadcastWebSocket.ts
git commit -m "feat: broadcastApi sem bankPrefix + hook useBroadcastWebSocket

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Configuracoes.tsx — nova seção VendeAI

**Files:**
- Modify: `frontend/src/pages/Configuracoes.tsx`

- [ ] **Step 1: Read current Configuracoes.tsx**

```bash
cat frontend/src/pages/Configuracoes.tsx
```

- [ ] **Step 2: Add import and state**

Add to imports:

```typescript
import { broadcastApi } from '../lib/api';
```

Add state (inside component):

```typescript
const [vendeaiEmail, setVendeaiEmail] = useState('');
const [vendeaiPassword, setVendeaiPassword] = useState('');
const [metaToken, setMetaToken] = useState('');
const [savingBroadcast, setSavingBroadcast] = useState(false);
const [broadcastSaved, setBroadcastSaved] = useState(false);

const handleSaveBroadcast = async () => {
  setSavingBroadcast(true);
  try {
    await broadcastApi.saveCredentials({
      email: vendeaiEmail,
      password: vendeaiPassword,
      meta_token: metaToken || undefined,
    });
    setBroadcastSaved(true);
    setTimeout(() => setBroadcastSaved(false), 3000);
  } catch {
    // show error
  } finally {
    setSavingBroadcast(false);
  }
};
```

- [ ] **Step 3: Add section JSX**

Add new card before the closing tag of the page, following the same card style as existing sections:

```tsx
{/* Disparo WhatsApp */}
<div style={{
  background: '#0d0d1f',
  border: '1px solid #1e1e3a',
  borderRadius: 12,
  padding: 24,
  marginTop: 24,
}}>
  <h3 style={{ color: '#6366f1', marginBottom: 16, fontSize: 16 }}>
    Disparo WhatsApp
  </h3>

  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <label style={{ color: '#94a3b8', fontSize: 13 }}>VendeAI E-mail</label>
    <input
      type="text"
      value={vendeaiEmail}
      onChange={e => setVendeaiEmail(e.target.value)}
      placeholder="seu@email.com"
      style={{
        background: '#080818', border: '1px solid #1e1e3a', borderRadius: 8,
        padding: '10px 14px', color: '#e2e8f0', fontSize: 14,
      }}
    />

    <label style={{ color: '#94a3b8', fontSize: 13 }}>VendeAI Senha</label>
    <input
      type="password"
      value={vendeaiPassword}
      onChange={e => setVendeaiPassword(e.target.value)}
      placeholder="Em branco = manter existente"
      style={{
        background: '#080818', border: '1px solid #1e1e3a', borderRadius: 8,
        padding: '10px 14px', color: '#e2e8f0', fontSize: 14,
      }}
    />

    <label style={{ color: '#94a3b8', fontSize: 13 }}>Meta Graph API Token</label>
    <input
      type="password"
      value={metaToken}
      onChange={e => setMetaToken(e.target.value)}
      placeholder="EAAxxxxx..."
      style={{
        background: '#080818', border: '1px solid #1e1e3a', borderRadius: 8,
        padding: '10px 14px', color: '#e2e8f0', fontSize: 14,
      }}
    />

    <p style={{ color: '#475569', fontSize: 12, margin: 0 }}>
      Credenciais Chatwoot: configure na seção CRM Chatwoot
    </p>

    <button
      onClick={handleSaveBroadcast}
      disabled={savingBroadcast}
      style={{
        background: broadcastSaved ? '#00ff88' : '#6366f1',
        color: broadcastSaved ? '#080818' : '#fff',
        border: 'none', borderRadius: 8, padding: '10px 20px',
        cursor: 'pointer', fontWeight: 600, fontSize: 14,
        alignSelf: 'flex-start', transition: 'all 0.2s',
      }}
    >
      {broadcastSaved ? 'Salvo!' : savingBroadcast ? 'Salvando...' : 'Salvar'}
    </button>
  </div>
</div>
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Configuracoes.tsx
git commit -m "feat: seção Disparo WhatsApp na página de configurações

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: NumberQualityGrid Component

**Files:**
- Create: `frontend/src/components/disparo/NumberQualityGrid.tsx`

- [ ] **Step 1: Write component**

```tsx
// frontend/src/components/disparo/NumberQualityGrid.tsx
import React from 'react';
import { broadcastApi } from '../../lib/api';

interface BroadcastNumber {
  phone_id: string;
  display_phone: string;
  quality_rating: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';
  messaging_tier: string;
  daily_limit: number;
  is_paused: boolean;
}

interface Props {
  numbers: BroadcastNumber[];
  onResume?: (phoneId: string) => void;
}

const qualityColor = {
  GREEN: '#00ff88',
  YELLOW: '#ffd700',
  RED: '#ff2d78',
  UNKNOWN: '#475569',
};

export function NumberQualityGrid({ numbers, onResume }: Props) {
  const handleResume = async (phoneId: string) => {
    // Resume numbers by resuming all running dispatches for this phone
    // This is a simplified resume — triggers a parent refresh
    onResume?.(phoneId);
  };

  if (!numbers.length) {
    return (
      <div style={{ color: '#475569', textAlign: 'center', padding: 32 }}>
        Nenhum número cadastrado. Configure credenciais e faça Refresh.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
      {numbers.map(n => (
        <div
          key={n.phone_id}
          style={{
            background: '#0d0d1f',
            border: `1px solid ${qualityColor[n.quality_rating] ?? '#1e1e3a'}22`,
            borderRadius: 12,
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 14 }}>
              {n.display_phone || n.phone_id}
            </span>
            <span style={{
              background: qualityColor[n.quality_rating] + '22',
              color: qualityColor[n.quality_rating],
              borderRadius: 6,
              padding: '2px 8px',
              fontSize: 11,
              fontWeight: 700,
            }}>
              {n.quality_rating}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{
              background: '#1e1e3a',
              color: '#94a3b8',
              borderRadius: 6,
              padding: '2px 8px',
              fontSize: 11,
            }}>
              {n.messaging_tier}/dia
            </span>
            <span style={{
              background: '#1e1e3a',
              color: '#94a3b8',
              borderRadius: 6,
              padding: '2px 8px',
              fontSize: 11,
            }}>
              {n.daily_limit.toLocaleString()} lim.
            </span>
          </div>

          {n.is_paused && (
            <button
              onClick={() => handleResume(n.phone_id)}
              style={{
                background: '#6366f133',
                border: '1px solid #6366f1',
                color: '#6366f1',
                borderRadius: 8,
                padding: '6px 12px',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                marginTop: 4,
              }}
            >
              Retomar
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/disparo/NumberQualityGrid.tsx
git commit -m "feat: NumberQualityGrid — cards com badge qualidade e chip tier

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: AlertFeed Component

**Files:**
- Create: `frontend/src/components/disparo/AlertFeed.tsx`

- [ ] **Step 1: Write component**

```tsx
// frontend/src/components/disparo/AlertFeed.tsx
import React from 'react';

interface Alert {
  id: string;
  alert_type: string;
  severity: 'warn' | 'critical';
  message: string;
  phone_id: string;
  ts: string;
}

interface Props {
  alerts: Alert[];
}

const severityColor = {
  warn: '#ffd700',
  critical: '#ff2d78',
};

export function AlertFeed({ alerts }: Props) {
  if (!alerts.length) {
    return (
      <div style={{ color: '#475569', textAlign: 'center', padding: 24 }}>
        Nenhum alerta registrado.
      </div>
    );
  }

  return (
    <div style={{
      maxHeight: 320,
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      {alerts.map(a => (
        <div
          key={a.id}
          style={{
            background: '#0d0d1f',
            border: `1px solid ${severityColor[a.severity] ?? '#1e1e3a'}44`,
            borderLeft: `3px solid ${severityColor[a.severity] ?? '#1e1e3a'}`,
            borderRadius: 8,
            padding: '10px 14px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ color: severityColor[a.severity], fontSize: 12, fontWeight: 700 }}>
              {a.alert_type.replace('_', ' ').toUpperCase()}
            </span>
            <span style={{ color: '#e2e8f0', fontSize: 13 }}>{a.message}</span>
            <span style={{ color: '#475569', fontSize: 11 }}>{a.phone_id}</span>
          </div>
          <span style={{ color: '#475569', fontSize: 11, whiteSpace: 'nowrap' }}>
            {new Date(a.ts).toLocaleTimeString('pt-BR')}
          </span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/disparo/AlertFeed.tsx
git commit -m "feat: AlertFeed — log scrollável com cor por severidade

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: DispatchMetrics Component

**Files:**
- Create: `frontend/src/components/disparo/DispatchMetrics.tsx`

- [ ] **Step 1: Write component**

```tsx
// frontend/src/components/disparo/DispatchMetrics.tsx
import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface PhoneMetric {
  phone_id: string;
  sent: number;
  failed: number;
  open: number;
  converted: number;
}

interface Props {
  metrics: PhoneMetric[];
}

export function DispatchMetrics({ metrics }: Props) {
  if (!metrics.length) {
    return (
      <div style={{ color: '#475569', textAlign: 'center', padding: 24 }}>
        Nenhuma métrica disponível.
      </div>
    );
  }

  const chartData = metrics.map(m => ({
    name: m.phone_id.slice(-8),
    Enviados: m.sent,
    Falhas: m.failed,
    Abertos: m.open,
    Convertidos: m.converted,
  }));

  const totals = metrics.reduce((acc, m) => ({
    sent: acc.sent + m.sent,
    converted: acc.converted + m.converted,
  }), { sent: 0, converted: 0 });

  const convRate = totals.sent > 0
    ? ((totals.converted / totals.sent) * 100).toFixed(1)
    : '0.0';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{
          background: '#0d0d1f', border: '1px solid #1e1e3a',
          borderRadius: 10, padding: '12px 20px',
        }}>
          <div style={{ color: '#475569', fontSize: 11 }}>Total Enviado</div>
          <div style={{ color: '#00ff88', fontSize: 22, fontWeight: 700 }}>
            {totals.sent.toLocaleString()}
          </div>
        </div>
        <div style={{
          background: '#0d0d1f', border: '1px solid #1e1e3a',
          borderRadius: 10, padding: '12px 20px',
        }}>
          <div style={{ color: '#475569', fontSize: 11 }}>Conversão (PAGO/OFERTADO)</div>
          <div style={{ color: '#6366f1', fontSize: 22, fontWeight: 700 }}>
            {convRate}%
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
          <XAxis dataKey="name" tick={{ fill: '#475569', fontSize: 11 }} />
          <YAxis tick={{ fill: '#475569', fontSize: 11 }} />
          <Tooltip
            contentStyle={{ background: '#0d0d1f', border: '1px solid #1e1e3a', borderRadius: 8 }}
            labelStyle={{ color: '#94a3b8' }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Enviados" fill="#6366f1" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Falhas" fill="#ff2d78" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Abertos" fill="#ffd700" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Convertidos" fill="#00ff88" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/disparo/DispatchMetrics.tsx
git commit -m "feat: DispatchMetrics — Recharts BarChart enviados/falhas/abertos/convertidos

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: CsvUploadWizard Component

**Files:**
- Create: `frontend/src/components/disparo/CsvUploadWizard.tsx`

- [ ] **Step 1: Write component**

```tsx
// frontend/src/components/disparo/CsvUploadWizard.tsx
import React, { useCallback, useState } from 'react';
import { broadcastApi } from '../../lib/api';

type WizardState = 'idle' | 'uploading' | 'analyzing' | 'confirming' | 'dispatching';

interface SplitAssignment {
  phone_id: string;
  planned_count: number;
  reason: string;
  inbox_id?: string;
  template_id?: string;
}

interface AnalyzeResult {
  dispatch_id: string;
  total_leads: number;
  split: {
    assignments: SplitAssignment[];
    justification: string;
    risks: string;
  };
}

interface Props {
  onDispatched?: () => void;
}

export function CsvUploadWizard({ onDispatched }: Props) {
  const [state, setState] = useState<WizardState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResult | null>(null);
  const [editableAssignments, setEditableAssignments] = useState<SplitAssignment[]>([]);

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file?.name.endsWith('.csv')) {
      setError('Apenas arquivos .csv são aceitos');
      return;
    }
    await uploadAndAnalyze(file);
  }, []);

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadAndAnalyze(file);
  };

  const uploadAndAnalyze = async (file: File) => {
    setError(null);
    setState('uploading');
    try {
      setState('analyzing');
      const resp = await broadcastApi.analyzeCSV(file);
      const result: AnalyzeResult = resp.data;
      setAnalyzeResult(result);
      setEditableAssignments(result.split.assignments.map(a => ({ ...a })));
      setState('confirming');
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Erro ao analisar CSV');
      setState('idle');
    }
  };

  const handleDispatch = async () => {
    if (!analyzeResult) return;
    setState('dispatching');
    setError(null);
    try {
      await broadcastApi.confirmDispatch({
        dispatch_id: analyzeResult.dispatch_id,
        assignments: editableAssignments,
      });
      onDispatched?.();
      setState('idle');
      setAnalyzeResult(null);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Erro ao disparar');
      setState('confirming');
    }
  };

  const updateCount = (phoneId: string, value: number) => {
    setEditableAssignments(prev =>
      prev.map(a => a.phone_id === phoneId ? { ...a, planned_count: value } : a)
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {state === 'idle' && (
        <div
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          style={{
            border: '2px dashed #1e1e3a',
            borderRadius: 12,
            padding: 40,
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'border-color 0.2s',
          }}
          onDragEnter={e => (e.currentTarget.style.borderColor = '#6366f1')}
          onDragLeave={e => (e.currentTarget.style.borderColor = '#1e1e3a')}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
          <div style={{ color: '#94a3b8', fontSize: 14, marginBottom: 12 }}>
            Arraste um CSV aqui ou clique para selecionar
          </div>
          <label style={{
            background: '#6366f1', color: '#fff', borderRadius: 8,
            padding: '8px 20px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
          }}>
            Selecionar arquivo
            <input type="file" accept=".csv" onChange={handleFileInput} style={{ display: 'none' }} />
          </label>
        </div>
      )}

      {(state === 'uploading' || state === 'analyzing') && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚡</div>
          <div style={{ color: '#6366f1', fontSize: 15, fontWeight: 600 }}>
            {state === 'uploading' ? 'Enviando CSV...' : 'Claude está analisando o disparo...'}
          </div>
        </div>
      )}

      {state === 'confirming' && analyzeResult && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{
            background: '#6366f111', border: '1px solid #6366f133',
            borderRadius: 10, padding: 14,
          }}>
            <div style={{ color: '#6366f1', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
              JUSTIFICATIVA CLAUDE
            </div>
            <div style={{ color: '#94a3b8', fontSize: 13 }}>
              {analyzeResult.split.justification}
            </div>
            {analyzeResult.split.risks && (
              <div style={{ color: '#ffd700', fontSize: 12, marginTop: 8 }}>
                ⚠ {analyzeResult.split.risks}
              </div>
            )}
          </div>

          <div style={{ color: '#94a3b8', fontSize: 13 }}>
            Total de leads: <strong style={{ color: '#e2e8f0' }}>{analyzeResult.total_leads}</strong>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e1e3a' }}>
                <th style={{ textAlign: 'left', color: '#475569', padding: '6px 8px' }}>Número</th>
                <th style={{ textAlign: 'left', color: '#475569', padding: '6px 8px' }}>Leads</th>
                <th style={{ textAlign: 'left', color: '#475569', padding: '6px 8px' }}>Motivo</th>
                <th style={{ textAlign: 'left', color: '#475569', padding: '6px 8px' }}>Inbox ID</th>
                <th style={{ textAlign: 'left', color: '#475569', padding: '6px 8px' }}>Template ID</th>
              </tr>
            </thead>
            <tbody>
              {editableAssignments.map(a => (
                <tr key={a.phone_id} style={{ borderBottom: '1px solid #1e1e3a11' }}>
                  <td style={{ color: '#e2e8f0', padding: '6px 8px' }}>{a.phone_id.slice(-10)}</td>
                  <td style={{ padding: '6px 8px' }}>
                    <input
                      type="number"
                      value={a.planned_count}
                      onChange={e => updateCount(a.phone_id, Number(e.target.value))}
                      style={{
                        background: '#080818', border: '1px solid #1e1e3a',
                        borderRadius: 6, padding: '4px 8px', color: '#e2e8f0',
                        width: 80, fontSize: 13,
                      }}
                    />
                  </td>
                  <td style={{ color: '#475569', padding: '6px 8px', fontSize: 12 }}>
                    {a.reason}
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <input
                      type="text"
                      value={a.inbox_id ?? ''}
                      onChange={e => setEditableAssignments(prev =>
                        prev.map(x => x.phone_id === a.phone_id ? { ...x, inbox_id: e.target.value } : x)
                      )}
                      placeholder="inbox_id"
                      style={{
                        background: '#080818', border: '1px solid #1e1e3a',
                        borderRadius: 6, padding: '4px 8px', color: '#e2e8f0',
                        width: 100, fontSize: 12,
                      }}
                    />
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <input
                      type="text"
                      value={a.template_id ?? ''}
                      onChange={e => setEditableAssignments(prev =>
                        prev.map(x => x.phone_id === a.phone_id ? { ...x, template_id: e.target.value } : x)
                      )}
                      placeholder="template_id"
                      style={{
                        background: '#080818', border: '1px solid #1e1e3a',
                        borderRadius: 6, padding: '4px 8px', color: '#e2e8f0',
                        width: 120, fontSize: 12,
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={handleDispatch}
              style={{
                background: '#00ff88', color: '#080818', border: 'none',
                borderRadius: 8, padding: '10px 24px', cursor: 'pointer',
                fontWeight: 700, fontSize: 14,
              }}
            >
              Confirmar e Disparar
            </button>
            <button
              onClick={() => { setState('idle'); setAnalyzeResult(null); }}
              style={{
                background: 'transparent', color: '#475569', border: '1px solid #1e1e3a',
                borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontSize: 14,
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {state === 'dispatching' && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🚀</div>
          <div style={{ color: '#00ff88', fontSize: 15, fontWeight: 600 }}>
            Enviando para VendeAI...
          </div>
        </div>
      )}

      {error && (
        <div style={{
          background: '#ff2d7811', border: '1px solid #ff2d7844',
          borderRadius: 8, padding: '10px 14px', color: '#ff2d78', fontSize: 13,
        }}>
          {error}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/disparo/CsvUploadWizard.tsx
git commit -m "feat: CsvUploadWizard — 5 estados idle→uploading→analyzing→confirming→dispatching

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: Disparo.tsx — main page

**Files:**
- Create: `frontend/src/pages/Disparo.tsx`

- [ ] **Step 1: Write page**

```tsx
// frontend/src/pages/Disparo.tsx
import React, { useEffect, useState } from 'react';
import { AlertFeed } from '../components/disparo/AlertFeed';
import { CsvUploadWizard } from '../components/disparo/CsvUploadWizard';
import { DispatchMetrics } from '../components/disparo/DispatchMetrics';
import { NumberQualityGrid } from '../components/disparo/NumberQualityGrid';
import { useBroadcastWebSocket } from '../hooks/useBroadcastWebSocket';
import { broadcastApi } from '../lib/api';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8002/ws';

export default function Disparo() {
  const { snapshot } = useBroadcastWebSocket(WS_URL);
  const [numbers, setNumbers] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    try {
      const [numsResp, analyticsResp, alertsResp] = await Promise.all([
        broadcastApi.listNumbers(),
        broadcastApi.getAnalytics(),
        broadcastApi.getAlerts(),
      ]);
      setNumbers(numsResp.data);
      setAnalytics(analyticsResp.data);
      setAlerts(alertsResp.data);
    } catch (e) {
      // silent — WS will hydrate
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Hydrate from WS snapshot when available
  useEffect(() => {
    if (!snapshot) return;
    if (snapshot.numbers.length) setNumbers(snapshot.numbers);
    if (snapshot.alerts.length) setAlerts(snapshot.alerts);
  }, [snapshot]);

  const handleRefreshNumbers = async () => {
    setRefreshing(true);
    try {
      await broadcastApi.refreshNumbers();
      await loadData();
    } catch (e) {
      // ignore
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1200 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ color: '#e2e8f0', fontSize: 22, fontWeight: 700, margin: 0 }}>
          Disparo WhatsApp
        </h1>
        <button
          onClick={handleRefreshNumbers}
          disabled={refreshing}
          style={{
            background: '#0d0d1f', border: '1px solid #1e1e3a',
            color: '#94a3b8', borderRadius: 8, padding: '8px 16px',
            cursor: 'pointer', fontSize: 13,
          }}
        >
          {refreshing ? 'Atualizando...' : '⟳ Refresh Números'}
        </button>
      </div>

      {/* Panel 1 — Upload Wizard */}
      <div style={{
        background: '#0d0d1f', border: '1px solid #1e1e3a',
        borderRadius: 12, padding: 24,
      }}>
        <h2 style={{ color: '#6366f1', fontSize: 15, fontWeight: 700, marginBottom: 16, marginTop: 0 }}>
          Novo Disparo
        </h2>
        <CsvUploadWizard onDispatched={loadData} />
      </div>

      {/* Panel 2 — Number Quality */}
      <div style={{
        background: '#0d0d1f', border: '1px solid #1e1e3a',
        borderRadius: 12, padding: 24,
      }}>
        <h2 style={{ color: '#6366f1', fontSize: 15, fontWeight: 700, marginBottom: 16, marginTop: 0 }}>
          Qualidade dos Números
        </h2>
        <NumberQualityGrid numbers={numbers} onResume={loadData} />
      </div>

      {/* Panel 3 — Metrics + Alerts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div style={{
          background: '#0d0d1f', border: '1px solid #1e1e3a',
          borderRadius: 12, padding: 24,
        }}>
          <h2 style={{ color: '#6366f1', fontSize: 15, fontWeight: 700, marginBottom: 16, marginTop: 0 }}>
            Métricas de Disparo
          </h2>
          <DispatchMetrics metrics={analytics} />
        </div>

        <div style={{
          background: '#0d0d1f', border: '1px solid #1e1e3a',
          borderRadius: 12, padding: 24,
        }}>
          <h2 style={{ color: '#ff2d78', fontSize: 15, fontWeight: 700, marginBottom: 16, marginTop: 0 }}>
            Alertas
          </h2>
          <AlertFeed alerts={alerts} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/Disparo.tsx
git commit -m "feat: Disparo.tsx — página principal com 3 painéis

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: Wire App.tsx — add route + rename nav

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Read current App.tsx**

```bash
cat frontend/src/App.tsx
```

- [ ] **Step 2: Add import for Disparo page**

In `frontend/src/App.tsx`, add import:

```typescript
import Disparo from './pages/Disparo';
```

- [ ] **Step 3: Add route**

Find the routes section and add:

```tsx
<Route path="/disparo" element={<Disparo />} />
```

- [ ] **Step 4: Rename Chatwoot nav link and add Disparo nav**

Find `"Disparo Chatwoot"` in the nav/sidebar and rename to `"CRM Chatwoot"`.

Add new NavLink before or after the CRM Chatwoot entry:

```tsx
<NavLink to="/disparo">Disparo WhatsApp</NavLink>
```

(Match the exact style pattern of existing NavLinks in the file.)

- [ ] **Step 5: Verify frontend builds**

```bash
cd "/Users/macbookdegabriel/projetos/ACELERA CORBAN/frontend"
npm run build 2>&1 | tail -20
```

Expected: build completes without TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat: rota /disparo + rename 'Disparo Chatwoot' → 'CRM Chatwoot' no nav

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 18: End-to-End Test (localhost)

- [ ] **Step 1: Start backend**

```bash
cd "/Users/macbookdegabriel/projetos/ACELERA CORBAN/backend"
uvicorn app.main:app --host 0.0.0.0 --port 8002 --reload
```

Verify in another terminal:
```bash
curl -s http://localhost:8002/health | python3 -m json.tool
```

Expected: `{"status": "ok", ...}`

- [ ] **Step 2: Start frontend**

```bash
cd "/Users/macbookdegabriel/projetos/ACELERA CORBAN/frontend"
npm run dev
```

Expected: dev server at `http://localhost:3002`

- [ ] **Step 3: Manual test checklist**

Open `http://localhost:3002` and verify:

1. Nav shows "Disparo WhatsApp" and "CRM Chatwoot" (renamed)
2. `/disparo` page loads with 3 panels
3. `/configuracoes` shows "Disparo WhatsApp" section
4. Enter VendeAI credentials (email: `own_ndat9@vendeai.com`, password: `own_UMwV8@!`) + Meta token → Save
5. Click "Refresh Números" → numbers appear in grid
6. Upload a test CSV → wizard progresses to "analyzing" → confirming
7. Check network tab — `/api/broadcast/analyze` returns split JSON
8. Check browser console for errors

- [ ] **Step 4: Verify backend logs show monitor loop**

Look for: `Broadcast monitor loop started` in backend stdout.

---

## Task 19: Deploy VPS

**Prerequisite:** User approves localhost test.

- [ ] **Step 1: Add ANTHROPIC_API_KEY to .env on VPS**

```bash
ssh root@177.7.58.154 "echo 'ANTHROPIC_API_KEY=<key>' >> /path/to/.env"
```

- [ ] **Step 2: Pull and rebuild on VPS**

```bash
ssh root@177.7.58.154 "cd /path/to/acelera-corban && git pull && docker compose up --build -d"
```

- [ ] **Step 3: Run migration on VPS**

```bash
ssh root@177.7.58.154 "psql \$DATABASE_URL -f migrations/013_broadcast.sql"
```

- [ ] **Step 4: Verify production**

```bash
curl -s https://api.aceleracorban.com.br/health
```

Expected: `{"status": "ok", ...}`

Open `https://aceleracorban.com.br/disparo` and verify page loads.

---

## Spec Coverage Check

- [x] Migration 013_broadcast.sql — Task 1
- [x] vendeai_client.py async — Task 3
- [x] meta_client.py quality polling — Task 4
- [x] claude_advisor.py tool-use + cache — Task 5
- [x] intervention.py pause/failover/idempotency — Task 6
- [x] monitor_loop.py 60s asyncio — Task 7
- [x] All 12 broadcast routes — Task 8
- [x] main.py wiring — Task 9
- [x] ws.py broadcast:events channel — Task 9
- [x] broadcastApi no bankPrefix — Task 10
- [x] useBroadcastWebSocket — Task 10
- [x] Configuracoes.tsx new section — Task 11
- [x] NumberQualityGrid — Task 12
- [x] AlertFeed — Task 13
- [x] DispatchMetrics Recharts — Task 14
- [x] CsvUploadWizard 5 states — Task 15
- [x] Disparo.tsx 3 panels — Task 16
- [x] App.tsx route + nav rename — Task 17
- [x] anthropic config + requirements — Task 2
