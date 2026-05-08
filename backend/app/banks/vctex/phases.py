import re
import asyncio
import logging
from playwright.async_api import Page
from .config import VCTexConfig as _Cfg

log = logging.getLogger("vctex.phases")


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

async def _nav_consultas(page: Page, cfg: _Cfg) -> None:
    """Navega para Consultas Termo — via URL direta (mais robusto)."""
    await page.goto(cfg.CONSULTAS_URL, timeout=cfg.timeout_page)
    await page.wait_for_load_state("networkidle", timeout=cfg.timeout_page)
    await asyncio.sleep(1)


async def _search_cpf(page: Page, cpf: str, cfg: _Cfg) -> None:
    """Preenche o campo de pesquisa e clica em Pesquisar para isolar o CPF."""
    cpf_fmt = _fmt_cpf(cpf)
    search = page.locator(cfg.SEL_F1_SEARCH_CPF).first
    await search.wait_for(state="visible", timeout=cfg.timeout_page)
    await search.fill("")
    await search.fill(cpf_fmt)
    await page.locator(cfg.SEL_F1_BTN_SEARCH).click()
    # Aguarda tabela renderizar — usa networkidle + sleep fixo (botões têm pointer-events:none durante loading)
    try:
        await page.wait_for_load_state("networkidle", timeout=15_000)
    except Exception:
        pass
    await asyncio.sleep(2)  # margem extra pra animação do spinner desaparecer


async def _screenshot_on_error(page: Page, label: str) -> None:
    try:
        path = f"/tmp/vctex_error_{label}.png"
        await page.screenshot(path=path, full_page=True)
        log.warning("Screenshot salvo: %s", path)
    except Exception:
        pass


def _extract_strong(text: str, pattern: str) -> str | None:
    m = re.search(pattern, text)
    return m.group(1).strip() if m else None


def _fmt_cpf(cpf: str) -> str:
    """Normaliza CPF para XXX.XXX.XXX-XX (portal exige formato com pontos e traço)."""
    digits = re.sub(r"\D", "", cpf)
    if len(digits) == 11:
        return f"{digits[:3]}.{digits[3:6]}.{digits[6:9]}-{digits[9:]}"
    return cpf  # devolve original se não tiver 11 dígitos


def _fmt_telefone(tel: str | None) -> str | None:
    """Formata telefone para o padrão do portal: (XX) 9XXXX-XXXX.
    O portal exige SOMENTE celular com 9 no início. Retorna None se inválido."""
    if not tel:
        return None
    digits = re.sub(r"\D", "", tel)
    if len(digits) > 11 and digits.startswith("55"):
        digits = digits[2:]
    # Converte 10 dígitos (fixo) → 11 dígitos inserindo o 9 após o DDD
    if len(digits) == 10:
        digits = digits[:2] + "9" + digits[2:]
    if len(digits) == 11 and digits[2] == "9":
        return f"({digits[:2]}) {digits[2:7]}-{digits[7:]}"
    return None


# ─────────────────────────────────────────────────────────────────────────────
# FASE 0 — Adicionar Termo
# ─────────────────────────────────────────────────────────────────────────────

async def fase0_adicionar_termo(
    page: Page,
    cpf: str,
    nome: str | None,
    telefone: str | None,
    cfg: _Cfg | None = None,
) -> str:
    """
    Navega até o formulário de Termo, preenche e envia.
    Retorna: 'adicionado' | 'ja_existe' | 'erro:<msg>'
    """
    cfg = cfg or _Cfg()
    try:
        # 1. Ir para Consultas Termo
        await _nav_consultas(page, cfg)

        # 2. Clicar em "Adicionar Termo" → navega para /termo-autorizacao
        btn_add = page.locator(cfg.SEL_BTN_ADICIONAR_TERMO).first
        await btn_add.wait_for(state="visible", timeout=cfg.timeout_page)
        await btn_add.click()
        await page.wait_for_url("**/termo-autorizacao**", timeout=cfg.timeout_page)
        await asyncio.sleep(0.8)

        # 3. Preencher campos
        await page.locator(cfg.SEL_F0_CPF).fill(cpf.zfill(11))
        await asyncio.sleep(0.3)

        # Nome: precisa de pelo menos 2 palavras; usa fallback se ausente ou inválido
        nome_limpo = (nome or "").strip()
        if not nome_limpo or len(nome_limpo.split()) < 2 or nome_limpo.upper() in ("N/A", "NA", "-"):
            nome_limpo = "Beneficiario Autorizacao"
        await page.locator(cfg.SEL_F0_NOME).fill(nome_limpo)
        await asyncio.sleep(0.2)

        await page.locator(cfg.SEL_F0_EMAIL).fill(cfg.email_placeholder)
        await asyncio.sleep(0.2)

        # Telefone é obrigatório — usa placeholder se não tiver número válido
        tel_fmt = _fmt_telefone(telefone) or "(11) 91111-1111"
        await page.locator(cfg.SEL_F0_TEL).fill(tel_fmt)
        await asyncio.sleep(0.3)

        # 4. Enviar Termo
        submit = page.locator(cfg.SEL_F0_SUBMIT).first
        await submit.wait_for(state="attached", timeout=cfg.timeout_page)
        try:
            await submit.click(timeout=10_000)
        except Exception:
            # Botão ainda desabilitado — fallback via JS dispatch event
            await page.evaluate(
                "document.querySelector(\"button[type='submit']\").dispatchEvent(new MouseEvent('click', {bubbles:true}))"
            )
        await asyncio.sleep(3)

        # 5. Verificar resultado
        body_text = await page.inner_text("body")

        # CPF já existe (overlay ou toast "Pré-operação já foi criada")?
        if re.search(
            r"já cadastrado|já existe|already exists|Pré-operação.*já foi criada|já foi criada",
            body_text, re.IGNORECASE
        ):
            log.info("CPF %s — já existe/pré-operação criada, avançando para fase1", cpf)
            try:
                overlay = page.locator(cfg.SEL_F0_POPUP_OVERLAY).first
                if await overlay.count() > 0:
                    await overlay.click()
                    await asyncio.sleep(0.5)
            except Exception:
                pass
            return "ja_existe"

        # Verifica sucesso: popup CSS (pode mudar) OU texto de confirmação no body
        overlay = page.locator(cfg.SEL_F0_POPUP_OVERLAY).first
        popup_visible = await overlay.count() > 0
        success_text = re.search(
            r"termo enviado|enviado com sucesso|sucesso|termo.*criado|link.*enviado",
            body_text, re.IGNORECASE
        )
        if not popup_visible and not success_text:
            await _screenshot_on_error(page, f"fase0_sem_submit_{cpf.replace('.','').replace('-','')}")
            log.error("fase0 CPF %s: popup não apareceu — submit falhou silenciosamente", cpf)
            return "erro:submit não disparado pelo portal"

        # 6. Fechar popup clicando fora (se overlay CSS presente)
        if popup_visible:
            try:
                await overlay.click()
                await asyncio.sleep(0.8)
            except Exception:
                await page.keyboard.press("Escape")
                await asyncio.sleep(0.5)
        else:
            await page.keyboard.press("Escape")
            await asyncio.sleep(0.5)

        log.info("CPF %s adicionado com sucesso (fase0)", cpf)
        return "adicionado"

    except Exception as e:
        await _screenshot_on_error(page, f"fase0_{cpf.replace('.', '').replace('-', '')}")
        log.error("fase0 erro CPF %s: %s", cpf, str(e)[:300])
        return f"erro:{str(e)[:200]}"


# ─────────────────────────────────────────────────────────────────────────────
# FASE 1 — Assinar Link de Autorização
# ─────────────────────────────────────────────────────────────────────────────

async def fase1_assinar_link(
    page: Page,
    cpf: str,
    cfg: _Cfg | None = None,
) -> str:
    """
    Pesquisa o CPF, abre menu Ações, copia link de autorização,
    abre nova aba, clica Assinar, aguarda confirmação.
    Retorna: 'aguardando_autorizacao' | 'erro:<msg>'
    """
    cfg = cfg or _Cfg()
    plurio_page = None
    try:
        # 1. Ir para Consultas Termo
        await _nav_consultas(page, cfg)

        # 2. Pesquisar CPF
        await _search_cpf(page, cpf, cfg)

        # 3. Aguarda loading da tabela desaparecer após pesquisa
        try:
            await page.locator("[role='progressbar'], .MuiCircularProgress-root, .MuiLinearProgress-root").wait_for(state="hidden", timeout=8_000)
        except Exception:
            pass
        await asyncio.sleep(0.5)

        # Log estado da página antes de tentar clicar
        try:
            buttons_vis = await page.locator("button:visible").all_inner_texts()
            log.info("fase1 CPF %s — url=%s | buttons=%s", cpf, page.url, buttons_vis[:20])
        except Exception:
            pass

        # 4. Clicar em "Ações"
        acoes_btn = page.locator(cfg.SEL_F1_BTN_ACOES).first
        if await acoes_btn.count() == 0:
            await asyncio.sleep(5)
            await _nav_consultas(page, cfg)
            await _search_cpf(page, cpf, cfg)
            try:
                await page.locator("[role='progressbar'], .MuiCircularProgress-root").wait_for(state="hidden", timeout=8_000)
            except Exception:
                pass
            acoes_btn = page.locator(cfg.SEL_F1_BTN_ACOES).first
        if await acoes_btn.count() == 0:
            log.error("fase1 erro CPF %s: botão Ações não encontrado após pesquisa. url=%s", cpf, page.url)
            await _screenshot_on_error(page, f"fase1_sem_acoes_{cpf.replace('.','').replace('-','')}")
            return "erro:botão Ações não encontrado após pesquisa"

        # Click: tenta normal → force → JS evaluate (último recurso para React/MUI com pointer-events:none)
        menu_abriu = False
        for _attempt, _strategy in enumerate(["normal", "force", "js"]):
            try:
                if _strategy == "normal":
                    await acoes_btn.scroll_into_view_if_needed(timeout=3000)
                    await acoes_btn.click(timeout=6_000)
                elif _strategy == "force":
                    log.warning("fase1 CPF %s: click normal falhou; tentando force=True", cpf)
                    await acoes_btn.click(force=True, timeout=5000)
                else:
                    log.warning("fase1 CPF %s: force falhou; tentando JS evaluate click", cpf)
                    clicked = await page.evaluate("""() => {
                        const btns = Array.from(document.querySelectorAll('button'));
                        const btn = btns.find(b => b.textContent.trim().startsWith('Ações'));
                        if (btn) { btn.click(); return true; }
                        return false;
                    }""")
                    if not clicked:
                        log.error("fase1 CPF %s: JS click — botão Ações não encontrado no DOM", cpf)
                        await _screenshot_on_error(page, f"fase1_acoes_nao_encontrado_{cpf.replace('.','').replace('-','')}")
                        return "erro:botão Ações não encontrado no DOM"
            except Exception as click_err:
                log.warning("fase1 CPF %s: estratégia %s falhou: %s", cpf, _strategy, str(click_err)[:80])
                continue

            await asyncio.sleep(2.0)
            # Verifica se menu abriu
            n_items = await page.locator("[role='menuitem']").count()
            if n_items > 0:
                log.info("fase1 CPF %s — menu abriu via '%s' (%d itens)", cpf, _strategy, n_items)
                menu_abriu = True
                break

        if not menu_abriu:
            await _screenshot_on_error(page, f"fase1_menu_nao_abriu_{cpf.replace('.','').replace('-','')}")
            log.error("fase1 CPF %s — menu Ações não abriu com nenhuma estratégia", cpf)
            return "erro:menu Ações não abriu"

        # 5. Log atributos do menu item antes de clicar (diagnóstico)
        try:
            item_meta = await page.evaluate("""() => {
                const items = document.querySelectorAll('[role="menuitem"]');
                return Array.from(items).map(el => ({
                    text: el.textContent.trim().substring(0, 80),
                    href: el.href || el.getAttribute('href') || null,
                    dataUrl: el.dataset.url || el.dataset.href || null,
                    html: el.innerHTML.substring(0, 200),
                }));
            }""")
            log.info("CPF %s — menuitem attrs: %s", cpf, str(item_meta)[:400])
        except Exception:
            pass

        # Intercepta clipboard + nova aba abertas pelo clique
        await page.evaluate("""
            window.__vctex_link = null;
            try {
                const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
                navigator.clipboard.writeText = async (text) => {
                    window.__vctex_link = text;
                    try { return await orig(text); } catch(e) {}
                };
            } catch(e) {}
            try {
                const origExec = document.execCommand.bind(document);
                document.execCommand = function(cmd, ...args) {
                    if (cmd === 'copy') {
                        try {
                            const sel = window.getSelection();
                            if (sel && sel.toString().startsWith('http')) {
                                window.__vctex_link = sel.toString();
                            }
                            const active = document.activeElement;
                            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
                                const v = active.value || '';
                                if (v.startsWith('http')) window.__vctex_link = v;
                            }
                        } catch(e) {}
                    }
                    return origExec(cmd, ...args);
                };
            } catch(e) {}
        """)

        # 6. Clicar no item "Link Termo Autorização"
        link_item = page.locator(cfg.SEL_F1_MENU_LINK).first
        try:
            await link_item.wait_for(state="visible", timeout=6_000)
        except Exception:
            try:
                menu_items = await page.locator("[role='menuitem']").all_inner_texts()
                if menu_items:
                    log.warning("CPF %s — menu aberto mas 'Link Termo' ausente. Itens: %s", cpf, menu_items)
                else:
                    body_snip = (await page.inner_text("body"))[:600]
                    log.warning("CPF %s — menu vazio/não abriu. Body: %s", cpf, body_snip)
            except Exception as de:
                log.warning("CPF %s — erro ao diagnosticar menu: %s", cpf, str(de)[:100])
            await _screenshot_on_error(page, f"fase1_sem_link_{cpf.replace('.','').replace('-','')}")
            log.info("CPF %s — 'Link Termo' ausente no menu; presumindo já assinado", cpf)
            return "aguardando_autorizacao"

        # Registra listener de nova aba — portal pode abrir o link direto em vez de copiar
        new_pages: list = []
        def _capture_new_page(p):
            new_pages.append(p)
        page.context.on("page", _capture_new_page)

        log.info("CPF %s — clicando Link Termo...", cpf)
        await link_item.click()
        await asyncio.sleep(2.5)  # aguarda clipboard async ou nova aba

        page.context.remove_listener("page", _capture_new_page)

        # 7. Recuperar link — 4 estratégias em ordem de prioridade

        # Estratégia A: nova aba/popup abriu com o link
        link_url: str | None = None
        if new_pages:
            np = new_pages[0]
            await asyncio.sleep(0.5)
            candidate = np.url
            log.info("CPF %s — nova aba detectada: %s", cpf, candidate[:120])
            if candidate and candidate.startswith("http") and "about:blank" not in candidate:
                link_url = candidate
                plurio_page = np  # reutiliza a aba já aberta
            else:
                try:
                    await np.close()
                except Exception:
                    pass

        # Estratégia B: intercept clipboard.writeText
        if not link_url:
            link_url = await page.evaluate("window.__vctex_link")
            log.info("CPF %s — clipboard intercept: %s", cpf, repr(link_url)[:120])

        # Estratégia C: clipboard.readText()
        if not link_url or not link_url.startswith("http"):
            try:
                link_url = await page.evaluate("navigator.clipboard.readText()")
                log.info("CPF %s — clipboard.readText(): %s", cpf, repr(link_url)[:120])
            except Exception as ce:
                log.warning("CPF %s — clipboard.readText() falhou: %s", cpf, str(ce)[:100])

        # Estratégia D: DOM anchor
        if not link_url or not link_url.startswith("http"):
            try:
                link_url = await page.evaluate("""() => {
                    const anchors = Array.from(document.querySelectorAll('a[href]'));
                    const found = anchors.find(a =>
                        a.href.includes('plurio') || a.href.includes('autorizac') ||
                        a.href.includes('assinar') || a.href.includes('termo')
                    );
                    return found ? found.href : null;
                }""")
                log.info("CPF %s — DOM anchor fallback: %s", cpf, repr(link_url)[:120])
            except Exception:
                pass

        if not link_url or not link_url.startswith("http"):
            log.error("CPF %s — FALHA: link de autorização não obtido. Todas estratégias falharam.", cpf)
            await _screenshot_on_error(page, f"fase1_sem_link_clipboard_{cpf.replace('.','').replace('-','')}")
            return "erro:não foi possível obter o link de autorização"

        log.info("CPF %s — link obtido: %s", cpf, link_url[:60])

        # 8. Usar aba já aberta (nova aba) ou abrir manualmente
        if plurio_page is None:
            plurio_page = await page.context.new_page()
            await plurio_page.goto(link_url, timeout=cfg.timeout_auth)
        await plurio_page.wait_for_load_state("networkidle", timeout=cfg.timeout_auth)
        await asyncio.sleep(1)

        # 8. Clicar em "Assinar"
        assinar = plurio_page.locator(cfg.SEL_PLURIO_ASSINAR).first
        await assinar.wait_for(state="visible", timeout=cfg.timeout_auth)
        await assinar.click()
        await asyncio.sleep(6)

        # 9. Verificar mensagem de sucesso
        body = await plurio_page.inner_text("body")
        if not re.search(r"processada com sucesso|assinatura.*sucesso|signed|assinado", body, re.IGNORECASE):
            await _screenshot_on_error(plurio_page, f"fase1_plurio_{cpf.replace('.','').replace('-','')}")
            log.warning("CPF %s — assinatura Plurio sem confirmação de sucesso", cpf)

        log.info("CPF %s assinado (fase1) → aguardando_autorizacao", cpf)
        return "aguardando_autorizacao"

    except Exception as e:
        await _screenshot_on_error(page, f"fase1_{cpf.replace('.', '').replace('-', '')}")
        log.error("fase1 erro CPF %s: %s", cpf, str(e)[:300])
        return f"erro:{str(e)[:200]}"

    finally:
        if plurio_page:
            try:
                await plurio_page.close()
            except Exception:
                pass


# ─────────────────────────────────────────────────────────────────────────────
# FASE 2 — Polling + Simulação
# ─────────────────────────────────────────────────────────────────────────────

async def _ler_campo(page: Page, label: str, cfg: _Cfg) -> str | None:
    """Lê o valor de um campo pelo texto do label na tela Nova Proposta.
    Usa travessia DOM para não depender de nomes de classes dinâmicos."""
    try:
        value = await page.evaluate("""(label) => {
            // Procura folhas de texto exatamente iguais ao label
            const leaves = Array.from(document.querySelectorAll('*')).filter(
                el => el.children.length === 0 && el.textContent.trim() === label
            );
            for (const el of leaves) {
                // 1. Irmão direto seguinte
                const sib = el.nextElementSibling;
                if (sib) {
                    const t = sib.textContent.trim();
                    if (t && t !== '-') return t;
                }
                // 2. Pai → irmão seguinte do pai
                const parent = el.parentElement;
                if (parent) {
                    const parentSib = parent.nextElementSibling;
                    if (parentSib) {
                        const t = parentSib.textContent.trim();
                        if (t && t !== '-') return t;
                    }
                    // 3. Outros filhos diretos do pai (exceto o próprio label)
                    for (const child of parent.children) {
                        if (child !== el) {
                            const t = child.textContent.trim();
                            if (t && t !== '-') return t;
                        }
                    }
                }
            }
            return null;
        }""", label)
        return value if value and value != "-" else None
    except Exception:
        return None


async def fase2_simular(
    page: Page,
    cpf: str,
    cfg: _Cfg | None = None,
) -> dict:
    """
    Polling até o botão 'Simular' aparecer (banco processou).
    Clica Simular → aguarda popup 4s → lê resultado.
    Se Elegível: clica Selecionar → Simular → extrai dados financeiros.
    Retorna dict com fase, situacao e dados.
    """
    cfg = cfg or _Cfg()
    result: dict = {
        "fase": "aguardando_autorizacao",  # default: ainda aguardando
        "situacao": None,
        "margem_disponivel": None,
        "valor_liberado": None,
        "parcelas": None,
        "data_nascimento": None,
        "tempo_de_casa": None,
        "termino_contrato": None,
        "observacao_portal": None,
    }

    try:
        # ── Polling: aguarda botão Simular ────────────────────────────────────
        simular_pronto = False
        for tentativa in range(cfg.poll_max_attempts):
            await _nav_consultas(page, cfg)
            await _search_cpf(page, cpf, cfg)

            btn_simular = page.locator(cfg.SEL_F2_BTN_SIMULAR).first
            btn_acomp   = page.locator(cfg.SEL_F2_BTN_ACOMPANHAR).first

            if await btn_simular.count() > 0:
                simular_pronto = True
                log.info("CPF %s — botão Simular disponível (tentativa %d)", cpf, tentativa + 1)
                break

            if await btn_acomp.count() > 0:
                log.info("CPF %s — ainda aguardando autorização (tentativa %d/%d)",
                         cpf, tentativa + 1, cfg.poll_max_attempts)
            else:
                # Verifica se o banco já processou como não-elegível
                # (Ações visível, sem Simular nem Acompanhar)
                btn_acoes = page.locator("button:has-text('Ações')").first
                if await btn_acoes.count() > 0:
                    try:
                        row_el = page.locator("div:has(button:has-text('Ações'))").first
                        row_text = (await row_el.inner_text()).strip() if await row_el.count() > 0 else ""
                    except Exception:
                        row_text = ""
                    if not row_text:
                        row_text = await page.inner_text("body")
                    # Extrai a frase de resultado (sem elegível)
                    m = re.search(
                        r"(N[aã]o foi encontrado.{0,120}|Sem v[ií]nculo.{0,80}|"
                        r"N[aã]o eleg[ií]vel.{0,80}|n[aã]o tem v[ií]nculo.{0,80})",
                        row_text, re.IGNORECASE | re.DOTALL,
                    )
                    status_msg = m.group(1).strip()[:200] if m else "Não Elegível"
                    log.info("CPF %s — banco já processou (não elegível): %s", cpf, status_msg[:100])
                    result.update({
                        "fase": "inelegivel",
                        "situacao": "Não Elegível",
                        "observacao_portal": status_msg,
                    })
                    return result

                log.warning("CPF %s — nenhum botão reconhecido na linha (tentativa %d)",
                            cpf, tentativa + 1)
                if tentativa == 0:
                    await _screenshot_on_error(page, f"fase2_poll0_{cpf.replace('.','').replace('-','')}")

            if tentativa < cfg.poll_max_attempts - 1:
                await asyncio.sleep(cfg.poll_interval_s)

        if not simular_pronto:
            log.info("CPF %s — timeout polling fase2, será reprocessado depois", cpf)
            return result  # fase permanece 'aguardando_autorizacao'

        # ── Clica Simular ─────────────────────────────────────────────────────
        btn_simular = page.locator(cfg.SEL_F2_BTN_SIMULAR).first
        await btn_simular.click()

        # ── Aguarda popup "Termo autorização validado!" (≈4s) ─────────────────
        try:
            popup = page.locator(cfg.SEL_F2_POPUP_VALIDADO).first
            await popup.wait_for(state="visible", timeout=8_000)
            log.info("CPF %s — popup validação apareceu, aguardando 4s", cpf)
            await asyncio.sleep(4.5)
        except Exception:
            await asyncio.sleep(4)  # aguarda mesmo sem detectar popup

        # ── Aguarda tela nova-proposta ─────────────────────────────────────────
        await page.wait_for_url("**/nova-proposta**", timeout=cfg.timeout_page)
        await page.wait_for_load_state("networkidle", timeout=cfg.timeout_page)
        await asyncio.sleep(1)

        # ── Lê dados do trabalhador ────────────────────────────────────────────
        result["margem_disponivel"]  = await _ler_campo(page, "Margem Disponível", cfg)
        result["data_nascimento"]    = await _ler_campo(page, "Data Nascimento", cfg)
        result["tempo_de_casa"]      = await _ler_campo(page, "Tempo de Casa", cfg)
        result["termino_contrato"]   = await _ler_campo(page, "Término Contrato", cfg)
        situacao_raw                 = await _ler_campo(page, "Situação", cfg)

        # ── Verifica elegibilidade ─────────────────────────────────────────────
        error_el = page.locator(cfg.SEL_F2_ERROR_MSG).first
        has_error = await error_el.count() > 0
        error_text = (await error_el.inner_text()).strip() if has_error else None

        btn_selecionar = page.locator(cfg.SEL_F2_BTN_SELECIONAR).first
        has_selecionar = await btn_selecionar.count() > 0
        # Botão Selecionar habilitado é o sinal mais confiável de elegibilidade
        # (situacao_raw pode ser lido errado se os seletores CSS mudaram)
        is_elegivel = has_selecionar and not has_error

        if not is_elegivel:
            _STATUSES_VALIDOS = {"Elegível", "Não Elegível", "NÃO TEM VÍNCULO CLT"}
            situacao_final = situacao_raw if situacao_raw in _STATUSES_VALIDOS else "Não Elegível"
            result["fase"]     = "inelegivel"
            result["situacao"] = situacao_final
            result["observacao_portal"] = error_text or situacao_raw
            log.info("CPF %s — NÃO ELEGÍVEL: %s", cpf, result["observacao_portal"])
            return result

        # ── ELEGÍVEL: clica Selecionar → Simular final ────────────────────────
        log.info("CPF %s — ELEGÍVEL! Clicando Selecionar...", cpf)
        await btn_selecionar.click()
        await asyncio.sleep(1.5)

        btn_simular_final = page.locator(cfg.SEL_F2_BTN_SIMULAR_FINAL).first
        await btn_simular_final.wait_for(state="visible", timeout=cfg.timeout_page)
        await btn_simular_final.click()
        await asyncio.sleep(5)

        # ── Extrai Valor Liberado e Parcelas ──────────────────────────────────
        page_text = await page.inner_text("body")

        # 1. Tenta achar "Valor Liberado" seguido de R$ no texto da página
        m_valor = re.search(
            r"Valor\s+Liberado[^\n]{0,40}\n?\s*(R\$\s*[\d.]+,\d{2})", page_text
        )
        valor_liberado = m_valor.group(1).strip() if m_valor else None

        # 2. Fallback: primeiro <strong> com R$ que não contenha "x R$" (parcelas)
        if not valor_liberado:
            strong_els = await page.locator("strong").all_inner_texts()
            for s in strong_els:
                s = s.strip()
                if re.match(r"R\$\s*[\d.,]+", s) and not re.search(r"\d+\s*[xX]", s):
                    valor_liberado = s
                    break

        # 3. Fallback: maior valor R$ na página inteira
        if not valor_liberado:
            candidatos = re.findall(r"R\$\s*([\d.]+,\d{2})", page_text)
            if candidatos:
                def _parse(v: str) -> float:
                    return float(v.replace(".", "").replace(",", "."))
                maior = max(candidatos, key=_parse)
                valor_liberado = f"R$ {maior}"

        # Parcelas: "12 x R$ 1.234,56" ou "12x R$..."
        m_parcelas = re.search(r"(\d+\s*[xX]\s*R\$\s*[\d.,]+)", page_text)
        parcelas = m_parcelas.group(1).strip() if m_parcelas else None

        if not parcelas:
            strong_fallback = await page.locator("strong").all_inner_texts()
            for s in strong_fallback:
                if re.search(r"\d+\s*[xX]\s*R\$", s.strip()):
                    parcelas = s.strip()
                    break

        result.update({
            "fase":           "elegivel",
            "situacao":       "Elegível",
            "valor_liberado": valor_liberado,
            "parcelas":       parcelas,
        })
        log.info("CPF %s — concluído ELEGÍVEL | valor=%s | parcelas=%s",
                 cpf, valor_liberado, parcelas)
        return result

    except Exception as e:
        await _screenshot_on_error(page, f"fase2_{cpf.replace('.', '').replace('-', '')}")
        log.error("fase2 erro CPF %s: %s", cpf, str(e)[:300])
        result["fase"] = "erro"
        result["observacao_portal"] = str(e)[:300]
        return result
