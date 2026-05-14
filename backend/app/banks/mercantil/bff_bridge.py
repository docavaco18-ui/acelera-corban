"""BFF Bridge — chama a API Mercantil de dentro do contexto Playwright.

page.evaluate(fetch(...)) herda:
  - JWT do localStorage["PCB_AUTH"]
  - Cookies de sessão autenticada
  - Origin = meu.bancomercantil.com.br → CORS aceito pelo BFF

Isso bypassa completamente o reCAPTCHA Enterprise score-based:
a chamada não passa pelo handler Angular que intercepta o submit do form.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import Any

from playwright.async_api import Page

from .config import MercantilConfig

log = logging.getLogger("mercantil.bff_bridge")

BFF_BASE = "https://api.mercantil.com.br:8443/pcb/sitebff/api"
EMPRESA_ID = 2

_STATUS_PRONTO = {"RetornoDisponivel", "ProdutosDisponiveis", "Disponivel"}
_STATUS_DATAPREV = {"DataprevNecessario", "Pendente"}
_STATUS_PROCESSANDO = {"ConsultaSolicitada", "ConsultaAutorizada", "RetornoEmProcessamento"}

# JS que executa fetch() dentro da página e retorna o resultado pro Python.
# Recebe {method, url, body} como argumento.
_FETCH_JS = """
async ({method, url, body}) => {
    // Extrai JWT do localStorage (raw ou JSON-wrapped)
    let jwt = null;
    let sessaoId = '';
    let mbData = {};

    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const v = localStorage.getItem(k);
        if (!v) continue;
        // JWT raw (começa com ey)
        if (v.startsWith('ey') && v.split('.').length >= 3) {
            jwt = v; break;
        }
        // JSON-wrapped
        if (v.startsWith('{')) {
            try {
                const obj = JSON.parse(v);
                for (const tk of ['access_token', 'token', 'accessToken', 'jwt']) {
                    const t = obj[tk];
                    if (t && typeof t === 'string' && t.startsWith('ey')) {
                        jwt = t; break;
                    }
                }
                if (jwt) break;
            } catch(e) {}
        }
    }

    if (!jwt) return {ok: false, status: 0, error: 'JWT_NOT_FOUND'};

    // Decodifica payload do JWT para extrair sessaoId e mb.data
    try {
        const raw = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const pad = raw + '==='.slice(0, (4 - raw.length % 4) % 4);
        const payload = JSON.parse(atob(pad));
        const mb = payload['mb.data'] || (payload.mb && payload.mb.data) || {};
        sessaoId = (mb.usuario && mb.usuario.sessaoId) || '';
        mbData = mb;
    } catch(e) {}

    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Authorization': 'Bearer ' + jwt,
        'X-Requested-With': 'XMLHttpRequest',
    };
    if (sessaoId) headers['sessaousuarioid'] = sessaoId;

    const opts = {method, headers};
    if (body) opts.body = JSON.stringify(body);

    try {
        const resp = await fetch(url, opts);
        let data;
        try { data = await resp.json(); } catch(e) { data = await resp.text(); }
        return {ok: resp.ok, status: resp.status, data, jwt, sessaoId, mbData};
    } catch(e) {
        return {ok: false, status: 0, error: String(e), jwt, sessaoId, mbData};
    }
}
"""

# JS que só extrai JWT + mbData (sem fetch) — usado pra capturar sessão
_SESSION_JS = """
() => {
    let jwt = null;
    let mbData = {};

    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const v = localStorage.getItem(k);
        if (!v) continue;
        if (v.startsWith('ey') && v.split('.').length >= 3) {
            jwt = v; break;
        }
        if (v.startsWith('{')) {
            try {
                const obj = JSON.parse(v);
                for (const tk of ['access_token', 'token', 'accessToken', 'jwt']) {
                    const t = obj[tk];
                    if (t && typeof t === 'string' && t.startsWith('ey')) {
                        jwt = t; break;
                    }
                }
                if (jwt) break;
            } catch(e) {}
        }
    }

    if (!jwt) return {jwt: null, mbData: {}, sessaoId: ''};

    let sessaoId = '';
    try {
        const raw = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const pad = raw + '==='.slice(0, (4 - raw.length % 4) % 4);
        const payload = JSON.parse(atob(pad));
        const mb = payload['mb.data'] || (payload.mb && payload.mb.data) || {};
        sessaoId = (mb.usuario && mb.usuario.sessaoId) || '';
        mbData = mb;
    } catch(e) {}

    return {jwt, mbData, sessaoId};
}
"""


class BffBridgeError(Exception):
    def __init__(self, status: int, data: Any, message: str = ""):
        self.status = status
        self.data = data
        super().__init__(message or f"BFF HTTP {status}: {str(data)[:200]}")


async def _bff_call(page: Page, method: str, path: str, body: dict | None = None) -> dict:
    """Executa fetch() dentro da página e retorna {ok, status, data, jwt, sessaoId, mbData}."""
    url = f"{BFF_BASE}/{path}"
    result = await page.evaluate(_FETCH_JS, {"method": method, "url": url, "body": body})
    if result.get("error") == "JWT_NOT_FOUND":
        log.error("bff_bridge JWT não encontrado no localStorage (page=%s)", page.url)
        raise BffBridgeError(0, None, "JWT não encontrado — usuário precisa estar logado")
    if result.get("error"):
        raise BffBridgeError(0, None, f"fetch() falhou: {result['error']}")
    if not result.get("ok"):
        raise BffBridgeError(result["status"], result.get("data"))
    return result


async def get_session_data(page: Page) -> dict:
    """Extrai {jwt, sessaoId, correspondente, substabelecido, usuario} do localStorage."""
    result = await page.evaluate(_SESSION_JS)
    mb = result.get("mbData") or {}
    return {
        "jwt": result.get("jwt"),
        "sessaoId": result.get("sessaoId", ""),
        "correspondente": mb.get("correspondente") or {},
        "substabelecido": mb.get("substabelecido") or {},
        "usuario": mb.get("usuario") or {},
    }


async def load_mte_convenio(page: Page) -> dict | None:
    """Busca GET /Convenios/Publicos e retorna o convênio MTE."""
    try:
        r = await _bff_call(page, "GET", "Convenios")
        convenios = r["data"]
        if isinstance(convenios, list):
            for c in convenios:
                nome = (c.get("nome") or c.get("descricao") or "").upper()
                if "MINISTERIO DO TRABALHO" in nome:
                    log.info("bff_bridge MTE convenio: id=%s nome=%s modalidade=%s",
                             c.get("id"), c.get("nome"), c.get("modalidadeConvenio"))
                    return c
        log.warning("bff_bridge MTE não encontrado em %d convenios", len(convenios or []))
    except BffBridgeError as e:
        log.error("bff_bridge load_mte_convenio err: %s", e)
    return None


def _build_iniciar_body(cpf_digits: str, sessao: dict, convenio: dict) -> dict:
    corr = sessao.get("correspondente") or {}
    sub = sessao.get("substabelecido") or {}
    usr = sessao.get("usuario") or {}
    return {
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


def _money(v) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        s = str(v).replace("R$", "").replace("\xa0", "").replace(" ", "").strip()
        s = s.replace(".", "").replace(",", ".") if "," in s else s
        try:
            return float(s)
        except (ValueError, TypeError):
            return None


def _int_val(v) -> int | None:
    if v is None:
        return None
    try:
        return int(v)
    except (ValueError, TypeError):
        m = re.search(r"\d+", str(v))
        return int(m.group(0)) if m else None


def _parse_detalhes(det: dict, uuid_portal: str, nome: str, cpf: str) -> dict:
    """Extrai resultado do response de Detalhes (schema confirmado pela API real).

    Campos financeiros: det["propostaEmprestimo"]["valorLiberado"] etc.
    Nome real: det["cliente"]["nome"].
    """
    pe = det.get("propostaEmprestimo") or {}
    cliente = det.get("cliente") or {}
    nome_real = cliente.get("nome") or nome

    valor_liberado = _money(pe.get("valorLiberado"))

    if valor_liberado is None or valor_liberado <= 0:
        log.warning("bff_bridge parse CPF=%s valorLiberado=%s — inelegível", cpf, valor_liberado)
        return {
            "status": "inelegivel",
            "uuid_portal": uuid_portal,
            "nome": nome_real,
            "erro": "sem margem ou não elegível (valorLiberado=0)",
        }

    return {
        "status": "elegivel",
        "cenario": "A",
        "uuid_portal": uuid_portal,
        "nome": nome_real,
        "valor_liberado": valor_liberado,
        "valor_parcela": _money(pe.get("valorParcela")),
        "qtd_parcelas": _int_val(pe.get("quantidadeParcelas")),
        "prazo": _int_val(pe.get("quantidadeParcelas")),
        "taxa_juros_mes": _money(pe.get("taxaJurosMes")),
        "valor_financiado": _money(pe.get("valorFinanciado")),
        "valor_emprestimo": _money(pe.get("valorEmprestimo")),
        "valor_iof": _money(pe.get("valorIof")),
        "data_vencimento": pe.get("dataPrimeiroVencimento"),
    }


async def consultar_cpf(
    page: Page,
    cpf: str,
    poll_interval: int = 8,
    poll_max: int = 180,
) -> dict:
    """Consulta elegibilidade de CPF via BFF dentro do contexto da página.

    Retorna:
      {"status": "elegivel", "uuid_portal": ..., "nome": ..., "valor_liberado": ..., ...}
      {"status": "inelegivel", "uuid_portal": ..., "nome": ..., "erro": ...}
      {"status": "aguardando_autorizacao", "uuid_portal": ..., "nome": ...}  -- Cenário B
      {"status": "erro", "erro": ...}
    """
    cpf_digits = re.sub(r"\D", "", cpf)
    if len(cpf_digits) != 11:
        return {"status": "erro", "erro": f"CPF inválido: {cpf}"}

    # 1. Sessão
    try:
        sessao = await get_session_data(page)
    except Exception as e:
        return {"status": "erro", "erro": f"get_session_data: {e}"}

    if not sessao.get("jwt"):
        return {"status": "erro", "erro": "JWT não encontrado — faça login primeiro"}

    # 2. Convênio MTE
    try:
        convenio = await load_mte_convenio(page)
    except Exception as e:
        convenio = None
        log.warning("bff_bridge load_mte_convenio: %s", e)

    if not convenio:
        return {"status": "erro", "erro": "Convênio MTE não encontrado"}

    # 3. IniciarOperacao
    body = _build_iniciar_body(cpf_digits, sessao, convenio)
    log.info("bff_bridge IniciarOperacao CPF=%s convenioId=%s", cpf_digits, convenio.get("id"))

    try:
        r = await _bff_call(page, "POST", "PropostasProspect/IniciarOperacao", body)
    except BffBridgeError as e:
        log.error("bff_bridge IniciarOperacao HTTP %d CPF=%s: %s", e.status, cpf_digits, e.data)
        return {"status": "erro", "erro": f"IniciarOperacao HTTP {e.status}: {str(e.data)[:200]}"}
    except Exception as e:
        log.exception("bff_bridge IniciarOperacao exc CPF=%s", cpf_digits)
        return {"status": "erro", "erro": str(e)[:200]}

    dados = r["data"]
    uuid_portal = (dados.get("id") or dados.get("propostaId") or
                   dados.get("uuid") or dados.get("propostaProspectId"))
    nome = dados.get("nomeCliente") or dados.get("nome") or ""
    token_valido = dados.get("tokenValidoConsignadoPrivado", False)

    log.info("bff_bridge IniciarOperacao OK CPF=%s uuid=%s tokenValido=%s nome=%s",
             cpf_digits, uuid_portal, token_valido, nome[:30] if nome else "")

    if not uuid_portal:
        log.warning("bff_bridge sem uuid CPF=%s dados=%s", cpf_digits, str(dados)[:300])
        return {"status": "erro", "erro": f"IniciarOperacao sem UUID: {str(dados)[:200]}"}

    # 4. Cenário B
    if not token_valido:
        return {
            "status": "aguardando_autorizacao",
            "cenario": "B",
            "uuid_portal": uuid_portal,
            "nome": nome,
        }

    # 5. Cenário A — poll Detalhes até propostaEmprestimo.valorLiberado != null
    deadline = time.monotonic() + poll_max
    while time.monotonic() < deadline:
        try:
            det = await _bff_call(page, "GET", f"PropostasProspect/{uuid_portal}/Detalhes")
            detalhes = det["data"]
        except BffBridgeError as e:
            log.warning("bff_bridge Detalhes HTTP %d CPF=%s uuid=%s", e.status, cpf_digits, uuid_portal)
            await asyncio.sleep(poll_interval)
            continue
        except Exception as e:
            log.warning("bff_bridge Detalhes exc CPF=%s: %s", cpf_digits, e)
            await asyncio.sleep(poll_interval)
            continue

        pe = detalhes.get("propostaEmprestimo") or {}
        valor_liberado = pe.get("valorLiberado")
        status_portal = (detalhes.get("status") or "").strip()
        token_valido = detalhes.get("tokenValidoConsignadoPrivado", True)

        log.info("bff_bridge poll CPF=%s uuid=%s status=%s valorLiberado=%s tokenValido=%s",
                 cpf_digits, uuid_portal, status_portal, valor_liberado, token_valido)

        # Dados financeiros disponíveis → parseia
        if valor_liberado is not None:
            return _parse_detalhes(detalhes, uuid_portal, nome, cpf_digits)

        # DataPrev necessário (tokenValido virou false no polling)
        if not token_valido and status_portal in ("Digitacao", "AguardandoAutorizacao"):
            link = detalhes.get("linkEncurtadoAutorizacaoDigitalConsignadoPrivado")
            return {
                "status": "aguardando_autorizacao",
                "cenario": "B",
                "uuid_portal": uuid_portal,
                "nome": nome,
                "link_autorizacao": link,
            }

        await asyncio.sleep(poll_interval)

    log.warning("bff_bridge poll timeout CPF=%s uuid=%s", cpf_digits, uuid_portal)
    return {"status": "erro", "erro": f"Timeout {poll_max}s aguardando dados financeiros", "uuid_portal": uuid_portal}
