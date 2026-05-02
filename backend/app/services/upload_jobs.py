"""Upload de CSV em background.

POST /api/leads/upload retorna {job_id} imediatamente; um asyncio.Task
processa o CSV em lotes e guarda o progresso no Redis (TTL 1h).
"""
from __future__ import annotations

import asyncio
import csv
import io
import json
import re
import unicodedata
import uuid

from ..database import db
from ..redis_client import get_redis

BATCH_SIZE = 500
JOB_TTL_SECONDS = 3600
JOB_KEY_PREFIX = "upload:"


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


def _parse_csv(content: bytes, owner_id: str) -> list[dict]:
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
        nome = _pick(row, normalized_row, NOME_KEYS)
        if nome:
            lead["nome"] = nome
        data_nasc = _normalize_date(_pick(row, normalized_row, DATA_KEYS))
        if data_nasc:
            lead["data_nascimento"] = data_nasc
        leads.append(lead)
    return leads


async def _run(job_id: str, content: bytes, owner_id: str) -> None:
    try:
        leads = _parse_csv(content, owner_id)
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
        "status": "running", "total": total, "processed": 0, "inserted": 0,
    })

    inserted = 0
    processed = 0
    loop = asyncio.get_running_loop()

    for i in range(0, total, BATCH_SIZE):
        batch = leads[i:i + BATCH_SIZE]
        try:
            def _upsert(b=batch):
                return (
                    db().table("v8_leads")
                    .upsert(b, on_conflict="owner_id,cpf", ignore_duplicates=True)
                    .execute()
                )
            res = await loop.run_in_executor(None, _upsert)
            inserted += len(res.data or [])
        except Exception as e:
            await _set_state(job_id, {
                "status": "error", "error": str(e),
                "total": total, "processed": processed, "inserted": inserted,
            })
            return

        processed += len(batch)
        await _set_state(job_id, {
            "status": "running", "total": total,
            "processed": processed, "inserted": inserted,
        })

    await _set_state(job_id, {
        "status": "done", "total": total,
        "processed": processed, "inserted": inserted,
    })


async def start_upload(content: bytes, owner_id: str) -> str:
    job_id = uuid.uuid4().hex
    await _set_state(job_id, {
        "status": "queued", "total": 0, "processed": 0, "inserted": 0,
    })
    asyncio.create_task(_run(job_id, content, owner_id))
    return job_id
