"""Agente que raspa propostas pagas do portal V8 e insere no CRM."""
import asyncio
import calendar
import logging
import re
from datetime import date, datetime, timezone
from typing import Any

from playwright.async_api import async_playwright, TimeoutError as PWTimeout

from ...db_scoped import scoped

logger = logging.getLogger(__name__)

PORTAL_URL = "https://app.v8sistema.com"
PROPOSALS_URL = f"{PORTAL_URL}/credito-consignado/minhas-propostas"

PT_MONTHS = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
]


def _parse_brl(text: str) -> float:
    if not text:
        return 0.0
    clean = re.sub(r"[R$\s\xa0]", "", text).replace(".", "").replace(",", ".")
    try:
        return float(clean)
    except ValueError:
        return 0.0


def _parse_date_br(text: str) -> str:
    """dd/mm/yyyy → yyyy-mm-dd"""
    m = re.search(r"(\d{2})/(\d{2})/(\d{4})", text or "")
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    return datetime.now().strftime("%Y-%m-%d")


def _months_to_scrape(months_back: int) -> list[tuple[int, int]]:
    """Retorna lista de (ano, mês) dos últimos N meses, do mais antigo ao mais recente."""
    today = date.today()
    result = []
    for i in range(months_back - 1, -1, -1):
        month = today.month - i
        year = today.year
        while month <= 0:
            month += 12
            year -= 1
        result.append((year, month))
    return result


class V8ProposalsScraper:
    def __init__(self, user_id: str, login: str, password: str, db: Any, months_back: int = 12):
        self.user_id = user_id
        self.login = login
        self.password = password
        self.db = db
        self.months_back = months_back

    async def run(self) -> dict:
        stats = {"added": 0, "skipped": 0, "errors": 0}
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True, args=["--no-sandbox"])
            ctx = await browser.new_context(viewport={"width": 1280, "height": 900})
            page = await ctx.new_page()
            try:
                await self._login(page)
                months = _months_to_scrape(self.months_back)
                for year, month in months:
                    logger.info(f"Iniciando mês {year}/{month:02d}")
                    try:
                        await self._navigate_and_filter_month(page, year, month)
                        await self._scrape_all_pages(page, stats)
                    except Exception as e:
                        logger.exception(f"Erro no mês {year}/{month:02d}: {e}")
                        stats["errors"] += 1
            except Exception as e:
                logger.exception(f"V8ProposalsScraper error: {e}")
                stats["errors"] += 1
            finally:
                await browser.close()
        return stats

    # ─── Login ────────────────────────────────────────────────────────────────

    async def _login(self, page):
        await page.goto(f"{PORTAL_URL}/signin", wait_until="domcontentloaded", timeout=30_000)

        # Passo 1: clicar em "Entrar na minha conta" para abrir o formulário
        entrar_btn = page.locator("button:has-text('Entrar na minha conta')")
        if await entrar_btn.count() > 0:
            await entrar_btn.first.click()
            await page.wait_for_timeout(600)

        # Passo 2: preencher email e senha
        await page.wait_for_selector(
            "input[type='email'], input[name='email'], input[placeholder*='mail' i]",
            timeout=15_000,
        )
        await page.fill(
            "input[type='email'], input[name='email'], input[placeholder*='mail' i]",
            self.login,
        )
        await page.fill("input[type='password']", self.password)

        # Passo 3: submeter (botão "Log in" ou type=submit)
        submit = page.locator("button:has-text('Log in'), button[type='submit']")
        await submit.first.click()
        await page.wait_for_url(f"{PORTAL_URL}/**", timeout=20_000)
        logger.info("V8 login OK")

    # ─── Navegação e filtro por mês ───────────────────────────────────────────

    DIALOG = "section[role='dialog']"

    async def _navigate_and_filter_month(self, page, year: int, month: int):
        """Vai para a página de propostas, aplica filtro Pago e define o intervalo do mês."""
        await page.goto(PROPOSALS_URL, wait_until="domcontentloaded", timeout=20_000)
        await page.wait_for_selector("button.chakra-menu__menu-button[aria-haspopup='menu']", timeout=15_000)

        # ── Filtro de status "Pago" (data-index="6") ──
        await page.locator("button.chakra-menu__menu-button[aria-haspopup='menu']").first.click()
        await page.wait_for_selector("[role='menu']", timeout=5_000)
        await page.locator("[role='menu'] [role='menuitem'][data-index='6']").click()
        await page.wait_for_load_state("networkidle", timeout=10_000)
        await page.wait_for_timeout(400)

        # ── Abre o date picker ──
        await page.locator("button[aria-haspopup='dialog']").first.click()
        await page.wait_for_selector(self.DIALOG, timeout=8_000)
        await page.wait_for_timeout(500)

        # ── Navega o calendário até o mês alvo ──
        await self._navigate_calendar_to(page, year, month)

        # ── Clica dia 1 e último dia do mês ──
        last_day = calendar.monthrange(year, month)[1]
        await self._click_calendar_day(page, 1)
        await page.wait_for_timeout(300)
        await self._click_calendar_day(page, last_day)
        await page.wait_for_timeout(300)

        # ── Aplica filtro ──
        dialog = page.locator(self.DIALOG)
        await dialog.locator("button", has_text="Aplicar Filtro").click()
        await page.wait_for_load_state("networkidle", timeout=12_000)
        await page.wait_for_timeout(600)
        logger.info(f"Filtro aplicado: {year}/{month:02d} (1 → {last_day})")

    async def _navigate_calendar_to(self, page, target_year: int, target_month: int):
        """Navega o calendário via botões react-day-picker até o mês alvo aparecer à esquerda."""
        for _ in range(36):
            curr_year, curr_month = await self._read_calendar_left_month(page)
            if curr_year == target_year and curr_month == target_month:
                return

            curr_total = curr_year * 12 + curr_month
            target_total = target_year * 12 + target_month

            if curr_total > target_total:
                await page.locator("button[name='previous-month']").first.click()
            else:
                await page.locator("button[name='next-month']").first.click()
            await page.wait_for_timeout(350)

    async def _read_calendar_left_month(self, page) -> tuple[int, int]:
        """Lê o mês/ano do caption esquerdo do react-day-picker."""
        try:
            # react-day-picker usa .rdp-caption_label para o título do mês
            labels = await page.locator(f"{self.DIALOG} .rdp-caption_label").all_text_contents()
            if labels:
                text = labels[0].lower()  # pega o calendário da esquerda
                for i, name in enumerate(PT_MONTHS):
                    if name in text:
                        year_match = re.search(r"(20\d\d)", text)
                        if year_match:
                            return int(year_match.group(1)), i + 1
        except Exception:
            pass
        return 0, 0

    async def _click_calendar_day(self, page, day: int):
        """Clica em um dia específico do react-day-picker, ignorando dias de meses adjacentes."""
        dialog = page.locator(self.DIALOG)
        # button[name="day"] com texto exato e sem classe rdp-day_outside
        day_btns = dialog.locator("button[name='day']:not(.rdp-day_outside):not(.rdp-day_disabled)")
        count = await day_btns.count()
        for i in range(count):
            btn = day_btns.nth(i)
            text = (await btn.text_content() or "").strip()
            if text == str(day):
                await btn.click()
                return
        logger.warning(f"Dia {day} não encontrado no calendário")

    # ─── Paginação ────────────────────────────────────────────────────────────

    async def _scrape_all_pages(self, page, stats: dict):
        page_num = 1
        while True:
            logger.info(f"Scraping página {page_num}")
            count = await self._scrape_page(page, stats)
            logger.info(f"Página {page_num}: {count} linhas | totais: {stats}")

            next_btn = page.locator("button:has-text('Próxima página')")
            if await next_btn.count() == 0 or not await next_btn.is_enabled():
                break
            await next_btn.click()
            await page.wait_for_load_state("networkidle", timeout=10_000)
            await page.wait_for_timeout(800)
            page_num += 1

    # ─── Raspa uma página de resultados ──────────────────────────────────────

    async def _scrape_page(self, page, stats: dict) -> int:
        count = await page.locator("button:has-text('Visualizar')").count()
        if count == 0:
            return 0

        for i in range(count):
            try:
                btn = page.locator("button:has-text('Visualizar')").nth(i)
                await btn.click()
                await page.wait_for_selector("input#name, input#cpf", timeout=8_000)

                data = await self._extract_modal(page)
                if data:
                    added = await asyncio.to_thread(self._save_to_crm, data)
                    if added:
                        stats["added"] += 1
                    else:
                        stats["skipped"] += 1

                await page.keyboard.press("Escape")
                await page.wait_for_timeout(400)

            except PWTimeout:
                logger.warning(f"Timeout na linha {i}, pulando")
                await page.keyboard.press("Escape")
                await page.wait_for_timeout(400)
                stats["errors"] += 1
            except Exception as e:
                logger.warning(f"Erro linha {i}: {e}")
                await page.keyboard.press("Escape")
                await page.wait_for_timeout(400)
                stats["errors"] += 1

        return count

    # ─── Extrai dados do modal ────────────────────────────────────────────────

    async def _extract_modal(self, page) -> dict | None:
        nome = await page.input_value("input#name") or ""
        cpf_raw = await page.input_value("input#cpf") or ""
        cpf = re.sub(r"[.\-]", "", cpf_raw)

        header_text = ""
        try:
            header_el = await page.query_selector("[class*='chakra-text']:has-text('Id:')")
            if header_el:
                header_text = await header_el.text_content() or ""
        except Exception:
            pass

        proposta_id = ""
        id_match = re.search(r"Id[:\s]+(\d+)", header_text)
        if id_match:
            proposta_id = id_match.group(1)

        autor = ""
        autor_match = re.search(r"Autor[:\s]+([\w_]+)", header_text)
        if autor_match:
            autor = autor_match.group(1)

        data_venda = datetime.now().strftime("%Y-%m-%d")
        criado_match = re.search(r"Criado[:\s]+(\d{2}/\d{2}/\d{4})", header_text)
        if criado_match:
            data_venda = _parse_date_br(criado_match.group(1))

        resumo_tab = page.locator("button[role='tab']:has-text('Resumo')")
        if await resumo_tab.count() == 0:
            resumo_tab = page.locator("[role='tab']:has-text('Resumo')")
        await resumo_tab.first.click()
        await page.wait_for_timeout(700)

        resumo = await page.evaluate("""
            () => {
                const result = {};
                const els = Array.from(document.querySelectorAll('p, span, div'))
                    .filter(el => el.children.length === 0 && el.textContent.trim());
                for (let i = 0; i < els.length - 1; i++) {
                    const label = els[i].textContent.trim();
                    const value = els[i + 1].textContent.trim();
                    if (label === 'Contratado')            result.valor    = value;
                    if (label === 'Valor parcela')         result.parcela  = value;
                    if (label === 'Número de parcelas')    result.prazo    = value;
                    if (label === 'Data primeira parcela') result.data     = value;
                    if (label === 'Pago')                  result.pago     = value;
                }
                return result;
            }
        """)

        valor   = _parse_brl(resumo.get("valor", ""))
        parcela = _parse_brl(resumo.get("parcela", ""))
        prazo_txt = resumo.get("prazo", "0").replace("x", "").strip()
        try:
            prazo = int(prazo_txt)
        except ValueError:
            prazo = 0

        if not cpf or valor <= 0:
            logger.warning(f"Proposta ignorada — CPF ou valor inválido: cpf={cpf} valor={valor}")
            return None

        return {
            "nome_vendedor": f"V8:{autor}" if autor else "V8",
            "cliente_nome": nome.strip(),
            "cliente_cpf": cpf,
            "banco": "V8",
            "data_venda": data_venda,
            "valor": valor,
            "parcela": parcela,
            "prazo": prazo or 1,
            "codigo_proposta": proposta_id,
            "status": "propostas",
        }

    # ─── Salva no CRM (síncrono — chamado via to_thread) ─────────────────────

    def _save_to_crm(self, data: dict) -> bool:
        proposta_id = data.get("codigo_proposta", "")
        for attempt in range(3):
            try:
                if proposta_id:
                    existing = (
                        scoped(self.db, "crm_propostas", self.user_id)
                        .select("id")
                        .eq("codigo_proposta", proposta_id)
                        .execute().data or []
                    )
                    if existing:
                        return False  # duplicata

                now_iso = datetime.now(timezone.utc).isoformat()
                payload = {
                    **data,
                    "approved": True,
                    "approved_at": now_iso,
                    "approved_by": self.user_id,
                }
                rows = (
                    scoped(self.db, "crm_propostas", self.user_id)
                    .insert(payload)
                    .execute().data or []
                )
                return bool(rows)
            except Exception as e:
                logger.warning(f"_save_to_crm tentativa {attempt + 1} falhou: {e}")
                if attempt == 2:
                    raise
        return False
