"""Presença Bank — fases do click bot (fluxo mapeado em 19/05/2026).

Fluxo por CPF:
  fase1_dados_basicos   → preenche CPF/nome/DDD/celular → Próximo → popup
  fase2_consultar       → clica Consultar no popup → aguarda countdown ~25s
  fase3_vinculo         → seleciona 1º vínculo rádio → Próximo
  fase4_tomador         → preenche e-mail → Próximo
  fase5_dados_bancarios → preenche renda + banco fictício → Próximo
  fase6_simulacao       → lê resultado elegível/inelegível

  nova_proposta         → navega direto para create_url (sem btn de nova consulta)
"""
import asyncio
import logging
import re

from playwright.async_api import Page

from .config import PresencaConfig

log = logging.getLogger("presenca.phases")

_cfg = PresencaConfig()


# ─── Utilitários ─────────────────────────────────────────────────────────────

def _fmt_cpf(cpf: str) -> str:
    digits = re.sub(r"\D", "", cpf)
    if len(digits) == 11:
        return f"{digits[:3]}.{digits[3:6]}.{digits[6:9]}-{digits[9:]}"
    return cpf


def _split_ddd_celular(telefone: str) -> tuple[str, str]:
    """'11987654321' → ('11', '987654321') | '(11) 98765-4321' → idem."""
    digits = re.sub(r"\D", "", telefone or "")
    if len(digits) >= 11:
        return digits[:2], digits[2:]
    if len(digits) == 10:
        return digits[:2], digits[2:]
    return "11", digits or "999999999"


async def _screenshot(page: Page, label: str) -> None:
    try:
        await page.screenshot(path=f"/tmp/presenca_{label}.png", full_page=True)
        log.info("screenshot: /tmp/presenca_%s.png", label)
    except Exception:
        pass


async def _fill_masked(page: Page, selector: str, value: str, timeout: int = 10_000) -> None:
    """Preenche campo com máscara Angular (triple-click → type lento)."""
    loc = page.locator(selector).first
    await loc.wait_for(state="visible", timeout=timeout)
    await loc.click()
    await loc.click(click_count=3)
    await page.keyboard.press("Control+a")
    await loc.type(value, delay=60)


async def _fill_label(page: Page, label_text: str, value: str, timeout: int = 10_000) -> None:
    """Preenche campo Angular Material pelo texto do label (para campos sem placeholder)."""
    loc = page.get_by_label(label_text).first
    await loc.wait_for(state="visible", timeout=timeout)
    await loc.click()
    await loc.click(click_count=3)
    await loc.type(value, delay=60)


async def _click_proximo(page: Page, cfg: PresencaConfig) -> None:
    btn = page.locator(cfg.SEL_PROXIMO_BTN).last
    await btn.wait_for(state="visible", timeout=cfg.timeout_page)
    await btn.scroll_into_view_if_needed()
    await btn.click()


# ─── Fases ───────────────────────────────────────────────────────────────────

async def fase1_dados_basicos(
    page: Page, cpf: str, nome: str, telefone: str, cfg: PresencaConfig | None = None
) -> None:
    """Navega para create_url, preenche dados básicos e clica Próximo."""
    cfg = cfg or _cfg

    # Navega para página de criação de proposta (mais rápido que clicar menu)
    await page.goto(cfg.create_url, wait_until="domcontentloaded", timeout=cfg.timeout_page)
    await asyncio.sleep(1.5)

    cpf_fmt = _fmt_cpf(cpf)
    ddd, celular = _split_ddd_celular(telefone)

    await _fill_masked(page, cfg.SEL_CPF_INPUT, cpf_fmt, cfg.timeout_page)
    await asyncio.sleep(0.3)
    await _fill_masked(page, cfg.SEL_NOME_INPUT, nome, cfg.timeout_page)
    await asyncio.sleep(0.3)
    await _fill_masked(page, cfg.SEL_DDD_INPUT, ddd, cfg.timeout_page)
    await asyncio.sleep(0.3)
    await _fill_masked(page, cfg.SEL_CELULAR_INPUT, celular, cfg.timeout_page)
    await asyncio.sleep(0.5)

    await _click_proximo(page, cfg)
    # Aguarda popup aparecer
    await asyncio.sleep(1.5)


async def fase2_consultar_vinculo(page: Page, cpf: str, cfg: PresencaConfig | None = None) -> dict | None:
    """Confirma popup e aguarda countdown de consulta eSocial (~25s).

    Retorna None se OK, ou dict {status: 'erro', erro: '...'} se falhar.
    """
    cfg = cfg or _cfg

    # Verifica se popup abriu
    popup = page.locator(cfg.SEL_POPUP_CONTAINER).first
    try:
        await popup.wait_for(state="visible", timeout=10_000)
    except Exception:
        # Se popup não abriu, tenta continuar (talvez redirecionou direto)
        log.warning("presenca fase2: popup consultar não apareceu cpf=%s", cpf)
        return None

    # Clica "Consultar" (botão accent/primário)
    btn_consultar = page.locator(cfg.SEL_POPUP_BTN_CONSULTAR).first
    try:
        await btn_consultar.wait_for(state="visible", timeout=5_000)
        await btn_consultar.click()
    except Exception:
        log.warning("presenca fase2: botão Consultar não encontrado cpf=%s", cpf)
        await _screenshot(page, f"{cpf}_popup_sem_btn")
        return {"status": "erro", "erro": "popup_sem_btn_consultar"}

    # Aguarda o countdown desaparecer (pode levar até ~30s)
    log.info("presenca fase2: aguardando countdown consulta cpf=%s", cpf)
    try:
        # Espera dialog de countdown aparecer
        countdown_dlg = page.locator(".cdk-overlay-pane:has-text('Consultando')").first
        await countdown_dlg.wait_for(state="visible", timeout=8_000)
        # Aguarda desaparecer (resolução da consulta)
        await countdown_dlg.wait_for(state="hidden", timeout=cfg.timeout_consulta)
    except Exception:
        # Pode não ter o countdown visível ou já passou
        pass

    await asyncio.sleep(1.5)
    return None


async def fase3_selecionar_vinculo(page: Page, cpf: str, cfg: PresencaConfig | None = None) -> dict | None:
    """Seleciona primeiro vínculo empregatício disponível e avança.

    Retorna None se OK, ou dict com inelegível se sem vínculo.
    """
    cfg = cfg or _cfg

    # Verifica mensagem de sem vínculo
    sem_vinculo = page.locator(cfg.SEL_SEM_VINCULO).first
    await asyncio.sleep(1.0)
    if await sem_vinculo.count() > 0:
        await _screenshot(page, f"{cpf}_sem_vinculo")
        return {"status": "inelegivel", "valor_liberado": None, "erro": "sem_vinculo_empregaticio"}

    # Aguarda radio group aparecer
    radio_group = page.locator(cfg.SEL_VINCULO_RADIO_GROUP).first
    try:
        await radio_group.wait_for(state="visible", timeout=cfg.timeout_page)
    except Exception:
        await _screenshot(page, f"{cpf}_sem_radio_group")
        log.warning("presenca fase3: radio group não encontrado cpf=%s", cpf)
        return {"status": "erro", "valor_liberado": None, "erro": "radio_group_nao_encontrado"}

    # Clica no primeiro radio button
    primeiro_radio = page.locator(cfg.SEL_VINCULO_PRIMEIRO_INPUT).first
    try:
        await primeiro_radio.wait_for(state="visible", timeout=5_000)
        await primeiro_radio.click(force=True)
    except Exception:
        # Tenta clicar no mat-radio-button pai (label)
        try:
            await page.locator("mat-radio-group[name='simulacoes'] mat-radio-button:first-of-type").first.click()
        except Exception as e:
            log.warning("presenca fase3: erro ao clicar radio cpf=%s: %s", cpf, e)

    await asyncio.sleep(0.5)
    await _click_proximo(page, cfg)
    await asyncio.sleep(1.5)
    return None


async def fase4_tomador(page: Page, cpf: str, cfg: PresencaConfig | None = None) -> None:
    """Preenche e-mail no step Tomador e avança."""
    cfg = cfg or _cfg

    email_field = page.locator(cfg.SEL_EMAIL_INPUT).first
    try:
        await email_field.wait_for(state="visible", timeout=cfg.timeout_page)
        await email_field.click(click_count=3)
        await email_field.fill(cfg.default_email)
    except Exception as e:
        log.warning("presenca fase4: e-mail não encontrado cpf=%s: %s", cpf, e)

    await asyncio.sleep(0.5)
    await _click_proximo(page, cfg)
    await asyncio.sleep(1.5)


async def fase5_dados_bancarios(page: Page, cpf: str, cfg: PresencaConfig | None = None) -> None:
    """Preenche renda + dados bancários fictícios e avança para simulação."""
    cfg = cfg or _cfg

    # Valor da Renda (placeholder vazio — usa get_by_label)
    try:
        await _fill_label(page, cfg.LABEL_VALOR_RENDA, cfg.default_valor_renda, cfg.timeout_page)
    except Exception as e:
        log.warning("presenca fase5: campo renda não encontrado cpf=%s: %s", cpf, e)

    await asyncio.sleep(0.3)

    # Banco (autocomplete)
    banco_field = page.locator(cfg.SEL_BANCO_INPUT).first
    try:
        await banco_field.wait_for(state="visible", timeout=5_000)
        await banco_field.click()
        await banco_field.fill(cfg.default_banco)
        await asyncio.sleep(0.8)
        # Seleciona primeira opção do autocomplete
        option = page.locator("mat-option").first
        if await option.count() > 0:
            await option.click()
    except Exception as e:
        log.warning("presenca fase5: campo banco não encontrado cpf=%s: %s", cpf, e)

    await asyncio.sleep(0.3)

    for sel, val in [
        (cfg.SEL_AGENCIA_INPUT, cfg.default_agencia),
        (cfg.SEL_CONTA_INPUT,   cfg.default_conta),
        (cfg.SEL_DIGITO_INPUT,  cfg.default_digito),
    ]:
        try:
            field = page.locator(sel).first
            if await field.count() > 0:
                await field.click(click_count=3)
                await field.fill(val)
                await asyncio.sleep(0.2)
        except Exception as e:
            log.warning("presenca fase5: campo %s não encontrado cpf=%s: %s", sel, cpf, e)

    await asyncio.sleep(0.5)
    await _click_proximo(page, cfg)
    await asyncio.sleep(2.0)


async def fase6_simulacao(page: Page, cpf: str, cfg: PresencaConfig | None = None) -> dict:
    """Lê resultado na tela de Simulação (Step 5).

    Retorna:
      {status: 'elegivel', valor_liberado: str|None, erro: None}
      {status: 'inelegivel', valor_liberado: None, erro: str}
      {status: 'erro', valor_liberado: None, erro: str}
    """
    cfg = cfg or _cfg

    await asyncio.sleep(1.5)

    # Verifica inelegível
    ineleg = page.locator(cfg.SEL_INELEGIVEL_MSG).first
    if await ineleg.count() > 0:
        try:
            msg = await ineleg.inner_text()
        except Exception:
            msg = "inelegivel_sem_tabela"
        await _screenshot(page, f"{cpf}_inelegivel")
        return {"status": "inelegivel", "valor_liberado": None, "erro": msg.strip()[:200]}

    # Verifica elegível — campo valor_parcela preenchido = simulação OK
    parcela_field = page.locator(cfg.SEL_VALOR_PARCELA).first
    if await parcela_field.count() > 0:
        try:
            valor_raw = await parcela_field.input_value()
            if valor_raw and valor_raw.strip():
                await _screenshot(page, f"{cpf}_elegivel")
                return {"status": "elegivel", "valor_liberado": valor_raw.strip(), "erro": None}
        except Exception:
            pass

    # Ambíguo
    await _screenshot(page, f"{cpf}_ambiguo_simulacao")
    log.warning("presenca fase6: resultado ambíguo cpf=%s url=%s", cpf, page.url)
    return {"status": "erro", "valor_liberado": None, "erro": "resultado_ambiguo_simulacao"}


async def processar_cpf(
    page: Page,
    record: dict,
    cfg: PresencaConfig | None = None,
) -> dict:
    """Pipeline completo para um CPF.

    `record` deve ter: cpf, nome (opcional), telefone (opcional).
    Retorna dict com status/valor_liberado/erro.
    """
    cfg = cfg or _cfg
    cpf = record["cpf"]
    nome = (record.get("nome") or "").strip() or "Cliente Presenca"
    telefone = (record.get("telefone") or "").strip() or "11999999999"

    try:
        # Passo 1: dados básicos
        await fase1_dados_basicos(page, cpf, nome, telefone, cfg)

        # Passo 2: confirma popup + aguarda consulta eSocial
        err = await fase2_consultar_vinculo(page, cpf, cfg)
        if err:
            return err

        # Passo 3: seleciona vínculo (pode retornar inelegível)
        err = await fase3_selecionar_vinculo(page, cpf, cfg)
        if err:
            return err

        # Passo 4: tomador (e-mail)
        await fase4_tomador(page, cpf, cfg)

        # Passo 5: dados bancários
        await fase5_dados_bancarios(page, cpf, cfg)

        # Passo 6: resultado
        return await fase6_simulacao(page, cpf, cfg)

    except asyncio.CancelledError:
        raise
    except Exception as e:
        await _screenshot(page, f"{cpf}_exc")
        log.exception("presenca processar_cpf erro cpf=%s", cpf)
        return {"status": "erro", "valor_liberado": None, "erro": str(e)[:200]}


async def nova_proposta(page: Page, cfg: PresencaConfig | None = None) -> None:
    """Reinicia para próximo CPF navegando direto para create_url."""
    cfg = cfg or _cfg
    try:
        await page.goto(cfg.create_url, wait_until="domcontentloaded", timeout=cfg.timeout_page)
        await asyncio.sleep(1.0)
    except Exception as e:
        log.warning("presenca nova_proposta: %s", e)
