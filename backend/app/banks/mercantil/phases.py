"""Fases do bot Mercantil — uma função por etapa do fluxo.

Cada fase é idempotente e retorna dict com ao menos a chave 'status' indicando
o que ocorreu. Logs incluem CPF mascarado em produção (últimos 3 dígitos)
mas aqui mantemos o CPF completo no log local porque é máquina do operador.
"""
from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path
from typing import Any

from playwright.async_api import Page, BrowserContext, TimeoutError as PWTimeout

from .config import MercantilConfig, gerar_celular_aleatorio

log = logging.getLogger("mercantil.phases")

UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _fmt_cpf(cpf: str) -> str:
    digits = re.sub(r"\D", "", cpf)
    if len(digits) == 11:
        return f"{digits[:3]}.{digits[3:6]}.{digits[6:9]}-{digits[9:]}"
    return cpf


def _norm_tel(tel: str | None) -> str | None:
    """Normaliza telefone do lead para o formato exigido pelo portal: (XX) 9XXXX-XXXX.
    Retorna None se não for celular válido (11 dígitos com 9 após DDD)."""
    if not tel:
        return None
    digits = re.sub(r"\D", "", tel)
    if digits.startswith("55") and len(digits) > 11:
        digits = digits[2:]
    if len(digits) == 10:
        digits = digits[:2] + "9" + digits[2:]
    if len(digits) == 11 and digits[2] == "9":
        return f"({digits[:2]}) {digits[2:7]}-{digits[7:]}"
    return None


def _parse_money(v: str | None) -> float | None:
    if not v:
        return None
    s = str(v).replace("R$", "").replace("\xa0", "").replace(" ", "").strip()
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def _parse_int(v: str | None) -> int | None:
    if v is None:
        return None
    m = re.search(r"\d+", str(v))
    return int(m.group(0)) if m else None


def _parse_taxa(v: str | None) -> float | None:
    """Extrai '4.74 (%)' → 4.74 OR '4,74' → 4.74."""
    if not v:
        return None
    m = re.search(r"[\d.,]+", str(v))
    if not m:
        return None
    s = m.group(0).replace(".", "").replace(",", ".") if "," in m.group(0) else m.group(0)
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def _parse_date_br(v: str | None) -> str | None:
    """Converte 'DD/MM/AAAA' → 'AAAA-MM-DD' (formato Postgres date). Retorna None se inválido."""
    if not v:
        return None
    m = re.search(r"(\d{2})/(\d{2})/(\d{4})", v)
    if not m:
        return None
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"


def _extract_uuid_from_url(url: str) -> str | None:
    m = UUID_RE.search(url or "")
    return m.group(0) if m else None


async def _screenshot(page: Page, label: str) -> None:
    try:
        Path("/tmp").mkdir(exist_ok=True)
        path = f"/tmp/mercantil_{label}.png"
        await page.screenshot(path=path, full_page=True)
        log.warning("mercantil screenshot saved %s", path)
    except Exception:
        pass


async def _check_form_valid(page: Page) -> bool | None:
    """Check form.valid via JS. Returns True/False/None if cannot evaluate."""
    try:
        result = await page.evaluate("""() => {
            const form = document.querySelector('form');
            if (!form) return null;
            if (form.checkValidity !== undefined) return form.checkValidity();
            if (form.__ngModelGroup !== undefined) return !form.__ngModelGroup.$invalid;
            const inputs = form.querySelectorAll('input, select, textarea');
            for (let inp of inputs) {
                if (inp.classList.contains('ng-invalid')) return false;
            }
            return true;
        }""")
        log.info("mercantil form.valid JS eval: %s", result)
        return result
    except Exception as e:
        log.warning("mercantil cannot evaluate form.valid: %s", str(e)[:100])
        return None


async def _ler_campo_por_label(page: Page, label: str) -> str | None:
    """Lê valor adjacente a um label de texto. Usado pra extrair campos do 'Resumo da operação'.
    Padrão copiado de vctex._ler_campo — tolerante a layout dinâmico do Angular."""
    try:
        value = await page.evaluate("""(label) => {
            const target = label.trim().toLowerCase();
            const all = Array.from(document.querySelectorAll('*'));
            const leaves = all.filter(el =>
                el.children.length === 0 &&
                el.textContent.trim().toLowerCase() === target
            );
            for (const el of leaves) {
                // 1. irmão direto
                const sib = el.nextElementSibling;
                if (sib) {
                    const t = sib.textContent.trim();
                    if (t && t !== '-') return t;
                }
                // 2. pai → irmão do pai
                const parent = el.parentElement;
                if (parent) {
                    const parentSib = parent.nextElementSibling;
                    if (parentSib) {
                        const t = parentSib.textContent.trim();
                        if (t && t !== '-') return t;
                    }
                    // 3. outros children do pai
                    for (const child of parent.children) {
                        if (child !== el) {
                            const t = child.textContent.trim();
                            if (t && t !== '-' && t !== label.trim()) return t;
                        }
                    }
                }
            }
            return null;
        }""", label)
        return value if value and value != "-" else None
    except Exception:
        return None


async def _select_mat_option(page: Page, select_locator, option_text: str, cfg: MercantilConfig) -> None:
    """Abre um <mat-select> e clica em <mat-option> que contém 'option_text'.

    Angular Material renderiza as opções num overlay (cdk-overlay-container)
    no body, não dentro do select — daí o selector global mat-option.
    """
    await select_locator.click(timeout=cfg.timeout_page)
    await asyncio.sleep(0.4)
    # Aguarda overlay com opções
    await page.wait_for_selector("mat-option", state="visible", timeout=10_000)
    option = page.locator(f"mat-option:has-text('{option_text}')").first
    await option.click(timeout=cfg.timeout_page)
    await asyncio.sleep(0.5)


async def _first_mat_select_by_label_or_index(page: Page, label_text: str, index: int):
    """Tenta achar mat-select pelo mat-label adjacente; cai pra index se não achar."""
    by_label = page.locator(
        f"mat-form-field:has(mat-label:has-text('{label_text}')) mat-select"
    ).first
    if await by_label.count() > 0:
        return by_label
    by_placeholder = page.locator(
        f"mat-select[placeholder='{label_text}']"
    ).first
    if await by_placeholder.count() > 0:
        return by_placeholder
    return page.locator("mat-select").nth(index)


# ─────────────────────────────────────────────────────────────────────────────
# FASE 1 — Consultar CPF
# Sai do dashboard → /simular-proposta → preenche → /consignado-privado/{UUID}
#                                                  OR /solicitar-dataprev/{UUID}
# ─────────────────────────────────────────────────────────────────────────────

async def _extract_jwt_from_page(page: Page) -> tuple[str | None, str | None]:
    """Extrai JWT e sessaoId do localStorage da página Angular."""
    import json as _json, base64 as _b64
    try:
        raw = await page.evaluate("""
            () => {
                const r = {};
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    r[k] = localStorage.getItem(k);
                }
                return r;
            }
        """)
        for k, v in raw.items():
            v_str = str(v or "")
            if v_str.startswith("ey") and v_str.count(".") >= 2:
                sessao_id = ""
                try:
                    payload_raw = v_str.split(".")[1] + "=="
                    payload = _json.loads(_b64.urlsafe_b64decode(payload_raw))
                    mb = payload.get("mb", {}).get("data", {})
                    sessao_id = mb.get("usuario", {}).get("sessaoId", "")
                except Exception:
                    pass
                log.info("mercantil JWT capturado localStorage key=%s sessaoId=%s", k, sessao_id)
                return v_str, sessao_id
            # JSON-wrapped token
            if v_str.startswith("{"):
                try:
                    obj = _json.loads(v_str)
                    for t_key in ["access_token", "token", "accessToken", "jwt"]:
                        t = str(obj.get(t_key, "") or "")
                        if t.startswith("ey") and t.count(".") >= 2:
                            sessao_id = ""
                            try:
                                payload_raw = t.split(".")[1] + "=="
                                payload = _json.loads(_b64.urlsafe_b64decode(payload_raw))
                                mb = payload.get("mb", {}).get("data", {})
                                sessao_id = mb.get("usuario", {}).get("sessaoId", "")
                            except Exception:
                                pass
                            log.info("mercantil JWT capturado JSON key=%s.%s sessaoId=%s", k, t_key, sessao_id)
                            return t, sessao_id
                except Exception:
                    pass
        log.warning("mercantil JWT não encontrado no localStorage keys=%s", list(raw.keys()))
        return None, None
    except Exception as e:
        log.warning("mercantil JWT extract falhou: %s", e)
        return None, None


async def fase1_consultar_cpf_api(page: Page, cpf: str, cfg: MercantilConfig) -> dict:
    """Consulta CPF via BFF (page.evaluate fetch) — bypassa reCAPTCHA e form Angular.

    Mantém o browser no dashboard enquanto chama a API diretamente do contexto JS,
    então a sessão/cookies autenticados são usados, mas nenhum DOM é manipulado.

    Retornos:
      {"status": "elegivel", "uuid_portal": ..., "valor_liberado": ..., ...}
      {"status": "inelegivel", "uuid_portal": ..., "erro": ...}
      {"status": "aguardando_autorizacao", "cenario": "B", "uuid_portal": ..., "nome": ...}
      {"status": "erro", "erro": ...}
    """
    from .bff_bridge import consultar_cpf as _bff_consultar

    cpf_fmt = _fmt_cpf(cpf)
    log.info("mercantil fase1_api CPF=%s — chamando BFF via page.evaluate", cpf_fmt)

    # Garante dashboard carregado (Angular bootstrapped → localStorage preenchido)
    try:
        if cfg.dashboard_url not in (page.url or ""):
            await page.goto(cfg.dashboard_url, wait_until="domcontentloaded", timeout=cfg.timeout_page)
            await asyncio.sleep(2.0)
        else:
            await asyncio.sleep(0.5)
    except Exception as e:
        log.warning("mercantil fase1_api goto dashboard: %s", e)

    # Aguarda Angular setar PCB_AUTH no localStorage (máx 10s)
    try:
        await page.wait_for_function(
            """() => {
                for (let i = 0; i < localStorage.length; i++) {
                    const v = localStorage.getItem(localStorage.key(i)) || '';
                    if (v.startsWith('ey') && v.split('.').length >= 3) return true;
                    if (v.startsWith('{')) {
                        try {
                            const o = JSON.parse(v);
                            for (const k of ['access_token','token','accessToken','jwt']) {
                                if (o[k] && String(o[k]).startsWith('ey')) return true;
                            }
                        } catch(e) {}
                    }
                }
                return false;
            }""",
            timeout=10_000,
        )
    except Exception:
        log.warning("mercantil fase1_api timeout aguardando JWT no localStorage CPF=%s", cpf_fmt)

    result = await _bff_consultar(
        page, cpf,
        poll_interval=cfg.poll_dataprev_interval_s,
        poll_max=cfg.poll_dataprev_max_seconds,
    )
    log.info("mercantil fase1_api CPF=%s status=%s", cpf_fmt, result.get("status"))

    # Salva JWT capturado durante a chamada (última chance de persistir)
    try:
        from .bff_bridge import get_session_data
        sessao = await get_session_data(page)
        if sessao.get("jwt"):
            import json as _json
            from .engine import STATE_DIR
            from pathlib import Path as _Path
            jwt_path = _Path(STATE_DIR) / "last_jwt.json"
            jwt_path.parent.mkdir(parents=True, exist_ok=True)
            jwt_path.write_text(_json.dumps({
                "access_token": sessao["jwt"],
                "sessao_id": sessao.get("sessaoId", ""),
            }))
    except Exception as _e:
        log.debug("mercantil fase1_api JWT save: %s", _e)

    return result


async def fase1_consultar_cpf(page: Page, cpf: str, cfg: MercantilConfig) -> dict:
    """Preenche o form de Simular Proposta e captura o UUID + cenário.

    Retornos possíveis:
      {"status": "cenario_A", "uuid_portal": "...", "url": "..."}
      {"status": "cenario_B", "uuid_portal": "...", "url": "..."}
      {"status": "erro", "erro": "..."}
    """
    cpf_fmt = _fmt_cpf(cpf)
    try:
        # 1. Ir pro dashboard pra garantir estado conhecido
        await page.goto(cfg.dashboard_url, wait_until="domcontentloaded", timeout=cfg.timeout_page)
        await asyncio.sleep(1.2)

        # Captura JWT do localStorage (1x por sessão — para debug e futura migração API)
        jwt_token, sessao_id = await _extract_jwt_from_page(page)
        if jwt_token:
            try:
                import json as _json
                from pathlib import Path as _Path
                from .engine import STATE_DIR
                jwt_path = _Path(STATE_DIR) / "last_jwt.json"
                jwt_path.parent.mkdir(parents=True, exist_ok=True)
                jwt_path.write_text(_json.dumps({"access_token": jwt_token, "sessao_id": sessao_id}))
                log.info("mercantil JWT salvo em %s", jwt_path)
            except Exception as _e:
                log.warning("mercantil JWT save err: %s", _e)

        # 2. Clicar "Digite aqui uma nova proposta" — pode estar no dashboard direto
        nova = page.locator(cfg.SEL_NOVA_PROPOSTA_BTN).first
        if await nova.count() == 0:
            # Fallback: ir direto pra URL
            await page.goto(cfg.simular_url, wait_until="domcontentloaded", timeout=cfg.timeout_page)
        else:
            await nova.click(timeout=cfg.timeout_page)
            await page.wait_for_url("**/simular-proposta**", timeout=cfg.timeout_page)
        await asyncio.sleep(1.0)

        # 3. UF — seleciona primeiro mat-select
        uf_sel = await _first_mat_select_by_label_or_index(page, "UF", 0)
        await _select_mat_option(page, uf_sel, cfg.uf_padrao, cfg)

        # 4. Convênio — segundo mat-select
        conv_sel = await _first_mat_select_by_label_or_index(page, "Convênio", 1)
        await _select_mat_option(page, conv_sel, cfg.convenio_texto, cfg)

        # 5. CPF — Tab after type to trigger Angular blur + form validation
        cpf_input = page.locator(cfg.SEL_CPF_INPUT).first
        await cpf_input.wait_for(state="visible", timeout=cfg.timeout_page)
        await cpf_input.fill("")
        await cpf_input.type(re.sub(r"\D", "", cpf), delay=40)
        await asyncio.sleep(0.3)
        await page.keyboard.press("Tab")  # Angular blur → marks field touched → form valid
        await asyncio.sleep(0.6)

        # 6. Instituição — terceiro mat-select (pode aparecer atrasado, com 1 opção só)
        # Portal pré-seleciona "Banco Mercantil" e deixa disabled quando há 1 opção.
        # Nesse caso skip — campo já está preenchido, form considera válido.
        try:
            inst_sel = await _first_mat_select_by_label_or_index(page, "Instituição", 2)
            await inst_sel.wait_for(state="visible", timeout=8000)
            is_disabled = await inst_sel.is_disabled()
            if is_disabled:
                log.info("mercantil fase1 CPF %s — instituição pré-selecionada (disabled), skip", cpf)
            else:
                await inst_sel.click(timeout=8_000)
                await asyncio.sleep(0.5)
                try:
                    await page.wait_for_selector("mat-option", state="visible", timeout=6000)
                    first_opt = page.locator("mat-option").first
                    await first_opt.click(timeout=cfg.timeout_page)
                    await asyncio.sleep(0.5)
                except PWTimeout:
                    await page.keyboard.press("Escape")
                    await asyncio.sleep(0.3)
        except Exception as e:
            log.warning("mercantil fase1 CPF %s — instituição: %s", cpf, str(e)[:120])

        # Aguarda rede idle após preencher form (async validators / instituição loading)
        try:
            await page.wait_for_load_state("networkidle", timeout=8000)
        except Exception:
            pass
        await asyncio.sleep(0.5)
        log.info("mercantil fase1 CPF %s — URL pré-click: %s", cpf, page.url)

        # 7. Consultar (Akamai bloqueado no contexto — ver engine.new_context)
        consultar_btn = page.locator(cfg.SEL_CONSULTAR_BTN).first
        await consultar_btn.wait_for(state="visible", timeout=cfg.timeout_page)

        network_requests: list[dict] = []
        _captured_bff: dict = {}

        def _on_request(req):
            network_requests.append({"url": req.url[:150], "method": req.method})
            # Capture BFF calls to understand API structure
            if "api.mercantil.com.br" in req.url and not _captured_bff.get("jwt"):
                auth = req.headers.get("authorization", "")
                sessao = req.headers.get("sessaousuarioid", "")
                if auth.startswith("Bearer "):
                    _captured_bff["jwt"] = auth[7:]
                    _captured_bff["sessao_id"] = sessao
                    _captured_bff["url"] = req.url
                    _captured_bff["body"] = req.post_data or ""
                    log.info("mercantil BFF CALL CAPTURED url=%s sessao=%s body_len=%d",
                             req.url, sessao, len(_captured_bff["body"]))

        page.on("request", _on_request)

        # Click Playwright (trusted event, isTrusted=True via CDP Input.dispatchMouseEvent)
        try:
            await consultar_btn.click(timeout=cfg.timeout_page)
        except Exception as e:
            log.warning("mercantil fase1 CPF %s — click err: %s", cpf, str(e)[:100])

        await asyncio.sleep(3.0)

        post_reqs = [r for r in network_requests if r["method"] in ("POST", "PUT")]
        log.info("mercantil fase1 CPF %s — após click: total=%d POST=%d sample=%s",
                 cpf, len(network_requests), len(post_reqs),
                 [r["url"] for r in network_requests[:5]])

        # reCAPTCHA pode estar bloqueando o POST — detecta e resolve
        recaptcha_reqs = [r for r in network_requests if "recaptcha" in r["url"] or "gstatic" in r["url"]]
        if recaptcha_reqs and not post_reqs:
            log.info("mercantil fase1 CPF %s — reCAPTCHA detectado, tentando resolver checkbox", cpf)
            try:
                # reCAPTCHA iframe com checkbox "I'm not a robot"
                frames = page.frames
                rc_frame = next(
                    (f for f in frames if "recaptcha" in (f.url or "") and "anchor" in (f.url or "")),
                    None
                )
                if rc_frame:
                    checkbox = rc_frame.locator("#recaptcha-anchor, .recaptcha-checkbox")
                    if await checkbox.count() > 0:
                        await checkbox.click(timeout=5000)
                        log.info("mercantil fase1 CPF %s — reCAPTCHA checkbox clicado", cpf)
                        await asyncio.sleep(4.0)
                    else:
                        log.warning("mercantil fase1 CPF %s — reCAPTCHA frame achado mas checkbox não", cpf)
                else:
                    log.warning("mercantil fase1 CPF %s — reCAPTCHA frame não encontrado (frames=%d)", cpf, len(frames))
                    await asyncio.sleep(5.0)  # aguarda resolução automática
            except Exception as e:
                log.warning("mercantil fase1 CPF %s — reCAPTCHA resolve err: %s", cpf, str(e)[:100])

        # Se ainda sem POST, tenta hover+click
        post_reqs = [r for r in network_requests if r["method"] in ("POST", "PUT")]
        if not post_reqs:
            log.warning("mercantil fase1 CPF %s — ainda 0 POST, hover+click", cpf)
            try:
                box = await consultar_btn.bounding_box()
                if box:
                    await page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
                    await asyncio.sleep(0.3)
                    await page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
                    await asyncio.sleep(5.0)
            except Exception as e:
                log.warning("mercantil fase1 CPF %s — hover+click err: %s", cpf, str(e)[:80])

        page.remove_listener("request", _on_request)

        # Save BFF capture if we got one
        if _captured_bff.get("jwt"):
            try:
                import json as _json
                from pathlib import Path as _Path
                from .engine import STATE_DIR
                bff_path = _Path(STATE_DIR) / "last_bff_capture.json"
                bff_path.parent.mkdir(parents=True, exist_ok=True)
                bff_path.write_text(_json.dumps(_captured_bff))
                log.info("mercantil BFF capture salvo url=%s", _captured_bff["url"])
            except Exception as _e:
                log.warning("mercantil BFF capture save err: %s", _e)

        post_reqs = [r for r in network_requests if r["method"] in ("POST", "PUT")]
        log.info("mercantil fase1 CPF %s — requests total: %d | POST: %d | sample: %s",
                 cpf, len(network_requests), len(post_reqs),
                 [r["url"] for r in network_requests[:8]])

        # 8. "Nova operação" pode aparecer como modal/popup. Pode também
        #    pular direto pra próxima tela em alguns fluxos.
        try:
            nova_op = page.locator(cfg.SEL_NOVA_OP_BTN).first
            await nova_op.wait_for(state="visible", timeout=30_000)
            await nova_op.click(timeout=cfg.timeout_page)
            log.info("mercantil fase1 CPF %s — 'Nova operação' clicado", cpf)
        except PWTimeout:
            await _screenshot(page, f"fase1_no_nova_op_{cpf}")
            log.info("mercantil fase1 CPF %s — sem botão 'Nova operação' (talvez já navegou, url=%s)", cpf, page.url)

        # 9. Espera URL terminar em /consignado-privado/{UUID} OU /solicitar-dataprev/{UUID}
        try:
            await page.wait_for_url(
                re.compile(r"/(consignado-privado|solicitar-dataprev)/[0-9a-f-]{36}", re.IGNORECASE),
                timeout=cfg.timeout_auth,
            )
        except PWTimeout:
            await _screenshot(page, f"fase1_no_redirect_{cpf}")
            return {"status": "erro", "erro": f"timeout esperando UUID redirect (url={page.url})"}

        uuid_portal = _extract_uuid_from_url(page.url)
        if not uuid_portal:
            return {"status": "erro", "erro": f"UUID não extraível de {page.url}"}

        if "/solicitar-dataprev/" in page.url:
            return {"status": "cenario_B", "uuid_portal": uuid_portal, "url": page.url}
        return {"status": "cenario_A", "uuid_portal": uuid_portal, "url": page.url}

    except Exception as e:
        await _screenshot(page, f"fase1_crash_{cpf}")
        log.exception("mercantil fase1 CPF %s falhou: %s", cpf, e)
        return {"status": "erro", "erro": str(e)[:300]}


# ─────────────────────────────────────────────────────────────────────────────
# FASE 2 — Polling Produtos Disponíveis
# (cenário A entra aqui direto; cenário B entra aqui após Plurio)
# ─────────────────────────────────────────────────────────────────────────────

async def fase2_aguardar_produtos(page: Page, uuid_portal: str, cfg: MercantilConfig) -> dict:
    """Aguarda 'Produtos disponíveis' aparecer (pipeline 4/4 verde).
    Retorna {"status": "ready"} ou {"status": "timeout"}."""
    consignado_url = f"https://meu.bancomercantil.com.br/consignado-privado/{uuid_portal}"
    deadline = asyncio.get_event_loop().time() + cfg.poll_dataprev_max_seconds
    interval = cfg.poll_dataprev_interval_s

    while asyncio.get_event_loop().time() < deadline:
        cur_url = page.url or ""
        # Angular auto-navega pra /simulacao/ quando produtos ficam disponíveis
        if "/simulacao/" in cur_url or "/simular" in cur_url:
            log.info("mercantil fase2 URL=%s — Angular já navegou pra simulação, ready", cur_url)
            return {"status": "ready"}

        # Variável 3: página de erro sem vínculo de trabalho
        try:
            body_txt = (await page.evaluate("() => document.body.innerText || ''")).lower()
            if ("não possui vínculo" in body_txt or "vinculo de trabalho" in body_txt
                    or "algo inesperado" in body_txt):
                log.info("mercantil fase2 uuid=%s — sem vínculo de trabalho, inelegível", uuid_portal)
                return {"status": "inelegivel", "erro": "sem vínculo de trabalho válido"}
        except Exception:
            pass

        try:
            heading = page.locator(cfg.SEL_PRODUTOS_HEADING).first
            if await heading.count() > 0 and await heading.is_visible():
                log.info("mercantil fase2 produtos disponíveis OK uuid=%s", uuid_portal)
                return {"status": "ready"}
        except Exception:
            pass

        # Re-navega pra forçar refresh do pipeline (Angular pode não dar push)
        try:
            if consignado_url not in (page.url or ""):
                await page.goto(consignado_url, wait_until="domcontentloaded",
                                timeout=cfg.timeout_page)
            else:
                await page.reload(wait_until="domcontentloaded", timeout=cfg.timeout_page)
        except Exception:
            pass
        await asyncio.sleep(interval)

    return {"status": "timeout"}


# ─────────────────────────────────────────────────────────────────────────────
# FASE 3 — Autorizar via DataPrev (Plurio em nova aba)
# ─────────────────────────────────────────────────────────────────────────────

async def fase3_autorizar_dataprev(
    page: Page,
    uuid_portal: str,
    telefone_lead: str | None,
    cfg: MercantilConfig,
) -> dict:
    """Cenário B: solicita SMS via portal, abre Plurio, marca 2 checkboxes, autoriza.
    Retorna {"status": "autorizado"} ou {"status": "erro", "erro": "..."}.
    Após sucesso, o caller deve chamar fase2_aguardar_produtos().
    """
    plurio_page: Page | None = None
    try:
        # 1. Preenche telefone se vazio
        tel_input = page.locator(cfg.SEL_DATAPREV_TEL_INPUT).first
        await tel_input.wait_for(state="visible", timeout=cfg.timeout_page)
        current = (await tel_input.input_value() or "").strip()
        if not current or len(re.sub(r"\D", "", current)) < 11:
            tel_to_fill = _norm_tel(telefone_lead) or gerar_celular_aleatorio()
            await tel_input.fill("")
            await tel_input.type(re.sub(r"\D", "", tel_to_fill), delay=40)
            await asyncio.sleep(0.5)
            log.info("mercantil fase3 telefone preenchido: %s", tel_to_fill)

        # 2. Clica Solicitar
        await page.locator(cfg.SEL_DATAPREV_SOLICITAR).first.click(timeout=cfg.timeout_page)

        # 3. Espera redirect pra /consignado-privado/{UUID}
        try:
            await page.wait_for_url(
                re.compile(rf"/consignado-privado/{uuid_portal}", re.IGNORECASE),
                timeout=cfg.timeout_auth,
            )
        except PWTimeout:
            log.warning("mercantil fase3 sem redirect pra consignado-privado")

        await asyncio.sleep(2.0)

        # Variável 4: DataPrev já autorizado em sessão anterior — produtos visíveis direto,
        # sem link Plurio. Detecta pelo heading "Produtos disponíveis" na tela atual.
        if f"/consignado-privado/{uuid_portal}" in (page.url or ""):
            try:
                heading = page.locator(cfg.SEL_PRODUTOS_HEADING).first
                if await heading.count() > 0 and await heading.is_visible():
                    log.info("mercantil fase3 Variável 4: DataPrev já autorizado, produtos visíveis uuid=%s", uuid_portal)
                    return {"status": "autorizado"}
            except Exception:
                pass

        # 4. Captura o link curto (bml.b.br/XXXX) lendo TODOS os readonly inputs
        short_link = await _capturar_short_link(page, cfg)
        if not short_link:
            await _screenshot(page, f"fase3_sem_link_{uuid_portal}")
            return {"status": "erro", "erro": "não foi possível capturar link de autorização"}
        log.info("mercantil fase3 link capturado: %s", short_link)

        # 5. Abre nova aba e assina (geolocalização já concedida no context)
        ctx: BrowserContext = page.context
        plurio_page = await ctx.new_page()
        await plurio_page.goto(short_link, wait_until="domcontentloaded", timeout=cfg.timeout_auth)
        await asyncio.sleep(2.0)

        # ── Etapa 1 de 2 ──
        ok1 = await _plurio_step(plurio_page, cfg, button_text="Iniciar")
        if not ok1:
            await _screenshot(plurio_page, f"fase3_plurio_etapa1_{uuid_portal}")
            return {"status": "erro", "erro": "Plurio etapa 1 falhou"}

        # ── Etapa 2 de 2 ──
        ok2 = await _plurio_step(plurio_page, cfg, button_text="Autorizar")
        if not ok2:
            await _screenshot(plurio_page, f"fase3_plurio_etapa2_{uuid_portal}")
            return {"status": "erro", "erro": "Plurio etapa 2 falhou"}

        # ── Confirma sucesso ──
        try:
            await plurio_page.locator(cfg.SEL_PLURIO_SUCESSO).first.wait_for(
                state="visible", timeout=cfg.timeout_auth,
            )
        except PWTimeout:
            await _screenshot(plurio_page, f"fase3_plurio_no_success_{uuid_portal}")
            return {"status": "erro", "erro": "Plurio não confirmou sucesso"}

        log.info("mercantil fase3 Plurio autorizado uuid=%s", uuid_portal)
        return {"status": "autorizado"}

    except Exception as e:
        log.exception("mercantil fase3 crash: %s", e)
        return {"status": "erro", "erro": str(e)[:300]}
    finally:
        if plurio_page:
            try:
                await plurio_page.close()
            except Exception:
                pass


async def _capturar_short_link(page: Page, cfg: MercantilConfig) -> str | None:
    """Procura o link curto em readonly inputs. Múltiplas estratégias."""
    try:
        # Estratégia A: ler value de TODOS os readonly inputs
        links = await page.evaluate("""() => {
            const inputs = document.querySelectorAll('input[readonly], input:not([editable])');
            const out = [];
            inputs.forEach(i => {
                const v = (i.value || '').trim();
                if (v && (v.startsWith('https://bml.b.br') ||
                          v.startsWith('https://autorizac') ||
                          v.includes('autorizac'))) {
                    out.push(v);
                }
            });
            return out;
        }""")
        if links:
            return links[0]

        # Estratégia B: <a href> que aponte pro domínio de autorização
        href = await page.evaluate("""() => {
            const a = document.querySelectorAll('a[href]');
            for (const el of a) {
                const h = el.href;
                if (h && (h.includes('bml.b.br') || h.includes('autorizac'))) return h;
            }
            return null;
        }""")
        if href:
            return href

        # Estratégia C: scan texto da página
        txt = await page.evaluate("""() => {
            const re = /https:\\/\\/(bml\\.b\\.br|autorizacoesdigitais)[^\\s'\"<>]+/i;
            const m = (document.body.innerText || '').match(re);
            return m ? m[0] : null;
        }""")
        return txt
    except Exception as e:
        log.warning("mercantil _capturar_short_link falhou: %s", e)
        return None


async def _plurio_step(page: Page, cfg: MercantilConfig, button_text: str) -> bool:
    """Marca o checkbox (único na etapa atual) e clica no botão (Iniciar ou Autorizar).
    Espera o botão sair do estado disabled antes de clicar."""
    try:
        # Aguarda checkbox aparecer
        cb = page.locator(cfg.SEL_PLURIO_CHECKBOX).first
        await cb.wait_for(state="attached", timeout=cfg.timeout_auth)
        # force=True porque MDC tem pointer-events:none em transições
        await cb.check(force=True, timeout=cfg.timeout_page)
        await asyncio.sleep(0.6)

        btn = page.locator(f"button:has-text('{button_text}')").first
        await btn.wait_for(state="visible", timeout=cfg.timeout_page)

        # Aguarda botão sair do estado disabled
        for _ in range(20):  # ~6s
            disabled = await btn.get_attribute("disabled")
            cls = (await btn.get_attribute("class")) or ""
            if disabled is None and cfg.SEL_PLURIO_DISABLED_CLASS not in cls:
                break
            await asyncio.sleep(0.3)

        await btn.click(timeout=cfg.timeout_page)
        await asyncio.sleep(2.0)
        return True
    except Exception as e:
        log.warning("mercantil _plurio_step '%s' falhou: %s", button_text, e)
        return False


# ─────────────────────────────────────────────────────────────────────────────
# FASE 4 — Simular e extrair resultado
# ─────────────────────────────────────────────────────────────────────────────

async def fase4_simular(page: Page, uuid_portal: str, cfg: MercantilConfig) -> dict:
    """Clica Iniciar no Contrato Novo → Simular → extrai resultado.

    Retorna:
      {"status": "elegivel", valor_liberado: ..., ...}
      {"status": "inelegivel", erro: "<msg>"}
      {"status": "erro", erro: "..."}
    """
    try:
        # 1. Se já está em /simulacao/ (Angular auto-navegou), pula o Iniciar click
        cur_url = page.url or ""
        if f"/simulacao/{uuid_portal}/simulacao" not in cur_url:
            # Angular pode auto-navegar pra /simulacao/ logo após pipeline completar.
            # Re-checa URL após 1s antes de tentar clicar Iniciar.
            await asyncio.sleep(1)
            cur_url = page.url or ""
            if f"/simulacao/{uuid_portal}/simulacao" in cur_url:
                log.info("mercantil fase4 auto-navegou durante sleep, pulando Iniciar click")
            else:
                # .nth(0).click() evita strict mode (há 2 botões Iniciar: Contrato Novo + Refinanciamento)
                # .click(timeout=X) aguarda visível+clicável sem chamar wait_for_selector(strict=True)
                try:
                    await page.locator(cfg.SEL_INICIAR_CONTRATO_NOVO).nth(0).click(timeout=60000)
                except PWTimeout:
                    if f"/simulacao/{uuid_portal}/simulacao" not in (page.url or ""):
                        await _screenshot(page, f"fase4_no_iniciar_{uuid_portal}")
                        return {"status": "erro", "erro": f"botão Iniciar não encontrado (url={page.url})"}

                # Espera URL /simulacao/{UUID}/simulacao
                try:
                    await page.wait_for_url(
                        re.compile(rf"/simulacao/{uuid_portal}/simulacao", re.IGNORECASE),
                        timeout=cfg.timeout_auth,
                    )
                except PWTimeout:
                    if f"/simulacao/{uuid_portal}/simulacao" not in (page.url or ""):
                        await _screenshot(page, f"fase4_no_simulacao_url_{uuid_portal}")
                        return {"status": "erro", "erro": f"timeout indo pra /simulacao (url={page.url})"}
        else:
            log.info("mercantil fase4 já em simulacao (Angular auto-nav), pulando Iniciar click")

        await asyncio.sleep(1.5)

        # Clica Simular — .nth(0).click() sem strict mode
        try:
            await page.locator(cfg.SEL_SIMULAR_BTN).nth(0).click(timeout=cfg.timeout_page)
        except PWTimeout:
            await _screenshot(page, f"fase4_no_simular_{uuid_portal}")
            return {"status": "erro", "erro": f"botão Simular não encontrado (url={page.url})"}

        # 4. Race: alert vermelho de inelegível OU valores aparecem
        outcome = await _await_resultado(page, cfg, timeout_s=30)

        if outcome["kind"] == "inelegivel":
            log.info("mercantil fase4 INELEGÍVEL uuid=%s motivo=%s", uuid_portal, outcome["motivo"])
            return {"status": "inelegivel", "erro": outcome["motivo"]}

        if outcome["kind"] == "elegivel":
            extracted = await _extrair_resultado(page, cfg)
            extracted["status"] = "elegivel"
            log.info(
                "mercantil fase4 ELEGÍVEL uuid=%s valor=%s parcelas=%s",
                uuid_portal,
                extracted.get("valor_liberado"),
                extracted.get("qtd_parcelas"),
            )
            return extracted

        return {"status": "inelegivel", "erro": outcome.get("motivo", "sem resultado")}

    except Exception as e:
        await _screenshot(page, f"fase4_crash_{uuid_portal}")
        log.exception("mercantil fase4 crash: %s", e)
        return {"status": "erro", "erro": str(e)[:300]}


async def _await_resultado(page: Page, cfg: MercantilConfig, timeout_s: int = 30) -> dict:
    """Race entre alert vermelho (inelegível) e seção 'Resumo da operação' (elegível)."""
    deadline = asyncio.get_event_loop().time() + timeout_s
    inelig_re = re.compile(cfg.REGEX_INELEGIVEL, re.IGNORECASE)

    while asyncio.get_event_loop().time() < deadline:
        # 1) Check inelegibilidade
        try:
            body_text = await page.evaluate("() => document.body.innerText || ''")
            m = inelig_re.search(body_text or "")
            if m:
                return {"kind": "inelegivel", "motivo": m.group(0)}
        except Exception:
            pass

        # 2) Check elegibilidade (strong.valorLiberado preenchido)
        try:
            txt = (await page.locator(cfg.SEL_VALOR_LIBERADO).nth(0).inner_text()).strip()
            if txt and re.search(r"\d", txt):
                return {"kind": "elegivel"}
        except Exception:
            pass

        await asyncio.sleep(0.3)
    # Timeout sem valor → sem margem disponível
    return {"kind": "inelegivel", "motivo": "timeout aguardando resultado — sem margem ou produto indisponível"}


async def _extrair_resultado(page: Page, cfg: MercantilConfig) -> dict:
    """Extrai todos os campos do 'Resumo da operação' e dos inputs do form."""
    data: dict = {}

    # valor_liberado vem do strong.valorLiberado
    try:
        vl_text = (await page.locator(cfg.SEL_VALOR_LIBERADO).first.inner_text()).strip()
        data["valor_liberado"] = _parse_money(vl_text)
    except Exception:
        data["valor_liberado"] = None

    # valor_parcela e prazo vêm dos inputs do form (visíveis quando elegível)
    try:
        vp = await page.locator(cfg.SEL_VALOR_PARCELA_INPUT).first.input_value()
        data["valor_parcela"] = _parse_money(vp)
    except Exception:
        data["valor_parcela"] = None
    try:
        pz = await page.locator(cfg.SEL_PRAZO_INPUT).first.input_value()
        data["prazo"] = _parse_int(pz)
    except Exception:
        data["prazo"] = None

    # Demais campos via label traversal no "Resumo da operação"
    label_map = {
        "valor_financiado":         "Valor financiado",
        "valor_emprestimo":         "Valor empréstimo",
        "qtd_parcelas":             "Quantidade de parcelas",
        "valor_iof":                "Valor IOF",
        "data_vencimento":          "Data 1º vencimento",
        "capital_segurado":         "Capital Segurado",
        "valor_seguro_prestamista": "Valor Seguro Prestamista",
        "taxa_juros_mes":           "Taxa juros (mês)",
    }
    raw: dict = {}
    for key, label in label_map.items():
        raw[key] = await _ler_campo_por_label(page, label)

    data["valor_financiado"]         = _parse_money(raw.get("valor_financiado"))
    data["valor_emprestimo"]         = _parse_money(raw.get("valor_emprestimo"))
    data["qtd_parcelas"]             = _parse_int(raw.get("qtd_parcelas"))
    data["valor_iof"]                = _parse_money(raw.get("valor_iof"))
    data["capital_segurado"]         = _parse_money(raw.get("capital_segurado"))
    data["valor_seguro_prestamista"] = _parse_money(raw.get("valor_seguro_prestamista"))
    data["data_vencimento"]          = _parse_date_br(raw.get("data_vencimento"))
    data["taxa_juros_mes"]           = _parse_taxa(raw.get("taxa_juros_mes"))

    return data


# ─────────────────────────────────────────────────────────────────────────────
# Reset pra próximo lead — clica o painel expansível "Nova proposta" no canto
# ─────────────────────────────────────────────────────────────────────────────

async def voltar_para_dashboard(page: Page, cfg: MercantilConfig) -> None:
    """Best-effort. Se falhar, o worker chama page.goto(dashboard_url) diretamente."""
    try:
        panel = page.locator(cfg.SEL_NOVA_PROPOSTA_PANEL).first
        if await panel.count() > 0:
            await panel.click(timeout=5000)
            await asyncio.sleep(1.5)
            return
    except Exception:
        pass
    # Fallback: navegação direta
    try:
        await page.goto(cfg.dashboard_url, wait_until="domcontentloaded", timeout=cfg.timeout_page)
    except Exception:
        pass
