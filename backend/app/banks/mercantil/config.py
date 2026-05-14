"""Configuração estática do bot Mercantil — URLs, seletores, timeouts."""
import os
import random
from dataclasses import dataclass, field


# DDDs válidos do Brasil (números de celular).
# Usado em fase B.1 quando o portal mostra campo de telefone vazio.
DDDS_VALIDOS: tuple[int, ...] = (
    11, 12, 13, 14, 15, 16, 17, 18, 19,
    21, 22, 24, 27, 28,
    31, 32, 33, 34, 35, 37, 38,
    41, 42, 43, 44, 45, 46, 47, 48, 49,
    51, 53, 54, 55,
    61, 62, 63, 64, 65, 66, 67, 68, 69,
    71, 73, 74, 75, 77, 79,
    81, 82, 83, 84, 85, 86, 87, 88, 89,
    91, 92, 93, 94, 95, 96, 97, 98, 99,
)


def gerar_celular_aleatorio() -> str:
    """Retorna (DD) 9XXXX-XXXX com DDD válido + 9 obrigatório + 8 dígitos aleatórios.
    Usado quando o lead não tem telefone cadastrado no portal Mercantil."""
    ddd = random.choice(DDDS_VALIDOS)
    rest = "".join(str(random.randint(0, 9)) for _ in range(8))
    return f"({ddd}) 9{rest[:4]}-{rest[4:]}"


@dataclass
class MercantilConfig:
    # ── URLs ──────────────────────────────────────────────────────────────────
    portal_url:     str = "https://meu.bancomercantil.com.br/login"
    dashboard_url:  str = "https://meu.bancomercantil.com.br/dashboard"
    simular_url:    str = "https://meu.bancomercantil.com.br/simular-proposta"
    auth_origin:    str = "https://autorizacoesdigitais.meu.bancomercantil.com.br"

    # ── Timeouts (ms) ─────────────────────────────────────────────────────────
    timeout_page:   int = 30_000
    timeout_auth:   int = 45_000

    # ── SMS humano via WS bridge ──────────────────────────────────────────────
    sms_timeout_seconds: int = 600
    sms_max_attempts:    int = 5

    # ── Polling DataPrev (cenario B) ──────────────────────────────────────────
    poll_dataprev_max_seconds: int = 300
    poll_dataprev_interval_s:  int = 10

    # ── Cadência humana entre CPFs (segundos) ─────────────────────────────────
    cpf_jitter_min: float = field(default_factory=lambda: float(os.getenv("MERCANTIL_CPF_JITTER_MIN", "8")))
    cpf_jitter_max: float = field(default_factory=lambda: float(os.getenv("MERCANTIL_CPF_JITTER_MAX", "16")))

    # ── Valores fixos do form ─────────────────────────────────────────────────
    uf_padrao:       str = "SP"
    convenio_texto:  str = "MINISTERIO DO TRABALHO E EMPREGO MTE"

    # ── Seletores: LOGIN ──────────────────────────────────────────────────────
    SEL_LOGIN_USER: str = 'input[formcontrolname="loginUsuario"]'
    SEL_LOGIN_PASS: str = 'input[formcontrolname="senha"]'
    SEL_LOGIN_BTN:  str = "button:has-text('Entrar')"

    # ── Seletores: SMS (tela do token de 6 dígitos) ───────────────────────────
    # Há 6 inputs separados. ID dinâmico do Angular — não usar #mat-input-N.
    # Heurística: inputs com maxlength=1 OU type=tel agrupados.
    SEL_SMS_INPUTS_PRIMARY:  str = 'input[maxlength="1"]'
    SEL_SMS_INPUTS_FALLBACK: str = 'input[type="tel"][autocomplete="one-time-code"]'
    SEL_SMS_VERIFY_BTN:      str = "button:has-text('Verificar')"
    # Mensagens conhecidas que indicam tela de SMS
    SEL_SMS_HEADING:         str = "text=/(Insira o token|token enviado por SMS)/i"

    # ── Seletores: Dashboard ──────────────────────────────────────────────────
    SEL_NOVA_PROPOSTA_BTN:  str = "button:has-text('Digite aqui uma nova proposta')"

    # ── Seletores: /simular-proposta ──────────────────────────────────────────
    # Form tem 3 mat-selects: UF, Convênio, Instituição. Cada um numa mat-form-field.
    # Indexação por ordem é frágil — usamos seletor combinado (mat-form-field) e nth().
    SEL_FORM_FIELDS:     str = "mat-form-field"
    SEL_UF_SELECT:       str = "mat-form-field:has(mat-label:has-text('UF')) mat-select, mat-select"
    SEL_CONVENIO_SELECT: str = "mat-form-field:has(mat-label:has-text('Convênio')) mat-select"
    SEL_INST_SELECT:     str = "mat-form-field:has(mat-label:has-text('Instituição')) mat-select"
    SEL_MAT_OPTION_BY_TEXT: str = "mat-option:has-text({text})"  # f-string template

    SEL_CPF_INPUT:       str = 'input[mask="000.000.000-00"]'
    SEL_CONSULTAR_BTN:   str = "button:has-text('Consultar')"
    SEL_NOVA_OP_BTN:     str = "a:has-text('Nova operação'), button:has-text('Nova operação'), [class*='pcb-button']:has-text('Nova operação')"

    # ── Seletores: /consignado-privado/{UUID} ─────────────────────────────────
    # Pipeline tem 4 dots: Consulta solicitada → autorizada → processamento → disponível
    SEL_PRODUTOS_HEADING:    str = "text=/Produtos disponíveis/i"
    SEL_INICIAR_CONTRATO_NOVO: str = "a.pcb-button:has-text('Iniciar'), a[mat-flat-button]:has-text('Iniciar'), button:has-text('Iniciar')"  # <a> tag no Angular Material

    # Cenário B: link curto + botão copiar
    # O link aparece em um input readonly ao lado do botão content_copy
    SEL_LINK_INPUT:          str = "input[readonly]"
    SEL_COPY_LINK_BTN:       str = "button:has(mat-icon:has-text('content_copy'))"

    # ── Seletores: /solicitar-dataprev/{UUID} ─────────────────────────────────
    SEL_DATAPREV_TEL_INPUT:  str = 'input[mask="(00) 00000-0000"]'
    SEL_DATAPREV_SOLICITAR:  str = "button:has-text('Solicitar')"

    # ── Seletores: Plurio (autorizacoesdigitais.meu.bancomercantil.com.br) ────
    SEL_PLURIO_CHECKBOX:     str = "input.mdc-checkbox__native-control"  # ID muda; classe é estável
    SEL_PLURIO_INICIAR:      str = "button:has-text('Iniciar')"
    SEL_PLURIO_AUTORIZAR:    str = "button:has-text('Autorizar')"
    SEL_PLURIO_SUCESSO:      str = "div#sucesso, div.tela-finalizadora, text=/Finalizamos sua assinatura/i"
    SEL_PLURIO_DISABLED_CLASS: str = "mat-mdc-button-disabled"

    # ── Seletores: /simulacao/{UUID}/simulacao ────────────────────────────────
    SEL_DROPDOWN_PRODUTO:    str = "mat-select"
    SEL_SIMULAR_BTN:         str = "button:has-text('Simular')"
    # Resultado elegível
    SEL_VALOR_LIBERADO:      str = "strong.valorLiberado"
    # Inputs do form de simulação
    SEL_VALOR_PARCELA_INPUT: str = 'input[currencymask][placeholder="R$ 0,00"]'
    SEL_PRAZO_INPUT:         str = 'input[type="number"][min="1"]'
    # Detecção de inelegível — regex case-insensitive
    REGEX_INELEGIVEL: str = (
        r"(Trabalhador n[aã]o possui margem dispon[ií]vel|"
        r"Simula[cç][aã]o n[aã]o atendida pela pol[ií]tica de cr[eé]dito)"
    )
    # Voltar pra próximo CPF (painel expansível com ícone note_add)
    SEL_NOVA_PROPOSTA_PANEL: str = "mat-expansion-panel-header:has(mat-icon:has-text('note_add'))"

    # ── Geolocalização padrão (São Paulo) ────────────────────────────────────
    geolocation_lat: float = -23.5505
    geolocation_lon: float = -46.6333
