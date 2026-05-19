"""Configuração estática do bot Presença Bank — URLs, seletores, timeouts."""
import os
from dataclasses import dataclass, field


@dataclass
class PresencaConfig:
    # ── URLs ──────────────────────────────────────────────────────────────────
    portal_url: str = "https://portal.presencabank.com.br/login"

    # ── Timeouts (ms) ─────────────────────────────────────────────────────────
    timeout_page: int = 30_000
    timeout_auth: int = 60_000

    # ── Polling resultado (fase2) ─────────────────────────────────────────────
    poll_interval_s: int = 10
    poll_max_attempts: int = 12   # 12 × 10s = 2 min máximo

    # ── Cadência humana entre CPFs (segundos) ─────────────────────────────────
    cpf_jitter_min: float = field(default_factory=lambda: float(os.getenv("PRESENCA_CPF_JITTER_MIN", "10")))
    cpf_jitter_max: float = field(default_factory=lambda: float(os.getenv("PRESENCA_CPF_JITTER_MAX", "20")))

    # ── Login ─────────────────────────────────────────────────────────────────
    SEL_LOGIN_USER: str = "input[type='text']:visible"
    SEL_LOGIN_PASS: str = "input[type='password']:visible"
    SEL_LOGIN_BTN:  str = "button[type='submit']:visible"

    # ── Consulta CPF ──────────────────────────────────────────────────────────
    SEL_CPF_INPUT:     str = "input[placeholder*='CPF'], input[name*='cpf'], input[id*='cpf']"
    SEL_CONSULTAR_BTN: str = "button:has-text('Consultar'), button:has-text('Buscar')"

    # ── Resultado ─────────────────────────────────────────────────────────────
    SEL_VALOR_LIBERADO: str = "[class*='valor'], [class*='limite'], strong"
    SEL_INELEGIVEL_MSG: str = "text=/(sem margem|não elegível|bloqueado|não possui)/i"
    SEL_ELEGIVEL_AREA:  str = "[class*='proposta'], [class*='simulacao'], [class*='oferta']"

    # ── Nova consulta ─────────────────────────────────────────────────────────
    SEL_NOVA_CONSULTA: str = "button:has-text('Nova consulta'), button:has-text('Voltar'), a:has-text('Nova')"
