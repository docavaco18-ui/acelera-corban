"""Cruzamento Chatwoot ↔ v8_leads. Roda em background via FastAPI BackgroundTasks."""
from __future__ import annotations
import re
import threading
import time
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any
import math
import httpx

from ..credentials.crypto import decrypt, safe_decrypt

logger = logging.getLogger(__name__)


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

# ─── Normalização de telefone ────────────────────────────────────────────────

def norm_phone(raw: str) -> str:
    """Retorna 55DDD9XXXXXXXX (13 dígitos) ou string vazia."""
    if not raw:
        return ""
    d = re.sub(r"\D", "", raw).lstrip("0")
    if d.startswith("55") and len(d) >= 12:
        sem = d[2:]
    elif len(d) == 11:
        sem = d
    elif len(d) == 10:
        sem = d[:2] + "9" + d[2:]
    elif len(d) == 9:
        return ""
    else:
        return ""
    if len(sem) == 10:
        sem = sem[:2] + "9" + sem[2:]
    return "55" + sem if len(sem) == 11 else ""


def phone_variants(normalized: str) -> set[str]:
    if not normalized or len(normalized) != 13:
        return {normalized} if normalized else set()
    ddd = normalized[2:4]
    rest = normalized[4:]
    rest_no9 = rest[1:] if rest.startswith("9") else rest
    base = ddd + rest
    base_no9 = ddd + rest_no9
    return {
        normalized, "+" + normalized,
        base, "+55" + base,
        base_no9, "55" + base_no9, "+55" + base_no9,
    }


# ─── Chatwoot client ─────────────────────────────────────────────────────────

class ChatwootClient:
    def __init__(self, url: str, account_id: str, token: str):
        self.base = url.rstrip("/")
        self.acc = account_id
        self.client = httpx.Client(
            headers={"api_access_token": token, "Content-Type": "application/json"},
            timeout=30,
        )

    def close(self) -> None:
        try:
            self.client.close()
        except Exception:
            pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def list_contacts_page(self, page: int) -> tuple[list[dict], int]:
        for attempt in range(3):
            try:
                r = self.client.get(
                    f"{self.base}/api/v1/accounts/{self.acc}/contacts",
                    params={"page": page},
                )
                r.raise_for_status()
                p = r.json()
                batch = p.get("payload") or p.get("data", {}).get("payload") or []
                meta = p.get("meta") or p.get("data", {}).get("meta") or {}
                return batch, int(meta.get("count", 0))
            except Exception as e:
                if attempt == 2:
                    raise
                time.sleep(1)
        return [], 0

    def fetch_all_contacts(self, on_progress=None) -> list[dict]:
        first, total = self.list_contacts_page(1)
        per_page = len(first) or 15
        n_pages = math.ceil(total / per_page) if total else 1
        all_c = list(first)
        if on_progress:
            on_progress("contacts", 1, n_pages, len(all_c))
        if n_pages <= 1:
            return all_c
        with ThreadPoolExecutor(max_workers=10) as ex:
            futs = {ex.submit(self.list_contacts_page, p): p for p in range(2, n_pages + 1)}
            done = 1
            for fut in as_completed(futs):
                try:
                    batch, _ = fut.result()
                    all_c.extend(batch)
                except Exception as e:
                    logger.warning(f"page fetch failed: {e}")
                done += 1
                if on_progress and (done % 50 == 0 or done == n_pages):
                    on_progress("contacts", done, n_pages, len(all_c))
        return all_c

    def _get_with_retry(self, url: str, max_retries: int = 4):
        """GET com backoff exponencial em 429/5xx (Chatwoot rate-limit)."""
        delay = 1.0
        for attempt in range(max_retries):
            r = self.client.get(url)
            if r.status_code == 429 or 500 <= r.status_code < 600:
                if attempt == max_retries - 1:
                    r.raise_for_status()
                time.sleep(delay)
                delay = min(delay * 2, 30)
                continue
            r.raise_for_status()
            return r
        return r  # type: ignore

    def fetch_conversations_for_contact(self, contact_id: int) -> tuple[list[dict], bool]:
        """Retorna (conversas, ok). ok=False = erro permanente — não classificar como 'nunca contatado'.

        F8: falha em UMA conversa não anula as outras. Só marca ok=False se a listagem falhar
        ou >50% das mensagens das conversas falharem.
        """
        try:
            r = self._get_with_retry(
                f"{self.base}/api/v1/accounts/{self.acc}/contacts/{contact_id}/conversations"
            )
            convs = r.json().get("payload", [])
        except Exception as e:
            logger.warning(f"conversations list failed contact={contact_id}: {e}")
            return [], False

        n_failed = 0
        for c in convs:
            cid = c.get("id")
            if cid is None:
                c["_messages"] = []
                continue
            try:
                rm = self._get_with_retry(
                    f"{self.base}/api/v1/accounts/{self.acc}/conversations/{cid}/messages"
                )
                c["_messages"] = rm.json().get("payload", [])
            except Exception as e:
                logger.warning(f"messages fetch failed conv={cid}: {e}")
                c["_messages"] = []
                n_failed += 1
            time.sleep(0.1)

        # ok = sem conversas (nada pra fazer) ou ≤50% das conversas com falha de mensagens
        ok = (not convs) or (n_failed / len(convs) <= 0.5)
        return convs, ok


# ─── Cruzamento ──────────────────────────────────────────────────────────────

def index_contacts_by_phone(contacts: list[dict]) -> dict[str, int]:
    idx: dict[str, int] = {}
    for c in contacts:
        nums = []
        if c.get("phone_number"):
            nums.append(c["phone_number"])
        for inb in c.get("contact_inboxes", []) or []:
            s = inb.get("source_id", "")
            if s and any(ch.isdigit() for ch in s):
                nums.append(s)
        for n in nums:
            norm = norm_phone(n)
            if not norm:
                continue
            for v in phone_variants(norm):
                idx.setdefault(v, c["id"])
            idx.setdefault(norm, c["id"])
    return idx


def _to_dt(s):
    if not s:
        return None
    try:
        if isinstance(s, (int, float)):
            return datetime.fromtimestamp(s)
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception:
        return None


def classify(convs: list[dict]) -> dict:
    if not convs:
        return {"bucket": "nunca_contatado", "labels": None}
    all_msgs, statuses, canais, labels_set = [], [], [], set()
    for c in convs:
        statuses.append(c.get("status"))
        canais.append((c.get("meta") or {}).get("channel") or c.get("channel"))
        for lab in c.get("labels", []) or []:
            if lab:
                labels_set.add(str(lab).lower())
        for m in c.get("_messages", []):
            all_msgs.append(m)
    incoming = [m for m in all_msgs if m.get("message_type") == 0]
    outgoing = [m for m in all_msgs if m.get("message_type") == 1]
    primeira_out = min((_to_dt(m.get("created_at")) for m in outgoing if _to_dt(m.get("created_at"))), default=None)
    ultima_out = max((_to_dt(m.get("created_at")) for m in outgoing if _to_dt(m.get("created_at"))), default=None)
    ultima_in = max((_to_dt(m.get("created_at")) for m in incoming if _to_dt(m.get("created_at"))), default=None)
    if ultima_in is not None:
        bucket = "respondeu"
    elif outgoing:
        bucket = "visualizou_sem_responder"
    else:
        bucket = "conversa_sem_msg"
    status_set = {s for s in statuses if s}
    if "open" in status_set or "pending" in status_set:
        sc = "aberta"
    elif "resolved" in status_set:
        sc = "fechada"
    else:
        sc = "outro"
    tempo_h = None
    if ultima_in and primeira_out:
        delta = (ultima_in - primeira_out).total_seconds() / 3600
        # F4: incoming antes do primeiro outgoing → não é "tempo de resposta"
        if delta >= 0:
            tempo_h = delta
    return {
        "bucket": bucket,
        "status_conversa": sc,
        "canal": canais[0] if canais else None,
        "n_conversas": len(convs),
        "n_msgs_outgoing": len(outgoing),
        "n_msgs_incoming": len(incoming),
        "primeira_outgoing_at": primeira_out.isoformat() if primeira_out else None,
        "ultima_outgoing_at": ultima_out.isoformat() if ultima_out else None,
        "ultima_incoming_at": ultima_in.isoformat() if ultima_in else None,
        "tempo_resposta_horas": round(tempo_h, 2) if tempo_h is not None else None,
        "labels": ",".join(sorted(labels_set)) if labels_set else None,
    }


# ─── Pipeline orquestrado ────────────────────────────────────────────────────

def run_sync(db, owner_id: str, settings_row: dict, run_id: str) -> dict:
    """Roda pipeline completo. Atualiza chatwoot_sync_runs ao final."""
    # F1: token salvo encriptado no DB; decifra só na hora de usar.
    # safe_decrypt: token salvo com chave Fernet antiga não derruba o sync com 500.
    token = safe_decrypt(settings_row["api_token"]) or ""
    client = ChatwootClient(settings_row["chatwoot_url"], settings_row["account_id"], token)

    # 1. Pega leads do user
    leads = []
    start = 0
    while True:
        res = (db.table("v8_leads")
                 .select("id,cpf,nome,telefone,status,batch_id,owner_id")
                 .eq("owner_id", owner_id)
                 .range(start, start + 999).execute())
        if not res.data:
            break
        leads.extend(res.data)
        if len(res.data) < 1000:
            break
        start += 1000
    logger.info(f"chatwoot sync: {len(leads)} leads do owner")

    # 2. Pega todos contatos do Chatwoot
    contacts = client.fetch_all_contacts()
    logger.info(f"chatwoot sync: {len(contacts)} contatos")

    # 3. Index + match
    idx = index_contacts_by_phone(contacts)
    matched: list[dict] = []
    for ld in leads:
        norm = norm_phone(ld.get("telefone", ""))
        cid = None
        if norm:
            for v in phone_variants(norm):
                if v in idx:
                    cid = idx[v]
                    break
        matched.append({**ld, "contact_id": cid})
    n_matched = sum(1 for m in matched if m["contact_id"])
    logger.info(f"chatwoot sync: {n_matched} matches")

    # 4. Buscar conversas (paralelo, conservador pra não estourar rate-limit do Chatwoot)
    # F2: abort real — flag threading.Event + shutdown(cancel_futures=True) cancela
    # tarefas QUEUED. Tarefas em voo (httpx.get) não dá pra cancelar mid-request, mas
    # workers checam a flag antes de cada chamada nova.
    to_fetch = [m for m in matched if m["contact_id"]]
    convs_by_cid: dict[int, list[dict]] = {}
    failed_cids: set[int] = set()
    n_total = len(to_fetch)
    n_failed = 0
    aborted = threading.Event()

    def _fetch_with_abort(contact_id: int):
        if aborted.is_set():
            return [], False
        return client.fetch_conversations_for_contact(contact_id)

    ex = ThreadPoolExecutor(max_workers=4)
    try:
        futs = {ex.submit(_fetch_with_abort, m["contact_id"]): m for m in to_fetch}
        for fut in as_completed(futs):
            m = futs[fut]
            try:
                convs, ok = fut.result()
                convs_by_cid[m["contact_id"]] = convs
                if not ok:
                    failed_cids.add(m["contact_id"])
                    n_failed += 1
                    if n_total >= 100 and n_failed / n_total > 0.30:
                        aborted.set()
                        raise RuntimeError(
                            f"Aborted: >30% failures ({n_failed}/{n_total}). "
                            "Chatwoot rate-limit ou indisponível."
                        )
            except RuntimeError:
                raise
            except Exception as e:
                logger.warning(f"contact {m['contact_id']}: {e}")
                convs_by_cid[m["contact_id"]] = []
                failed_cids.add(m["contact_id"])
                n_failed += 1
    finally:
        ex.shutdown(wait=False, cancel_futures=True)
        try:
            client.close()
        except Exception:
            pass

    # 5. Classifica + persiste (pula leads cujo fetch falhou pra não corromper bucket)
    rows_to_upsert = []
    n_responded = 0
    for ld in matched:
        cid = ld["contact_id"]
        if cid in failed_cids:
            continue  # mantém estado anterior, não classifica como nunca_contatado
        convs = convs_by_cid.get(cid) if cid else None
        cls = classify(convs or [])
        if cls.get("bucket") == "respondeu":
            n_responded += 1
        rows_to_upsert.append({
            "lead_id": ld["id"],
            "owner_id": owner_id,
            "cpf": ld.get("cpf"),
            "chatwoot_contact_id": cid,
            **cls,
            "synced_at": _utcnow_iso(),
        })

    # Upsert em chunks
    for i in range(0, len(rows_to_upsert), 500):
        chunk = rows_to_upsert[i:i + 500]
        db.table("chatwoot_lead_status").upsert(chunk, on_conflict="lead_id").execute()

    # 6. Fecha run
    db.table("chatwoot_sync_runs").update({
        "finished_at": _utcnow_iso(),
        "status": "completed",
        "total_contacts": len(contacts),
        "total_leads": len(leads),
        "total_matched": n_matched,
        "total_responded": n_responded,
    }).eq("id", run_id).execute()

    db.table("chatwoot_settings").update({
        "last_sync_at": _utcnow_iso(),
    }).eq("owner_id", owner_id).execute()

    return {
        "total_contacts": len(contacts),
        "total_leads": len(leads),
        "total_matched": n_matched,
        "total_responded": n_responded,
    }
