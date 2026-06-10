"""Presença Bank REST API client — 4 passos para higienização.

Fluxo por CPF:
  login()                    → JWT (reutilizado até 401)
  gerar_termo(cpf, nome, tel) → autorizacaoId
  assinar_termo(autorizacaoId) → ok
  consultar_vinculos(cpf)    → list[VinculoInfo] | None (None = sem vínculo = inelegível)
  consultar_margem(cpf, matricula, cnpj) → MargemInfo

Nota: simulação (POST /v5/operacoes/simulacao/disponiveis) bloqueada por configuração
do banco ("Prazo não permitido para o originador"). Higienização usa apenas os 4 passos acima.
"""
import logging
import random
import re
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

log = logging.getLogger("presenca.api")

BASE_URL = "https://presenca-bank-api.azurewebsites.net"
VINCULOS_TIMEOUT = 20.0   # endpoint eSocial pode levar até 15s
DEFAULT_TIMEOUT = 10.0


@dataclass
class VinculoInfo:
    matricula: str
    cnpj: str        # numeroInscricaoEmpregador
    elegivel: bool
    cpf: str


@dataclass
class MargemInfo:
    valor_margem_disponivel: float
    valor_margem_base: float
    registro_empregaticio: str
    cnpj_empregador: str
    data_admissao: str | None
    data_nascimento: str | None
    nome_mae: str | None
    sexo: str | None
    valor_total_devido: float = 0.0


def _fmt_cpf(cpf: str) -> str:
    digits = re.sub(r"\D", "", cpf)
    if len(digits) == 11:
        return f"{digits[:3]}.{digits[3:6]}.{digits[6:9]}-{digits[9:]}"
    return cpf


def _strip_digits(v: str) -> str:
    return re.sub(r"\D", "", v or "")


class PresencaApiClient:
    def __init__(self, login_cpf: str, password: str):
        self._login_cpf = login_cpf
        self._password = password
        self._token: str | None = None
        self._token_ts: float = 0.0
        self._client = httpx.Client(
            base_url=BASE_URL,
            timeout=httpx.Timeout(DEFAULT_TIMEOUT),
            headers={"Content-Type": "application/json"},
            verify=False,
        )

    def _auth_headers(self) -> dict:
        return {"Authorization": f"Bearer {self._token}"}

    def login(self) -> str:
        """Autentica e armazena JWT. Retorna token."""
        cpf_fmt = _fmt_cpf(self._login_cpf)
        r = self._client.post("/login", json={"login": cpf_fmt, "senha": self._password})
        if r.status_code not in (200, 201):
            raise RuntimeError(f"presenca login falhou status={r.status_code} (500=senha errada): {r.text[:200]}")
        data = r.json()
        token = data.get("token") or data.get("access_token") or data.get("jwt") or ""
        if not token:
            raise RuntimeError(f"login sem token: {data}")
        self._token = token
        self._token_ts = time.monotonic()
        log.info("presenca api login OK cpf=%s", cpf_fmt)
        return token

    def ensure_token(self) -> None:
        """Re-login se token expirado (>9h) ou ausente."""
        age = time.monotonic() - self._token_ts
        if self._token is None or age > 9 * 3600:
            self.login()

    def _request(self, method: str, path: str, *, json: Any = None, timeout: float | None = None) -> dict:
        """HTTP request com retry automático em 401."""
        self.ensure_token()
        kw: dict = {"headers": self._auth_headers()}
        if json is not None:
            kw["json"] = json
        if timeout:
            kw["timeout"] = httpx.Timeout(timeout)

        r = self._client.request(method, path, **kw)
        if r.status_code == 401:
            log.warning("presenca api 401 — relogin")
            self.login()
            kw["headers"] = self._auth_headers()
            r = self._client.request(method, path, **kw)
            if r.status_code == 401:
                raise RuntimeError(f"presenca api 401 persiste após relogin: {r.text[:200]}")

        return r

    def _normalizar_telefone(self, telefone: str) -> str:
        digits = _strip_digits(telefone) or ""
        if len(digits) in (12, 13) and digits.startswith("55"):
            digits = digits[2:]
        return digits if len(digits) == 11 else ""

    def _telefone_fallback_cpf(self, cpf: str) -> str:
        """Gera telefone único derivado do CPF. Formato: DDD11 + 9 + 8 dígitos do CPF."""
        d = _strip_digits(cpf)[-8:]
        return f"119{d}"  # 11 + 9 + 8 dígitos = 11 dígitos, 3º dígito = 9 (celular válido)

    def gerar_termo(self, cpf: str, nome: str, telefone: str) -> str:
        """POST /consultas/termo-inss — retorna autorizacaoId."""
        digits = self._normalizar_telefone(telefone) or self._telefone_fallback_cpf(cpf)

        for tentativa, tel in enumerate([digits, self._telefone_fallback_cpf(cpf)]):
            for rate_attempt in range(3):
                r = self._request("POST", "/consultas/termo-inss", json={
                    "cpf": _strip_digits(cpf),
                    "nome": nome or "Cliente",
                    "telefone": tel,
                    "produtoId": 28,
                })
                if r.status_code == 429:
                    # backoff linear + jitter — workers concorrentes não retriam em sincronia
                    wait = 30 + rate_attempt * 15 + random.uniform(0, 10)
                    log.warning("presenca gerar_termo 429 cpf=%s — aguardando %.0fs", cpf, wait)
                    time.sleep(wait)
                    continue
                break
            if r.status_code in (200, 201):
                break
            body = r.text
            # telefone já usado → tenta com fallback derivado do CPF
            if r.status_code == 400 and "Telefone já utilizado" in body and tentativa == 0:
                log.warning("presenca gerar_termo telefone já usado cpf=%s, tentando fallback", cpf)
                continue
            raise RuntimeError(f"gerar_termo {r.status_code}: {body[:300]}")
        data = r.json()
        aid = data.get("autorizacaoId") or data.get("id") or ""
        if not aid:
            raise RuntimeError(f"gerar_termo sem autorizacaoId: {data}")
        log.debug("presenca gerar_termo cpf=%s autorizacaoId=%s", cpf, aid)
        return aid

    def assinar_termo(self, autorizacao_id: str) -> None:
        """PUT /consultas/termo-inss/{id} — assina com device fake."""
        r = self._request("PUT", f"/consultas/termo-inss/{autorizacao_id}", json={
            "userAgent": "Mozilla/5.0",
            "OperationalSystem": "Android",
            "DeviceModel": "Samsung Galaxy",
            "DeviceName": "samsung",
            "DeviceType": "mobile",
            "GeoLocation": {"Latitude": "-23.5505", "Longitude": "-46.6333"},
        })
        if r.status_code not in (200, 204):
            raise RuntimeError(f"assinar_termo {r.status_code}: {r.text[:200]}")
        log.debug("presenca assinar_termo %s OK", autorizacao_id)

    def consultar_vinculos(self, cpf: str) -> list[VinculoInfo] | None:
        """POST /v3/operacoes/consignado-privado/consultar-vinculos.

        Retorna lista de vínculos elegíveis, ou None se sem vínculo eSocial.
        400 em ~15s = sem dados eSocial = inelegível.
        """
        for attempt in range(3):
            r = self._request(
                "POST", "/v3/operacoes/consignado-privado/consultar-vinculos",
                json={"cpf": _strip_digits(cpf)},
                timeout=VINCULOS_TIMEOUT,
            )
            if r.status_code == 429:
                # backoff linear + jitter — workers concorrentes não retriam em sincronia
                wait = 30 + attempt * 15 + random.uniform(0, 10)
                log.warning("presenca vinculos 429 rate limit cpf=%s — aguardando %.0fs", cpf, wait)
                time.sleep(wait)
                continue
            break
        if r.status_code == 400:
            body = r.text
            if "Limite de consulta" in body or "limite" in body.lower():
                raise RuntimeError(f"consultar_vinculos limite de consulta (rate limit do banco) cpf={cpf}: {body[:200]}")
            log.info("presenca vinculos 400 (sem eSocial) cpf=%s body=%s", cpf, body[:200])
            return None
        if r.status_code not in (200, 201):
            raise RuntimeError(f"consultar_vinculos {r.status_code}: {r.text[:200]}")

        data = r.json()
        items = data.get("id") or data.get("vinculos") or []
        if not items:
            log.info("presenca vinculos vazio cpf=%s", cpf)
            return None

        vinculos = [
            VinculoInfo(
                matricula=str(v.get("matricula", "")),
                cnpj=str(v.get("numeroInscricaoEmpregador", "")),
                elegivel=bool(v.get("elegivel", True)),
                cpf=cpf,
            )
            for v in items
        ]
        eligible = [v for v in vinculos if v.elegivel]
        return eligible if eligible else None

    def consultar_margem(self, cpf: str, matricula: str, cnpj: str) -> MargemInfo:
        """POST /v3/operacoes/consignado-privado/consultar-margem."""
        r = self._request("POST", "/v3/operacoes/consignado-privado/consultar-margem", json={
            "cpf": _strip_digits(cpf),
            "matricula": matricula,
            "cnpj": cnpj,
        })
        if r.status_code not in (200, 201):
            raise RuntimeError(f"consultar_margem {r.status_code}: {r.text[:200]}")
        d = r.json()
        return MargemInfo(
            valor_margem_disponivel=float(d.get("valorMargemDisponivel") or 0),
            valor_margem_base=float(d.get("valorMargemBase") or 0),
            valor_total_devido=float(d.get("valorTotalDevido") or 0),
            registro_empregaticio=str(d.get("registroEmpregaticio") or matricula),
            cnpj_empregador=str(d.get("cnpjEmpregador") or cnpj),
            data_admissao=d.get("dataAdmissao"),
            data_nascimento=d.get("dataNascimento"),
            nome_mae=d.get("nomeMae"),
            sexo=d.get("sexo"),
        )

    def close(self) -> None:
        self._client.close()
