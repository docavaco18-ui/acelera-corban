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
    active = [n for n in numbers if not n.get("is_paused") and n.get("quality_rating") != "RED"]
    if not active:
        active = numbers  # fallback: use all if none qualify

    total_capacity = sum(n.get("daily_limit", 1000) for n in active)
    remaining = total_leads
    assignments = []

    for i, n in enumerate(active):
        limit = n.get("daily_limit", 1000)
        if i == len(active) - 1:
            planned = remaining
        else:
            planned = min(round(total_leads * limit / total_capacity), remaining, limit)
        remaining -= planned
        quality = n.get("quality_rating", "UNKNOWN")
        assignments.append({
            "phone_id": n["phone_id"],
            "planned_count": planned,
            "reason": f"Qualidade {quality}, limite diário {limit}",
        })

    risks = []
    red = [n for n in numbers if n.get("quality_rating") == "RED"]
    paused = [n for n in numbers if n.get("is_paused")]
    if red:
        risks.append(f"{len(red)} número(s) com qualidade RED excluído(s)")
    if paused:
        risks.append(f"{len(paused)} número(s) pausado(s) excluído(s)")
    if total_leads > total_capacity:
        risks.append(f"Total de leads ({total_leads}) excede capacidade diária ({total_capacity})")

    return {
        "assignments": assignments,
        "justification": f"Distribuição proporcional ao limite diário entre {len(active)} número(s) ativo(s).",
        "risks": "; ".join(risks) if risks else "Nenhum risco identificado.",
    }
