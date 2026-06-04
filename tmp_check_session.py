"""Quick check: what's on the page after navigation."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

STATE_DIR = Path(__file__).parent / "backend/.bot_state/mercantil"
USER_ID = "545ca793-1c1d-4b4a-a08a-da92f1cf9560"


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox"]
        )
        ctx = await browser.new_context(
            storage_state=str(STATE_DIR / f"{USER_ID}.json"),
            locale="pt-BR",
        )
        page = await ctx.new_page()

        await page.goto("https://meu.bancomercantil.com.br/dashboard",
                        wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(6)

        url = page.url
        title = await page.title()
        body_text = await page.evaluate("() => document.body.innerText.substring(0, 500)")
        html_snip = await page.evaluate("() => document.documentElement.innerHTML.substring(0, 800)")

        print(f"URL: {url}")
        print(f"Title: {title}")
        print(f"Body text:\n{body_text}")
        print(f"\nHTML snippet:\n{html_snip}")

        await browser.close()

asyncio.run(main())
