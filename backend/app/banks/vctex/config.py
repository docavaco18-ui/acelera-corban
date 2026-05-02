import os
from dataclasses import dataclass, field


@dataclass
class VCTexConfig:
    portal_url: str = "https://www.appvctex.com.br/login"
    timeout_page: int = 30_000
    timeout_auth: int = 90_000

    email_placeholder: str = "sem@email.com"

    # ── Polling fase2 ─────────────────────────────────────────────────────────
    poll_interval_s: int = 12       # segundos entre tentativas
    poll_max_attempts: int = 6      # 6 × 12s = ~1 minuto máximo

    # ── Cadência humana entre CPFs (segundos) ─────────────────────────────────
    cpf_jitter_min: float = field(default_factory=lambda: float(os.getenv("BOT_CPF_JITTER_MIN", "15")))
    cpf_jitter_max: float = field(default_factory=lambda: float(os.getenv("BOT_CPF_JITTER_MAX", "30")))

    # ── Login ─────────────────────────────────────────────────────────────────
    SEL_CPF_INPUT:  str = "input[type='text']:visible"
    SEL_PASS_INPUT: str = "input[type='password']:visible"
    SEL_LOGIN_BTN:  str = "button[type='submit']:visible"

    # ── Navegação sidebar ─────────────────────────────────────────────────────
    CONSULTAS_URL:     str = "https://www.appvctex.com.br/dashboard/consignado/consultas"
    SEL_NAV_CLT:       str = '[data-testid="Sidebar-Drawer-Button-accordion-consignado"]'
    SEL_NAV_CONSULTAS: str = '[data-testid="Sidebar-Sidebar-Sub-Button-Consultas-Consignado"]'

    # ── Fase 0 — Adicionar Termo ───────────────────────────────────────────────
    SEL_BTN_ADICIONAR_TERMO: str = "button:has-text('Adicionar Termo')"
    SEL_F0_CPF:    str = "input[name='cpfEmployee']"
    SEL_F0_NOME:   str = "input[name='nameEmployee']"
    SEL_F0_EMAIL:  str = "input[name='emailEmployee']"
    SEL_F0_TEL:    str = "input[name='phoneEmployee']"
    SEL_F0_SUBMIT: str = "button[type='submit']:has-text('Enviar Termo')"
    SEL_F0_POPUP_OVERLAY: str = "div.css-4lxdxq"   # backdrop para fechar popup

    # ── Fase 1 — Pesquisa + Ações + Link ──────────────────────────────────────
    SEL_F1_SEARCH_CPF:  str = "input[name='cpf']"
    SEL_F1_BTN_SEARCH:  str = "[aria-label='Pesquisar']"
    SEL_F1_BTN_ACOES:   str = "button:has-text('Ações')"
    SEL_F1_MENU_LINK:   str = "[data-testid='ContentCopyIcon']"   # ícone dentro do item de menu
    # Página do Plurio (nova aba)
    SEL_PLURIO_ASSINAR:  str = "button#modalBtn"
    SEL_PLURIO_SUCESSO:  str = "span.message-box--span"

    # ── Fase 2 — Polling + Nova Proposta ──────────────────────────────────────
    SEL_F2_BTN_SIMULAR:       str = "button:not([disabled]):has-text('Simular')"
    SEL_F2_BTN_ACOMPANHAR:    str = "button:has-text('Acompanhar a autorização')"
    SEL_F2_POPUP_VALIDADO:    str = "h2:has-text('Termo autorização validado')"
    # Dados do trabalhador na tela Nova Proposta
    SEL_F2_LABEL:             str = "p.css-7b7t20"
    SEL_F2_VALUE:             str = "span.css-l69bhl"
    # Resultado Elegível / erro
    SEL_F2_BTN_SELECIONAR:    str = "button:not([disabled]):has-text('Selecionar')"
    SEL_F2_ERROR_MSG:         str = "p.CardEmployee_ErrorInfo__VJyWT"
    # Botão Simular final (fundo da tela) — após Selecionar
    SEL_F2_BTN_SIMULAR_FINAL: str = "div.css-1bvc4cc button:has-text('Simular')"
