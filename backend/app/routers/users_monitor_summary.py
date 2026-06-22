"""Redução de um overview do command_center para o card de resumo da Central de Usuários."""
from __future__ import annotations

from datetime import datetime, timezone

from ..credentials.crypto import safe_decrypt

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
        } if (has_live or templates.get("by_status")) else None,
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
