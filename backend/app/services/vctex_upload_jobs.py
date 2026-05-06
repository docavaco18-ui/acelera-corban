"""Upload de CSV pra VCTex — análogo ao upload_jobs (V8)."""
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
JOB_KEY_PREFIX = "vctex_upload:"


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
        cpf = re.sub(r"\D", "", cpf_raw).zfill(11)
        if not cpf or len(cpf) > 11:
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
        if batch_id is not None:
            lead["batch_id"] = batch_id
        leads.append(lead)
    return leads


async def _create_batch(owner_id: str, file_name: str | None) -> str:
    loop = asyncio.get_running_loop()
    name = file_name or f"VCTex Upload {uuid.uuid4().hex[:8]}"

    def _insert():
        return scoped(db(), "vctex_batches", owner_id).insert({
            "name": name,
            "file_name": file_name,
            "status": "pendente",
        }).execute()

    res = await loop.run_in_executor(None, _insert)
    return res.data[0]["id"]


async def _run(job_id: str, content: bytes, owner_id: str, batch_id: str) -> None:
    try:
        leads = _parse_csv(content, owner_id, batch_id=batch_id)
    except Exception as e:
        await _set_state(job_id, {"status": "error", "error": f"CSV inválido: {e}",
                                  "total": 0, "processed": 0, "inserted": 0})
        return

    total = len(leads)
    if total == 0:
        await _set_state(job_id, {"status": "error", "error": "Nenhum CPF encontrado",
                                  "total": 0, "processed": 0, "inserted": 0})
        return

    await _set_state(job_id, {"status": "running", "total": total,
                              "processed": 0, "inserted": 0, "batch_id": batch_id})

    inserted = 0
    processed = 0
    loop = asyncio.get_running_loop()

    for i in range(0, total, BATCH_SIZE):
        batch = leads[i:i + BATCH_SIZE]
        try:
            def _upsert(b=batch):
                return (
                    scoped(db(), "vctex_leads", owner_id)
                    .upsert(b, on_conflict="owner_id,cpf", ignore_duplicates=True)
                    .execute()
                )
            res = await loop.run_in_executor(None, _upsert)
            inserted += len(res.data or [])
        except Exception as e:
            await _set_state(job_id, {"status": "error", "error": str(e),
                                      "total": total, "processed": processed, "inserted": inserted})
            return

        processed += len(batch)
        await _set_state(job_id, {"status": "running", "total": total,
                                  "processed": processed, "inserted": inserted})

    try:
        def _update_batch():
            scoped(db(), "vctex_batches", owner_id).update({
                "total_leads": inserted,
            }).eq("id", batch_id).execute()
        await loop.run_in_executor(None, _update_batch)
    except Exception:
        pass

    await _set_state(job_id, {"status": "done", "total": total,
                              "processed": processed, "inserted": inserted,
                              "batch_id": batch_id})


async def start_upload(content: bytes, owner_id: str, file_name: str | None = None) -> dict:
    job_id = uuid.uuid4().hex
    batch_id = await _create_batch(owner_id, file_name)
    await _set_state(job_id, {"status": "queued", "total": 0, "processed": 0, "inserted": 0,
                              "batch_id": batch_id})
    asyncio.create_task(_run(job_id, content, owner_id, batch_id))
    return {"job_id": job_id, "batch_id": batch_id}
