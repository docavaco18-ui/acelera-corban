"""Playwright engine para o portal Meu Mercantil.

Diferenças críticas vs VCTex:
- Login requer SMS humano (6 dígitos) → integrado via sms_bridge
- Geolocalização concedida para autorizacoesdigitais.* (Plurio pede)
- storage_state persistido em disco por user → reusa sessão entre runs
  (evita re-pedir SMS toda vez)
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
from pathlib import Path
from typing import Any, Callable

from playwright.async_api import async_playwright, Browser, BrowserContext, Page

from .config import MercantilConfig
from .humanize import get_random_user_agent, get_human_headers
from . import sms_bridge

logger = logging.getLogger("mercantil.engine")


# Diretório onde salvamos storage_state por usuário.
# Path relativo a cwd:
#   - Local (cd backend && uvicorn app.main:app): cwd=./backend → .bot_state/mercantil
#   - Docker (WORKDIR=/app com volume ./backend:/app):    cwd=/app   → /app/.bot_state/mercantil
#     que mapeia pra host em ./backend/.bot_state/mercantil
# Override via env var MERCANTIL_STATE_DIR (preferir absoluto se montar volume separado).
STATE_DIR = Path(os.getenv("MERCANTIL_STATE_DIR", ".bot_state/mercantil"))


class MercantilEngine:
    def __init__(self, login: str, password: str, config: MercantilConfig | None = None):
        self.login = login
        self.password = password
        self.cfg = config or MercantilConfig()
        self._browser: Browser | None = None
        self._playwright = None

    # ── Lifecycle ───────────────────────────────────────────────────────────

    async def start(self, headless: bool | None = None) -> None:
        # Default: HEADED (com Xvfb em prod). Akamai bloqueia headless puro.
        # Override via env var MERCANTIL_HEADLESS=1 pra forçar headless (debug).
        if headless is None:
            headless = os.getenv("MERCANTIL_HEADLESS", "0") == "1"
        self._playwright = await async_playwright().start()
        self._browser = await self._playwright.chromium.launch(
            headless=headless,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--disable-features=IsolateOrigins,site-per-process",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-infobars",
                "--disable-extensions",
                "--start-maximized",
            ],
        )
        logger.info("mercantil engine started login=%s headless=%s display=%s",
                    self.login, headless, os.getenv("DISPLAY"))

    async def stop(self) -> None:
        if self._browser:
            try:
                await self._browser.close()
            except Exception:
                pass
            self._browser = None
        if self._playwright:
            try:
                await self._playwright.stop()
            except Exception:
                pass
            self._playwright = None

    # ── Storage state ───────────────────────────────────────────────────────

    def storage_state_path(self, user_id: str) -> Path:
        return STATE_DIR / f"{user_id}.json"

    def has_saved_state(self, user_id: str) -> bool:
        p = self.storage_state_path(user_id)
        return p.is_file() and p.stat().st_size > 0

    def jwt_cache_path(self, user_id: str) -> Path:
        return STATE_DIR / f"{user_id}.jwt.json"

    async def _save_state(self, ctx: BrowserContext, user_id: str) -> None:
        try:
            p = self.storage_state_path(user_id)
            p.parent.mkdir(parents=True, exist_ok=True)
            await ctx.storage_state(path=str(p))
            logger.info("mercantil storage_state saved user=%s path=%s", user_id, p)
        except Exception as e:
            logger.warning("mercantil storage_state save FAILED user=%s err=%s", user_id, e)

        # Also extract JWT from localStorage for direct BFF API calls
        try:
            pages = ctx.pages
            if pages:
                page = pages[0]
                raw = await page.evaluate("""
                    () => {
                        const result = {};
                        for (let i = 0; i < localStorage.length; i++) {
                            const k = localStorage.key(i);
                            result[k] = localStorage.getItem(k);
                        }
                        return result;
                    }
                """)
                jwt_token = None
                for k, v in raw.items():
                    if v and isinstance(v, str) and v.count(".") >= 2 and v.startswith("ey"):
                        jwt_token = v
                        logger.info("mercantil JWT captured from localStorage key=%s user=%s", k, user_id)
                        break
                if not jwt_token:
                    # Try JSON-wrapped auth object
                    import json as _json
                    for k, v in raw.items():
                        try:
                            obj = _json.loads(v or "{}")
                            t = obj.get("access_token") or obj.get("token") or obj.get("accessToken")
                            if t and str(t).startswith("ey"):
                                jwt_token = str(t)
                                logger.info("mercantil JWT captured from JSON key=%s user=%s", k, user_id)
                                break
                        except Exception:
                            pass
                if jwt_token:
                    import json as _json, base64 as _b64
                    sessao_id = ""
                    try:
                        payload_raw = jwt_token.split(".")[1] + "=="
                        payload = _json.loads(_b64.urlsafe_b64decode(payload_raw))
                        mb = payload.get("mb", {}).get("data", {})
                        sessao_id = mb.get("usuario", {}).get("sessaoId", "")
                    except Exception:
                        pass
                    jwt_data = {"access_token": jwt_token, "sessao_id": sessao_id, "localStorage": raw}
                    jp = self.jwt_cache_path(user_id)
                    jp.write_text(_json.dumps(jwt_data))
                    logger.info("mercantil JWT cache saved user=%s sessao_id=%s", user_id, sessao_id)
                else:
                    logger.warning("mercantil JWT not found in localStorage user=%s keys=%s", user_id, list(raw.keys()))
        except Exception as e:
            logger.warning("mercantil JWT capture FAILED user=%s err=%s", user_id, e)

    def _drop_state(self, user_id: str) -> None:
        try:
            p = self.storage_state_path(user_id)
            if p.is_file():
                p.unlink()
                logger.info("mercantil storage_state dropped user=%s", user_id)
        except Exception:
            pass

    # ── Context com geolocation + stealth + sessão carregada ────────────────

    async def new_context(self, user_id: str) -> BrowserContext:
        if not self._browser:
            raise RuntimeError("engine não iniciado — chame start() antes")

        kwargs: dict[str, Any] = {
            "user_agent": get_random_user_agent(),
            "extra_http_headers": get_human_headers(),
            "locale": "pt-BR",
            "timezone_id": "America/Sao_Paulo",
            "viewport": {"width": 1366, "height": 768},
            # Geolocation pré-concedida pra dois origins relevantes
            "permissions": ["clipboard-read", "clipboard-write", "geolocation"],
            "geolocation": {
                "latitude": self.cfg.geolocation_lat,
                "longitude": self.cfg.geolocation_lon,
            },
        }

        # Proxy opcional via env (MERCANTIL_PROXY_SERVER + USER + PASS).
        # Rotação por porta: lista CSV em MERCANTIL_PROXY_PORTS pega round-robin.
        proxy_server = os.getenv("MERCANTIL_PROXY_SERVER")
        if proxy_server:
            ports_csv = os.getenv("MERCANTIL_PROXY_PORTS", "").strip()
            if ports_csv:
                ports = [p.strip() for p in ports_csv.split(",") if p.strip()]
                # Round-robin estável por user_id (mesmo user_id → mesma porta na sessão)
                idx = abs(hash(user_id)) % len(ports)
                server = f"{proxy_server.rstrip(':')}:{ports[idx]}"
            else:
                server = proxy_server
            proxy_cfg: dict[str, Any] = {"server": server}
            user = os.getenv("MERCANTIL_PROXY_USER")
            pwd = os.getenv("MERCANTIL_PROXY_PASS")
            if user:
                proxy_cfg["username"] = user
            if pwd:
                proxy_cfg["password"] = pwd
            kwargs["proxy"] = proxy_cfg
            logger.info("mercantil proxy enabled server=%s user=%s", server, user or "(none)")

        # Carrega storage_state se existir → reusa sessão (evita SMS)
        if self.has_saved_state(user_id):
            kwargs["storage_state"] = str(self.storage_state_path(user_id))

        ctx = await self._browser.new_context(**kwargs)

        # Stealth: remove sinais óbvios de automação. Akamai checa muitos.
        await ctx.add_init_script(
            """
            // 1. webdriver flag
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});

            // 2. languages
            Object.defineProperty(navigator, 'languages', {get: () => ['pt-BR', 'pt', 'en-US', 'en']});

            // 3. plugins fake
            Object.defineProperty(navigator, 'plugins', {
                get: () => [
                    {name: 'PDF Viewer', filename: 'internal-pdf-viewer'},
                    {name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer'},
                    {name: 'Chromium PDF Plugin', filename: 'internal-pdf-viewer'},
                    {name: 'Microsoft Edge PDF Plugin', filename: 'internal-pdf-viewer'},
                    {name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer'}
                ]
            });

            // 4. window.chrome objeto completo
            window.chrome = {
                runtime: {},
                loadTimes: () => ({}),
                csi: () => ({}),
                app: {}
            };

            // 5. permissions API — devolve estado realista pra notifications
            const origQuery = window.navigator.permissions && window.navigator.permissions.query;
            if (origQuery) {
                window.navigator.permissions.query = (p) =>
                    p.name === 'notifications'
                        ? Promise.resolve({state: Notification.permission})
                        : origQuery(p);
            }

            // 6. WebGL vendor/renderer (Akamai checa)
            try {
                const getParameter = WebGLRenderingContext.prototype.getParameter;
                WebGLRenderingContext.prototype.getParameter = function(parameter) {
                    if (parameter === 37445) return 'Intel Inc.';
                    if (parameter === 37446) return 'Intel Iris OpenGL Engine';
                    return getParameter.call(this, parameter);
                };
            } catch(e) {}

            // 7. iframe contentWindow.chrome
            try {
                Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
                    get: function() {
                        const w = this.__lookupGetter__ ? this.__proto__.contentWindow : null;
                        return w;
                    }
                });
            } catch(e) {}

            // 8. hardwareConcurrency & deviceMemory realistas
            Object.defineProperty(navigator, 'hardwareConcurrency', {get: () => 8});
            Object.defineProperty(navigator, 'deviceMemory', {get: () => 8});
            """
        )

        # Bot Manager Akamai blocking DESATIVADO — quebra dependência do reCAPTCHA
        # ("Não foi possível conectar-se ao serviço reCAPTCHA"). Pra modo BFF é OK
        # porque BFF não usa clicks DOM, então não importa se Bot Manager monitora.
        # Pra modo DOM, Bot Manager pode cancelar clicks — mas reCAPTCHA é mais crítico.
        if os.getenv("MERCANTIL_BLOCK_AKAMAI", "0") == "1":
            async def _block_bot_manager(route):
                url = route.request.url
                if "rb_bf86592ucl" in url or "/akam/" in url:
                    await route.fulfill(status=200, content_type="application/javascript", body="")
                else:
                    await route.continue_()
            await ctx.route("**/*", _block_bot_manager)
            logger.info("mercantil Akamai bot manager blocked (env MERCANTIL_BLOCK_AKAMAI=1)")

        return ctx

    # ── Login com SMS bridge ────────────────────────────────────────────────

    async def login_with_sms(
        self,
        page: Page,
        user_id: str,
        run_id: str,
        emit: Callable[[dict], None] | None = None,
    ) -> bool:
        """Faz login no portal. Se storage_state já tem sessão válida, ignora SMS.
        Caso contrário pausa em BLPOP esperando o user enviar o código.

        Retorna True em sucesso, False se SMS falhou após N tentativas.
        """

        def _emit(payload: dict) -> None:
            if emit:
                try:
                    emit({**payload, "user_id": user_id, "run_id": run_id, "bank": "mercantil"})
                except Exception:
                    logger.exception("mercantil emit failed payload=%s", payload)

        # 1ª tentativa: vai direto pro dashboard. Se sessão válida, fica lá.
        try:
            await page.goto(self.cfg.dashboard_url, wait_until="domcontentloaded",
                            timeout=self.cfg.timeout_page)
        except Exception as e:
            logger.warning("mercantil goto dashboard falhou: %s", e)

        # Aguarda redirect client-side do Angular se houver
        await asyncio.sleep(3.0)

        # Confirma "logado" via elemento real do dashboard, não só URL.
        # URL pode mostrar /dashboard mesmo enquanto Angular ainda vai redirecionar pra /login.
        try:
            nova_proposta = page.locator(self.cfg.SEL_NOVA_PROPOSTA_BTN).first
            if await nova_proposta.count() > 0 and await nova_proposta.is_visible():
                logger.info("mercantil sessão reaproveitada user=%s (no SMS, btn dashboard visível)",
                            user_id)
                await self._save_state(page.context, user_id)
                return True
        except Exception:
            pass

        # Se URL contém /login OU não tem elemento de dashboard → precisa logar
        url_now = page.url or ""
        body_snip = ""
        try:
            body_snip = (await page.evaluate("() => document.body.innerText.substring(0,200)")) or ""
        except Exception:
            pass
        # Detecta Access Denied do Akamai
        if "access denied" in body_snip.lower() or "errors.edgesuite" in url_now:
            await self._screenshot(page, f"akamai_block_{user_id}")
            logger.error("mercantil AKAMAI BLOCK user=%s url=%s body=%s",
                         user_id, url_now, body_snip[:100])
            emit({"type": "akamai_blocked", "url": url_now})
            return False

        # Sem sessão válida → fluxo de login completo
        return await self._do_full_login(page, user_id, run_id, _emit)

    async def _do_full_login(
        self,
        page: Page,
        user_id: str,
        run_id: str,
        emit: Callable[[dict], None],
    ) -> bool:
        for attempt in range(1, self.cfg.sms_max_attempts + 1):
            logger.info("mercantil login attempt %d/%d user=%s", attempt, self.cfg.sms_max_attempts, user_id)
            try:
                await page.goto(self.cfg.portal_url, wait_until="domcontentloaded",
                                timeout=self.cfg.timeout_page)
                await page.wait_for_selector(self.cfg.SEL_LOGIN_USER,
                                             timeout=self.cfg.timeout_page, state="visible")
                await asyncio.sleep(1.0)

                # Fill via locator.fill() — não interpreta caracteres especiais (|, $, [, ~ etc)
                user_input = page.locator(self.cfg.SEL_LOGIN_USER).first
                await user_input.click()
                await user_input.fill("")
                await user_input.fill(self.login)
                await page.keyboard.press("Tab")
                await asyncio.sleep(0.3)

                pass_input = page.locator(self.cfg.SEL_LOGIN_PASS).first
                await pass_input.click()
                await pass_input.fill("")
                await pass_input.fill(self.password)
                await page.keyboard.press("Tab")
                await asyncio.sleep(0.5)

                # Click Entrar — tenta normal + force fallback
                btn = page.locator(self.cfg.SEL_LOGIN_BTN).first
                await btn.wait_for(state="visible", timeout=5000)
                user_val = await user_input.input_value()
                pass_val = await pass_input.input_value()
                logger.info("mercantil login pre-submit user_len=%d pass_len=%d", len(user_val), len(pass_val))
                try:
                    await btn.click(timeout=5000)
                except Exception:
                    await btn.click(force=True, timeout=3000)

                # Race: dashboard direto OU tela de SMS (timeout maior, SMS leva tempo)
                outcome = await self._await_dashboard_or_sms(page, timeout_s=45)

                if outcome == "dashboard":
                    logger.info("mercantil login direto (sem SMS) user=%s", user_id)
                    await self._save_state(page.context, user_id)
                    return True

                if outcome == "sms":
                    reason = "initial" if attempt == 1 else "wrong_code"
                    emit({"type": "sms_required", "reason": reason, "phone_hint": "-5744",
                          "attempt": attempt})
                    await sms_bridge.set_state(user_id, run_id, "waiting", ttl=self.cfg.sms_timeout_seconds + 30)

                    code = await sms_bridge.request_sms_code(
                        user_id, run_id, timeout=self.cfg.sms_timeout_seconds,
                    )
                    if not code:
                        emit({"type": "sms_timeout", "attempt": attempt})
                        logger.error("mercantil SMS timeout user=%s attempt=%d", user_id, attempt)
                        continue  # próxima tentativa: re-submete user/pass

                    ok = await self._fill_sms_and_verify(page, code)
                    if not ok:
                        logger.warning("mercantil SMS preenchimento falhou — re-tentando", )
                        continue

                    # Detecta resultado: dashboard (sucesso) ou volta pra SMS (código errado)
                    final = await self._await_dashboard_or_sms(page, timeout_s=20)
                    if final == "dashboard":
                        await sms_bridge.set_state(user_id, run_id, "done", ttl=5)
                        await sms_bridge.discard_code(user_id, run_id)
                        emit({"type": "sms_accepted"})
                        await self._save_state(page.context, user_id)
                        logger.info("mercantil login OK user=%s attempt=%d", user_id, attempt)
                        return True

                    # Voltou pra SMS → código errado
                    emit({"type": "sms_wrong_code", "attempt": attempt})
                    await sms_bridge.set_state(user_id, run_id, "wrong", ttl=10)
                    continue

                # Outcome desconhecido → screenshot debug
                logger.error("mercantil login outcome desconhecido url=%s", page.url)
                await self._screenshot(page, f"login_unknown_{user_id}")

            except Exception as e:
                logger.exception("mercantil login attempt %d crash: %s", attempt, e)
                await self._screenshot(page, f"login_crash_{user_id}")
                await asyncio.sleep(3)

        emit({"type": "sms_max_attempts"})
        await sms_bridge.set_state(user_id, run_id, "max_attempts", ttl=30)
        # Drop estado salvo — pode estar corrompido
        self._drop_state(user_id)
        return False

    async def _await_dashboard_or_sms(self, page: Page, timeout_s: int = 30) -> str:
        """Race entre URL = /dashboard e tela de SMS visível. Retorna 'dashboard' | 'sms' | 'unknown'."""
        deadline = asyncio.get_event_loop().time() + timeout_s
        while asyncio.get_event_loop().time() < deadline:
            url = page.url or ""
            if "/dashboard" in url and "/login" not in url:
                return "dashboard"
            # Heurística SMS: heading visível OU inputs maxlength=1 presentes
            try:
                sms_visible = await page.locator(self.cfg.SEL_SMS_HEADING).count() > 0
                if sms_visible:
                    return "sms"
            except Exception:
                pass
            try:
                inputs = await page.locator(self.cfg.SEL_SMS_INPUTS_PRIMARY).count()
                if inputs >= 6:
                    return "sms"
            except Exception:
                pass
            await asyncio.sleep(0.5)
        return "unknown"

    async def _fill_sms_and_verify(self, page: Page, code: str) -> bool:
        """Preenche os 6 inputs do token e clica 'Verificar código'.

        Estratégia: pega TODOS os inputs com maxlength=1 (típico Angular Material
        para campos de OTP), preenche um a um usando page.keyboard.type (para que
        Angular detecte input + keyup events corretamente). Fallback: keyboard
        digita 6 chars no primeiro input com auto-advance.
        """
        digits = re.sub(r"\D", "", code)
        if len(digits) != 6:
            logger.error("mercantil código SMS inválido (digits=%d)", len(digits))
            return False

        try:
            primary = page.locator(self.cfg.SEL_SMS_INPUTS_PRIMARY)
            count = await primary.count()
            logger.info("mercantil _fill_sms: %d inputs detectados", count)

            if count >= 6:
                # Click no primeiro input e digita os 6 dígitos com delay (deixa
                # Angular fazer auto-advance OR fallback per-input)
                first = primary.nth(0)
                await first.click(timeout=3000)
                await asyncio.sleep(0.2)
                # Tenta keyboard.type primeiro (deixa Angular auto-advance gerenciar)
                await page.keyboard.type(digits, delay=100)
                await asyncio.sleep(0.5)

                # Verifica se preencheu — se não, fallback manual per-input
                filled = 0
                for i in range(6):
                    try:
                        v = await primary.nth(i).input_value()
                        if v and v.strip():
                            filled += 1
                    except Exception:
                        pass
                logger.info("mercantil _fill_sms: %d/6 inputs preenchidos após keyboard.type", filled)

                if filled < 6:
                    # Fallback: per-input fill
                    for i in range(6):
                        try:
                            inp = primary.nth(i)
                            await inp.click(timeout=2000)
                            await inp.fill("")  # limpa
                            await inp.fill(digits[i])
                            await asyncio.sleep(0.15)
                        except Exception as e:
                            logger.warning("mercantil _fill_sms: input %d falhou: %s", i, e)
            else:
                inp = primary.first if count > 0 else page.locator(self.cfg.SEL_SMS_INPUTS_FALLBACK).first
                await inp.click(timeout=3000)
                await page.keyboard.type(digits, delay=100)

            await asyncio.sleep(0.8)

            # Tenta múltiplas variantes do botão Verificar (Angular Material)
            button_variants = [
                "button:has-text('Verificar código')",
                "button:has-text('Verificar')",
                "button:has-text('VERIFICAR')",
                "button:has-text('Continuar')",
                "button:has-text('Confirmar')",
                "button:has-text('Entrar')",
                "button[type='submit']",
                "button.mat-mdc-button:has-text('Verificar')",
                "button.mat-mdc-raised-button:has-text('Verificar')",
                "button.mat-flat-button:has-text('Verificar')",
                "mat-button:has-text('Verificar')",
                "[role='button']:has-text('Verificar')",
                "a:has-text('Verificar')",
                "a.pcb-button:has-text('Verificar')",
                "input[type='submit']",
            ]
            verify_clicked = False
            for sel in button_variants:
                try:
                    btn = page.locator(sel).first
                    if await btn.count() > 0 and await btn.is_visible():
                        try:
                            await btn.click(timeout=3000)
                            logger.info("mercantil _fill_sms: clicou via selector '%s'", sel)
                            verify_clicked = True
                            break
                        except Exception:
                            # tenta force click
                            await btn.click(force=True, timeout=2000)
                            logger.info("mercantil _fill_sms: force-click via '%s'", sel)
                            verify_clicked = True
                            break
                except Exception:
                    continue

            if not verify_clicked:
                logger.warning("mercantil _fill_sms: nenhum selector de botão funcionou, tirando screenshot + Enter")
                try:
                    await self._screenshot(page, "sms_no_verify_btn")
                except Exception:
                    pass
                # Dump dos botões visíveis pra diagnóstico
                try:
                    btns = await page.evaluate("""() => {
                        const out = [];
                        document.querySelectorAll('button, a, [role=button], input[type=submit]').forEach(el => {
                            if (el.offsetParent !== null) {
                                out.push({tag: el.tagName, text: (el.innerText||el.value||'').trim().substring(0,40), classes: el.className});
                            }
                        });
                        return out.slice(0, 20);
                    }""")
                    logger.warning("mercantil _fill_sms: botões visíveis na tela: %s", btns)
                except Exception:
                    pass
                await page.keyboard.press("Enter")
                await asyncio.sleep(1)

            return True
        except Exception as e:
            logger.exception("mercantil _fill_sms falhou: %s", e)
            try:
                await self._screenshot(page, "sms_fill_failed")
            except Exception:
                pass
            return False

    async def ensure_logged_in(
        self,
        page: Page,
        user_id: str,
        run_id: str,
        emit: Callable[[dict], None] | None = None,
    ) -> bool:
        """Garante que estamos no dashboard. Se URL = /login, faz re-login completo.
        Usar entre CPFs para detectar expiração de sessão mid-batch."""
        if "/login" not in (page.url or ""):
            return True
        # Sessão expirou; estado salvo provavelmente está stale
        self._drop_state(user_id)
        return await self._do_full_login(page, user_id, run_id, lambda p: emit(p) if emit else None)

    async def _screenshot(self, page: Page, label: str) -> None:
        try:
            tmpdir = Path("/tmp")
            tmpdir.mkdir(exist_ok=True)
            path = tmpdir / f"mercantil_{label}.png"
            await page.screenshot(path=str(path), full_page=True)
            logger.warning("mercantil screenshot saved %s", path)
        except Exception:
            pass
