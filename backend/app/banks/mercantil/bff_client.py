"""Cliente HTTP direto para o BFF Mercantil.

Substitui Playwright para a consulta de CPF — sem reCAPTCHA, sem Akamai.
O único lugar onde ainda precisamos de Playwright é o login (SMS).

Fluxo API:
  1. JWT do localStorage["PCB_AUTH"].access_token (capturado após login)
  2. mb.data do payload JWT → dadosSessao (correspondente, substabelecido, usuario)
  3. GET /Convenios/Publicos → encontra MTE → convenioId + modalidadeConvenio
  4. Para cada CPF: POST /PropostasProspect/IniciarOperacao
     - tokenValidoConsignadoPrivado=true → Cenário A (elegível candidato)
     - tokenValidoConsignadoPrivado=false → aguardando DataPrev (Cenário B)
  5. Cenário A: poll GET /PropostasProspect/{uuid}/Detalhes → status pronto
  6. Simular: POST /PropostasProspect/SimulacaoPropostaEmprestimo → resultado final

Resultado em 3 casos:
  - elegivel: valor_liberado, valor_parcela, etc. extraídos de SimulacaoDetalhes
  - inelegivel: mensagem de política de crédito / sem margem
  - aguardando_autorizacao: precisa DataPrev (Cenário B) — lead marcado para retry manual
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import time
from pathlib import Path
from typing import Any

import httpx

log = logging.getLogger("mercantil.bff")

BFF_BASE = "https://api.mercantil.com.br:8443/pcb/sitebff/api"
EMPRESA_ID = 2  # BancoMercantilBrasil enum value
CONVENIO_NOME_PATTERN = "MINISTERIO DO TRABALHO"  # partial match
UF_PADRAO = "SP"

# Status strings from dadosProposta.situacaoConsulta
STATUS_PRONTO = {"RetornoDisponivel", "ProdutosDisponiveis", "Disponivel"}
STATUS_AGUARDANDO = {"ConsultaSolicitada", "ConsultaAutorizada", "RetornoEmProcessamento"}
STATUS_NEGADO_DATAPREV = {"DataprevNecessario", "Pendente"}

_DEFAULT_POLL_INTERVAL = 8  # seconds between polls
_DEFAULT_POLL_MAX = 180      # max seconds to wait for status


class BffSession:
    """Holds JWT, session data, and HTTP client for BFF calls."""

    def __init__(self, access_token: str):
        self.access_token = access_token
        self._mb_data: dict | None = None
        self._convenios: list[dict] | None = None
        self._mte_convenio: dict | None = None
        self._client: httpx.AsyncClient | None = None

    # ── JWT payload ───────────────────────────────────────────────────────────

    def _parse_mb_data(self) -> dict:
        if self._mb_data is not None:
            return self._mb_data
        try:
            parts = self.access_token.split(".")
            p1 = parts[1]
            padded = p1 + "=" * (-len(p1) % 4)
            payload = json.loads(base64.urlsafe_b64decode(padded))
            self._mb_data = payload.get("mb.data") or payload.get("mb", {}).get("data", {})
        except Exception as e:
            log.error("bff JWT decode failed: %s", e)
            self._mb_data = {}
        return self._mb_data

    @property
    def sessao_id(self) -> str:
        return self._parse_mb_data().get("usuario", {}).get("sessaoId", "")

    @property
    def correspondente(self) -> dict:
        return self._parse_mb_data().get("correspondente", {})

    @property
    def substabelecido(self) -> dict:
        return self._parse_mb_data().get("substabelecido", {}) or {}

    @property
    def usuario(self) -> dict:
        return self._parse_mb_data().get("usuario", {})

    # ── HTTP client ───────────────────────────────────────────────────────────

    def _headers(self) -> dict:
        h = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
            "Accept": "application/json, text/plain, */*",
            "Origin": "https://meu.bancomercantil.com.br",
            "Referer": "https://meu.bancomercantil.com.br/",
            "X-Requested-With": "XMLHttpRequest",
        }
        sid = self.sessao_id
        if sid:
            h["sessaousuarioid"] = sid
        return h

    async def __aenter__(self):
        self._client = httpx.AsyncClient(
            verify=False,
            timeout=30,
            headers=self._headers(),
        )
        return self

    async def __aexit__(self, *args):
        if self._client:
            await self._client.aclose()

    async def _get(self, path: str, params: dict | None = None) -> Any:
        r = await self._client.get(f"{BFF_BASE}/{path}", params=params)
        r.raise_for_status()
        return r.json()

    async def _post(self, path: str, body: dict) -> Any:
        r = await self._client.post(f"{BFF_BASE}/{path}", json=body)
        r.raise_for_status()
        return r.json()

    # ── Convenios ─────────────────────────────────────────────────────────────

    async def load_mte_convenio(self) -> dict:
        """Fetch /Convenios/Publicos and find the MTE convenio."""
        if self._mte_convenio:
            return self._mte_convenio
        try:
            convenios = await self._get("Convenios")
            if isinstance(convenios, list):
                for c in convenios:
                    nome = (c.get("nome") or c.get("descricao") or "").upper()
                    if CONVENIO_NOME_PATTERN in nome:
                        self._mte_convenio = c
                        log.info("bff MTE convenio found: id=%s nome=%s modalidade=%s",
                                 c.get("id"), c.get("nome"), c.get("modalidadeConvenio"))
                        return c
            log.warning("bff MTE convenio NOT found in list of %d convenios", len(convenios or []))
            # Fallback: use known convenio ID (discovered from previous intercept)
            return {"id": None, "nome": "MINISTERIO DO TRABALHO E EMPREGO MTE", "modalidadeConvenio": None}
        except Exception as e:
            log.error("bff load_mte_convenio failed: %s", e)
            return {"id": None, "nome": "MINISTERIO DO TRABALHO E EMPREGO MTE", "modalidadeConvenio": None}

    # ── Main consultation ──────────────────────────────────────────────────────

    def _build_iniciar_body(self, cpf_digits: str, convenio: dict) -> dict:
        corr = self.correspondente
        sub = self.substabelecido
        usr = self.usuario
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
            "uf": UF_PADRAO,
            "sessaoId": self.sessao_id,
            "modalidadeConvenio": convenio.get("modalidadeConvenio"),
            "reCaptchaToken": None,
        }

    async def consultar_cpf(
        self,
        cpf: str,
        poll_interval: int = _DEFAULT_POLL_INTERVAL,
        poll_max: int = _DEFAULT_POLL_MAX,
    ) -> dict:
        """Main entry point: CPF → eligibility result dict.

        Returns:
          {
            "status": "elegivel" | "inelegivel" | "aguardando_autorizacao" | "erro",
            "cenario": "A" | "B" | None,
            "uuid_portal": "...",
            "nome": "...",
            # + financial fields for elegivel
          }
        """
        import re
        cpf_digits = re.sub(r"\D", "", cpf)
        if len(cpf_digits) != 11:
            return {"status": "erro", "erro": f"CPF inválido: {cpf}"}

        try:
            convenio = await self.load_mte_convenio()
            body = self._build_iniciar_body(cpf_digits, convenio)
            log.info("bff iniciarOperacao CPF=%s convenioId=%s", cpf_digits, convenio.get("id"))

            dados_cliente = await self._post("PropostasProspect/IniciarOperacao", body)

        except httpx.HTTPStatusError as e:
            status_code = e.response.status_code
            text = e.response.text[:200]
            log.error("bff iniciarOperacao HTTP %d CPF=%s body=%s", status_code, cpf_digits, text)
            return {"status": "erro", "erro": f"HTTP {status_code}: {text}"}
        except Exception as e:
            log.exception("bff iniciarOperacao exception CPF=%s", cpf_digits)
            return {"status": "erro", "erro": str(e)[:200]}

        uuid_portal = dados_cliente.get("id") or dados_cliente.get("propostaId") or dados_cliente.get("uuid")
        nome = dados_cliente.get("nomeCliente") or dados_cliente.get("nome") or ""
        token_valido = dados_cliente.get("tokenValidoConsignadoPrivado", False)

        log.info("bff iniciarOperacao OK CPF=%s uuid=%s tokenValido=%s",
                 cpf_digits, uuid_portal, token_valido)

        if not uuid_portal:
            # IniciarOperacao returned no uuid - unexpected
            log.warning("bff no uuid in response CPF=%s resp=%s", cpf_digits, str(dados_cliente)[:200])
            return {
                "status": "erro",
                "erro": f"IniciarOperacao sem UUID: {str(dados_cliente)[:200]}",
                "raw": dados_cliente,
            }

        if not token_valido:
            # Cenário B: needs DataPrev authorization
            return {
                "status": "aguardando_autorizacao",
                "cenario": "B",
                "uuid_portal": uuid_portal,
                "nome": nome,
            }

        # Cenário A: proceed to poll and simulate
        return await self._poll_and_simulate(cpf_digits, uuid_portal, nome, poll_interval, poll_max)

    async def _poll_and_simulate(
        self,
        cpf_digits: str,
        uuid_portal: str,
        nome: str,
        poll_interval: int,
        poll_max: int,
    ) -> dict:
        """Poll /PropostasProspect/{uuid}/Detalhes até dados financeiros aparecerem.

        Schema real (confirmado): dados em detalhes["propostaEmprestimo"]["valorLiberado"].
        Pronto quando valorLiberado != null (não polling de string de status).
        """
        deadline = time.monotonic() + poll_max

        while time.monotonic() < deadline:
            try:
                detalhes = await self._get(f"PropostasProspect/{uuid_portal}/Detalhes")
            except Exception as e:
                log.warning("bff Detalhes err CPF=%s uuid=%s: %s", cpf_digits, uuid_portal, e)
                await asyncio.sleep(poll_interval)
                continue

            status_portal = (detalhes.get("status") or "").strip()
            pe = detalhes.get("propostaEmprestimo") or {}
            valor_liberado = pe.get("valorLiberado")
            token_valido = detalhes.get("tokenValidoConsignadoPrivado", True)

            log.info("bff poll CPF=%s uuid=%s status=%s valorLiberado=%s tokenValido=%s",
                     cpf_digits, uuid_portal, status_portal, valor_liberado, token_valido)

            # Dados financeiros disponíveis → parseia resultado
            if valor_liberado is not None:
                return _parse_detalhes_result(detalhes, uuid_portal, nome, cpf_digits)

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

        log.warning("bff poll timeout CPF=%s uuid=%s", cpf_digits, uuid_portal)
        return {
            "status": "erro",
            "erro": f"Timeout aguardando dados financeiros ({poll_max}s)",
            "uuid_portal": uuid_portal,
        }


def _parse_detalhes_result(det: dict, uuid_portal: str, nome: str, cpf_digits: str) -> dict:
    """Extrai resultado financeiro do response de Detalhes (schema confirmado pela API).

    Campos financeiros ficam em det["propostaEmprestimo"]["*"].
    Nome real do cliente em det["cliente"]["nome"].
    """
    import re

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

    pe = det.get("propostaEmprestimo") or {}
    cliente = det.get("cliente") or {}
    nome_real = cliente.get("nome") or nome

    valor_liberado = _money(pe.get("valorLiberado"))

    if valor_liberado is None or valor_liberado <= 0:
        log.warning("bff parse CPF=%s valorLiberado=%s — inelegível", cpf_digits, valor_liberado)
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


# ── Session loader ─────────────────────────────────────────────────────────────

def load_session_from_cache(user_id: str, state_dir: str | Path) -> BffSession | None:
    """Load BffSession from JWT cache file."""
    state_dir = Path(state_dir)
    for fname in [f"{user_id}.jwt.json", "last_jwt.json"]:
        p = state_dir / fname
        if p.exists():
            try:
                data = json.loads(p.read_text())
                token = data.get("access_token")
                if token:
                    log.info("bff session loaded from %s", p)
                    return BffSession(token)
            except Exception as e:
                log.warning("bff load cache failed %s: %s", p, e)
    return None
