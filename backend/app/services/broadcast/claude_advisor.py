from __future__ import annotations

from typing import Any


async def advise_split(
    numbers: list[dict],
    total_leads: int,
    api_key: str = "",
) -> dict[str, Any]:
    """
    Split leads proportionally by daily_limit.
    Excludes RED/paused numbers when alternatives exist.
    numbers: [{phone_id, quality_rating, messaging_tier, daily_limit, is_paused}]
    """
    def is_eligible(n: dict) -> bool:
        if not n.get("chatwoot_connected"):
            return False
        if n.get("can_send") == "BLOCKED":
            return False
        if n.get("is_paused"):
            return False
        if n.get("quality_rating") == "RED":
            return False
        if (n.get("daily_limit") or 0) <= 0:
            return False
        return True

    active = [n for n in numbers if is_eligible(n)]
    excluded = [n for n in numbers if not is_eligible(n)]

    if not active:
        return {
            "assignments": [],
            "justification": "Nenhum número elegível para disparo.",
            "risks": "Verifique se há números conectados ao Chatwoot com status disponível e capacidade > 0.",
        }

    total_capacity = sum(n.get("daily_limit", 0) for n in active)
    remaining = total_leads
    assignments = []

    for i, n in enumerate(active):
        limit = n.get("daily_limit", 0)
        if i == len(active) - 1:
            planned = remaining
        else:
            planned = min(round(total_leads * limit / total_capacity), remaining, limit)
        remaining -= planned
        quality = n.get("quality_rating", "UNKNOWN")
        can_send = n.get("can_send", "UNKNOWN")
        assignments.append({
            "phone_id": n["phone_id"],
            "planned_count": planned,
            "reason": f"Qualidade {quality}, limite diário {limit}",
            "can_send": can_send,
        })

    risks = []
    no_chatwoot = [n for n in excluded if not n.get("chatwoot_connected")]
    blocked = [n for n in excluded if n.get("can_send") == "BLOCKED"]
    paused = [n for n in excluded if n.get("is_paused")]
    red = [n for n in excluded if n.get("quality_rating") == "RED"]
    if no_chatwoot:
        risks.append(f"{len(no_chatwoot)} número(s) sem Chatwoot excluído(s)")
    if blocked:
        risks.append(f"{len(blocked)} número(s) bloqueado(s) excluído(s)")
    if paused:
        risks.append(f"{len(paused)} número(s) pausado(s) excluído(s)")
    if red:
        risks.append(f"{len(red)} número(s) com qualidade RED excluído(s)")
    if total_leads > total_capacity:
        risks.append(f"Total de leads ({total_leads}) excede capacidade diária ({total_capacity})")

    return {
        "assignments": assignments,
        "justification": f"Distribuição proporcional ao limite diário entre {len(active)} número(s) ativo(s).",
        "risks": "; ".join(risks) if risks else "Nenhum risco identificado.",
    }
