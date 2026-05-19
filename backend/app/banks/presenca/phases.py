"""Presença Bank — fases de automação click bot.

Fluxo por CPF:
  fase1_consultar → resultado elegivel | inelegivel | erro

MAPEAMENTO: atualizar seletores em config.py conforme o portal real.
"""
import asyncio
import logging
import re

from playwright.async_api import Page

from .config import PresencaConfig

log = logging.getLogger("presenca.phases")

_cfg = PresencaConfig()


def _fmt_cpf(cpf: str) -> str:
    digits = re.sub(r"\D", "", cpf)
    if len(digits) == 11:
        return f"{digits[:3]}.{digits[3:6]}.{digits[6:9]}-{digits[9:]}"
    return cpf


async def _screenshot(page: Page, label: str) -> None:
    try:
        path = f"/tmp/presenca_{label}.png"
        await page.screenshot(path=path, full_page=True)
        log.info("screenshot salvo: %s", path)
    except Exception:
        pass


async def fase1_consultar(page: Page, cpf: str, cfg: PresencaConfig | None = None) -> dict:
    """Consulta CPF no portal Presença Bank.

    Retorna dict com:
      status: "elegivel" | "inelegivel" | "erro"
      valor_liberado: str | None
      erro: str | None

    MAPEAMENTO PENDENTE: ajustar seletores em PresencaConfig conforme portal real.
    """
    cfg = cfg or _cfg
    cpf_fmt = _fmt_cpf(cpf)

    try:
        # 1. Preenche campo CPF
        cpf_field = page.locator(cfg.SEL_CPF_INPUT).first
        await cpf_field.wait_for(state="visible", timeout=cfg.timeout_page)
        await cpf_field.fill("")
        await cpf_field.fill(cpf_fmt)
        await asyncio.sleep(0.5)

        # 2. Clica Consultar
        await page.locator(cfg.SEL_CONSULTAR_BTN).first.click()

        # 3. Aguarda resultado (networkidle ou seletor de resultado)
        try:
            await page.wait_for_load_state("networkidle", timeout=20_000)
        except Exception:
            pass
        await asyncio.sleep(1.5)

        # 4. Verifica inelegível
        inelegivel = page.locator(cfg.SEL_INELEGIVEL_MSG).first
        if await inelegivel.count() > 0:
            await _screenshot(page, f"{cpf}_inelegivel")
            return {"status": "inelegivel", "valor_liberado": None, "erro": None}

        # 5. Verifica elegível — tenta capturar valor
        elegivel_area = page.locator(cfg.SEL_ELEGIVEL_AREA).first
        if await elegivel_area.count() > 0:
            valor_raw = None
            try:
                valor_el = page.locator(cfg.SEL_VALOR_LIBERADO).first
                if await valor_el.count() > 0:
                    valor_raw = await valor_el.inner_text()
            except Exception:
                pass
            await _screenshot(page, f"{cpf}_elegivel")
            return {"status": "elegivel", "valor_liberado": valor_raw, "erro": None}

        # 6. Resultado ambíguo — screenshot + erro mapeável
        await _screenshot(page, f"{cpf}_ambiguo")
        log.warning("presenca fase1: resultado ambíguo cpf=%s url=%s", cpf, page.url)
        return {"status": "erro", "valor_liberado": None, "erro": "resultado_ambiguo — atualizar seletores"}

    except asyncio.CancelledError:
        raise
    except Exception as e:
        await _screenshot(page, f"{cpf}_erro")
        log.exception("presenca fase1 erro cpf=%s", cpf)
        return {"status": "erro", "valor_liberado": None, "erro": str(e)[:200]}


async def nova_consulta(page: Page, cfg: PresencaConfig | None = None) -> None:
    """Volta para estado de nova consulta entre CPFs."""
    cfg = cfg or _cfg
    try:
        btn = page.locator(cfg.SEL_NOVA_CONSULTA).first
        if await btn.count() > 0:
            await btn.click()
            await asyncio.sleep(1.0)
    except Exception as e:
        log.warning("presenca nova_consulta: %s", e)
