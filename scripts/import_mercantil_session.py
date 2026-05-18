"""Importa session do Chrome real do user pra storage_state Playwright.

Uso:
    python3 scripts/import_mercantil_session.py < /tmp/dump.json
    OU
    python3 scripts/import_mercantil_session.py   (cola e Ctrl+D)

Input: JSON do bookmark do console DevTools com formato:
    {"url":"...", "cookies":"k=v; k=v", "localStorage":{...}, "sessionStorage":{...}}

Output: backend/.bot_state/mercantil/{user_id}.json (storage_state Playwright)
"""
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

USER_ID = os.getenv("MERCANTIL_USER_ID", "bc72f4c3-472d-4f1a-831f-5cda1c539b92")
REPO_ROOT = Path(__file__).resolve().parent.parent
STATE_DIR = REPO_ROOT / "backend" / ".bot_state" / "mercantil"
STATE_FILE = STATE_DIR / f"{USER_ID}.json"


def parse_cookies(cookie_str: str, domain: str) -> list[dict]:
    out = []
    for pair in cookie_str.split(";"):
        pair = pair.strip()
        if not pair or "=" not in pair:
            continue
        name, _, value = pair.partition("=")
        out.append({
            "name": name.strip(),
            "value": value.strip(),
            "domain": domain,
            "path": "/",
            "expires": -1,
            "httpOnly": False,
            "secure": True,
            "sameSite": "Lax",
        })
    return out


def main():
    print("[import] cole o JSON do console DevTools e termine com Ctrl+D:", file=sys.stderr)
    raw = sys.stdin.read().strip()
    if not raw:
        print("[import] ❌ vazio", file=sys.stderr)
        sys.exit(1)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"[import] ❌ JSON inválido: {e}", file=sys.stderr)
        sys.exit(1)

    url = data.get("url") or "https://meu.bancomercantil.com.br/dashboard"
    parsed = urlparse(url)
    domain = parsed.hostname or "meu.bancomercantil.com.br"
    origin = f"{parsed.scheme}://{parsed.hostname}"

    cookies = parse_cookies(data.get("cookies") or "", domain)
    local = data.get("localStorage") or {}
    session = data.get("sessionStorage") or {}

    storage_state = {
        "cookies": cookies,
        "origins": [{
            "origin": origin,
            "localStorage": [{"name": k, "value": v} for k, v in local.items()],
        }],
    }

    STATE_DIR.mkdir(parents=True, exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(storage_state, f, indent=2, ensure_ascii=False)

    pcb = local.get("PCB_AUTH")
    print(f"[import] ✅ salvou {STATE_FILE}")
    print(f"[import]   cookies: {len(cookies)}")
    print(f"[import]   localStorage keys: {list(local.keys())}")
    print(f"[import]   sessionStorage keys: {list(session.keys())}")
    if pcb:
        print(f"[import]   PCB_AUTH presente (len={len(pcb)})")
    else:
        print("[import]   ⚠️  PCB_AUTH ausente — BFF não vai funcionar")


if __name__ == "__main__":
    main()
