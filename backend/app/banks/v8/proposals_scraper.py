"""Agente que raspa propostas pagas do portal V8 e insere no CRM."""
import asyncio
import logging
import re
from datetime import datetime, timezone
from typing import Any

from playwright.async_api import async_playwright, TimeoutError as PWTimeout

from ...db_scoped import scoped

logger = logging.getLogger(__name__)

PORTAL_URL = "https://app.v8sistema.com"
PROPOSALS_URL = f"{PORTAL_URL}/credito-consignado/minhas-propostas"


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


class V8ProposalsScraper:
    def __init__(self, user_id: str, login: str, password: str, db: Any):
        self.user_id = user_id
        self.login = login
        self.password = password
        self.db = db

    async def run(self) -> dict:
        stats = {"added": 0, "skipped": 0, "errors": 0}
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True, args=["--no-sandbox"])
            ctx = await browser.new_context(viewport={"width": 1280, "height": 900})
            page = await ctx.new_page()
            try:
                await self._login(page)
                await self._navigate_and_filter(page)
                await self._scrape_all_pages(page, stats)
            except Exception as e:
                logger.exception(f"V8ProposalsScraper error: {e}")
                stats["errors"] += 1
            finally:
                await browser.close()
        return stats

    # ─── Login ────────────────────────────────────────────────────────────────

    async def _login(self, page):
        await page.goto(PORTAL_URL, wait_until="domcontentloaded", timeout=30_000)
        # Aguarda campo de e-mail
        await page.wait_for_selector("input[type='email'], input[name='email'], input[placeholder*='mail' i]", timeout=15_000)
        await page.fill("input[type='email'], input[name='email'], input[placeholder*='mail' i]", self.login)
        await page.fill("input[type='password']", self.password)
        await page.click("button[type='submit']")
        # Aguarda sair da tela de login
        await page.wait_for_url(f"{PORTAL_URL}/**", timeout=20_000)
        logger.info("V8 login OK")

    # ─── Navegação e filtro ───────────────────────────────────────────────────

    async def _navigate_and_filter(self, page):
        await page.goto(PROPOSALS_URL, wait_until="domcontentloaded", timeout=20_000)
        # Aguarda o dropdown de status aparecer
        await page.wait_for_selector("button:has-text('Todos os status'), button:has-text('Pago')", timeout=15_000)

        # Se já estiver filtrado por Pago, não precisa clicar
        if await page.locator("button:has-text('Pago')").count() > 0:
            current = await page.locator("button:has-text('Pago')").first.text_content()
            if "Pago" in (current or ""):
                return

        # Abre dropdown de status
        await page.locator("button:has-text('Todos os status')").first.click()
        await page.wait_for_timeout(600)

        # Clica em "Pago" no menu dropdown
        await page.locator("[role='menuitem']:has-text('Pago'), [role='option']:has-text('Pago'), .chakra-menu__menuitem:has-text('Pago')").first.click()
        await page.wait_for_load_state("networkidle", timeout=10_000)
        logger.info("Filtro 'Pago' aplicado")

    # ─── Paginação ────────────────────────────────────────────────────────────

    async def _scrape_all_pages(self, page, stats: dict):
        page_num = 1
        while True:
            logger.info(f"Scraping página {page_num}")
            count = await self._scrape_page(page, stats)
            logger.info(f"Página {page_num}: {count} linhas processadas | totais: {stats}")

            # Tenta ir para próxima página
            next_btn = page.locator("button:has-text('Próxima página')")
            if await next_btn.count() == 0 or not await next_btn.is_enabled():
                break
            await next_btn.click()
            await page.wait_for_load_state("networkidle", timeout=10_000)
            await page.wait_for_timeout(800)
            page_num += 1

    # ─── Raspa uma página de resultados ──────────────────────────────────────

    async def _scrape_page(self, page, stats: dict) -> int:
        # Conta quantos botões "Visualizar" existem
        count = await page.locator("button:has-text('Visualizar')").count()
        if count == 0:
            return 0

        for i in range(count):
            try:
                # Re-localiza pois o DOM pode ter mudado após fechar modal
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

                # Fecha modal com Escape
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
        # ── Dados Pessoais (aba padrão) ──
        nome = await page.input_value("input#name") or ""
        cpf_raw = await page.input_value("input#cpf") or ""
        cpf = re.sub(r"[.\-]", "", cpf_raw)

        # ID da proposta e data criação do cabeçalho
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

        # ── Aba Resumo ──
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
            "status": "propostas",  # coluna "PAGOS"
        }

    # ─── Salva no CRM (síncrono — chamado via to_thread) ─────────────────────

    def _save_to_crm(self, data: dict) -> bool:
        proposta_id = data.get("codigo_proposta", "")
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
