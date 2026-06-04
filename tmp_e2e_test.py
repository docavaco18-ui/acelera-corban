"""
E2E test — login headless + bff_bridge via page.evaluate.

Usage: python3 tmp_e2e_test.py [cpf1 cpf2 ...]
       (default: usa 5 CPFs do /tmp/mercantil_janeiro_50.csv)
"""
import asyncio
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "backend"))

from playwright.async_api import async_playwright

LOGIN_URL   = "https://meu.bancomercantil.com.br/login"
DASH_URL    = "https://meu.bancomercantil.com.br/dashboard"
PORTAL_LOGIN = "35275CF.GABRIEL"
PORTAL_PASS  = "zZB|;v8eoe5~J1$[_4/_%"
STATE_DIR   = Path(__file__).parent / "backend/.bot_state/mercantil"
USER_ID     = "bc72f4c3-472d-4f1a-831f-5cda1c539b92"

# BFF bridge JS (same as bff_bridge._FETCH_JS)
_FETCH_JS = """
async ({method, url, body}) => {
    let jwt=null, sessaoId='', mbData={};
    for(let i=0;i<localStorage.length;i++){
        const k=localStorage.key(i);const v=localStorage.getItem(k);
        if(!v)continue;
        if(v.startsWith('ey')&&v.split('.').length>=3){jwt=v;break;}
        if(v.startsWith('{')){try{const o=JSON.parse(v);for(const tk of ['access_token','token','accessToken','jwt']){const t=o[tk];if(t&&typeof t==='string'&&t.startsWith('ey')){jwt=t;break;}}if(jwt)break;}catch(e){}}
    }
    if(!jwt)return{ok:false,status:0,error:'JWT_NOT_FOUND'};
    try{const r=jwt.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');const p=r+'==='.slice(0,(4-r.length%4)%4);const pl=JSON.parse(atob(p));const mb=pl['mb.data']||(pl.mb&&pl.mb.data)||{};sessaoId=(mb.usuario&&mb.usuario.sessaoId)||'';mbData=mb;}catch(e){}
    const h={'Content-Type':'application/json','Accept':'application/json, text/plain, */*','Authorization':'Bearer '+jwt,'X-Requested-With':'XMLHttpRequest'};
    if(sessaoId)h['sessaousuarioid']=sessaoId;
    const opts={method,headers:h};
    if(body)opts.body=JSON.stringify(body);
    try{const resp=await fetch(url,opts);let data;try{data=await resp.json();}catch(e){data=await resp.text();}return{ok:resp.ok,status:resp.status,data,jwt,sessaoId,mbData};}
    catch(e){return{ok:false,status:0,error:String(e)};}
}
"""

BFF_BASE = "https://api.mercantil.com.br:8443/pcb/sitebff/api"
EMPRESA_ID = 2


async def bff(page, method, path, body=None):
    url = f"{BFF_BASE}/{path}"
    r = await page.evaluate(_FETCH_JS, {"method": method, "url": url, "body": body})
    if r.get("error"):
        raise RuntimeError(f"BFF error: {r['error']}")
    if not r.get("ok"):
        raise RuntimeError(f"BFF HTTP {r['status']}: {str(r.get('data',''))[:200]}")
    return r


async def get_mte_convenio(page):
    r = await bff(page, "GET", "Convenios")
    for c in r["data"]:
        if "MINISTERIO DO TRABALHO" in (c.get("nome") or "").upper():
            return c
    raise RuntimeError("MTE convenio not found")


async def consultar_cpf(page, cpf, sessao, convenio, poll_interval=8, poll_max=120):
    cpf_digits = re.sub(r"\D", "", cpf)
    corr = sessao.get("correspondente") or {}
    sub  = sessao.get("substabelecido") or {}
    usr  = sessao.get("usuario") or {}
    body = {
        "empresaId": EMPRESA_ID,
        "cpfCliente": int(cpf_digits),
        "cnpjCorrespondente": corr.get("cnpj"),
        "correspondenteId": corr.get("id"),
        "correspondenteNome": corr.get("nome"),
        "cnpjSubstabelecido": sub.get("cnpj"),
        "substabelecidoId": sub.get("id"),
        "substabelecidoNome": sub.get("nome"),
        "usuarioDigitadorId": usr.get("codigo"),
        "usuarioDigitadorNome": usr.get("nome"),
        "convenioId": convenio.get("id"),
        "convenioNome": convenio.get("nome"),
        "uf": "SP",
        "sessaoId": sessao.get("sessaoId", ""),
        "modalidadeConvenio": convenio.get("modalidadeConvenio"),
        "reCaptchaToken": None,
    }

    r = await bff(page, "POST", "PropostasProspect/IniciarOperacao", body)
    d = r["data"]
    uuid  = d.get("id")
    nome  = d.get("nomeCliente", "")
    token = d.get("tokenValidoConsignadoPrivado", False)
    print(f"  IniciarOperacao: uuid={uuid} tokenValido={token} nome={nome}")

    if not uuid:
        return {"status": "erro", "erro": f"sem uuid: {str(d)[:200]}"}

    if not token:
        return {"status": "aguardando_autorizacao", "cenario": "B", "uuid_portal": uuid, "nome": nome}

    # Cenário A — tenta endpoints de trigger antes de poll
    trigger_endpoints = [
        ("POST", f"PropostasProspect/{uuid}/SolicitarConsulta"),
        ("POST", f"PropostasProspect/{uuid}/IniciarConsulta"),
        ("POST", f"PropostasProspect/{uuid}/Consultar"),
        ("POST", f"PropostasProspect/{uuid}/Processar"),
    ]
    for method, path in trigger_endpoints:
        try:
            tr = await bff(page, method, path, {})
            print(f"  [TRIGGER] {path} → {tr.get('status')} {str(tr.get('data',''))[:100]}")
            break  # primeiro que não der erro
        except Exception as e:
            print(f"  [TRIGGER] {path} → ERRO {e}")

    # Cenário A — poll
    import time
    _first_debug_done = [False]
    deadline = time.monotonic() + poll_max
    while time.monotonic() < deadline:
        det_r = await bff(page, "GET", f"PropostasProspect/{uuid}/Detalhes")
        det   = det_r["data"]
        pe    = det.get("propostaEmprestimo") or {}
        vl    = pe.get("valorLiberado")
        st    = det.get("status", "")
        token = det.get("tokenValidoConsignadoPrivado")
        link  = det.get("linkEncurtadoAutorizacaoDigitalConsignadoPrivado")
        # Sempre dump na primeira poll de cada CPF
        if not _first_debug_done[0]:
            _first_debug_done[0] = True
            print(f"  [DEBUG] Detalhes completo: {json.dumps(det, ensure_ascii=False)[:1000]}")
        print(f"  poll: status={st} valorLiberado={vl} tokenValido={token} link={str(link)[:60] if link else None}")
        if vl is not None:
            if vl <= 0:
                return {"status": "inelegivel", "uuid_portal": uuid, "nome": (det.get("cliente") or {}).get("nome", nome)}
            return {
                "status": "elegivel", "cenario": "A",
                "uuid_portal": uuid,
                "nome": (det.get("cliente") or {}).get("nome", nome),
                "valor_liberado": vl,
                "valor_parcela": pe.get("valorParcela"),
                "qtd_parcelas": pe.get("quantidadeParcelas"),
                "taxa_juros_mes": pe.get("taxaJurosMes"),
                "valor_financiado": pe.get("valorFinanciado"),
                "valor_emprestimo": pe.get("valorEmprestimo"),
                "valor_iof": pe.get("valorIof"),
                "data_vencimento": pe.get("dataPrimeiroVencimento"),
            }
        # tokenValido virou False durante poll → Cenário B
        if token is False and st in ("Digitacao", "AguardandoAutorizacao"):
            return {"status": "aguardando_autorizacao", "cenario": "B",
                    "uuid_portal": uuid, "nome": nome, "link_autorizacao": link}
        await asyncio.sleep(poll_interval)

    return {"status": "erro", "erro": "timeout", "uuid_portal": uuid}


async def do_login(page):
    """Login com SMS. Lê código do terminal."""
    # Limpa estado antigo que pode causar conflito com toast "sessão expirou"
    print("[LOGIN] Limpando estado antigo...")
    try:
        await page.context.clear_cookies()
        await page.evaluate("() => { try { localStorage.clear(); sessionStorage.clear(); } catch(e) {} }")
    except Exception:
        pass

    print("[LOGIN] Navegando para portal...")
    await page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=30000)
    await asyncio.sleep(3)

    # Preenche user/pass
    u = page.locator("input[formcontrolname='usuario'], input[name='usuario'], input[type='text']").first
    await u.click()
    await page.keyboard.type(PORTAL_LOGIN, delay=50)
    await page.keyboard.press("Tab")
    await asyncio.sleep(0.3)

    p = page.locator("input[formcontrolname='senha'], input[name='senha'], input[type='password']").first
    await p.click()
    await page.keyboard.type(PORTAL_PASS, delay=50)
    await page.keyboard.press("Tab")
    await asyncio.sleep(0.5)

    btn = page.locator("button[type='submit'], button:has-text('Entrar')").first
    await btn.click()
    await asyncio.sleep(3)

    sms_entered = False

    # Espera SMS ou dashboard (até 60s)
    for _ in range(60):
        url = page.url
        if "/dashboard" in url:
            if sms_entered:
                print("[LOGIN] Dashboard OK após SMS!")
            else:
                print("[LOGIN] Dashboard direto (sem SMS)")
            return True

        if not sms_entered:
            inputs = await page.locator("input[maxlength='1']").count()
            if inputs >= 6:
                sms_file = Path("/tmp/mercantil_sms.txt")
                if sms_file.exists():
                    sms_file.unlink()
                print(f"\n[SMS] Código enviado pro celular final -5744")
                print(f"[SMS] Escreva o código em /tmp/mercantil_sms.txt — ex: echo 123456 > /tmp/mercantil_sms.txt")
                # Poll até 5min
                code = None
                for _ in range(300):
                    if sms_file.exists():
                        try:
                            code = sms_file.read_text().strip()
                            sms_file.unlink()
                            if code:
                                break
                        except Exception:
                            pass
                    await asyncio.sleep(1)
                if not code:
                    print("[SMS] Timeout aguardando /tmp/mercantil_sms.txt")
                    return False
                digits = re.sub(r"\D", "", code)
                if len(digits) != 6:
                    print(f"[SMS] Código inválido: '{code}' → '{digits}'")
                    return False
                print(f"[SMS] Código recebido: {digits}")
                first = page.locator("input[maxlength='1']").first
                await first.click()
                await page.keyboard.type(digits, delay=100)
                await asyncio.sleep(1)
                for sel in ["button:has-text('Verificar código')", "button:has-text('Verificar')", "button[type='submit']"]:
                    btn2 = page.locator(sel).first
                    if await btn2.count() > 0:
                        await btn2.click()
                        break
                sms_entered = True
                print("[LOGIN] Código enviado, aguardando dashboard...")

        await asyncio.sleep(1)

    print(f"[LOGIN] Timeout. URL atual: {page.url}")
    return False


CSV_INPUT  = "/tmp/mercantil_30_erros.csv"
CSV_OUTPUT = "/tmp/mercantil_30_erros_resultado.csv"


def _load_output_csv():
    """Retorna set de CPFs já processados no output CSV."""
    done = set()
    out = Path(CSV_OUTPUT)
    if out.exists():
        with open(out) as f:
            next(f, None)
            for line in f:
                c = line.split(",")[0].strip()
                if c:
                    done.add(c)
    return done


def _write_result(resultado):
    """Appenda resultado no output CSV, criando header se necessário."""
    out = Path(CSV_OUTPUT)
    header_needed = not out.exists()
    with open(out, "a", newline="") as f:
        import csv as _csv
        w = _csv.DictWriter(f, fieldnames=["cpf", "status", "valor_liberado", "valor_parcela", "prazo", "erro"], extrasaction="ignore")
        if header_needed:
            w.writeheader()
        w.writerow({
            "cpf": resultado.get("cpf", ""),
            "status": resultado.get("status", ""),
            "valor_liberado": resultado.get("valor_liberado", ""),
            "valor_parcela": resultado.get("valor_parcela", ""),
            "prazo": resultado.get("prazo", ""),
            "erro": resultado.get("erro", ""),
        })


async def main():
    # CPFs: args ou CSV
    if len(sys.argv) > 1:
        cpfs = [re.sub(r"\D", "", a) for a in sys.argv[1:]]
    else:
        cpfs = []
        try:
            with open(CSV_INPUT) as f:
                next(f)
                for line in f:
                    c = re.sub(r"\D", "", line.split(",")[0])
                    if len(c) == 11:
                        cpfs.append(c)
        except Exception:
            print("CSV não encontrado, use: python3 tmp_e2e_test.py <cpf1> <cpf2> ...")
            sys.exit(1)

    # Resume: pula CPFs já processados
    done = _load_output_csv()
    if done:
        before = len(cpfs)
        cpfs = [c for c in cpfs if c not in done]
        print(f"[RESUME] {before - len(cpfs)} CPFs já processados, {len(cpfs)} restantes")

    print(f"CPFs para processar: {len(cpfs)}")

    # Apaga storage state expirado para evitar conflito de sessão
    state_file = STATE_DIR / f"{USER_ID}.json"
    if state_file.exists():
        state_file.unlink()
        print(f"[SETUP] Storage state antigo removido (sessão expirada)")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=False,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox", "--start-maximized"],
        )
        ctx = await browser.new_context(
            storage_state=None,
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            locale="pt-BR",
            timezone_id="America/Sao_Paulo",
            geolocation={"latitude": -23.5505, "longitude": -46.6333},
            permissions=["geolocation"],
        )
        await ctx.add_init_script("""
            Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
            Object.defineProperty(navigator,'languages',{get:()=>['pt-BR','pt','en-US','en']});
            window.chrome={runtime:{},loadTimes:()=>({}),csi:()=>({}),app:{}};
        """)
        page = await ctx.new_page()

        # Tenta dashboard primeiro
        await page.goto(DASH_URL, wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(4)

        if "/login" in (page.url or ""):
            ok = await do_login(page)
            if not ok:
                print("LOGIN FALHOU")
                await browser.close()
                return
            # Salva novo storage state após login bem-sucedido
            try:
                STATE_DIR.mkdir(parents=True, exist_ok=True)
                await ctx.storage_state(path=str(state_file))
                print(f"[SETUP] Novo storage state salvo em {state_file}")
            except Exception as e:
                print(f"[SETUP] Aviso: não salvou storage state: {e}")

        # Aguarda JWT no localStorage
        print("[BFF] Aguardando JWT no localStorage...")
        try:
            await page.wait_for_function("""
                () => {
                    for(let i=0;i<localStorage.length;i++){
                        const v=localStorage.getItem(localStorage.key(i))||'';
                        if(v.startsWith('ey')&&v.split('.').length>=3)return true;
                        if(v.startsWith('{')){try{const o=JSON.parse(v);for(const k of ['access_token','token','accessToken']){if(o[k]&&String(o[k]).startsWith('ey'))return true;}}catch(e){}}
                    }
                    return false;
                }
            """, timeout=30000)
            print("[BFF] JWT encontrado no localStorage!")
        except Exception:
            # Debug: mostra o que tem no localStorage
            ls_debug = await page.evaluate("""
            () => {
                const out = {};
                for(let i=0;i<localStorage.length;i++){
                    const k=localStorage.key(i);
                    const v=localStorage.getItem(k)||'';
                    out[k] = v.length > 100 ? v.substring(0,100)+'...' : v;
                }
                return out;
            }
            """)
            print(f"[DEBUG] localStorage keys: {list(ls_debug.keys())}")
            for k, v in ls_debug.items():
                print(f"  {k}: {v[:80]}")
            print("[BFF] JWT não encontrado após 15s")
            await browser.close()
            return

        # Extrai sessão
        sess_r = await page.evaluate("""
        () => {
            let jwt=null,mbData={};
            for(let i=0;i<localStorage.length;i++){
                const k=localStorage.key(i);const v=localStorage.getItem(k);
                if(!v)continue;
                if(v.startsWith('ey')&&v.split('.').length>=3){jwt=v;break;}
                if(v.startsWith('{')){try{const o=JSON.parse(v);for(const tk of ['access_token','token']){const t=o[tk];if(t&&typeof t==='string'&&t.startsWith('ey')){jwt=t;break;}}if(jwt)break;}catch(e){}}
            }
            if(!jwt)return{jwt:null,mbData:{},sessaoId:''};
            let sessaoId='';
            try{const r=jwt.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');const p=r+'==='.slice(0,(4-r.length%4)%4);const pl=JSON.parse(atob(p));const mb=pl['mb.data']||(pl.mb&&pl.mb.data)||{};sessaoId=(mb.usuario&&mb.usuario.sessaoId)||'';mbData=mb;}catch(e){}
            return{jwt,mbData,sessaoId};
        }
        """)
        mb = sess_r.get("mbData") or {}
        sessao = {
            "jwt": sess_r.get("jwt"),
            "sessaoId": sess_r.get("sessaoId", ""),
            "correspondente": mb.get("correspondente") or {},
            "substabelecido": mb.get("substabelecido") or {},
            "usuario": mb.get("usuario") or {},
        }
        print(f"[BFF] Sessão: correspondente={sessao['correspondente'].get('nome')} usuario={sessao['usuario'].get('nome')}")

        # Salva JWT pra outros scripts
        jwt_path = STATE_DIR / "last_jwt.json"
        jwt_path.write_text(json.dumps({"access_token": sess_r.get("jwt"), "sessao_id": sessao["sessaoId"]}))
        print(f"[BFF] JWT salvo em {jwt_path}")

        # ── TESTE DOM CLICK — loop por todos os CPFs ────────────────────────────
        import time as _time

        async def capture_bff(request):
            if "sitebff" in request.url:
                print(f"[NET] {request.method} {request.url.split('/api/')[-1]}")
        page.on("request", capture_bff)

        _INELIG_KEYWORDS = ("não possui margem", "nao possui margem",
                            "política de crédito", "politica de credito",
                            "sem margem")

        resultados = []
        _total = len(cpfs)
        for _idx, cpf in enumerate(cpfs, 1):
            print(f"\n{'='*55}")
            print(f"[DOM-TEST] [{_idx}/{_total}] CPF {cpf}...")
            resultado_cpf = {"cpf": cpf, "status": "erro", "erro": ""}
            try:
                # PASSO 1 — Dashboard → "Nova proposta"
                await page.goto(DASH_URL, wait_until="domcontentloaded", timeout=30000)
                await asyncio.sleep(2)

                # Session expiry: se redirecionou pro login, re-loga
                if "/login" in (page.url or ""):
                    print("[SESSION] Sessão expirou — re-login...")
                    ok = await do_login(page)
                    if not ok:
                        print("[SESSION] Re-login falhou. Abortando.")
                        break
                    await page.goto(DASH_URL, wait_until="domcontentloaded", timeout=30000)
                    await asyncio.sleep(2)

                await page.locator("button:has-text('Digite aqui uma nova proposta')").first.click()
                await page.wait_for_url("**/simular-proposta**", timeout=15000)
                await asyncio.sleep(2)

                # PASSO 2 — UF
                selects = page.locator("mat-select")
                await selects.nth(0).click()
                await asyncio.sleep(0.5)
                await page.locator("mat-option:has-text('SP')").first.click()
                await asyncio.sleep(0.5)

                # PASSO 3 — Convênio
                await selects.nth(1).click()
                await asyncio.sleep(1)
                await page.locator("mat-option:has-text('MINISTERIO DO TRABALHO')").first.click()
                await asyncio.sleep(1)

                # PASSO 4 — CPF
                cpf_input = page.locator("input[mask='000.000.000-00']").first
                await cpf_input.click()
                await page.keyboard.type(cpf, delay=80)
                await asyncio.sleep(0.5)

                # PASSO 5 — Instituição (pula se desabilitada)
                await asyncio.sleep(1)
                inst_select = selects.nth(2)
                if await inst_select.count() > 0:
                    if await inst_select.get_attribute("aria-disabled") != "true":
                        await inst_select.click()
                        await asyncio.sleep(0.5)
                        first_opt = page.locator("mat-option").first
                        if await first_opt.count() > 0:
                            await first_opt.click()
                        await asyncio.sleep(0.5)

                # PASSO 6 — Consultar
                await page.locator("button:has-text('Consultar')").first.click()

                # Variável 1: toast "politicas do banco" = CPF bloqueado antes de Nova operação
                # Procura SOMENTE em snack-bar/toast/dialog, NÃO no body inteiro
                # (evita falso positivo de banner global persistente).
                await asyncio.sleep(1.5)
                _toast_text = ""
                try:
                    _toast_text = (await page.evaluate("""
                        () => {
                            const sels = ['mat-snack-bar-container', '[role=\"alert\"]',
                                          '.mat-snack-bar-container', 'mat-dialog-container',
                                          '.cdk-overlay-container'];
                            let parts = [];
                            for (const s of sels) {
                                document.querySelectorAll(s).forEach(el => {
                                    if (el.offsetParent !== null) parts.push(el.innerText || '');
                                });
                            }
                            return parts.join(' | ');
                        }
                    """)) or ""
                except Exception:
                    pass
                _toast_low = _toast_text.lower()
                if ("politicas do banco" in _toast_low or "não é possível digitar" in _toast_low
                        or "nao e possivel digitar" in _toast_low):
                    resultado_cpf = {"cpf": cpf, "status": "inelegivel", "erro": "bloqueado política do banco"}
                    print(f"[DOM-TEST] Variável 1: ❌ CPF bloqueado — política do banco")
                    print(f"[DOM-TEST] TOAST snippet: {_toast_text[:200]}")
                    try:
                        _sp = f"/tmp/mercantil_screenshots_30/{cpf}_var1.png"
                        await page.screenshot(path=_sp, full_page=True)
                        print(f"[SCREENSHOT] {_sp}")
                    except Exception:
                        pass
                    resultados.append(resultado_cpf)
                    _write_result(resultado_cpf)
                    _elegiveis = sum(1 for r in resultados if r.get("status") == "elegivel")
                    print(f"[PROGRESS] {_idx}/{_total} | elegíveis: {_elegiveis} | output: {CSV_OUTPUT}")
                    await asyncio.sleep(3)
                    continue

                # PASSO 7 — Nova operação
                nova_op = page.locator(
                    "a:has-text('Nova operação'), button:has-text('Nova operação'), "
                    "[class*='pcb-button']:has-text('Nova operação')"
                ).first
                await nova_op.wait_for(state="visible", timeout=15000)
                await nova_op.click()

                # PASSO 8 — Aguarda redirect pra cenário A ou B
                await page.wait_for_url(
                    re.compile(r"/(consignado-privado|solicitar-dataprev)/[0-9a-f-]{36}", re.IGNORECASE),
                    timeout=20000,
                )
                url_final = page.url
                print(f"[DOM-TEST] ✅ {url_final}")

                if "solicitar-dataprev" in url_final:
                    # Cenário B — DataPrev: preenche telefone → Solicitar → copia link → Plurio
                    import random as _random
                    dds = ["11","21","31","41","51","61","71","81","85","86","87","88","91","92","93","94","95","96","97","98","99"]
                    dd = _random.choice(dds)
                    tel_rand = f"{dd}9{''.join([str(_random.randint(0,9)) for _ in range(8)])}"
                    print(f"[DOM-TEST] Cenário B — preenchendo telefone {tel_rand[:2]}-9****")

                    tel_input = page.locator("input[mask='(00) 00000-0000']").first
                    await tel_input.click()
                    await page.keyboard.type(tel_rand, delay=60)
                    await asyncio.sleep(0.5)
                    await page.locator("button:has-text('Solicitar')").first.click()
                    print("[DOM-TEST] Solicitar clicado!")

                    # Variável 4: race entre link Plurio (input[readonly]) e redirect
                    # direto pra consignado-privado com produtos já disponíveis
                    # (DataPrev já autorizado em sessão anterior — sem link)
                    _plurio_skip = False
                    plurio_url = None
                    _race_deadline = _time.monotonic() + 25
                    while _time.monotonic() < _race_deadline:
                        _cur = page.url or ""
                        # Variável 4: redirect direto pra consignado-privado com produtos visíveis
                        if "consignado-privado" in _cur:
                            _hd = page.locator("text=/Produtos disponíveis/i").first
                            if await _hd.count() > 0 and await _hd.is_visible():
                                print("[DOM-TEST] Variável 4: ✅ DataPrev já autorizado — produtos visíveis, skip Plurio")
                                _plurio_skip = True
                                url_final = _cur
                                break
                        # Link Plurio em input[readonly]
                        _lnk = page.locator("input[readonly]").first
                        if await _lnk.count() > 0:
                            _val = await _lnk.input_value()
                            if _val and ("bml.b.br" in _val or "autorizac" in _val):
                                plurio_url = _val
                                print(f"[DOM-TEST] Link Plurio obtido: {plurio_url[:60]}...")
                                break
                        await asyncio.sleep(0.5)

                    if not _plurio_skip and not plurio_url:
                        raise Exception("Cenário B: timeout sem link Plurio e sem redirect consignado-privado")

                    if not _plurio_skip and plurio_url:
                        async def _plurio_etapa(ppage, btn_text):
                            """Marca checkbox e clica botão, aguarda enabled."""
                            cb = ppage.locator("input.mdc-checkbox__native-control").first
                            await cb.wait_for(state="visible", timeout=15000)
                            await cb.check()
                            await asyncio.sleep(0.5)
                            btn = ppage.locator(f"button:has-text('{btn_text}')").first
                            for _ in range(30):  # aguarda até 9s
                                disabled = await btn.get_attribute("disabled")
                                cls = (await btn.get_attribute("class")) or ""
                                if disabled is None and "disabled" not in cls:
                                    break
                                await asyncio.sleep(0.3)
                            await btn.click(timeout=15000)
                            print(f"[DOM-TEST] Plurio: '{btn_text}' clicado!")

                        # Abre Plurio em nova aba
                        plurio_page = await page.context.new_page()
                        await plurio_page.goto(plurio_url, wait_until="domcontentloaded", timeout=30000)
                        await asyncio.sleep(2)

                        # Etapa 1 de 2
                        await _plurio_etapa(plurio_page, "Iniciar")
                        await asyncio.sleep(2)

                        # Etapa 2 de 2
                        await _plurio_etapa(plurio_page, "Autorizar")
                        await asyncio.sleep(2)

                        # Aguarda sucesso
                        sucesso_sel = "div#sucesso, div.tela-finalizadora, li.ok"
                        try:
                            await plurio_page.locator(sucesso_sel).first.wait_for(state="visible", timeout=20000)
                            print("[DOM-TEST] ✅ Plurio: assinatura com sucesso!")
                        except Exception:
                            body_p = (await plurio_page.evaluate("() => document.body.innerText || ''")).lower()
                            if "finalizamos" in body_p or "sucesso" in body_p:
                                print("[DOM-TEST] ✅ Plurio: texto sucesso detectado!")
                            else:
                                print(f"[DOM-TEST] ⚠️ Plurio: resultado incerto — {body_p[:200]}")

                        await plurio_page.close()
                        print("[DOM-TEST] Plurio fechado — voltando ao banco...")
                        await asyncio.sleep(3)

                        # Navega pro consignado-privado
                        uuid_b = re.search(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", url_final)
                        uuid_b_str = uuid_b.group(0) if uuid_b else ""
                        consignado_url = f"https://meu.bancomercantil.com.br/consignado-privado/{uuid_b_str}"
                        await page.goto(consignado_url, wait_until="domcontentloaded", timeout=30000)
                        url_final = page.url

                if "consignado-privado" in url_final:
                    # Fase 2 — poll Produtos disponíveis
                    deadline2 = _time.monotonic() + 300
                    auto_navigated = False
                    _var3_inelig = False
                    while _time.monotonic() < deadline2:
                        cur = page.url or ""
                        if "/simulacao/" in cur:
                            auto_navigated = True
                            break
                        # Variável 3: página de erro sem vínculo de trabalho
                        _body_poll = (await page.evaluate("() => document.body.innerText || ''")).lower()
                        if ("não possui vínculo" in _body_poll or "vinculo de trabalho" in _body_poll
                                or "algo inesperado" in _body_poll):
                            resultado_cpf = {"cpf": cpf, "status": "inelegivel",
                                             "erro": "sem vínculo de trabalho válido"}
                            print(f"[DOM-TEST] Variável 3: ❌ sem vínculo de trabalho — inelegível")
                            _var3_inelig = True
                            break
                        heading = page.locator("text=/Produtos disponíveis/i").first
                        if await heading.count() > 0 and await heading.is_visible():
                            print("[DOM-TEST] ✅ Produtos disponíveis")
                            break
                        print(f"[DOM-TEST] poll... {cur.split('/')[-1][:8]}")
                        await page.reload(wait_until="domcontentloaded", timeout=30000)
                        await asyncio.sleep(8)
                    else:
                        raise Exception("timeout aguardando Produtos disponíveis")

                    if not _var3_inelig:
                        # Fase 4 — Iniciar (é <a> tag, não <button>)
                        if not auto_navigated:
                            await asyncio.sleep(1)
                            if "/simulacao/" in (page.url or ""):
                                auto_navigated = True
                            else:
                                print("[DOM-TEST] Clicando Iniciar...")
                                try:
                                    await page.locator(
                                        "a.pcb-button:has-text('Iniciar'), "
                                        "a[mat-flat-button]:has-text('Iniciar'), "
                                        "button:has-text('Iniciar')"
                                    ).nth(0).click(timeout=60000)
                                    await page.wait_for_url(re.compile(r"/simulacao/"), timeout=30000)
                                except Exception:
                                    if "/simulacao/" not in (page.url or ""):
                                        raise

                        print(f"[DOM-TEST] Em simulação: {page.url}")
                        await asyncio.sleep(2)

                        # Fase 4 — Simular
                        print("[DOM-TEST] Clicando Simular...")
                        await page.locator("button:has-text('Simular')").nth(0).click(timeout=20000)

                        # Resultado — checa a cada 0.3s (toast some rápido)
                        deadline3 = _time.monotonic() + 30
                        while _time.monotonic() < deadline3:
                            body_l = (await page.evaluate("() => document.body.innerText || ''")).lower()
                            if any(kw in body_l for kw in _INELIG_KEYWORDS):
                                resultado_cpf = {"cpf": cpf, "status": "inelegivel"}
                                print(f"[DOM-TEST] RESULTADO: ❌ inelegível")
                                break
                            try:
                                vl_text = await page.locator("strong.valorLiberado").nth(0).inner_text()
                                if vl_text.strip() and any(c.isdigit() for c in vl_text):
                                    # Extrai campos adicionais via labels
                                    extra = {}
                                    try:
                                        parcela = await page.locator("input[currencymask][placeholder='R$ 0,00']").nth(0).input_value()
                                        if parcela:
                                            extra["valor_parcela"] = parcela
                                    except Exception:
                                        pass
                                    try:
                                        prazo = await page.locator("input[type='number'][min='1']").nth(0).input_value()
                                        if prazo:
                                            extra["prazo"] = prazo
                                    except Exception:
                                        pass
                                    resultado_cpf = {"cpf": cpf, "status": "elegivel", "valor_liberado": vl_text, **extra}
                                    print(f"[DOM-TEST] RESULTADO: ✅ elegível — {vl_text} | parcela={extra.get('valor_parcela','?')} | prazo={extra.get('prazo','?')}")
                                    try:
                                        _sp = f"/tmp/mercantil_screenshots_30/{cpf}_elegivel.png"
                                        await page.screenshot(path=_sp, full_page=True)
                                        print(f"[SCREENSHOT] {_sp}")
                                    except Exception:
                                        pass
                                    break
                            except Exception:
                                pass
                            await asyncio.sleep(0.3)
                        else:
                            resultado_cpf = {"cpf": cpf, "status": "inelegivel", "erro": "timeout sem resultado"}
                            print(f"[DOM-TEST] RESULTADO: ❌ inelegível (timeout)")
                            try:
                                _sp = f"/tmp/mercantil_screenshots_30/{cpf}_timeout_resultado.png"
                                await page.screenshot(path=_sp, full_page=True)
                                print(f"[SCREENSHOT] {_sp}")
                            except Exception:
                                pass

            except Exception as e:
                resultado_cpf = {"cpf": cpf, "status": "erro", "erro": str(e)[:200]}
                print(f"[DOM-TEST] ❌ CPF {cpf} erro: {e}")
                try:
                    _sp = f"/tmp/mercantil_screenshots_30/{cpf}_erro.png"
                    await page.screenshot(path=_sp, full_page=True)
                    print(f"[SCREENSHOT] {_sp}")
                except Exception:
                    pass

            resultados.append(resultado_cpf)
            _write_result(resultado_cpf)
            _elegiveis = sum(1 for r in resultados if r.get("status") == "elegivel")
            print(f"[PROGRESS] {_idx}/{_total} | elegíveis: {_elegiveis} | output: {CSV_OUTPUT}")
            await asyncio.sleep(3)

        # Resumo final
        print(f"\n{'='*55}")
        print("RESUMO FINAL:")
        _cnt = {"elegivel": 0, "inelegivel": 0, "erro": 0}
        for r in resultados:
            vl = r.get("valor_liberado", "")
            st = r.get("status", "erro")
            _cnt[st] = _cnt.get(st, 0) + 1
            if st == "elegivel":
                print(f"  ✅ {r['cpf']}: R$ {vl}")
        print(f"\nTotal: {len(resultados)} | Elegíveis: {_cnt['elegivel']} | Inelegíveis: {_cnt['inelegivel']} | Erros: {_cnt['erro']}")
        print(f"Output CSV: {CSV_OUTPUT}")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
