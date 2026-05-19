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
        try:
            await page.goto(self.cfg.portal_url, wait_until="domcontentloaded", timeout=self.cfg.timeout_page)
            await page.wait_for_selector(self.cfg.SEL_LOGIN_USER, state="visible", timeout=self.cfg.timeout_page)
            await page.fill(self.cfg.SEL_LOGIN_USER, self.login)
            await page.fill(self.cfg.SEL_LOGIN_PASS, self.password)
            await page.click(self.cfg.SEL_LOGIN_BTN)
            await page.wait_for_load_state("networkidle", timeout=self.cfg.timeout_auth)
            if "/login" in page.url:
                log.error("presenca login falhou — ainda em /login após submit user=%s", self.login)
                return False
            log.info("presenca login OK user=%s url=%s", self.login, page.url)
            return True
        except Exception as e:
            log.error("presenca login_page failed user=%s: %s", self.login, e)
            return False
