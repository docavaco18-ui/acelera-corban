from __future__ import annotations

import asyncio
import logging
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends

from ..auth_deps import AuthUser, require_user
from ..credentials.crypto import safe_decrypt
from ..database import get_db
from ..services.broadcast.meta_client import MetaClient

router = APIRouter(prefix="/api/command-center", tags=["command-center"])
logger = logging.getLogger(__name__)

ERROR_RADAR_WINDOW_DAYS = 7


DISPATCHERS = {
    "vendeai": {
        "label": "VendeAI",
        "settings_table": "vendeai_settings",
        "numbers_table": "broadcast_numbers",
        "dispatches_table": "broadcast_dispatches",
        "meta_token_col": "meta_token_enc",
        "crm_required": ("email_enc", "password_enc"),
        "crm_label": "Credenciais VendeAI",
    },
    "aesir": {
        "label": "Aesir",
        "settings_table": "aesir_settings",
        "numbers_table": "aesir_instances",
        "dispatches_table": "aesir_dispatches",
        "meta_token_col": "meta_token_enc",
        "crm_required": ("api_token_enc", "account_id"),
        "crm_label": "Credenciais Aesir",
    },
    "chipcare": {
        "label": "Chipcare",
        "settings_table": "chipcare_settings",
        "numbers_table": "chipcare_channels",
        "dispatches_table": "chipcare_dispatches",
        "meta_token_col": "meta_token_enc",
        "crm_required": ("email_enc", "password_enc"),
        "crm_label": "Credenciais Chipcare",
    },
}


BANKS = {
    "v8": "V8",
    "vctex": "VCTex",
    "mercantil": "Mercantil",
    "presenca": "Presenca",
    "powerhub": "PowerHub",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _days_ago(days: int) -> str:
    return _iso(_now() - timedelta(days=days))


def _safe_select(db, table: str, columns: str = "*", *, owner_id: str | None = None, limit: int | None = None) -> list[dict]:
    try:
        q = db.table(table).select(columns)
        if owner_id:
            q = q.eq("owner_id", owner_id)
        if limit:
            q = q.limit(limit)
        return q.execute().data or []
    except Exception as e:
        # Falha de DB não é "não configurado" — loga pra diagnóstico em vez de sumir
        logger.warning("command_center: query em %s falhou: %s", table, e)
        return []


def _safe_count(db, table: str, *, owner_id: str | None = None, column: str = "id") -> int:
    return len(_safe_select(db, table, column, owner_id=owner_id, limit=5000))


def _has_value(row: dict, key: str) -> bool:
    value = row.get(key)
    return value is not None and value != "" and value != []


def _decrypt_ok(value: Any) -> bool:
    if not value:
        return False
    return bool(safe_decrypt(value))


def _number_id(row: dict) -> str:
    return str(row.get("phone_id") or row.get("instance_id") or row.get("channel_id") or row.get("id") or "")


def _number_title(row: dict) -> str:
    return (
        row.get("display_phone")
        or row.get("phone")
        or row.get("title")
        or row.get("name")
        or _number_id(row)
        or "Numero sem identificacao"
    )


def _daily_limit(row: dict) -> int:
    try:
        return int(row.get("daily_limit") or 0)
    except Exception:
        return 0


def _is_number_healthy(row: dict) -> bool:
    if row.get("is_paused"):
        return False
    quality = str(row.get("quality_rating") or "UNKNOWN").upper()
    can_send = str(row.get("can_send") or "UNKNOWN").upper()
    status = str(row.get("phone_status") or row.get("status") or "").upper()
    if quality == "RED":
        return False
    if can_send in {"BLOCKED", "LIMITED"}:
        return False
    if row.get("has_payment_issue") or row.get("display_name_pending"):
        return False
    if status in {"DISCONNECTED", "BANNED", "RESTRICTED", "CLOSED"}:
        return False
    return _daily_limit(row) > 0


def _risk_level(row: dict) -> str:
    quality = str(row.get("quality_rating") or "UNKNOWN").upper()
    can_send = str(row.get("can_send") or "UNKNOWN").upper()
    if row.get("has_payment_issue") or can_send == "BLOCKED" or quality == "RED":
        return "critical"
    if row.get("display_name_pending") or can_send == "LIMITED" or quality == "YELLOW":
        return "warning"
    return "ok"


def _sent_today_from_assignments(db, owner_id: str) -> dict[str, int]:
    today = _now().date().isoformat()
    try:
        rows = (
            db.table("broadcast_dispatch_assignments")
            .select("phone_id, sent_count, created_at")
            .eq("owner_id", owner_id)
            .gte("created_at", today)
            .limit(5000)
            .execute()
            .data
            or []
        )
    except Exception as e:
        logger.warning("command_center: sent_today query falhou: %s", e)
        rows = []
    totals: dict[str, int] = defaultdict(int)
    for row in rows:
        if str(row.get("created_at") or "")[:10] != today:
            continue
        totals[str(row.get("phone_id") or "")] += int(row.get("sent_count") or 0)
    return dict(totals)


def _collect_numbers(db, owner_id: str) -> dict[str, list[dict]]:
    return {
        key: _safe_select(db, cfg["numbers_table"], "*", owner_id=owner_id, limit=1000)
        for key, cfg in DISPATCHERS.items()
    }


def _used_today_by_source(db, owner_id: str) -> dict[str, dict[str, int]]:
    """Enviadas hoje por número, POR CRM. Antes só o VendeAI contava — Aesir/Chipcare
    ficavam com used_today=0 e a capacidade restante da Central era superestimada."""
    today = _now().date().isoformat()
    out: dict[str, dict[str, int]] = {"vendeai": defaultdict(int), "aesir": defaultdict(int), "chipcare": defaultdict(int)}
    # VendeAI: broadcast_dispatch_assignments por phone_id
    try:
        rows = db.table("broadcast_dispatch_assignments").select("phone_id, sent_count, created_at") \
            .eq("owner_id", owner_id).gte("created_at", today).limit(5000).execute().data or []
        for r in rows:
            pid = r.get("phone_id")
            if pid:
                out["vendeai"][str(pid)] += int(r.get("sent_count") or 0)
    except Exception as e:
        logger.warning("used_today vendeai falhou: %s", e)
    # Aesir/Chipcare: assignments_json dos dispatches de hoje
    for crm, table, id_field in (("aesir", "aesir_dispatches", "instance_id"),
                                 ("chipcare", "chipcare_dispatches", "channel_id")):
        try:
            rows = db.table(table).select("assignments_json, created_at") \
                .eq("owner_id", owner_id).gte("created_at", today).limit(1000).execute().data or []
            for r in rows:
                for a in (r.get("assignments_json") or []):
                    key = a.get(id_field)
                    if key is not None:
                        out[crm][str(key)] += int(a.get("sent") or a.get("sent_count") or 0)
        except Exception as e:
            logger.warning("used_today %s falhou: %s", crm, e)
    return {k: dict(v) for k, v in out.items()}


def _collect_settings(db, owner_id: str) -> dict[str, dict]:
    settings: dict[str, dict] = {}
    for key, cfg in DISPATCHERS.items():
        rows = _safe_select(db, cfg["settings_table"], "*", owner_id=owner_id, limit=1)
        settings[key] = rows[0] if rows else {}
    return settings


def _build_health(db, owner_id: str, settings: dict[str, dict], numbers: dict[str, list[dict]]) -> list[dict]:
    checks: list[dict] = []

    try:
        credential_rows = (
            db.table("user_bank_credentials")
            .select("bank_code, login_enc, password_enc")
            .eq("user_id", owner_id)
            .execute()
            .data
            or []
        )
    except Exception:
        credential_rows = []
    by_bank = {str(r.get("bank_code")): r for r in credential_rows}
    for bank, label in BANKS.items():
        row = by_bank.get(bank)
        if not row:
            continue  # banco não configurado → não penaliza score
        ok = _decrypt_ok(row.get("login_enc")) and _decrypt_ok(row.get("password_enc"))
        checks.append({
            "id": f"bank-{bank}",
            "group": "Bancos",
            "label": f"{label} configurado",
            "status": "ok" if ok else "warning",
            "detail": "Login e senha salvos" if ok else "Credencial ausente ou corrompida",
        })

    chatwoot = _safe_select(db, "chatwoot_settings", "*", owner_id=owner_id, limit=1)
    checks.append({
        "id": "chatwoot",
        "group": "CRM",
        "label": "Chatwoot conectado",
        "status": "ok" if chatwoot else "warning",
        "detail": "Settings encontrados" if chatwoot else "Configure URL, conta e token antes do sync",
    })

    for key, cfg in DISPATCHERS.items():
        row = settings.get(key) or {}
        nums = numbers.get(key) or []
        if not row and not nums:
            continue  # CRM nunca configurado → não penaliza score
        meta_ok = _decrypt_ok(row.get(cfg["meta_token_col"]))
        crm_ok = all(_decrypt_ok(row.get(f)) if f.endswith("_enc") else _has_value(row, f) for f in cfg["crm_required"])
        healthy = [n for n in nums if _is_number_healthy(n)]
        checks.extend([
            {
                "id": f"{key}-crm",
                "group": "Disparos",
                "label": cfg["crm_label"],
                "status": "ok" if crm_ok else "warning",
                "detail": "CRM pronto" if crm_ok else "Credencial do CRM ausente/corrompida",
            },
            {
                "id": f"{key}-meta",
                "group": "Meta/BM",
                "label": f"Token Meta {cfg['label']}",
                "status": "ok" if meta_ok else "critical",
                "detail": "Token salvo e descriptografavel" if meta_ok else "Token Meta ausente/corrompido",
            },
            {
                "id": f"{key}-numbers",
                "group": "Entregabilidade",
                "label": f"Numeros saudaveis {cfg['label']}",
                "status": "ok" if healthy else ("warning" if nums else "critical"),
                "detail": f"{len(healthy)}/{len(nums)} canais saudaveis",
            },
        ])

    return checks


def _build_deliverability(db, owner_id: str, numbers: dict[str, list[dict]]) -> dict:
    used_by_source = _used_today_by_source(db, owner_id)
    id_field = {"vendeai": "phone_id", "aesir": "instance_id", "chipcare": "channel_id"}
    channels = []
    totals = {"all": 0, "healthy": 0, "warning": 0, "critical": 0, "capacity_today": 0, "used_today": 0}

    for key, rows in numbers.items():
        label = DISPATCHERS[key]["label"]
        used_map = used_by_source.get(key, {})
        for row in rows:
            limit = _daily_limit(row)
            # id específico do CRM (phone_id só existe no VendeAI)
            src_id = str(row.get(id_field.get(key, "phone_id")) or "")
            used = used_map.get(src_id, 0)
            remaining = max(0, limit - used)
            level = _risk_level(row)
            healthy = _is_number_healthy(row)
            totals["all"] += 1
            # "Saudável" segue a MESMA definição da capacidade (_is_number_healthy):
            # pausado, sem tier ou desconectado não conta como saudável mesmo com risk ok.
            if level == "ok" and not healthy:
                totals["warning"] += 1
            else:
                totals[level if level != "ok" else "healthy"] += 1
            if healthy:
                totals["capacity_today"] += remaining
            totals["used_today"] += used
            channels.append({
                "source": key,
                "source_label": label,
                "id": _number_id(row),
                "title": _number_title(row),
                "waba_id": row.get("waba_id"),
                "phone_id": row.get("phone_id"),
                "quality_rating": row.get("quality_rating") or "UNKNOWN",
                "can_send": row.get("can_send") or "UNKNOWN",
                "name_status": row.get("name_status") or "UNKNOWN",
                "daily_limit": limit,
                "used_today": used,
                "remaining_today": remaining,
                "risk": level,
                "is_healthy": healthy,
                "has_payment_issue": bool(row.get("has_payment_issue")),
                "last_meta_check_at": row.get("last_meta_check_at"),
                "issues": _number_issues(row),
            })

    channels.sort(key=lambda c: ({"critical": 0, "warning": 1, "ok": 2}.get(c["risk"], 3), -c["remaining_today"]))
    return {"totals": totals, "channels": channels[:100]}


def _number_issues(row: dict) -> list[str]:
    issues: list[str] = []
    quality = str(row.get("quality_rating") or "UNKNOWN").upper()
    can_send = str(row.get("can_send") or "UNKNOWN").upper()
    if quality == "RED":
        issues.append("Qualidade vermelha")
    elif quality == "YELLOW":
        issues.append("Qualidade amarela")
    if can_send == "BLOCKED":
        issues.append("Meta bloqueou envio")
    elif can_send == "LIMITED":
        issues.append("Envio limitado")
    if row.get("has_payment_issue"):
        issues.append("Problema de pagamento")
    if row.get("display_name_pending"):
        issues.append("Nome de exibicao pendente/recusado")
    if row.get("is_paused"):
        issues.append("Canal pausado")
    for r in row.get("restrictions") or []:
        label = r.get("label") if isinstance(r, dict) else None
        if label and label not in issues:
            issues.append(label)
    return issues


def _build_capacity(deliverability: dict, target: int = 10000) -> dict:
    channels = [c for c in deliverability["channels"] if c["is_healthy"] and c["remaining_today"] > 0]
    total = sum(c["remaining_today"] for c in channels)
    if total <= 0 or target <= 0:
        days: int | None = None
        plan: list[dict] = []
    else:
        days = max(1, (target + total - 1) // total)
        plan = []
        remaining = target
        for day in range(1, min(days, 7) + 1):
            day_cap = min(total, remaining)
            plan.append({"day": day, "planned": day_cap, "remaining_after": max(0, remaining - day_cap)})
            remaining -= day_cap
            if remaining <= 0:
                break
    return {
        "target": target,
        "capacity_today": total,
        "healthy_channels": len(channels),
        "estimated_days": days,
        "safe_per_hour": max(0, total // 8),
        "recommendation": _capacity_recommendation(total, target, len(channels)),
        "plan": plan,
    }


def _capacity_recommendation(total: int, target: int, channels: int) -> str:
    if channels == 0:
        return "Nenhum canal saudavel para disparar com seguranca."
    if total >= target:
        return "Capacidade suficiente para rodar hoje, mantendo distribuicao proporcional."
    return "Divida a campanha em mais de um dia ou adicione canais saudaveis antes de escalar."


def _audit_meta_tokens_cached(settings: dict[str, dict], numbers: dict[str, list[dict]]) -> list[dict]:
    audits: list[dict] = []
    for key, row in settings.items():
        cfg = DISPATCHERS[key]
        rows = numbers.get(key) or []
        # CRM nunca configurado (sem settings E sem números): não emite auditoria —
        # senão vira incidente crítico FANTASMA "Auditoria Meta falhou" e derruba o
        # score de quem usa só 1 CRM. Espelha o comportamento de _build_health.
        if not row and not rows:
            continue
        token_ok = _decrypt_ok((row or {}).get(cfg["meta_token_col"]))
        wabas = sorted({str(r.get("waba_id")) for r in rows if r.get("waba_id")})
        phones = [r for r in rows if r.get("phone_id")]
        # Multi-BM: números sincronizados provam Meta funcional mesmo SEM o token legado
        # (as portas ficam em vendeai_meta_tokens). Só é crítico quando não há token
        # legado NEM números sincronizados.
        has_meta = token_ok or bool(phones)
        if has_meta:
            status = "ok" if phones else "warning"
            if token_ok:
                message = f"Token salvo · {len(wabas)} WABAs em cache · {len(phones)} numeros sincronizados"
            else:
                message = f"{len(wabas)} WABAs · {len(phones)} numeros sincronizados (multi-BM)"
        else:
            status = "critical"
            message = "Token Meta ausente ou corrompido"
        audits.append({
            "source": key,
            "source_label": cfg["label"],
            "status": status,
            "message": message,
            "wabas": wabas,
            "phones": phones,
            "templates": [],
            "live": False,
        })
    return audits


def _vendeai_port_tokens(db, owner_id: str) -> list[dict]:
    """Portas multi-BM do VendeAI com token decifrado + waba_ids salvos."""
    try:
        rows = db.table("vendeai_meta_tokens").select("meta_token_enc, waba_ids, bm_name") \
            .eq("owner_id", owner_id).execute().data or []
    except Exception:
        return []
    out = []
    for r in rows:
        tok = safe_decrypt(r.get("meta_token_enc"))
        if tok:
            out.append({"token": tok, "waba_ids": r.get("waba_ids") or [], "bm_name": r.get("bm_name")})
    return out


async def _audit_meta_tokens_live(settings: dict[str, dict], numbers: dict[str, list[dict]] | None = None,
                                  db=None, owner_id: str | None = None) -> list[dict]:
    numbers = numbers or {}
    # Deferido 4: no live, o VendeAI multi-BM guarda os tokens em vendeai_meta_tokens,
    # não no token legado. Sem isto, o audit reportava 'crítico' pra quem só usa portas.
    port_tokens = _vendeai_port_tokens(db, owner_id) if (db is not None and owner_id) else []

    async def audit_one(key: str, row: dict) -> dict | None:
        cfg = DISPATCHERS[key]
        label = cfg["label"]
        # CRM nunca configurado (sem settings E sem números): não emite auditoria —
        # espelha o skip do modo cached, senão vira incidente crítico fantasma no live.
        if not row and not (numbers.get(key) or []) and not (key == "vendeai" and port_tokens):
            return None
        token = safe_decrypt(row.get(cfg["meta_token_col"]))
        # VendeAI sem token legado: usa o token da 1ª porta multi-BM
        if not token and key == "vendeai" and port_tokens:
            token = port_tokens[0]["token"]
        if not token:
            return {
                "source": key,
                "source_label": label,
                "status": "critical",
                "message": "Token Meta ausente ou corrompido",
                "wabas": [],
                "phones": [],
                "templates": [],
                "live": True,
            }
        client = MetaClient(token)
        try:
            manual_wabas = row.get("waba_ids") or []
            wabas = manual_wabas or await client.discover_wabas()
            phones: list[dict] = []
            templates: list[dict] = []
            for wid in wabas[:20]:
                try:
                    info = await client.get_waba_info(wid)
                    for phone in await client.get_all_phones(wid):
                        phones.append({**phone, "waba_name": info.get("name") or ""})
                    for tpl in await client.get_templates_all(wid):
                        templates.append({
                            "waba_id": wid,
                            "id": tpl.get("id"),
                            "name": tpl.get("name"),
                            "status": tpl.get("status") or "UNKNOWN",
                            "category": tpl.get("category") or "UNKNOWN",
                            "language": tpl.get("language") or "",
                            "variables": tpl.get("variables") or [],
                            "rejected_reason": tpl.get("rejected_reason") or "",
                        })
                except Exception:
                    continue
            return {
                "source": key,
                "source_label": label,
                "status": "ok" if wabas else "warning",
                "message": f"{len(wabas)} WABAs, {len(phones)} numeros, {len(templates)} templates",
                "wabas": wabas,
                "phones": phones,
                "templates": templates,
                "live": True,
            }
        except Exception as e:
            return {
                "source": key,
                "source_label": label,
                "status": "critical",
                "message": str(e)[:240],
                "wabas": [],
                "phones": [],
                "templates": [],
                "live": True,
            }

    results = await asyncio.gather(*(audit_one(k, r or {}) for k, r in settings.items()))
    return [r for r in results if r is not None]


def _build_templates(meta_audits: list[dict]) -> dict:
    by_category: Counter = Counter()
    by_status: Counter = Counter()
    rows: list[dict] = []
    for audit in meta_audits:
        for tpl in audit.get("templates") or []:
            category = str(tpl.get("category") or "UNKNOWN").upper()
            status = str(tpl.get("status") or "UNKNOWN").upper()
            by_category[category] += 1
            by_status[status] += 1
            rows.append({**tpl, "source": audit["source"], "source_label": audit["source_label"]})
    rows.sort(key=lambda t: (t.get("status") != "APPROVED", t.get("category") or "", t.get("name") or ""))
    return {
        "by_category": dict(by_category),
        "by_status": dict(by_status),
        "templates": rows[:300],
    }


def _build_error_radar(db, owner_id: str, numbers: dict[str, list[dict]]) -> dict:
    reasons: Counter = Counter()
    examples: dict[str, list[str]] = defaultdict(list)

    for rows in numbers.values():
        for n in rows:
            for issue in _number_issues(n):
                reasons[issue] += 1
                if len(examples[issue]) < 4:
                    examples[issue].append(_number_title(n))

    # Janela de 7 dias: falhas/campanhas de meses atrás não são incidente "ativo"
    window = _days_ago(ERROR_RADAR_WINDOW_DAYS)

    def _recent(rows: list[dict]) -> list[dict]:
        out = []
        for r in rows:
            ca = str(r.get("created_at") or "")
            if not ca or ca >= window:
                out.append(r)
        return out

    try:
        assignment_rows = db.table("broadcast_dispatch_assignments") \
            .select("phone_id, failed_count, status, display_phone, created_at") \
            .eq("owner_id", owner_id).gte("created_at", window).limit(5000).execute().data or []
    except Exception:
        assignment_rows = []
    failed_assignments = sum(int(r.get("failed_count") or 0) for r in assignment_rows)
    if failed_assignments:
        reasons["Falhas em assignments VendeAI"] += failed_assignments

    for key, cfg in DISPATCHERS.items():
        rows = _recent(_safe_select(db, cfg["dispatches_table"], "*", owner_id=owner_id, limit=1000))
        for row in rows:
            status = str(row.get("status") or "").lower()
            # cancelled/revoked = AÇÃO do usuário, não erro operacional — não conta
            if status in {"error", "failed", "partial_error"}:
                label = f"Campanhas {cfg['label']} em {status}"
                reasons[label] += 1
                if len(examples[label]) < 4:
                    examples[label].append(row.get("campaign_name") or row.get("id") or "campanha")

    return {
        "reasons": [
            {"reason": reason, "count": count, "examples": examples.get(reason, [])}
            for reason, count in reasons.most_common(20)
        ]
    }


def _build_incidents(health: list[dict], deliverability: dict, error_radar: dict, meta_audits: list[dict]) -> list[dict]:
    incidents: list[dict] = []
    now = _iso(_now())
    for check in health:
        if check["status"] == "critical":
            incidents.append({
                "severity": "critical",
                "title": check["label"],
                "detail": check["detail"],
                "source": check["group"],
                "created_at": now,
                "action": "Corrigir antes de rodar operacao.",
            })
        elif check["status"] == "warning":
            incidents.append({
                "severity": "warning",
                "title": check["label"],
                "detail": check["detail"],
                "source": check["group"],
                "created_at": now,
                "action": "Revisar para evitar gargalo.",
            })

    for ch in deliverability["channels"]:
        if ch["risk"] == "critical":
            incidents.append({
                "severity": "critical",
                "title": f"Canal em risco: {ch['title']}",
                "detail": ", ".join(ch["issues"]) or "Canal nao saudavel",
                "source": ch["source_label"],
                "created_at": now,
                "action": "Pausar canal ou atualizar status BM antes de disparar.",
            })

    for audit in meta_audits:
        if audit["status"] == "critical":
            incidents.append({
                "severity": "critical",
                "title": f"Auditoria Meta falhou - {audit['source_label']}",
                "detail": audit["message"],
                "source": "Meta/BM",
                "created_at": now,
                "action": "Re-salvar token Meta de usuario de sistema.",
            })

    for reason in error_radar["reasons"][:5]:
        if reason["count"] >= 3:
            incidents.append({
                "severity": "warning",
                "title": reason["reason"],
                "detail": f"{reason['count']} ocorrencias detectadas",
                "source": "Radar de Erros",
                "created_at": now,
                "action": "Abrir detalhe e corrigir a causa antes de escalar.",
            })

    rank = {"critical": 0, "warning": 1, "info": 2}
    incidents.sort(key=lambda i: rank.get(i["severity"], 9))
    return incidents[:50]


def _build_checklist(health: list[dict], deliverability: dict, templates: dict, capacity: dict, templates_synced: bool = True) -> list[dict]:
    approved_templates = templates["by_status"].get("APPROVED", 0)
    marketing = templates["by_category"].get("MARKETING", 0)
    utility = templates["by_category"].get("UTILITY", 0)
    items = [
        {
            "id": "tokens",
            "label": "Tokens Meta salvos e validos",
            "status": "ok" if not any(c["id"].endswith("-meta") and c["status"] == "critical" for c in health) else "block",
            "detail": "Auditoria Meta precisa estar verde.",
        },
        {
            "id": "healthy_channels",
            "label": "Canais saudaveis para envio",
            "status": "ok" if deliverability["totals"]["healthy"] > 0 else "block",
            "detail": f"{deliverability['totals']['healthy']} canais saudaveis encontrados.",
        },
        {
            "id": "critical_channels",
            "label": "Nenhum canal critico selecionado",
            "status": "ok" if deliverability["totals"]["critical"] == 0 else "warn",
            "detail": f"{deliverability['totals']['critical']} canais criticos precisam de pausa/correcao.",
        },
        {
            "id": "templates",
            # Sem auditoria ao vivo o cache SEMPRE reporta 0 templates — não penalizar
            # o checklist/score por um dado que não foi sincronizado (era -4 fantasma).
            "label": "Templates aprovados disponiveis",
            "status": ("ok" if approved_templates > 0 else "warn") if templates_synced else "info",
            "detail": (f"{approved_templates} aprovados · {marketing} marketing · {utility} utility."
                       if templates_synced else "Rode a auditoria ao vivo para sincronizar os templates da Meta."),
        },
        {
            "id": "capacity",
            "label": "Capacidade suficiente para campanha padrao",
            "status": "ok" if capacity["capacity_today"] >= 1000 else ("warn" if capacity["capacity_today"] > 0 else "block"),
            "detail": f"{capacity['capacity_today']} envios seguros estimados hoje.",
        },
    ]
    return items


def _build_score(health: list[dict], deliverability: dict, checklist: list[dict], incidents: list[dict]) -> dict:
    score = 100
    score -= sum(12 for c in health if c["status"] == "critical")
    score -= sum(5 for c in health if c["status"] == "warning")
    score -= min(25, deliverability["totals"]["critical"] * 8)
    score -= min(15, deliverability["totals"]["warning"] * 3)
    score -= sum(10 for c in checklist if c["status"] == "block")
    score -= sum(4 for c in checklist if c["status"] == "warn")
    score -= min(20, sum(8 for i in incidents if i["severity"] == "critical"))
    score = max(0, min(100, score))
    status = "critical" if score < 50 else "warning" if score < 75 else "ok"
    return {
        "score": score,
        "status": status,
        "label": "Operacao saudavel" if status == "ok" else "Atencao operacional" if status == "warning" else "Operacao em risco",
    }


LIVE_META_TIMEOUT_SECONDS = 45


async def compute_overview(db, owner_id: str, *, live_meta: bool = False) -> dict:
    # Toda a agregação síncrona (supabase-py é bloqueante: ~13 queries sequenciais)
    # roda numa thread separada para NÃO congelar o event loop do único worker —
    # senão o overview de um tenant trava o disparo e a API de todos os outros.
    def _collect_sync():
        _settings = _collect_settings(db, owner_id)
        _numbers = _collect_numbers(db, owner_id)
        _health = _build_health(db, owner_id, _settings, _numbers)
        _deliverability = _build_deliverability(db, owner_id, _numbers)
        _capacity = _build_capacity(_deliverability, target=10000)
        _error_radar = _build_error_radar(db, owner_id, _numbers)
        return _settings, _numbers, _health, _deliverability, _capacity, _error_radar

    settings, numbers, health, deliverability, capacity, error_radar = await asyncio.to_thread(_collect_sync)

    live_timed_out = False
    if live_meta:
        try:
            meta_audits = await asyncio.wait_for(
                _audit_meta_tokens_live(settings, numbers, db=db, owner_id=owner_id),
                timeout=LIVE_META_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            live_timed_out = True
            meta_audits = _audit_meta_tokens_cached(settings, numbers)
    else:
        meta_audits = _audit_meta_tokens_cached(settings, numbers)

    templates = _build_templates(meta_audits)
    templates_synced = any(a.get("live") for a in meta_audits)
    incidents = _build_incidents(health, deliverability, error_radar, meta_audits)
    checklist = _build_checklist(health, deliverability, templates, capacity, templates_synced=templates_synced)
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


LIVE_META_COOLDOWN_SECONDS = 120


@router.get("/overview")
async def overview(live_meta: bool = False, user: AuthUser = Depends(require_user)):
    db = get_db()
    if live_meta:
        # Cooldown por owner: cada clique em "auditar ao vivo" dispara N chamadas
        # Graph. Dentro da janela, serve o último resultado live cacheado (a qualidade
        # Meta muda em horas, não em segundos) — corta rajada de rate-limit.
        try:
            from ..redis_client import get_redis
            redis = await get_redis()
            cache_key = f"cc:live_overview:{user.user_id}"
            cached = await redis.get(cache_key)
            if cached:
                import json as _json
                return _json.loads(cached)
            result = await compute_overview(db, user.user_id, live_meta=True)
            import json as _json
            await redis.set(cache_key, _json.dumps(result, default=str), ex=LIVE_META_COOLDOWN_SECONDS)
            return result
        except Exception as e:
            logger.warning("live overview cache indisponível (%s) — rodando direto", e)
            return await compute_overview(db, user.user_id, live_meta=True)
    return await compute_overview(db, user.user_id, live_meta=False)
