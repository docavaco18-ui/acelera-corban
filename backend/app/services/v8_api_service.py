import httpx
from ..config import settings
from .auth_service import get_token

BASE = "https://bff.v8sistema.com"

class V8APIError(Exception):
    """Erro da API V8 com payload completo preservado."""
    def __init__(self, status: int, payload: dict | str, endpoint: str):
        self.status = status
        self.payload = payload
        self.endpoint = endpoint
        if isinstance(payload, dict):
            title = payload.get("title") or payload.get("type") or "erro"
            detail = payload.get("detail") or ""
            msg = f"V8 {status} {endpoint}: {title}" + (f" — {detail}" if detail and detail != title else "")
        else:
            msg = f"V8 {status} {endpoint}: {payload}"
        super().__init__(msg)

def _raise_v8(resp: httpx.Response, endpoint: str):
    if resp.is_success: return
    try: payload = resp.json()
    except Exception: payload = resp.text
    raise V8APIError(resp.status_code, payload, endpoint)

async def _headers() -> dict:
    token = await get_token()
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

def _client(proxy: str | None = None) -> httpx.AsyncClient:
    return httpx.AsyncClient(proxy=proxy) if proxy else httpx.AsyncClient()

async def enrich_cpf(cpf: str, proxy: str | None = None) -> dict:
    async with _client(proxy) as client:
        resp = await client.get(
            f"{BASE}/private-consignment/consult/client-data/basic/{cpf}",
            headers=await _headers(),
            timeout=20,
        )
        _raise_v8(resp, "enrich_cpf")
        return resp.json()

def _parse_phone_br(telefone: str) -> tuple[str, str]:
    """Retorna (areaCode, phoneNumber). V8 exige phoneNumber de 9 dígitos começando com 9."""
    digits = ''.join(c for c in (telefone or "") if c.isdigit())
    # remove DDI 55 se presente (12-13 dígitos)
    if len(digits) in (12, 13) and digits.startswith("55"):
        digits = digits[2:]
    if len(digits) == 11:
        area, num = digits[:2], digits[2:]
    elif len(digits) == 10:
        area, num = digits[:2], digits[2:]
    else:
        raise ValueError(f"Telefone inválido: {telefone!r} (esperado 10-11 dígitos com DDD)")
    # Normaliza num para 9 dígitos começando com 9
    if len(num) == 8:
        num = "9" + num
    elif len(num) == 9 and not num.startswith("9"):
        num = "9" + num[-8:]
    if len(num) != 9 or not num.startswith("9"):
        raise ValueError(f"Telefone inválido: {telefone!r} (não foi possível normalizar)")
    return area, num

async def find_active_consult(cpf: str, proxy: str | None = None) -> str | None:
    from datetime import datetime, timedelta, timezone
    end = datetime.now(timezone.utc) + timedelta(days=1)
    start = end - timedelta(days=31)
    base = {"startDate": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "endDate": end.strftime("%Y-%m-%dT%H:%M:%SZ"), "limit": 100}
    async with _client(proxy) as client:
        for page in range(1, 21):
            resp = await client.get(f"{BASE}/private-consignment/consult",
                                    params={**base, "page": page},
                                    headers=await _headers(), timeout=20)
            if not resp.is_success: return None
            items = (resp.json() or {}).get("data") or []
            if not items: return None
            for it in items:
                if it.get("documentNumber") == cpf:
                    return it.get("id")
        return None

async def create_consent(cpf: str, client_data: dict, telefone: str, proxy: str | None = None) -> str:
    area, number = _parse_phone_br(telefone)

    body = {
        "borrowerDocumentNumber": cpf,
        "gender": "male",
        "birthDate": client_data["birthDate"],
        "signerName": client_data["name"],
        "signerEmail": client_data["email"],
        "signerPhone": {
            "phoneNumber": number,
            "countryCode": "55",
            "areaCode": area,
        },
        "provider": settings.v8_provider,
    }
    async with _client(proxy) as client:
        resp = await client.post(
            f"{BASE}/private-consignment/consult",
            json=body,
            headers=await _headers(),
            timeout=20,
        )
        if resp.status_code == 400:
            try: payload = resp.json()
            except Exception: payload = {}
            if payload.get("type") == "consult_already_exists_by_user_and_document_number":
                existing = await find_active_consult(cpf, proxy=proxy)
                if existing: return existing
        _raise_v8(resp, "create_consent")
        return resp.json()["id"]

async def get_consult(consult_id: str, proxy: str | None = None) -> dict:
    async with _client(proxy) as client:
        resp = await client.get(
            f"{BASE}/private-consignment/consult/{consult_id}",
            headers=await _headers(),
            timeout=15,
        )
        _raise_v8(resp, "get_consult")
        return resp.json()

async def authorize_consent(consult_id: str, proxy: str | None = None) -> None:
    async with _client(proxy) as client:
        resp = await client.post(
            f"{BASE}/private-consignment/consult/{consult_id}/authorize",
            json={},
            headers=await _headers(),
            timeout=20,
        )
        _raise_v8(resp, "authorize_consent")

async def get_simulation_configs(proxy: str | None = None) -> list[dict]:
    async with _client(proxy) as client:
        resp = await client.get(
            f"{BASE}/private-consignment/simulation/configs",
            headers=await _headers(),
            timeout=20,
        )
        _raise_v8(resp, "simulation_configs")
        return resp.json().get("configs") or []

def pick_config(configs: list[dict], prefer_seguro: bool) -> dict | None:
    if not configs:
        return None
    if prefer_seguro:
        for c in configs:
            if "seguro" in (c.get("slug") or "").lower():
                return c
        return None
    for c in configs:
        if "seguro" not in (c.get("slug") or "").lower():
            return c
    return configs[0]

def _max_installments(config: dict, cap: int = 36) -> int:
    raw = config.get("number_of_installments") or []
    nums = []
    for x in raw:
        try: nums.append(int(x))
        except (TypeError, ValueError): pass
    return min(max(nums), cap) if nums else cap

async def create_simulation(consult_id: str, config_id: str, margin: float, num_installments: int = 36, proxy: str | None = None) -> dict:
    body = {
        "consult_id": consult_id,
        "config_id": config_id,
        "installment_face_value": float(margin),
        "number_of_installments": num_installments,
        "provider": settings.v8_provider,
    }
    async with _client(proxy) as client:
        resp = await client.post(
            f"{BASE}/private-consignment/simulation",
            json=body,
            headers=await _headers(),
            timeout=20,
        )
        _raise_v8(resp, "create_simulation")
        return resp.json()

async def register_webhook(url: str) -> None:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BASE}/user/webhook/private-consignment/consult",
            json={"url": url},
            headers=await _headers(),
            timeout=20,
        )
        resp.raise_for_status()
