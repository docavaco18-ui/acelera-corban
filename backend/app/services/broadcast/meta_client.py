from __future__ import annotations

import os
import re

import httpx

META_BASE = "https://graph.facebook.com/v21.0"

# Restriction codes that are pure cosmetic noise (SIP not configured) — hide from UI
COSMETIC_CODES = {138024, 138025}

# Map error codes to human-readable Portuguese labels
RESTRICTION_LABELS: dict[int, str] = {
    131056: "limite de mensagens excedido (24h)",
    133004: "número não verificado",
    133015: "nome de exibição reprovado",
    131048: "qualidade ruim (RED)",
    131049: "spam reportado por usuários",
    130472: "conta bloqueada por falta de pagamento",
    133010: "número desabilitado pela Meta",
    131045: "número não registrado",
    133006: "verificação OTP pendente",
    133007: "número em revisão Meta",
}

# Fallback WABA IDs used when token has no granular target_ids (e.g. CLAUDE DISPARO app).
# Validated against the token at discovery time — only accessible IDs are returned.
_FALLBACK_RAW = os.getenv("META_WABA_FALLBACK_IDS", "")
META_WABA_FALLBACK_IDS: list[str] = [w.strip() for w in _FALLBACK_RAW.split(",") if w.strip()]

# throughput.level = VELOCIDADE de envio (msg/s), NAO o limite diario de conversas.
THROUGHPUT_LABEL = {
    "STANDARD":       "padrao (~80 msg/s)",
    "HIGH":           "alto",
    "VERY_HIGH":      "muito alto",
    "NOT_APPLICABLE": "—",
}


def _tier_capacity(raw_tier) -> tuple[str, int]:
    """Capacidade diaria REAL = messaging_limit_tier da Meta (conversas business-initiated/24h).
    TIER_250/1K/2K/10K/100K/UNLIMITED. Retorna ("", 0) quando a Meta NAO reporta
    (ex.: Marketing Messages Lite API) — nunca fabrica numero a partir da velocidade."""
    t = str(raw_tier or "").upper().strip()
    if not t:
        return ("", 0)
    if t in ("TIER_UNLIMITED", "UNLIMITED"):
        return ("ilimitado", 999_999_999)
    m = re.match(r"^(?:C?TIER_)?(\d+)\s*([KM])?/?D?I?A?$", t)
    if m:
        n = int(m.group(1))
        mult = {"K": 1000, "M": 1_000_000, None: 1}[m.group(2)]
        val = n * mult
        label = f"{n}{m.group(2)}/dia" if m.group(2) else f"{val}/dia"
        return (label, val)
    return (t, 0)


def _parse_phone(data: dict, waba_id: str = "") -> dict:
    throughput_level = (data.get("throughput") or {}).get("level", "NOT_APPLICABLE")
    # Capacidade diaria vem do messaging_limit_tier REAL (nao do throughput/velocidade).
    tier_label, daily_limit = _tier_capacity(data.get("messaging_limit_tier"))

    hs = data.get("health_status") or {}
    can_send = hs.get("can_send_message", "UNKNOWN")

    # Collect real restrictions (filter cosmetic noise like SIP setup)
    restrictions: list[dict] = []
    additional_info: list[str] = []
    for ent in hs.get("entities", []):
        for err in ent.get("errors", []):
            code = err.get("error_code")
            if code in COSMETIC_CODES:
                continue
            restrictions.append({
                "code": code,
                "label": RESTRICTION_LABELS.get(code, err.get("error_description") or f"código {code}"),
                "entity": ent.get("entity_type", "PHONE_NUMBER"),
            })
        for info in ent.get("additional_info", []) or []:
            if info and info not in additional_info:
                additional_info.append(info)

    # Detect payment/debt issues
    has_payment_issue = any(r["code"] == 130472 for r in restrictions)
    name_status = data.get("name_status", "UNKNOWN")
    display_name_pending = name_status in ("PENDING_REVIEW", "DECLINED", "EXPIRED")

    return {
        "phone_id": data.get("id", ""),
        "waba_id": waba_id,
        "display_phone": data.get("display_phone_number", ""),
        "verified_name": data.get("verified_name", ""),
        "quality_rating": data.get("quality_rating", "UNKNOWN"),
        "throughput_level": throughput_level,
        "throughput_label": THROUGHPUT_LABEL.get(throughput_level, "—"),
        "messaging_tier": tier_label,
        "daily_limit": daily_limit,
        "tier_reported": daily_limit > 0,
        "can_send": can_send,
        "name_status": name_status,
        "display_name_pending": display_name_pending,
        "phone_status": data.get("status", "UNKNOWN"),
        "account_mode": data.get("account_mode", ""),
        "code_verification_status": data.get("code_verification_status", ""),
        "is_official_business_account": data.get("is_official_business_account", False),
        "restriction_codes": [r["code"] for r in restrictions],
        "restrictions": restrictions,
        "additional_info": additional_info,
        "has_payment_issue": has_payment_issue,
    }


PHONE_FIELDS = (
    "id,display_phone_number,verified_name,quality_rating,throughput,"
    "messaging_limit_tier,health_status,name_status,status,account_mode,"
    "code_verification_status,is_official_business_account"
)


def _extract_template_variables(components: list) -> list[str]:
    """Extract {{N}} variable positions from template components."""
    seen: set[str] = set()
    variables: list[str] = []
    for comp in components:
        for part in [comp.get("text", "")] + [
            btn.get("url", "") for btn in comp.get("buttons", [])
        ]:
            for match in re.findall(r"\{\{(\d+)\}\}", part or ""):
                if match not in seen:
                    seen.add(match)
                    variables.append(match)
    return sorted(variables, key=lambda x: int(x))


class MetaClient:
    def __init__(self, access_token: str):
        self.access_token = access_token
        # Token via header Bearer, NUNCA via query param: param vaza o token em
        # URLs de log (httpx inclui a URL completa em erros) e no paging.next
        self._auth = {"Authorization": f"Bearer {access_token}"}

    async def discover_wabas(self, bm_id: str | None = None) -> list[str]:
        """Auto-discover WABA IDs accessible by this token.

        Strategy (multi-prong, each non-fatal):
          0. bm_id explícito (Portfólio) → /{bm}/owned + client_whatsapp_business_accounts
          1. debug_token → granular_scopes target_ids → owned_whatsapp_business_accounts
          2. /me/businesses → /{biz}/owned_whatsapp_business_accounts
          3. /me/assigned_whatsapp_business_accounts (direct SU assignments)
          4. Fallback seed list (META_WABA_FALLBACK_IDS env) — validated 1-by-1

        Tokens de apps "CLAUDE DISPARO"/system users costumam voltar VAZIO em
        1-3 (target_ids vazio + /me/businesses vazio). Pra esses, o caminho
        confiável é a Strategy 0 (BM id que o usuário informa) ou o seed env.
        """
        waba_ids: list[str] = []

        async with httpx.AsyncClient(timeout=15) as client:
            async def _add_edge(node: str, edge: str) -> None:
                """Lista WABAs de {node}/{edge} seguindo paginação (paging.next)."""
                url: str | None = f"{META_BASE}/{node}/{edge}"
                params: dict | None = {"fields": "id,name", "limit": 100}
                try:
                    while url:
                        r = await client.get(url, params=params, headers=self._auth)
                        if r.status_code != 200:
                            return
                        data = r.json()
                        for waba in data.get("data", []):
                            wid = str(waba.get("id", ""))
                            if wid and wid not in waba_ids:
                                waba_ids.append(wid)
                        url = (data.get("paging") or {}).get("next")
                        params = None  # next já traz os params embutidos
                except Exception:
                    return

            # ── Strategy 0: BM id explícito (o mais confiável p/ system user) ─
            if bm_id:
                await _add_edge(bm_id, "owned_whatsapp_business_accounts")
                await _add_edge(bm_id, "client_whatsapp_business_accounts")
                # Porta com BM explícita usa SOMENTE a Strategy 0: as Strategies
                # 1-3 varrem TODAS as businesses do token e contaminariam a porta
                # com WABAs de outras BMs (token de agência multi-BM = caso comum).
                # Vazio aqui = erro honesto "0 números, confira o BM id" no refresh,
                # nunca números da BM errada. Mesmo racional do guard da Strategy 4.
                return waba_ids

            # ── Strategy 1: debug_token granular_scopes → owned WABAs ────────
            try:
                r = await client.get(
                    f"{META_BASE}/debug_token",
                    params={"input_token": self.access_token},
                    headers=self._auth,
                )
                if r.status_code == 200:
                    for scope in r.json().get("data", {}).get("granular_scopes", []):
                        if scope.get("scope") == "whatsapp_business_management":
                            for biz_id in (scope.get("target_ids") or []):
                                await _add_edge(str(biz_id), "owned_whatsapp_business_accounts")
                            break
            except Exception:
                pass

            # ── Strategy 2: /me/businesses → owned WABAs ─────────────────────
            try:
                rb = await client.get(
                    f"{META_BASE}/me/businesses",
                    params={"fields": "id", "limit": 100},
                    headers=self._auth,
                )
                if rb.status_code == 200:
                    for biz in rb.json().get("data", []):
                        biz_id = str(biz.get("id", ""))
                        if biz_id:
                            await _add_edge(biz_id, "owned_whatsapp_business_accounts")
            except Exception:
                pass

            # ── Strategy 3: assigned to system user ──────────────────────────
            try:
                ra = await client.get(
                    f"{META_BASE}/me/assigned_whatsapp_business_accounts",
                    params={"fields": "id,name", "limit": 100},
                    headers=self._auth,
                )
                if ra.status_code == 200:
                    for waba in ra.json().get("data", []):
                        wid = str(waba.get("id", ""))
                        if wid and wid not in waba_ids:
                            waba_ids.append(wid)
            except Exception:
                pass

            # ── Strategy 4: env seed fallback ────────────────────────────────
            # Lista GLOBAL (multi-tenant). Só usar quando NÃO há bm_id explícito
            # E nada foi descoberto — senão um token que enxerga WABAs de outra
            # BM no seed as anexaria à porta errada (vazamento entre BMs/tenants).
            if not bm_id and not waba_ids:
                for wid in META_WABA_FALLBACK_IDS:
                    if wid in waba_ids:
                        continue
                    try:
                        rv = await client.get(
                            f"{META_BASE}/{wid}",
                            params={"fields": "id,name"},
                            headers=self._auth,
                            timeout=8,
                        )
                        if rv.status_code == 200 and rv.json().get("id"):
                            waba_ids.append(wid)
                    except Exception:
                        continue

        return waba_ids

    async def resolve_identity(self, bm_id: str | None = None) -> dict:
        """Valida o token e resolve o nome do Business Manager para o UX
        "conexão ok ESTÁVEL". Retorna:
          {valid, bm_id, bm_name, app, waba_count, error}

        Se `bm_id` (Portfólio) for informado, usa ele direto pra nome da BM e
        contagem de WABAs — caminho confiável p/ tokens system user que voltam
        vazio em /me/businesses (ex: apps DISPARO / CLAUDE DISPARO).
        """
        out: dict = {
            "valid": False, "bm_id": None, "bm_name": None,
            "app": None, "waba_count": 0, "error": None,
        }
        async with httpx.AsyncClient(timeout=15) as client:
            # 1. debug_token → validade + app
            try:
                r = await client.get(
                    f"{META_BASE}/debug_token",
                    params={"input_token": self.access_token},
                    headers=self._auth,
                )
                data = (r.json() or {}).get("data", {})
                if not data.get("is_valid"):
                    out["error"] = "Token inválido ou expirado"
                    return out
                out["valid"] = True
                out["app"] = data.get("application")
            except Exception as e:
                out["error"] = f"Falha ao validar token: {e}"
                return out

            # 2a. BM id explícito → nome da BM direto (caminho confiável)
            if bm_id:
                try:
                    rbm = await client.get(
                        f"{META_BASE}/{bm_id}",
                        params={"fields": "id,name"},
                        headers=self._auth,
                    )
                    if rbm.status_code == 200:
                        j = rbm.json() or {}
                        out["bm_id"] = str(j.get("id") or bm_id) or None
                        out["bm_name"] = j.get("name") or out["bm_name"]
                except Exception:
                    pass

            # 2b. Nome da BM via /me/businesses (1ª business possuída)
            if not out["bm_name"]:
                try:
                    rb = await client.get(
                        f"{META_BASE}/me/businesses",
                        params={"fields": "id,name", "limit": 1},
                        headers=self._auth,
                    )
                    biz = (rb.json() or {}).get("data") or []
                    if biz:
                        out["bm_id"] = out["bm_id"] or (str(biz[0].get("id") or "") or None)
                        out["bm_name"] = biz[0].get("name")
                except Exception:
                    pass

        # 3. Contagem de WABAs (+ nome da BM via 1ª WABA se ainda sem nome)
        try:
            wabas = await self.discover_wabas(bm_id=bm_id)
            out["waba_count"] = len(wabas)
            if not out["bm_name"] and wabas:
                info = await self.get_waba_info(wabas[0])
                out["bm_name"] = info.get("name") or None
        except Exception:
            pass

        if not out["bm_name"]:
            out["bm_name"] = "BM (sem nome)"
        return out

    async def get_waba_info(self, waba_id: str) -> dict:
        """Fetch WABA-level fields: account review, business verification, currency, country."""
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                f"{META_BASE}/{waba_id}",
                params={
                    "fields": "id,name,account_review_status,business_verification_status,currency,country,timezone_id,is_enabled_for_insights",
                },
                headers=self._auth,
            )
            if r.status_code != 200:
                return {}
            return r.json()

    async def get_all_phones_auto(self, bm_id: str | None = None) -> list[dict]:
        """Discover WABAs from token (ou via BM id) then fetch all phone numbers.
        Each phone is enriched with WABA-level review/verification fields."""
        waba_ids = await self.discover_wabas(bm_id=bm_id)
        all_phones: list[dict] = []
        for wid in waba_ids:
            try:
                waba_info = await self.get_waba_info(wid)
                phones = await self.get_all_phones(wid)
                for p in phones:
                    p["waba_name"] = waba_info.get("name", "")
                    p["account_review_status"] = waba_info.get("account_review_status", "UNKNOWN")
                    p["business_verification_status"] = waba_info.get("business_verification_status", "unknown")
                    p["waba_currency"] = waba_info.get("currency", "")
                    p["waba_country"] = waba_info.get("country", "")
                all_phones.extend(phones)
            except Exception:
                pass
        return all_phones

    async def get_phone_quality(self, phone_id: str) -> dict:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{META_BASE}/{phone_id}",
                params={"fields": PHONE_FIELDS},
                headers=self._auth,
                timeout=15,
            )
            r.raise_for_status()
        return _parse_phone(r.json())

    async def get_all_phones(self, waba_id: str) -> list[dict]:
        all_phones: list[dict] = []
        url: str | None = f"{META_BASE}/{waba_id}/phone_numbers"
        params: dict = {"fields": PHONE_FIELDS, "limit": 100}

        async with httpx.AsyncClient() as client:
            while url:
                r = await client.get(url, params=params, headers=self._auth, timeout=15)
                r.raise_for_status()
                data = r.json()
                all_phones.extend(_parse_phone(p, waba_id) for p in data.get("data", []))
                url = (data.get("paging") or {}).get("next")
                params = {}  # next URL already has all params embedded

        return all_phones

    async def get_templates(self, waba_id: str) -> list[dict]:
        """Returns APPROVED message templates for a WABA with their variables."""
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{META_BASE}/{waba_id}/message_templates",
                params={
                    "fields": "id,name,status,language,category,components",
                    "status": "APPROVED",
                    "limit": 200,
                },
                headers=self._auth,
                timeout=15,
            )
            r.raise_for_status()
            data = r.json()

        results = []
        for t in data.get("data", []):
            components = t.get("components", [])
            variables = _extract_template_variables(components)
            body = next((c.get("text", "") for c in components if c.get("type") == "BODY"), "")
            results.append({**t, "variables": variables, "body": body})
        return results

    async def get_templates_all(self, waba_id: str) -> list[dict]:
        """Returns message templates for a WABA across statuses/categories for diagnostics."""
        templates: list[dict] = []
        url: str | None = f"{META_BASE}/{waba_id}/message_templates"
        params: dict = {
            "fields": "id,name,status,language,category,components,rejected_reason",
            "limit": 200,
        }
        async with httpx.AsyncClient(timeout=15) as client:
            while url:
                r = await client.get(url, params=params, headers=self._auth)
                r.raise_for_status()
                data = r.json()
                templates.extend(data.get("data", []))
                url = (data.get("paging") or {}).get("next")
                params = {}

        results = []
        for t in templates:
            components = t.get("components", [])
            variables = _extract_template_variables(components)
            body = next((c.get("text", "") for c in components if c.get("type") == "BODY"), "")
            results.append({**t, "variables": variables, "body": body})
        return results

    async def send_template(
        self,
        phone_id: str,
        to: str,
        template_name: str,
        language: str,
        body_params: list[str] | None = None,
    ) -> dict:
        """Send an approved template via Cloud API POST /{phone_id}/messages.

        body_params fill the {{1}}..{{N}} BODY variables in order. Raises
        httpx.HTTPStatusError on non-2xx; returns the parsed Graph response.
        """
        template: dict = {"name": template_name, "language": {"code": language}}
        if body_params:
            template["components"] = [{
                "type": "body",
                "parameters": [{"type": "text", "text": str(p)} for p in body_params],
            }]
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "template",
            "template": template,
        }
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                f"{META_BASE}/{phone_id}/messages",
                headers={**self._auth, "Content-Type": "application/json"},
                json=payload,
            )
            r.raise_for_status()
            return r.json()
