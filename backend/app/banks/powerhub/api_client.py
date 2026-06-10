"""PowerHub REST API client — enriquecimento de telefone via CPF."""
import logging
import random
import re
import time
from typing import Optional

import httpx

log = logging.getLogger("powerhub.api")

BASE_URL = "https://novapowerhub.com.br"
HIGIENIZACAO_URL = "https://higienizacao.novapowerhub.com.br"
DEFAULT_TIMEOUT = 20.0
TOKEN_TTL = 270  # access_token tem ~300s — renova com 30s de folga
MAX_RETRIES = 3
BACKOFF_CAP = 30.0  # teto do backoff exponencial em segundos


def _backoff_sleep(attempt: int) -> None:
    """Backoff exponencial com jitter: 2^attempt + uniform(0,1), cap 30s."""
    wait = min(2.0 ** attempt, BACKOFF_CAP) + random.uniform(0, 1)
    time.sleep(wait)

_NO_KEEPALIVE = {"Connection": "close"}


def _new_client() -> httpx.Client:
    return httpx.Client(
        timeout=DEFAULT_TIMEOUT,
        verify=False,
        http1=True,
        http2=False,
        limits=httpx.Limits(max_keepalive_connections=0, max_connections=5),
    )


class PowerHubApiClient:
    def __init__(self, username: str, password: str):
        self.username = username
        self.password = password
        self._access_token: Optional[str] = None
        self._refresh_token: Optional[str] = None
        self._token_obtained_at: float = 0.0
        self._client = _new_client()

    def _reset_client(self) -> None:
        try:
            self._client.close()
        except Exception:
            pass
        self._client = _new_client()

    def _login(self) -> None:
        resp = self._client.post(
            f"{BASE_URL}/api/auth/token",
            json={"username": self.username, "password": self.password},
            headers=_NO_KEEPALIVE,
        )
        resp.raise_for_status()
        data = resp.json()
        self._access_token = data["access_token"]
        self._refresh_token = data["refresh_token"]
        self._token_obtained_at = time.time()
        log.info("PowerHub login OK")

    def _do_refresh(self) -> None:
        try:
            resp = self._client.post(
                f"{BASE_URL}/api/auth/refresh",
                params={"refreshToken": self._refresh_token},
                headers=_NO_KEEPALIVE,
            )
            resp.raise_for_status()
            data = resp.json()
            self._access_token = data["access_token"]
            self._refresh_token = data["refresh_token"]
            self._token_obtained_at = time.time()
            log.debug("PowerHub token refreshed")
        except Exception as e:
            log.warning(f"Refresh falhou ({e}), fazendo login completo")
            self._login()

    def _ensure_token(self) -> None:
        if self._access_token is None:
            self._login()
        elif time.time() - self._token_obtained_at >= TOKEN_TTL:
            self._do_refresh()

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self._access_token}"}

    def buscar_telefones(self, cpf: str) -> dict:
        """Retorna dict com nome e lista de telefones para o CPF."""
        cpf_digits = re.sub(r"\D", "", cpf)
        self._ensure_token()

        def _get():
            return self._client.get(
                f"{HIGIENIZACAO_URL}/api/telefonia/dados/{cpf_digits}",
                params={"whatsapp": "true"},
                headers={**self._headers(), **_NO_KEEPALIVE},
            )

        resp: httpx.Response | None = None
        for attempt in range(MAX_RETRIES):
            try:
                resp = _get()
            except (httpx.RemoteProtocolError, httpx.ConnectError, httpx.ReadError, httpx.ReadTimeout) as exc:
                log.warning(f"PowerHub conexão caiu (tentativa {attempt+1}/{MAX_RETRIES}): {exc}")
                self._reset_client()
                self._ensure_token()
                if attempt == MAX_RETRIES - 1:
                    raise
                _backoff_sleep(attempt)
                continue
            # 429 / 5xx: retry com backoff exponencial + jitter (evita ban e thundering herd)
            if resp.status_code == 429 or resp.status_code >= 500:
                log.warning(
                    f"PowerHub HTTP {resp.status_code} (tentativa {attempt+1}/{MAX_RETRIES}) cpf={cpf_digits}"
                )
                if attempt == MAX_RETRIES - 1:
                    break  # cai no raise_for_status abaixo
                _backoff_sleep(attempt)
                continue
            break
        if resp is None:
            raise RuntimeError("PowerHub: todas as tentativas falharam")

        if resp.status_code == 401:
            self._do_refresh()
            resp = _get()

        if resp.status_code == 404:
            return {"cpf": cpf_digits, "nome": None, "phones": [], "status": "not_found"}

        resp.raise_for_status()
        data = resp.json()

        phones = [
            t["phone"]
            for t in (data.get("telefones") or [])
            if t.get("phone")
        ]

        return {
            "cpf": cpf_digits,
            "nome": data.get("nomeCompleto"),
            "phones": phones,
            "status": "found" if phones else "not_found",
        }

    def close(self):
        self._client.close()
