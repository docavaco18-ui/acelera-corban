from typing import Any

TENANT_TABLES: set[str] = {
    # Higienização (V8, VCTex, Mercantil, Presença, PowerHub)
    "v8_leads", "v8_bot_runs", "v8_batches",
    "vctex_leads", "vctex_bot_runs", "vctex_batches",
    "mercantil_leads", "mercantil_bot_runs", "mercantil_batches",
    "presenca_leads", "presenca_bot_runs", "presenca_batches",
    "powerhub_leads", "powerhub_bot_runs", "powerhub_batches",
    "nossafintech_leads", "nossafintech_bot_runs", "nossafintech_batches",
    # CRM
    "crm_propostas", "crm_settings",
    # Disparo WhatsApp (VendeAI / Aesir / Chipcare)
    "vendeai_settings",
    "broadcast_numbers", "broadcast_dispatches", "broadcast_dispatch_assignments",
    "broadcast_alerts", "broadcast_recipients",
    "aesir_instances", "aesir_dispatches",
    "chipcare_channels", "chipcare_dispatches", "chipcare_settings",
}


def scoped(db: Any, table_name: str, user_id: str):
    if table_name not in TENANT_TABLES:
        raise ValueError(f"{table_name!r} não é tabela tenant; use db.table() direto")
    return _ScopedQuery(db.table(table_name), user_id)


class _ScopedQuery:
    def __init__(self, q, user_id: str):
        self._q = q
        self._user_id = user_id

    def select(self, cols: str = "*"):
        return _ScopedQuery(self._q.select(cols).eq("owner_id", self._user_id), self._user_id)

    def insert(self, payload):
        if isinstance(payload, list):
            payload = [{**p, "owner_id": self._user_id} for p in payload]
        else:
            payload = {**payload, "owner_id": self._user_id}
        return _ScopedQuery(self._q.insert(payload), self._user_id)

    def update(self, payload):
        return _ScopedQuery(self._q.update(payload).eq("owner_id", self._user_id), self._user_id)

    def upsert(self, payload, on_conflict: str | None = None, **kwargs):
        if isinstance(payload, list):
            payload = [{**p, "owner_id": self._user_id} for p in payload]
        else:
            payload = {**payload, "owner_id": self._user_id}
        if on_conflict is not None:
            kwargs["on_conflict"] = on_conflict
        return _ScopedQuery(self._q.upsert(payload, **kwargs), self._user_id)

    def delete(self):
        return _ScopedQuery(self._q.delete().eq("owner_id", self._user_id), self._user_id)

    def eq(self, col, val):     return _ScopedQuery(self._q.eq(col, val), self._user_id)
    def neq(self, col, val):    return _ScopedQuery(self._q.neq(col, val), self._user_id)
    def gt(self, col, val):     return _ScopedQuery(self._q.gt(col, val), self._user_id)
    def gte(self, col, val):    return _ScopedQuery(self._q.gte(col, val), self._user_id)
    def lt(self, col, val):     return _ScopedQuery(self._q.lt(col, val), self._user_id)
    def lte(self, col, val):    return _ScopedQuery(self._q.lte(col, val), self._user_id)
    def in_(self, col, vals):   return _ScopedQuery(self._q.in_(col, vals), self._user_id)
    def is_(self, col, val):    return _ScopedQuery(self._q.is_(col, val), self._user_id)
    def like(self, col, pat):   return _ScopedQuery(self._q.like(col, pat), self._user_id)
    def ilike(self, col, pat):  return _ScopedQuery(self._q.ilike(col, pat), self._user_id)
    def order(self, *a, **k):   return _ScopedQuery(self._q.order(*a, **k), self._user_id)
    def limit(self, n):         return _ScopedQuery(self._q.limit(n), self._user_id)
    def range(self, lo, hi):    return _ScopedQuery(self._q.range(lo, hi), self._user_id)
    def single(self):           return _ScopedQuery(self._q.single(), self._user_id)
    def maybe_single(self):     return _ScopedQuery(self._q.maybe_single(), self._user_id)

    def execute(self):          return self._q.execute()
