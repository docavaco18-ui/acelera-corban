"""Login manual Mercantil — roda LOCAL no Mac (host, não Docker).

Fluxo:
1. Abre Chromium visível no Mac
2. Preenche login/senha automaticamente
3. NÃO clica Entrar — você clica
4. Você digita SMS no navegador real
5. Script aguarda dashboard (até 15min)
6. Ao detectar dashboard, salva storage_state pro backend usar via BFF
7. Fecha sozinho

Uso:
    cd ~/projetos/ACELERA\\ CORBAN
    python scripts/mercantil_manual_login.py

Variáveis (opcional, defaults embutidos):
    MERCANTIL_USER_ID  — user_id Supabase (default: bc72f4c3-...)
    MERCANTIL_LOGIN    — login portal
    MERCANTIL_PASS     — senha portal
"""
import asyncio
import os
import sys
from pathlib import Path

try:
    from playwright.async_api import async_playwright
except ImportError:
    print("\n[ERRO] playwright não instalado no host.")
    print("Instala: pip install playwright && playwright install chromium\n")
    sys.exit(1)

REPO_ROOT = Path(__file__).resolve().parent.parent
STATE_DIR = REPO_ROOT / "backend" / ".bot_state" / "mercantil"

LOGIN_URL = "https://meu.bancomercantil.com.br/login"
DASHBOARD_URL = "https://meu.bancomercantil.com.br/dashboard"

USER_ID = os.getenv("MERCANTIL_USER_ID", "bc72f4c3-472d-4f1a-831f-5cda1c539b92")
PORTAL_LOGIN = os.getenv("MERCANTIL_LOGIN", "35275CF.GABRIEL")
PORTAL_PASS = os.getenv("MERCANTIL_PASS", "zZB|;v8eoe5~J1$[_4/_%")

STATE_FILE = STATE_DIR / f"{USER_ID}.json"
MAX_WAIT_SECONDS = 15 * 60  # 15 min


async def wait_for_dashboard(page, max_seconds: int) -> bool:
    """Polla URL e elemento dashboard. Retorna True quando logado, False em timeout."""
    deadline = asyncio.get_event_loop().time() + max_seconds
    while asyncio.get_event_loop().time() < deadline:
        try:
            url = page.url or ""
            if "/dashboard" in url and "/login" not in url:
                # Confirma com elemento visível
                try:
                    nova = page.locator("button:has-text('Nova proposta'), a:has-text('Nova proposta')").first
                    if await nova.count() > 0 and await nova.is_visible():
                        return True
                except Exception:
                    pass
                # URL ok mesmo sem botão (dashboard pode variar)
                await asyncio.sleep(2)
                if "/dashboard" in (page.url or "") and "/login" not in (page.url or ""):
                    return True
        except Exception:
            pass
        await asyncio.sleep(2)
    return False


async def main():
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[manual-login] user_id={USER_ID}")
    print(f"[manual-login] storage_state path: {STATE_FILE}")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=False, slow_mo=80)

        ctx_args = {}
        if STATE_FILE.exists():
            ctx_args["storage_state"] = str(STATE_FILE)
            print(f"[manual-login] storage_state existente carregado")

        ctx = await browser.new_context(
            **ctx_args,
            geolocation={"latitude": -23.5505, "longitude": -46.6333},
            permissions=["geolocation"],
        )
        page = await ctx.new_page()

        try:
            await page.goto(DASHBOARD_URL, wait_until="domcontentloaded", timeout=30000)
        except Exception:
            await page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(2)

        # Sessão já válida?
        if "/dashboard" in (page.url or "") and "/login" not in (page.url or ""):
            try:
                nova = page.locator("button:has-text('Nova proposta'), a:has-text('Nova proposta')").first
                if await nova.count() > 0:
                    print("[manual-login] ✅ Sessão já válida — salvando storage_state")
                    await ctx.storage_state(path=str(STATE_FILE))
                    print(f"[manual-login] ✅ Sessão salva em {STATE_FILE}")
                    await browser.close()
                    return
            except Exception:
                pass

        # Garante que está na tela de login
        if "/login" not in (page.url or ""):
            await page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(2)

        # Preenche credenciais — NÃO clica Entrar
        print("[manual-login] preenchendo login/senha (sem clicar Entrar)…")
        try:
            user_input = page.locator('input[formcontrolname="login"]').first
            await user_input.click()
            await user_input.fill("")
            await user_input.fill(PORTAL_LOGIN)

            pass_input = page.locator('input[formcontrolname="senha"]').first
            await pass_input.click()
            await pass_input.fill("")
            await pass_input.fill(PORTAL_PASS)

            await page.keyboard.press("Tab")
        except Exception as e:
            print(f"[manual-login] ⚠️  erro preenchendo: {e}")
            print("[manual-login] navegador continua aberto — preencha manualmente.")

        print("\n" + "=" * 60)
        print("AGORA É CONTIGO:")
        print(" 1. Clique 'Entrar' no navegador")
        print(" 2. Espere o SMS chegar no celular")
        print(" 3. Digite o código no navegador")
        print(" 4. Aguarde chegar ao dashboard")
        print(f" 5. Script salva sessão automaticamente em até {MAX_WAIT_SECONDS//60}min")
        print("    (ou pode fechar o navegador manualmente quando quiser sair)")
        print("=" * 60 + "\n")

        ok = await wait_for_dashboard(page, MAX_WAIT_SECONDS)

        if ok:
            print("[manual-login] ✅ dashboard detectado — salvando storage_state")
            try:
                await ctx.storage_state(path=str(STATE_FILE))
                print(f"[manual-login] ✅ Sessão salva em {STATE_FILE}")
                print("[manual-login] Agora abra o dashboard e clique ⚡ Rodar BFF")
            except Exception as e:
                print(f"[manual-login] ❌ falha ao salvar: {e}")
        else:
            print(f"[manual-login] ⏰ timeout {MAX_WAIT_SECONDS}s sem chegar ao dashboard")
            print("[manual-login] tente de novo")

        try:
            await browser.close()
        except Exception:
            pass


if __name__ == "__main__":
    asyncio.run(main())
