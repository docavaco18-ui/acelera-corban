import asyncio
import logging
import os
import random
from urllib.parse import urlparse, unquote
from playwright.async_api import async_playwright, Browser, BrowserContext, Page
from .config import VCTexConfig
from .humanize import get_random_user_agent, get_human_headers


async def preflight_proxy(proxy_url: str, timeout: float = 10.0) -> str:
    """Valida proxy hitando api.ipify.org e retorna o egress IP.

    Levanta exceção em 407 (creds), timeout ou erro de rede.
    Roda antes do Chromium subir — ~1s por proxy.
    """
    import httpx
    proxies = {"http://": proxy_url, "https://": proxy_url}
    async with httpx.AsyncClient(proxies=proxies, timeout=timeout) as client:
        r = await client.get("https://api.ipify.org")
        r.raise_for_status()
        return r.text.strip()


def _build_playwright_proxy(proxy_url: str) -> dict:
    """Parse proxy URL and return Playwright's expected dict format.

    Playwright/Chromium ignore credentials embedded in the URL string
    (user:pass@host). They MUST be passed as explicit username/password
    fields, otherwise the proxy refuses with 407 silently.
    """
    parsed = urlparse(proxy_url)
    server = f"{parsed.scheme}://{parsed.hostname}:{parsed.port}"
    out: dict = {"server": server}
    if parsed.username:
        out["username"] = unquote(parsed.username)
    if parsed.password:
        out["password"] = unquote(parsed.password)
    return out


class BotEngine:
    def __init__(self, login: str, password: str, config: VCTexConfig | None = None, proxy_url: str | None = None):
        self.login = login
        self.password = password
        self.cfg = config or VCTexConfig()
        self.proxy_url = proxy_url
        self.proxy_label = self._extract_proxy_label(proxy_url)
        self._browser: Browser | None = None
        self._playwright = None

    @staticmethod
    def _extract_proxy_label(url: str | None) -> str:
        if not url:
            return "no-proxy"
        import re
        m = re.search(r"@([^/]+)$", url) or re.search(r"//([^/]+)$", url)
        return m.group(1) if m else "unknown"

    async def start(self, headless: bool = True):
        self._playwright = await async_playwright().start()
        launch_args = {
            "headless": headless,
            "args": [
                "--disable-blink-features=AutomationControlled",
                "--disable-features=IsolateOrigins,site-per-process",
                "--no-sandbox",
                "--disable-dev-shm-usage",
            ],
        }

        proxy_url = self.proxy_url or os.getenv("BOT_PROXY")
        if proxy_url:
            launch_args["proxy"] = _build_playwright_proxy(proxy_url)
            self.proxy_label = self._extract_proxy_label(proxy_url)
            logging.info("Engine login=%s proxy=%s", self.login, self.proxy_label)
        else:
            logging.info("Engine login=%s sem proxy (IP local)", self.login)

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
            permissions=["clipboard-read", "clipboard-write"],
        )
        await ctx.add_init_script(
            """
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            Object.defineProperty(navigator, 'languages', {get: () => ['pt-BR', 'pt', 'en-US', 'en']});
            Object.defineProperty(navigator, 'plugins', {get: () => [1,2,3,4,5]});
            window.chrome = {runtime: {}};
            const origQuery = window.navigator.permissions && window.navigator.permissions.query;
            if (origQuery) {
                window.navigator.permissions.query = (p) => p.name === 'notifications'
                    ? Promise.resolve({state: Notification.permission})
                    : origQuery(p);
            }
            """
        )
        return ctx

    async def login_page(self, page: Page) -> bool:
        try:
            await page.goto(self.cfg.portal_url, wait_until="domcontentloaded", timeout=self.cfg.timeout_page)
            await page.wait_for_selector(self.cfg.SEL_CPF_INPUT, timeout=self.cfg.timeout_page, state="visible")
            await page.wait_for_load_state("networkidle", timeout=self.cfg.timeout_page)
            await page.fill(self.cfg.SEL_CPF_INPUT, self.login)
            await page.fill(self.cfg.SEL_PASS_INPUT, self.password)
            await page.click(self.cfg.SEL_LOGIN_BTN)
            await page.wait_for_url("**/dashboard/**", timeout=self.cfg.timeout_page)
            return True
        except Exception as e:
            logging.error("login_page failed for %s: %s", self.login, str(e))
            return False
