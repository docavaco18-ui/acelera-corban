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
