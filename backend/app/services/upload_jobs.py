"""Upload de CSV em background.

POST /api/leads/upload retorna {job_id} imediatamente; um asyncio.Task
processa o CSV em lotes e guarda o progresso no Redis (TTL 1h).
"""
from __future__ import annotations

import asyncio
import csv
import io
import json
import logging
import re
import unicodedata
import uuid

import httpx

from ..database import db
from ..db_scoped import scoped
from ..redis_client import get_redis

logger = logging.getLogger(__name__)

BATCH_SIZE = 500
JOB_TTL_SECONDS = 3600
JOB_KEY_PREFIX = "upload:"
UPSERT_MAX_ATTEMPTS = 4
UPSERT_BACKOFF_BASE = 0.5  # 0.5, 1, 2, 4 segundos

TRANSIENT_HTTPX_ERRORS = (
    httpx.RemoteProtocolError,
    httpx.ReadError,
    httpx.ConnectError,
    httpx.ReadTimeout,
    httpx.WriteError,
    httpx.PoolTimeout,
    httpx.ConnectTimeout,
)


def _job_key(job_id: str) -> str:
    return f"{JOB_KEY_PREFIX}{job_id}"


async def _set_state(job_id: str, state: dict) -> None:
    r = await get_redis()
    await r.set(_job_key(job_id), json.dumps(state), ex=JOB_TTL_SECONDS)


async def get_job(job_id: str) -> dict | None:
    r = await get_redis()
    raw = await r.get(_job_key(job_id))
    return json.loads(raw) if raw else None


def _norm_key(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]", "", s.lower())


CPF_KEYS = {"cpf", "cpfcliente", "documento", "doc", "cpfcnpj"}
NOME_KEYS = {"nome", "nomecliente", "cliente", "nomecompleto"}
TEL_KEYS = {"telefone", "celular", "telefonecelular", "telefone1", "fone", "phone", "ddd"}
DATA_KEYS = {"datanascimento", "nascimento", "dtnascimento", "datanasc", "dtnasc"}


def _pick(row: dict, normalized_row: dict, candidates: set[str]) -> str:
    for k_norm, original in normalized_row.items():
        if k_norm in candidates:
            v = row.get(original)
            if v is not None and str(v).strip():
                return str(v).strip()
    return ""


def _detect_dialect(text: str) -> csv.Dialect | type[csv.Dialect]:
    sample = text[:4096]
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        return csv.excel


def _normalize_date(s: str) -> str | None:
    s = s.strip()
    if not s:
        return None
    if "/" in s:
        parts = s.split("/")
        if len(parts) == 3:
            d, m, y = parts
            if len(y) == 2:
                y = "19" + y if int(y) > 30 else "20" + y
            try:
                return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"
            except ValueError:
                return None
    if "-" in s and len(s) >= 10:
        return s[:10]
    return None


def _parse_csv(content: bytes, owner_id: str, batch_id: str | None = None) -> list[dict]:
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")
    dialect = _detect_dialect(text)
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    if not reader.fieldnames:
        return []
    normalized_row = {_norm_key(f): f for f in reader.fieldnames}
    leads: list[dict] = []
    for row in reader:
        cpf_raw = _pick(row, normalized_row, CPF_KEYS)
        cpf = re.sub(r"\D", "", cpf_raw)
        if not cpf:
            continue
        lead = {
            "cpf": cpf,
            "telefone": _pick(row, normalized_row, TEL_KEYS),
            "status": "pendente",
            "owner_id": owner_id,
        }
        if batch_id is not None:
            lead["batch_id"] = batch_id
        nome = _pick(row, normalized_row, NOME_KEYS)
        if nome:
            lead["nome"] = nome
        data_nasc = _normalize_date(_pick(row, normalized_row, DATA_KEYS))
        if data_nasc:
            lead["data_nascimento"] = data_nasc
        leads.append(lead)
    return leads


async def _run(job_id: str, content: bytes, owner_id: str, batch_id: str | None = None) -> None:
    try:
        leads = _parse_csv(content, owner_id, batch_id=batch_id)
    except Exception as e:
        await _set_state(job_id, {
            "status": "error", "error": f"CSV inválido: {e}",
            "total": 0, "processed": 0, "inserted": 0,
        })
        return

    total = len(leads)
    if total == 0:
        await _set_state(job_id, {
            "status": "error", "error": "Nenhum CPF encontrado no arquivo",
            "total": 0, "processed": 0, "inserted": 0,
        })
        return

    await _set_state(job_id, {
        "status": "running", "total": total, "processed": 0, "inserted": 0, "duplicates": 0,
    })

    inserted = 0
    duplicates = 0
    processed = 0
    loop = asyncio.get_running_loop()

    for i in range(0, total, BATCH_SIZE):
        batch = leads[i:i + BATCH_SIZE]
        try:
            res = await _upsert_with_retry(batch, owner_id, loop)
            new_rows = len(res.data or [])
            inserted += new_rows
            duplicates += len(batch) - new_rows
        except Exception as e:
            logger.exception("Upload %s falhou no batch i=%d (processado=%d, inserido=%d)",
                             job_id, i, processed, inserted)
            await _set_state(job_id, {
                "status": "error",
                "error": f"{type(e).__name__}: {e}",
                "total": total, "processed": processed,
                "inserted": inserted, "duplicates": duplicates,
            })
            return

        processed += len(batch)
        await _set_state(job_id, {
            "status": "running", "total": total,
            "processed": processed, "inserted": inserted, "duplicates": duplicates,
        })

    # Atualiza total_leads na batch (se houver)
    if batch_id is not None:
        try:
            def _update_batch():
                scoped(db(), "v8_batches", owner_id).update({
                    "total_leads": inserted,
                }).eq("id", batch_id).execute()
            await loop.run_in_executor(None, _update_batch)
        except Exception:
            pass  # não-crítico

    await _set_state(job_id, {
        "status": "done", "total": total,
        "processed": processed, "inserted": inserted,
        "duplicates": duplicates,
        "batch_id": batch_id,
    })


async def _upsert_with_retry(batch: list[dict], owner_id: str, loop) -> object:
    """Upsert com retry em erros httpx transientes (Server disconnected, ReadError, etc.).

    PostgREST + ignore_duplicates é idempotente, então retry é seguro.
    Se o batch foi parcialmente commitado antes da queda, na retry os já-inseridos
    viram duplicatas (não são reinseridos), o que pode subestimar o counter — mas
    a integridade dos dados é mantida.
    """
    def _upsert(b=batch):
        return (
            scoped(db(), "v8_leads", owner_id)
            .upsert(b, on_conflict="owner_id,cpf", ignore_duplicates=True)
            .execute()
        )

    last_err: Exception | None = None
    for attempt in range(UPSERT_MAX_ATTEMPTS):
        try:
            return await loop.run_in_executor(None, _upsert)
        except TRANSIENT_HTTPX_ERRORS as e:
            last_err = e
            wait = UPSERT_BACKOFF_BASE * (2 ** attempt)
            logger.warning("upsert tentativa %d/%d falhou (%s); retry em %.1fs",
                           attempt + 1, UPSERT_MAX_ATTEMPTS, type(e).__name__, wait)
            await asyncio.sleep(wait)
        except Exception as e:
            # Heurística: erros que mencionam "disconnect" / "connection" também são transientes
            msg = str(e).lower()
            if any(k in msg for k in ("disconnect", "connection reset", "broken pipe", "connection aborted")):
                last_err = e
                wait = UPSERT_BACKOFF_BASE * (2 ** attempt)
                logger.warning("upsert tentativa %d/%d falhou (%s: %s); retry em %.1fs",
                               attempt + 1, UPSERT_MAX_ATTEMPTS, type(e).__name__, e, wait)
                await asyncio.sleep(wait)
            else:
                raise
    assert last_err is not None
    raise last_err


async def _create_batch(owner_id: str, file_name: str | None) -> str:
    """Cria uma batch nova e retorna o id."""
    loop = asyncio.get_running_loop()
    name = file_name or f"Upload {uuid.uuid4().hex[:8]}"

    def _insert():
        return scoped(db(), "v8_batches", owner_id).insert({
            "name": name,
            "file_name": file_name,
            "status": "pendente",
        }).execute()

    res = await loop.run_in_executor(None, _insert)
    return res.data[0]["id"]


async def start_upload(content: bytes, owner_id: str, file_name: str | None = None) -> dict:
    job_id = uuid.uuid4().hex
    batch_id = await _create_batch(owner_id, file_name)
    await _set_state(job_id, {
        "status": "queued", "total": 0, "processed": 0, "inserted": 0,
        "batch_id": batch_id,
    })
    asyncio.create_task(_run(job_id, content, owner_id, batch_id=batch_id))
    return {"job_id": job_id, "batch_id": batch_id}
