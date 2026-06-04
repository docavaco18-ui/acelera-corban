"""Login-only: abre browser headed, faz login, deixa aberto pra inspeção manual."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

LOGIN_URL    = "https://meu.bancomercantil.com.br/login"
PORTAL_LOGIN = "35275CF.GABRIEL"
PORTAL_PASS  = "zZB|;v8eoe5~J1$[_4/_%"
STATE_DIR    = Path(__file__).parent / "backend/.bot_state/mercantil"
STATE_FILE   = STATE_DIR / "bc72f4c3-472d-4f1a-831f-5cda1c539b92.json"


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=False, slow_mo=50)

        ctx_args = {}
        if STATE_FILE.exists():
            ctx_args["storage_state"] = str(STATE_FILE)
            print(f"[LOGIN] Usando storage state: {STATE_FILE}")

        ctx = await browser.new_context(
            **ctx_args,
            geolocation={"latitude": -23.5505, "longitude": -46.6333},
            permissions=["geolocation"],
        )
        page = await ctx.new_page()

        await page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(2)

        if "dashboard" in page.url or "simular" in page.url:
            print("[LOGIN] ✅ Sessão válida — direto no dashboard")
        else:
            print("[LOGIN] Preenchendo credenciais...")
            await page.locator('input[formcontrolname="login"]').fill(PORTAL_LOGIN)
            await page.locator('input[formcontrolname="senha"]').fill(PORTAL_PASS)
            await page.locator("button:has-text('Entrar')").click()
            await asyncio.sleep(3)

            if "sms" in page.url.lower() or "token" in page.url.lower() or await page.locator("text=/Insira o token/i").count():
                print("[LOGIN] Tela SMS — digite o código abaixo:")
                code = input(">>> Código SMS (6 dígitos): ").strip()
                inputs = page.locator('input[maxlength="1"]')
                for i, d in enumerate(code):
                    await inputs.nth(i).fill(d)
                await page.locator("button:has-text('Verificar')").click()
                await asyncio.sleep(3)

            if "dashboard" in page.url or "simular" in page.url:
                print("[LOGIN] ✅ Login OK")
                if not STATE_FILE.parent.exists():
                    STATE_FILE.parent.mkdir(parents=True)
                await ctx.storage_state(path=str(STATE_FILE))
                print(f"[LOGIN] Storage state salvo: {STATE_FILE}")
            else:
                print(f"[LOGIN] ❌ URL inesperada: {page.url}")

        print("\n[LOGIN] Browser aberto. Pressiona Enter pra fechar.")
        input(">>> ")
        await browser.close()


asyncio.run(main())
