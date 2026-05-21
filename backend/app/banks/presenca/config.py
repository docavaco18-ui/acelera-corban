"""Configuração Presença Bank — seletores mapeados em 19/05/2026."""
import os
from dataclasses import dataclass, field


@dataclass
class PresencaConfig:
    # ── URLs ─────────────────────────────────────────────────────────────────
    portal_url:          str = "https://portal.presencabank.com.br/"
    create_url:          str = "https://portal.presencabank.com.br/propostas/criar/credito-privado"

    # ── Timeouts (ms) ────────────────────────────────────────────────────────
    timeout_page:    int = 30_000
    timeout_auth:    int = 60_000
    timeout_consulta: int = 40_000   # consulta vínculo eSocial ~25s

    # ── Jitter entre CPFs (segundos) ─────────────────────────────────────────
    cpf_jitter_min: float = field(default_factory=lambda: float(os.getenv("PRESENCA_CPF_JITTER_MIN", "10")))
    cpf_jitter_max: float = field(default_factory=lambda: float(os.getenv("PRESENCA_CPF_JITTER_MAX", "20")))

    # ── Login ─────────────────────────────────────────────────────────────────
    SEL_LOGIN_USER: str = "input[type='email'], input[placeholder='Login'], input[type='text']"
    SEL_LOGIN_PASS: str = "input[type='password']"
    SEL_LOGIN_BTN:  str = "button:has-text('Entrar'), button[type='submit']"
    # Elemento presente após login bem-sucedido (qualquer item de nav)
    SEL_LOGGED_IN:  str = ".fuse-horizontal-navigation-item-title"

    # ── Navegação para criar proposta ─────────────────────────────────────────
    # Menu Propostas na navbar horizontal
    SEL_MENU_PROPOSTAS: str = ".fuse-horizontal-navigation-item-title:has-text('Propostas')"
    # Item "Criar" dentro do dropdown de propostas (tem submenu)
    SEL_MENU_CRIAR:     str = "[role='menuitem']:has-text('Criar')"
    # Item "Consignado Privado" dentro do submenu de Criar
    SEL_MENU_CONSIGNADO_PRIVADO: str = "[role='menuitem']:has-text('Consignado Privado')"

    # ── Step 1 — Dados básicos ────────────────────────────────────────────────
    SEL_CPF_INPUT:     str = "input[placeholder='CPF']"
    SEL_NOME_INPUT:    str = "input[placeholder='Nome']"
    SEL_DDD_INPUT:     str = "input[placeholder='Ddd']"
    SEL_CELULAR_INPUT: str = "input[placeholder='Celular']"
    # Botão "Próximo →" — avança step E dispara popup de consulta
    SEL_PROXIMO_BTN:   str = "button:has-text('Próximo')"

    # ── Popup "Consultar de vínculo empregatício?" ────────────────────────────
    SEL_POPUP_CONTAINER:       str = ".cdk-overlay-pane.fuse-confirmation-dialog-panel"
    # Botão "Consultar" (primário/accent) dentro do popup
    SEL_POPUP_BTN_CONSULTAR:   str = ".cdk-overlay-pane button.mat-accent, .cdk-overlay-pane button:has-text('Consultar'):not(:has-text('Cancel'))"
    # Dialog de espera com countdown ("Consultando vinculos empregatícios")
    SEL_POPUP_CONSULTANDO:     str = ".cdk-overlay-pane:has-text('Consultando')"
    SEL_POPUP_CANCEL:          str = ".cdk-overlay-pane button:has-text('Cancel')"

    # ── Step 2 — Selecionar vínculo empregatício ──────────────────────────────
    SEL_VINCULO_RADIO_GROUP:   str = "mat-radio-group[name='simulacoes']"
    # Primeiro radio disponível dentro do grupo
    SEL_VINCULO_PRIMEIRO_INPUT: str = "mat-radio-group[name='simulacoes'] mat-radio-button:first-of-type input[type='radio']"
    # Mensagens de sem vínculo / inelegível no step 2
    SEL_SEM_VINCULO:           str = "text=/(sem vínculo|não possui vínculo|nenhum vínculo|não foi encontrado)/i"

    # ── Step 3 — Tomador ─────────────────────────────────────────────────────
    SEL_EMAIL_INPUT: str = "input[placeholder='Email']"

    # ── Step 4 — Benefício e Dados bancários ─────────────────────────────────
    # Valor da Renda (placeholder vazio → busca por label)
    LABEL_VALOR_RENDA: str = "Valor da Renda"
    SEL_BANCO_INPUT:   str = "input[placeholder='Banco']"
    SEL_AGENCIA_INPUT: str = "input[placeholder='Agência']"
    SEL_CONTA_INPUT:   str = "input[placeholder='Conta']"
    SEL_DIGITO_INPUT:  str = "input[placeholder='Digíto']"   # typo é do portal
    SEL_TIPO_CONTA:    str = "mat-select[placeholder='Tipo de Conta']"

    # ── Step 5 — Simulação (resultado) ───────────────────────────────────────
    # Inelegível: alerta "FORA DO ROTEIRO" ou "Não existe tabelas"
    SEL_INELEGIVEL_MSG:  str = (
        "fuse-alert:has-text('FORA DO ROTEIRO'), "
        "fuse-alert:has-text('Não existe tabelas'), "
        "fuse-alert:has-text('sem tabelas'), "
        "mat-error:has-text('Tabela é obrigatório')"
    )
    # Valor parcela (presente e preenchido = simulação OK = elegível)
    SEL_VALOR_PARCELA:   str = "input[placeholder='Valor Parcela']"
    # Área elegível: campo parcela tem valor E sem alerta de erro
    SEL_ELEGIVEL_AREA:   str = "input[placeholder='Valor Parcela']:not([value=''])"

    # ── Nova consulta ─────────────────────────────────────────────────────────
    # Volta para create_url — sem botão "Nova consulta" específico; navega direto
    SEL_VOLTAR_BTN: str = "button:has-text('← Voltar'), button:has-text('Voltar')"

    # ── Dados fictícios para campos obrigatórios ──────────────────────────────
    default_email:         str = "consulta@presencabank.com.br"
    default_valor_renda:   str = "3000"
    default_banco:         str = "237"    # Bradesco
    default_agencia:       str = "0001"
    default_conta:         str = "123456"
    default_digito:        str = "0"
    default_tipo_conta:    str = "Conta Corrente"
