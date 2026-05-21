"""Presença Bank BotEngine — Playwright headless, login simples, sem SMS."""
import logging
import os
from urllib.parse import urlparse, unquote

from playwright.async_api import async_playwright, Browser, BrowserContext, Page

from .config import PresencaConfig
from .humanize import get_random_user_agent, get_human_headers

log = logging.getLogger("presenca.engine")


def _build_playwright_proxy(proxy_url: str) -> dict:
    parsed = urlparse(proxy_url)
    server = f"{parsed.scheme}://{parsed.hostname}:{parsed.port}"
    out: dict = {"server": server}
    if parsed.username:
        out["username"] = unquote(parsed.username)
    if parsed.password:
        out["password"] = unquote(parsed.password)
    return out


class PresencaEngine:
    def __init__(
        self,
        login: str,
        password: str,
        config: PresencaConfig | None = None,
        proxy_url: str | None = None,
    ):
        self.login = login
        self.password = password
        self.cfg = config or PresencaConfig()
        self.proxy_url = proxy_url
        self._browser: Browser | None = None
        self._playwright = None

    async def start(self, headless: bool = True):
        self._playwright = await async_playwright().start()
        launch_args: dict = {
            "headless": headless,
            "args": [
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-features=IsolateOrigins,site-per-process",
            ],
        }
        proxy_url = self.proxy_url or os.getenv("PRESENCA_PROXY")
        if proxy_url:
            launch_args["proxy"] = _build_playwright_proxy(proxy_url)
            log.info("presenca engine login=%s proxy=on", self.login)
        else:
            log.info("presenca engine login=%s sem proxy", self.login)

        self._browser = await self._playwright.chromium.launch(**launch_args)

    async def stop(self):
        if self._browser:
            await self._browser.close()
            self._browser = None
        if self._playwright:
            await self._playwright.stop()
            self._playwright = None

    async def new_context(self) -> BrowserContext:
        ctx = await self._browser.new_context(
            user_agent=get_random_user_agent(),
            extra_http_headers=get_human_headers(),
            locale="pt-BR",
            timezone_id="America/Sao_Paulo",
            viewport={"width": 1366, "height": 768},
        )
        await ctx.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            Object.defineProperty(navigator, 'languages', {get: () => ['pt-BR', 'pt', 'en-US', 'en']});
            Object.defineProperty(navigator, 'plugins', {get: () => [1,2,3,4,5]});
            window.chrome = {runtime: {}};
        """)
        return ctx

    async def login_page(self, page: Page) -> bool:
        import asyncio as _asyncio
        from urllib.parse import urlparse

        try:
            # Angular SPA: usa load + sleep para aguardar hidratação
            await page.goto(self.cfg.portal_url, wait_until="load", timeout=self.cfg.timeout_page)
            await _asyncio.sleep(5)

            path = urlparse(page.url).path

            # Portal redireciona para /dashboards se sessão já ativa
            if path.startswith("/dashboard") or path.startswith("/propostas"):
                log.info("presenca sessão já ativa user=%s url=%s", self.login, page.url)
                return True

            # Screenshot da tela de login para debug
            try:
                await page.screenshot(path="/tmp/presenca_login_screen.png", full_page=True)
                log.info("presenca screenshot login: /tmp/presenca_login_screen.png")
            except Exception:
                pass

            # Fuse Angular usa input[formcontrolname] — tenta múltiplos seletores
            user_sels = [
                "input[formcontrolname='email']",
                "input[formcontrolname='username']",
                "input[formcontrolname='cpf']",
                "input[formcontrolname='login']",
                "input[type='email']",
                "input[name='email']",
                "input[placeholder*='CPF'], input[placeholder*='cpf']",
                "input[placeholder*='Login'], input[placeholder*='login']",
                "input[placeholder*='Usuário'], input[placeholder*='usuario']",
            ]
            pass_sels = [
                "input[formcontrolname='password']",
                "input[type='password']",
                "input[name='password']",
            ]

            # Aguarda qualquer input ficar visível (Angular precisa de tempo)
            try:
                await page.wait_for_selector("input", state="visible", timeout=15_000)
            except Exception:
                log.warning("presenca login: nenhum input visível após 15s")

            filled_user = False
            for sel in user_sels:
                try:
                    loc = page.locator(sel).first
                    if await loc.count() > 0:
                        await loc.fill(self.login)
                        filled_user = True
                        log.info("presenca login: preencheu usuário com seletor=%s", sel)
                        break
                except Exception:
                    continue

            if not filled_user:
                # Fallback: primeiro input visível
                inputs = page.locator("input:not([type='hidden'])").first
                if await inputs.count() > 0:
                    await inputs.fill(self.login)
                    log.info("presenca login: fallback primeiro input")

            await _asyncio.sleep(0.3)

            filled_pass = False
            for sel in pass_sels:
                try:
                    loc = page.locator(sel).first
                    if await loc.count() > 0:
                        await loc.fill(self.password)
                        filled_pass = True
                        break
                except Exception:
                    continue

            if not filled_pass:
                log.error("presenca login: campo senha não encontrado url=%s", page.url)
                return False

            await _asyncio.sleep(0.3)
            # Clica botão Entrar — locator suporta múltiplos seletores com vírgula
            btn_entrar = page.locator(self.cfg.SEL_LOGIN_BTN).first
            await btn_entrar.wait_for(state="visible", timeout=10_000)
            await btn_entrar.click()

            # Aguarda sair do sign-in
            try:
                await page.wait_for_url(
                    lambda url: "sign-in" not in url and "login" not in url,
                    timeout=self.cfg.timeout_auth,
                )
            except Exception:
                pass

            path_after = urlparse(page.url).path
            if "sign-in" in path_after or "login" in path_after:
                try:
                    await page.screenshot(path="/tmp/presenca_login_failed.png", full_page=True)
                except Exception:
                    pass
                log.error("presenca login falhou — url=%s user=%s", page.url, self.login)
                return False

            log.info("presenca login OK user=%s url=%s", self.login, page.url)
            return True
        except Exception as e:
            log.error("presenca login_page failed user=%s: %s", self.login, e)
            return False
