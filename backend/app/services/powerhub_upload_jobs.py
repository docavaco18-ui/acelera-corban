"""Upload de CSV para PowerHub — enriquecimento de telefone."""
from __future__ import annotations

import asyncio
import csv
import io
import json
import re
import unicodedata
import uuid

from ..database import db
from ..db_scoped import scoped
from ..redis_client import get_redis

BATCH_SIZE = 500
JOB_TTL_SECONDS = 3600
JOB_KEY_PREFIX = "powerhub_upload:"


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


def _parse_csv(content: bytes) -> list[dict]:
    text = content.lstrip(b"\xef\xbb\xbf").decode("utf-8", errors="replace")
    dialect = _detect_dialect(text)
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    rows = list(reader)

    cpf_digits_seen: set[str] = set()
    records: list[dict] = []

    for row in rows:
        normalized = {_norm_key(k): k for k in row.keys()}
        cpf_raw = _pick(row, normalized, CPF_KEYS)
        if not cpf_raw:
            continue
        cpf_digits = re.sub(r"\D", "", cpf_raw)
        if len(cpf_digits) != 11:
            continue
        if cpf_digits in cpf_digits_seen:
            continue
        cpf_digits_seen.add(cpf_digits)

        nome = _pick(row, normalized, NOME_KEYS)
        records.append({"cpf": cpf_digits, "nome": nome})

    return records


async def start_upload(content: bytes, user_id: str, file_name: str = "") -> dict:
    job_id = str(uuid.uuid4())
    await _set_state(job_id, {"status": "processing", "total": 0, "inserted": 0})
    asyncio.create_task(_run_upload(job_id, content, user_id, file_name))
    return {"job_id": job_id}


async def _run_upload(job_id: str, content: bytes, user_id: str, file_name: str) -> None:
    try:
        records = await asyncio.to_thread(_parse_csv, content)
        total = len(records)
        await _set_state(job_id, {"status": "processing", "total": total, "inserted": 0})

        # Cria batch
        batch_resp = await asyncio.to_thread(
            lambda: scoped(db(), "powerhub_batches", user_id).insert({
                "file_name": file_name,
                "total_leads": total,
                "status": "active",
            }).execute()
        )
        batch_id = batch_resp.data[0]["id"]

        inserted = 0
        for i in range(0, total, BATCH_SIZE):
            chunk = records[i : i + BATCH_SIZE]
            rows = [
                {
                    "owner_id": user_id,
                    "batch_id": batch_id,
                    "cpf": r["cpf"],
                    "nome": r["nome"] or None,
                    "status": "pending",
                    "phones": "[]",
                }
                for r in chunk
            ]
            await asyncio.to_thread(
                lambda: scoped(db(), "powerhub_leads", user_id).insert(rows).execute()
            )
            inserted += len(chunk)
            await _set_state(job_id, {"status": "processing", "total": total, "inserted": inserted, "batch_id": batch_id})

        await _set_state(job_id, {"status": "done", "total": total, "inserted": inserted, "batch_id": batch_id})

    except Exception as e:
        await _set_state(job_id, {"status": "error", "error": str(e)})
