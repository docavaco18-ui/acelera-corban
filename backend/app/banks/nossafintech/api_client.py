"""Nossa Fintech CLT — REST API client para higienização.

Fluxo por CPF:
  login()                          → JWT (Bearer, reusado até 401)
  banking_institutions()           → service_type (ex: "QITECH"), cacheado por client
  check_authorization(cpf)         → "AUTHORIZED" | "PENDING" | "NOT_AUTHORIZED"
  request_authorization(cpf, nome, phone) → (status, authorization_link|None)
                                     Retorna link para auto-aceitação (digitação).
  auto_accept_authorization(url)   → bool — navega link + aceita via Playwright
  check_enrollment(cpf)            → [EnrollmentInfo] (vínculo: employer_cnpj)
  get_margin(cpf, employer_cnpj)   → MarginInfo (saldo/margem + margin_key)
  list_rebates(margin_key)         → tabelas (cod_tabela, prazo)
  simulate_loan(...)               → SimulationInfo (valor liberado, parcela, prazo)

get_margin só é chamado após status AUTHORIZED — nunca consulta margem de quem
não consentiu (LGPD).

Doc: https://nossa-fintech-doc.spixiiservices.com.br/docs/nossa-fintech-clt/*
"""
import logging
import re
import time
from dataclasses import dataclass
from typing import Any

import httpx

from .config import NossaFintechConfig

log = logging.getLogger("nossafintech.api")


@dataclass
class EnrollmentInfo:
    work_registration: str
    employer_cnpj: str
    employer_name: str


@dataclass
class MarginInfo:
    margin_key: str
    available_balance: float       # saldo disponível
    utilizable_balance: float      # saldo utilizável (teto de parcela consignável)
    base_margin_value: float       # margem base
    name: str | None
    employer_name: str | None
    employer_cnpj: str | None
    birth_date: str | None
    admission_date: str | None
    mother_name: str | None
    gender: str | None
    job_description: str | None


@dataclass
class SimulationInfo:
    disbursement_amount: float     # valor liberado (líquido)
    financed_amount: float         # valor financiado
    total_amount_owed: float       # total devido
    num_periods: int               # prazo (parcelas)
    installment: float             # valor da parcela
    interest_rate: float           # taxa juros (mês)
    cod_tabela: str


def _digits(v: str) -> str:
    return re.sub(r"\D", "", v or "")


def _parse_phone_nf(phone: str) -> tuple[str, str]:
    """(area_code, phone_number) pra Nossa Fintech. Fallback: 11/999999999."""
    d = re.sub(r"\D", "", phone or "")
    if d.startswith("55") and len(d) >= 12:
        d = d[2:]
    if len(d) == 11:
        return d[:2], d[2:]
    if len(d) == 10:
        return d[:2], d[2:]
    return "11", "999999999"


def _money_from_cents(v: Any) -> float:
    return round(float(v or 0) / 100, 2)


class NossaFintechApiClient:
    def __init__(self, cpf: str, promot_id: str, password: str, cfg: NossaFintechConfig | None = None):
        self._cpf = _digits(cpf)
        self._promot_id = promot_id
        self._password = password
        self.cfg = cfg or NossaFintechConfig()
        self._token: str | None = None
        self._token_ts: float = 0.0
        self._service_type: str | None = None
        self._client = httpx.Client(
            base_url=self.cfg.base_url,
            timeout=httpx.Timeout(self.cfg.timeout_default),
            headers={"Content-Type": "application/json"},
        )

    # ── auth ──────────────────────────────────────────────────────────────────
    def _auth_headers(self) -> dict:
        return {"Authorization": f"Bearer {self._token}"}

    @staticmethod
    def _coerce_promot(v: str) -> Any:
        d = _digits(str(v))
        return int(d) if d else v

    def login(self) -> str:
        """POST /auth/login {cpf, promot_id, password} → access_token."""
        r = self._client.post("/auth/login", json={
            "cpf": self._cpf,
            "promot_id": self._coerce_promot(self._promot_id),
            "password": self._password,
        })
        if r.status_code not in (200, 201):
            raise RuntimeError(
                f"nossafintech login falhou status={r.status_code} "
                f"(401=credenciais inválidas): {r.text[:200]}"
            )
        data = r.json()
        token = data.get("access_token") or data.get("token") or ""
        if not token:
            raise RuntimeError(f"login sem access_token: {str(data)[:200]}")
        self._token = token
        self._token_ts = time.monotonic()
        log.info("nossafintech login OK cpf=%s", self._cpf)
        return token

    def ensure_token(self) -> None:
        if self._token is None:
            self.login()

    def _request(self, method: str, path: str, *, json: Any = None,
                 params: Any = None, timeout: float | None = None) -> httpx.Response:
        """HTTP com retry automático em 401 (relogin)."""
        self.ensure_token()
        kw: dict = {"headers": self._auth_headers()}
        if json is not None:
            kw["json"] = json
        if params is not None:
            kw["params"] = params
        if timeout:
            kw["timeout"] = httpx.Timeout(timeout)

        r = self._client.request(method, path, **kw)
        if r.status_code == 401:
            log.warning("nossafintech 401 em %s — relogin", path)
            self.login()
            kw["headers"] = self._auth_headers()
            r = self._client.request(method, path, **kw)
            if r.status_code == 401:
                raise RuntimeError(f"nossafintech 401 persiste após relogin em {path}: {r.text[:200]}")
        return r

    @staticmethod
    def _unwrap(r: httpx.Response, ctx: str) -> Any:
        if r.status_code not in (200, 201):
            raise RuntimeError(f"{ctx} {r.status_code}: {r.text[:300]}")
        body = r.json()
        if isinstance(body, dict) and body.get("success") is False:
            raise RuntimeError(f"{ctx} success=false: {body.get('message')}")
        return body.get("data") if isinstance(body, dict) else body

    # ── steps ─────────────────────────────────────────────────────────────────
    def banking_institutions(self) -> str:
        """GET /clt-loan/v1/banking-institutions → service_type (cacheado)."""
        if self._service_type:
            return self._service_type
        r = self._request("GET", "/clt-loan/v1/banking-institutions")
        raw = self._unwrap(r, "banking_institutions") or []
        # Extrai string: API pode retornar lista de strings OU lista de dicts
        data = [
            str(item.get("service_type") or item.get("code") or "")
            if isinstance(item, dict) else str(item)
            for item in raw
        ]
        # prefere a bancarizadora default (QITECH) se disponível, senão a 1ª
        pref = self.cfg.default_service_type
        self._service_type = pref if pref in data else (data[0] if data else pref)
        log.info("nossafintech service_type=%s (disponíveis=%s)", self._service_type, data)
        return self._service_type

    def check_authorization(self, cpf: str) -> str:
        """POST /clt-loan/v1/check-authorization → AUTHORIZED|PENDING|NOT_AUTHORIZED.

        API retorna success=false quando não há autorização — tratado como NOT_AUTHORIZED,
        não como erro (comportamento esperado para CPFs novos).
        """
        st = self.banking_institutions()
        r = self._request("POST", "/clt-loan/v1/check-authorization", json={
            "document_number": _digits(cpf),
            "service_type": st,
        })
        if r.status_code == 404:
            # CPF não encontrado na base = inelegível (não erro)
            return "NOT_AUTHORIZED"
        if r.status_code not in (200, 201):
            raise RuntimeError(f"check_authorization {r.status_code}: {r.text[:300]}")
        body = r.json()
        if isinstance(body, dict) and body.get("success") is False:
            return "NOT_AUTHORIZED"
        data = (body.get("data") if isinstance(body, dict) else body) or {}
        return str(data.get("status") or "NOT_AUTHORIZED").upper()

    def request_authorization(self, cpf: str, person_name: str = "", phone: str = "") -> tuple[str, str | None]:
        """POST /clt-loan/v1/request-authorization → (status, authorization_link|None).

        Retorna tuple (status, link). Link usado para auto-aceitar via digitação
        sem interação do cliente. Se CPF já autorizado, link pode ser None.
        """
        st = self.banking_institutions()
        area, number = _parse_phone_nf(phone)
        r = self._request("POST", "/clt-loan/v1/request-authorization", json={
            "document_number": _digits(cpf),
            "person_name": person_name or cpf,
            "country_code": "55",
            "area_code": area,
            "phone_number": number,
            "notification_method": "sms",
            "service_type": st,
        })
        if r.status_code not in (200, 201):
            raise RuntimeError(f"request_authorization {r.status_code}: {r.text[:300]}")
        body = r.json()
        if isinstance(body, dict) and body.get("success") is False:
            raise RuntimeError(f"request_authorization falhou: {body.get('message')}")
        data = (body.get("data") if isinstance(body, dict) else body) or {}
        status = str(data.get("status") or "PENDING").upper()
        link = data.get("authorization_link") or None
        log.info("nossafintech request_authorization cpf=%s status=%s link=%s",
                 _digits(cpf), status, bool(link))
        return status, link

    def auto_accept_authorization(self, url: str) -> bool:
        """Aceita autorização via Playwright (digitação sem SMS ao cliente).

        Navega até o link de autorização, injeta geolocalização, clica
        "Tentar novamente" para ir à tela de acordo, e confirma "Autorizar".
        Retorna True se "Autorização enviada com sucesso" aparecer na página.
        """
        from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

        _GEO_JS = """
        if (!navigator.__nf_geo_done__) {
          Object.defineProperty(navigator, 'geolocation', {
            configurable: true,
            value: {
              getCurrentPosition: (ok) => ok({
                coords: {latitude: -23.5505, longitude: -46.6333, accuracy: 10},
                timestamp: Date.now()
              }),
              watchPosition: (ok) => {
                ok({coords:{latitude:-23.5505,longitude:-46.6333,accuracy:10},
                    timestamp:Date.now()});
                return 1;
              },
              clearWatch: () => {}
            }
          });
          navigator.__nf_geo_done__ = true;
        }
        """

        log.info("nossafintech auto_accept_authorization url=%s", url)
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(headless=True)
                ctx = browser.new_context(
                    permissions=["geolocation"],
                    geolocation={"latitude": -23.5505, "longitude": -46.6333},
                    locale="pt-BR",
                )
                page = ctx.new_page()

                # Injeta geolocalização antes de cada carregamento de página
                page.add_init_script(_GEO_JS)

                # networkidle falha (SPA tem conexões contínuas) — usa load + wait
                page.goto(url, timeout=30_000, wait_until="load")
                page.wait_for_timeout(4_000)  # React render + geolocation resolve

                # Com geolocation no contexto, a página resolve geo automaticamente
                # e exibe "Autorizar" diretamente (sem "Tentar novamente")
                autorizar = page.get_by_role("button", name="Autorizar")
                autorizar.wait_for(state="visible", timeout=15_000)
                autorizar.click()

                # Aguarda mensagem de sucesso (API pode demorar 2-8s)
                try:
                    page.get_by_text("Autorização enviada com sucesso").wait_for(timeout=12_000)
                    sucesso = True
                except PWTimeout:
                    content = page.inner_text("body")
                    sucesso = "sucesso" in content.lower() or "fechar" in content.lower()
                browser.close()

            log.info("nossafintech auto_accept_authorization resultado=%s", sucesso)
            return sucesso
        except Exception as e:
            log.error("nossafintech auto_accept_authorization erro: %s", str(e)[:200])
            return False

    def check_enrollment(self, cpf: str) -> list[EnrollmentInfo]:
        """POST /clt-loan/v1/check-employee-enrollment → vínculos (employer_cnpj).

        success=false sem HTTP error = sem vínculo eSocial → retorna [] (inelegível, não erro).
        """
        st = self.banking_institutions()
        r = self._request("POST", "/clt-loan/v1/check-employee-enrollment", json={
            "document_number": _digits(cpf),
            "service_type": st,
        })
        if r.status_code == 202:
            # DataPrev async: consulta ainda em processamento, tentar novamente
            log.info("nossafintech check_enrollment cpf=%s dataprev_processando (202)", cpf)
            return None  # type: ignore[return-value]  — sentinela: retry
        if r.status_code == 404:
            # CPF não encontrado no eSocial — sem vínculo
            return []
        if r.status_code not in (200, 201):
            raise RuntimeError(f"check_enrollment {r.status_code}: {r.text[:300]}")
        body = r.json()
        if isinstance(body, dict) and body.get("success") is False:
            log.info("nossafintech check_enrollment cpf=%s sem_vinculo: %s", cpf, body.get("message"))
            return []
        data = (body.get("data") if isinstance(body, dict) else body) or []
        return [
            EnrollmentInfo(
                work_registration=str(v.get("work_registration", "")),
                employer_cnpj=_digits(str(v.get("employer_cnpj", ""))),
                employer_name=str(v.get("employer_name") or ""),
            )
            for v in data
            if v.get("employer_cnpj")
        ]

    def get_margin(self, cpf: str, employer_cnpj: str) -> MarginInfo:
        """POST /clt-loan/v1/get-margin → saldo/margem + margin_key."""
        st = self.banking_institutions()
        r = self._request("POST", "/clt-loan/v1/get-margin", json={
            "document_number": _digits(cpf),
            "employer_document": _digits(employer_cnpj),
            "service_type": st,
        }, timeout=self.cfg.timeout_margin)
        d = self._unwrap(r, "get_margin") or {}
        employer = d.get("employer") or {}
        employer_doc = _digits(str(employer.get("document") or ""))
        if len(employer_doc) != 14:
            employer_doc = _digits(str(employer_cnpj))
        gender = d.get("gender") or {}
        job = d.get("job_code") or {}
        return MarginInfo(
            margin_key=str(d.get("margin_key") or ""),
            available_balance=float(d.get("available_balance") or 0),
            utilizable_balance=float(d.get("utilizable_balance") or 0),
            base_margin_value=float(d.get("base_margin_value") or 0),
            name=d.get("name"),
            employer_name=employer.get("name"),
            employer_cnpj=employer_doc,
            birth_date=d.get("birth_date"),
            admission_date=d.get("admission_date"),
            mother_name=d.get("mother_name"),
            gender=gender.get("description") if isinstance(gender, dict) else None,
            job_description=job.get("description") if isinstance(job, dict) else None,
        )

    def list_rebates(self, margin_key: str | None = None) -> list[dict]:
        """GET /clt-loan/v1/list-rebates → tabelas de prazo."""
        st = self.banking_institutions()
        params = {"service_type": st}
        if margin_key:
            params["margin_key"] = margin_key
        r = self._request("GET", "/clt-loan/v1/list-rebates", params=params)
        return self._unwrap(r, "list_rebates") or []

    @staticmethod
    def pick_table(rebates: list[dict], margin: float) -> dict | None:
        """Escolhe a tabela: range do complement que cobre a margem, maior prazo.

        complement é faixa de margem tipo "201 a 400". Sem match → maior prazo geral.
        """
        if not rebates:
            return None

        def _parse_amount(v: Any) -> float | None:
            if v is None:
                return None
            s = str(v).strip().lower().replace(",", ".")
            m = re.search(r"(\d+(?:\.\d+)?)\s*(k)?", s)
            if not m:
                return None
            amount = float(m.group(1))
            return amount * 1000 if m.group(2) else amount

        def _parse_range(t: dict) -> tuple[float, float]:
            start = _parse_amount(t.get("start"))
            end = _parse_amount(t.get("end"))
            if start is not None and end is not None:
                return start, end

            nums = re.findall(r"\d+(?:[.,]\d+)?\s*k?", str(t.get("complement") or ""), re.I)
            if len(nums) >= 2:
                return _parse_amount(nums[0]) or 0.0, _parse_amount(nums[1]) or float("inf")
            if len(nums) == 1:
                return _parse_amount(nums[0]) or 0.0, float("inf")
            return 0.0, float("inf")

        matching = []
        for t in rebates:
            lo, hi = _parse_range(t)
            if lo <= margin <= hi:
                matching.append(t)
        pool = matching or rebates
        return max(pool, key=lambda t: int(t.get("number_of_installments") or 0))

    def simulate_loan(self, margin_key: str, employer_cnpj: str,
                      requested_amount: float, cod_tabela: str) -> SimulationInfo:
        """POST /clt-loan/v1/simulate-loan → valor liberado, parcela, prazo."""
        st = self.banking_institutions()
        r = self._request("POST", "/clt-loan/v1/simulate-loan", json={
            "margin_key": margin_key,
            "simulation_type": self.cfg.simulation_type,
            "employer_document": _digits(employer_cnpj),
            "requested_amount": requested_amount,
            "service_type": st,
            "cod_tabela": cod_tabela,
        }, timeout=self.cfg.timeout_margin)
        d = self._unwrap(r, "simulate_loan") or {}
        # A API retorna valores monetários da simulação em centavos.
        # Ex.: requested_amount=400 -> schedule.payment=40000 (R$ 400,00).
        installment = 0.0
        for item in (d.get("schedule") or []):
            p = _money_from_cents(item.get("payment"))
            if p > 0:
                installment = p
                break
        return SimulationInfo(
            disbursement_amount=_money_from_cents(d.get("disbursement_amount")),
            financed_amount=_money_from_cents(d.get("financed_amount")),
            total_amount_owed=_money_from_cents(d.get("total_amount_owed")),
            num_periods=int(d.get("num_periods") or 0),
            installment=installment,
            interest_rate=float(d.get("interest_rate") or 0),
            cod_tabela=cod_tabela,
        )

    def close(self) -> None:
        self._client.close()
