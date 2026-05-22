"""PowerHub REST API client — enriquecimento de telefone via CPF."""
import logging
import re
import time
from typing import Optional

import httpx

log = logging.getLogger("powerhub.api")

BASE_URL = "https://novapowerhub.com.br"
HIGIENIZACAO_URL = "https://higienizacao.novapowerhub.com.br"
DEFAULT_TIMEOUT = 15.0
TOKEN_TTL = 270  # access_token tem ~300s — renova com 30s de folga


class PowerHubApiClient:
    def __init__(self, username: str, password: str):
        self.username = username
        self.password = password
        self._access_token: Optional[str] = None
        self._refresh_token: Optional[str] = None
        self._token_obtained_at: float = 0.0
        self._client = httpx.Client(timeout=DEFAULT_TIMEOUT, verify=False)

    def _login(self) -> None:
        resp = self._client.post(
            f"{BASE_URL}/api/auth/token",
            json={"username": self.username, "password": self.password},
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
        """Retorna dict com nome e lista de telefones para o CPF.

        Returns:
            {
              "cpf": str,
              "nome": str | None,
              "phones": list[str],  # dígitos limpos, sem formatação
              "status": "found" | "not_found" | "error",
            }
        """
        cpf_digits = re.sub(r"\D", "", cpf)
        self._ensure_token()

        def _get():
            return self._client.get(
                f"{HIGIENIZACAO_URL}/api/telefonia/dados/{cpf_digits}",
                params={"whatsapp": "true"},
                headers=self._headers(),
            )

        resp = _get()
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
