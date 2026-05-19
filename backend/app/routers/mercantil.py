"""Routers Mercantil — leads, bot, stats, batches sob /api/mercantil/*.

Endpoints SMS críticos:
  POST /api/mercantil/bot/sms    — frontend envia o código que user digitou
  GET  /api/mercantil/bot/sms/state — fallback de polling se WS caiu
"""
from __future__ import annotations

import csv
import io
import re

from pathlib import Path

from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Request
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel, Field

from ..auth_deps import require_user, AuthUser
from ..database import db as get_db
from ..db_scoped import scoped
from ..banks.mercantil.credentials_helper import get_mercantil_runtime_creds
from ..banks.mercantil import sms_bridge
from ..services import mercantil_upload_jobs, mercantil_bot_service

router = APIRouter(prefix="/api/mercantil", tags=["mercantil"])
_events: list[dict] = []


def _on_event(event: dict):
    _events.append(event)
    if len(_events) > 500:
        _events.pop(0)


# ─── Leads ──────────────────────────────────────────────────────────────────

@router.post("/leads/upload", status_code=202)
async def upload_csv(
    file: UploadFile = File(...),
    user: AuthUser = Depends(require_user),
):
    content = await file.read()
    if not content:
        raise HTTPException(400, "Arquivo vazio")
    return await mercantil_upload_jobs.start_upload(content, user.user_id, file_name=file.filename)


@router.get("/leads/upload/{job_id}")
async def upload_status(job_id: str, _: AuthUser = Depends(require_user)):
    state = await mercantil_upload_jobs.get_job(job_id)
    if state is None:
        raise HTTPException(404, "Job não encontrado ou expirado")
    return state


@router.get("/leads/")
async def list_leads(
    status: str = None,
    batch_id: str | None = None,
    page: int = 1,
    limit: int = 50,
    user: AuthUser = Depends(require_user),
):
    db = get_db()
    q = scoped(db, "mercantil_leads", user.user_id).select("*").order("created_at", desc=True)
    if status:
        q = q.eq("status", status)
    if batch_id:
        q = q.eq("batch_id", batch_id)
    result = q.range((page - 1) * limit, page * limit - 1).execute()
    return {"data": result.data, "page": page}


@router.get("/leads/export")
async def export_csv(
    status: str = "elegivel",
    batch_id: str | None = None,
    user: AuthUser = Depends(require_user),
):
    db = get_db()
    q = scoped(db, "mercantil_leads", user.user_id).select("*").eq("status", status)
    if batch_id:
        q = q.eq("batch_id", batch_id)
    result = q.execute()
    leads = result.data
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=[
        "cpf", "nome", "telefone", "status", "cenario",
        "valor_liberado", "valor_parcela", "qtd_parcelas", "prazo",
        "taxa_juros_mes", "valor_financiado", "valor_emprestimo",
        "data_vencimento", "erro",
    ])
    writer.writeheader()
    for lead in leads:
        writer.writerow({k: lead.get(k, "") for k in writer.fieldnames})
    output.seek(0)
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode()),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=mercantil_{status}.csv"},
    )


@router.post("/leads/retry-errors")
def retry_errors(batch_id: str | None = None, user: AuthUser = Depends(require_user)):
    db = get_db()
    q = scoped(db, "mercantil_leads", user.user_id).update(
        {"status": "pendente", "erro": None}
    ).eq("status", "erro")
    if batch_id:
        q = q.eq("batch_id", batch_id)
    result = q.execute()
    return {"resetados": len(result.data or [])}


# ─── Bot ────────────────────────────────────────────────────────────────────

@router.post("/bot/start")
async def bot_start(
    request: Request,
    num_workers: int = 1,
    batch_id: str | None = None,
    mode: str = "dom",
    user: AuthUser = Depends(require_user),
):
    if mode not in ("dom", "bff"):
        raise HTTPException(400, "mode deve ser 'dom' ou 'bff'")

    db = get_db()
    creds = get_mercantil_runtime_creds(user.user_id, db)
    pool = request.app.state.mercantil_pool

    # Bloqueia se outro bot do mesmo user estiver rodando (recurso compartilhado Chromium)
    v8_pool = request.app.state.v8_pool
    vctex_pool = request.app.state.vctex_pool
    if v8_pool.status(user.user_id) is not None:
        raise HTTPException(409, "Bot V8 já em execução. Pare-o antes de iniciar o Mercantil.")
    if vctex_pool.status(user.user_id) is not None:
        raise HTTPException(409, "Bot VCTex já em execução. Pare-o antes de iniciar o Mercantil.")

    return await mercantil_bot_service.start_bot(
        pool=pool, user_id=user.user_id, num_workers=num_workers,
        creds=creds, db=db, on_event=_on_event, batch_id=batch_id,
        mode=mode,
    )


@router.post("/bot/stop")
async def bot_stop(request: Request, user: AuthUser = Depends(require_user)):
    pool = request.app.state.mercantil_pool
    return await mercantil_bot_service.stop_bot(pool, user.user_id)


@router.get("/bot/status")
async def bot_status(request: Request, user: AuthUser = Depends(require_user)):
    pool = request.app.state.mercantil_pool
    return await mercantil_bot_service.get_bot_status(pool, user.user_id)


@router.get("/bot/events")
async def bot_events(user: AuthUser = Depends(require_user)):
    return {"events": [e for e in _events if e.get("user_id") == user.user_id][-100:]}


# ─── SMS bridge endpoints ───────────────────────────────────────────────────

class SmsSubmitBody(BaseModel):
    run_id: str = Field(..., min_length=1)
    code: str = Field(..., min_length=4, max_length=12)


@router.post("/bot/sms")
async def submit_sms(
    body: SmsSubmitBody,
    user: AuthUser = Depends(require_user),
):
    """Recebe o código SMS digitado no modal do frontend.
    Valida ownership do run_id antes de empurrar pra fila do bot."""
    db = get_db()
    # Verifica que o run pertence ao user (evita usuário A injetar código no run de B)
    rows = (
        scoped(db, "mercantil_bot_runs", user.user_id)
        .select("id").eq("id", body.run_id).execute().data or []
    )
    if not rows:
        raise HTTPException(404, "Run não encontrado ou não pertence ao usuário")

    code = re.sub(r"\D", "", body.code)
    if len(code) < 4:
        raise HTTPException(400, "Código deve conter ao menos 4 dígitos")

    await sms_bridge.submit_sms_code(user.user_id, body.run_id, code)
    return {"status": "submitted"}


@router.get("/bot/sms/state")
async def sms_state(
    run_id: str,
    user: AuthUser = Depends(require_user),
):
    """Frontend pode chamar isso pra confirmar estado se WS dropou."""
    db = get_db()
    rows = (
        scoped(db, "mercantil_bot_runs", user.user_id)
        .select("id").eq("id", run_id).execute().data or []
    )
    if not rows:
        raise HTTPException(404, "Run não encontrado ou não pertence ao usuário")
    state = await sms_bridge.get_state(user.user_id, run_id)
    return state or {"status": "unknown"}


# ─── Stats ──────────────────────────────────────────────────────────────────

@router.get("/stats/dashboard")
async def stats_dashboard(batch_id: str | None = None, user: AuthUser = Depends(require_user)):
    db = get_db()
    rows: list[dict] = []
    PAGE = 1000
    offset = 0
    while True:
        q = scoped(db, "mercantil_leads", user.user_id).select("status,valor_liberado,batch_id")
        if batch_id is not None:
            q = q.eq("batch_id", batch_id)
        chunk = q.range(offset, offset + PAGE - 1).execute().data or []
        rows.extend(chunk)
        if len(chunk) < PAGE:
            break
        offset += PAGE

    counts: dict[str, int] = {}
    total_liberado = 0.0
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
        if r["status"] == "elegivel":
            total_liberado += float(r.get("valor_liberado") or 0)

    eleg = counts.get("elegivel", 0)
    ineleg = counts.get("inelegivel", 0)
    erros = counts.get("erro", 0)
    pend = counts.get("pendente", 0)
    em_proc = (counts.get("fase1_consulta", 0) + counts.get("fase2_check_auth", 0)
               + counts.get("fase3_dataprev", 0) + counts.get("fase4_simular", 0))
    aguard = counts.get("aguardando_autorizacao", 0)
    return {
        "total": len(rows),
        "elegiveis": eleg,
        "inelegiveis": ineleg,
        "pendentes": pend,
        "erros": erros,
        "em_processamento": em_proc,
        "aguardando_autorizacao": aguard,
        "processados": eleg + ineleg + erros,
        "total_liberado": round(total_liberado, 2),
        "total_margem": 0.0,
        "by_status": counts,
    }


# ─── Batches ────────────────────────────────────────────────────────────────

@router.get("/batches/")
def list_batches(user: AuthUser = Depends(require_user)):
    db = get_db()
    rows = (
        scoped(db, "mercantil_batches", user.user_id)
        .select("*").order("created_at", desc=True).execute().data or []
    )
    return {"data": rows}


@router.get("/batches/stats/{batch_id}")
@router.get("/batches/{batch_id}/stats")
def batch_stats(batch_id: str, user: AuthUser = Depends(require_user)):
    db = get_db()
    own = (
        scoped(db, "mercantil_batches", user.user_id)
        .select("id").eq("id", batch_id).execute().data or []
    )
    if not own:
        raise HTTPException(404, "Batch não encontrada")
    rows: list[dict] = []
    PAGE = 1000
    offset = 0
    while True:
        chunk = (
            scoped(db, "mercantil_leads", user.user_id)
            .select("status,valor_liberado")
            .eq("batch_id", batch_id)
            .range(offset, offset + PAGE - 1)
            .execute().data or []
        )
        rows.extend(chunk)
        if len(chunk) < PAGE:
            break
        offset += PAGE
    counts: dict[str, int] = {}
    total_liberado = 0.0
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
        if r["status"] == "elegivel":
            total_liberado += float(r.get("valor_liberado") or 0)
    eleg = counts.get("elegivel", 0)
    ineleg = counts.get("inelegivel", 0)
    erros = counts.get("erro", 0)
    em_proc = (counts.get("fase1_consulta", 0) + counts.get("fase2_check_auth", 0)
               + counts.get("fase3_dataprev", 0) + counts.get("fase4_simular", 0))
    return {
        "total": len(rows), "elegiveis": eleg, "inelegiveis": ineleg,
        "pendentes": counts.get("pendente", 0), "erros": erros,
        "em_processamento": em_proc,
        "aguardando_autorizacao": counts.get("aguardando_autorizacao", 0),
        "processados": eleg + ineleg + erros,
        "total_liberado": round(total_liberado, 2), "total_margem": 0.0, "by_status": counts,
    }


@router.get("/batches/current")
def current_batch(user: AuthUser = Depends(require_user)):
    db = get_db()
    active = (
        scoped(db, "mercantil_batches", user.user_id).select("*")
        .in_("status", ["pendente", "processando"])
        .order("created_at", desc=True).limit(1).execute().data or []
    )
    if active:
        return active[0]
    latest = (
        scoped(db, "mercantil_batches", user.user_id).select("*")
        .order("created_at", desc=True).limit(1).execute().data or []
    )
    return latest[0] if latest else None


@router.get("/batches/{batch_id}")
def get_batch(batch_id: str, user: AuthUser = Depends(require_user)):
    db = get_db()
    rows = (
        scoped(db, "mercantil_batches", user.user_id).select("*")
        .eq("id", batch_id).execute().data or []
    )
    if not rows:
        raise HTTPException(404, "Batch não encontrada")
    return rows[0]


class PatchBatchBody(BaseModel):
    name: str | None = None
    status: str | None = None


@router.patch("/batches/{batch_id}")
def patch_batch(batch_id: str, body: PatchBatchBody, user: AuthUser = Depends(require_user)):
    db = get_db()
    payload: dict = {}
    if body.name is not None:
        payload["name"] = body.name.strip()[:120]
    if body.status is not None:
        if body.status not in ("pendente", "processando", "concluida", "cancelada"):
            raise HTTPException(400, "status inválido")
        payload["status"] = body.status
    if not payload:
        raise HTTPException(400, "Nada para atualizar")
    rows = (
        scoped(db, "mercantil_batches", user.user_id)
        .update(payload).eq("id", batch_id).execute().data or []
    )
    if not rows:
        raise HTTPException(404, "Batch não encontrada")
    return rows[0]


@router.delete("/batches/{batch_id}", status_code=204)
def delete_batch(batch_id: str, user: AuthUser = Depends(require_user)):
    db = get_db()
    own = (
        scoped(db, "mercantil_batches", user.user_id)
        .select("id").eq("id", batch_id).execute().data or []
    )
    if not own:
        raise HTTPException(404, "Batch não encontrada")
    scoped(db, "mercantil_leads", user.user_id).delete().eq("batch_id", batch_id).execute()
    scoped(db, "mercantil_batches", user.user_id).delete().eq("id", batch_id).execute()


@router.get("/bot/session-status")
def session_status(user: AuthUser = Depends(require_user)):
    """Returns whether a saved storage state exists on disk for this user."""
    return mercantil_bot_service.get_session_status(user.user_id)


class ImportSessionBody(BaseModel):
    url: str | None = None
    cookies: str = ""
    localStorage: dict | None = None
    sessionStorage: dict | None = None


@router.post("/bot/import-session")
async def bot_import_session(
    body: ImportSessionBody,
    user: AuthUser = Depends(require_user),
):
    """Importa sessão do Chrome real do user (cookies+localStorage) e salva
    como storage_state Playwright em backend/.bot_state/mercantil/{user_id}.json.
    """
    import json as _json
    import os as _os
    from urllib.parse import urlparse

    url = body.url or "https://meu.bancomercantil.com.br/dashboard"
    parsed = urlparse(url)
    domain = parsed.hostname or "meu.bancomercantil.com.br"
    origin = f"{parsed.scheme}://{parsed.hostname}"

    cookies: list[dict] = []
    for pair in (body.cookies or "").split(";"):
        pair = pair.strip()
        if not pair or "=" not in pair:
            continue
        name, _, value = pair.partition("=")
        cookies.append({
            "name": name.strip(),
            "value": value.strip(),
            "domain": domain,
            "path": "/",
            "expires": -1,
            "httpOnly": False,
            "secure": True,
            "sameSite": "Lax",
        })

    local = body.localStorage or {}
    storage_state = {
        "cookies": cookies,
        "origins": [{
            "origin": origin,
            "localStorage": [{"name": k, "value": str(v)} for k, v in local.items()],
        }],
    }

    state_dir = Path(_os.getenv("MERCANTIL_STATE_DIR", ".bot_state/mercantil"))
    state_dir.mkdir(parents=True, exist_ok=True)
    state_file = state_dir / f"{user.user_id}.json"
    with open(state_file, "w") as f:
        _json.dump(storage_state, f, ensure_ascii=False)

    pcb = local.get("PCB_AUTH")
    return {
        "status": "ok",
        "path": str(state_file),
        "cookies_count": len(cookies),
        "localStorage_keys": list(local.keys()),
        "has_pcb_auth": bool(pcb),
    }


@router.post("/bot/login-visual", status_code=202)
async def bot_login_visual(
    request: Request,
    manual: int = 0,
    user: AuthUser = Depends(require_user),
):
    """Starts headful login (visible browser) for SMS capture only. Does NOT process leads.

    Query param `manual=1` ativa modo assistido: bot só preenche login/senha,
    pede 1 código SMS e para. Sem retries automáticos."""
    import logging as _log
    _log.getLogger("mercantil.router").info(
        "login_visual hit user=%s manual=%d", user.user_id, manual
    )
    db = get_db()
    creds = get_mercantil_runtime_creds(user.user_id, db)
    if not creds or not getattr(creds, "login", None) or not getattr(creds, "password", None):
        raise HTTPException(400, "Credenciais Mercantil não configuradas. Configure em Configurações.")
    return await mercantil_bot_service.start_login_visual(
        pool=request.app.state.mercantil_pool,
        user_id=user.user_id,
        creds=creds,
        on_event=_on_event,
        db=db,
        manual_sms=bool(manual),
    )


_SCREENSHOT_NAME_RE = re.compile(r"^[A-Za-z0-9_\-.]+\.png$")


@router.get("/screenshot/{name}")
def get_screenshot(name: str, _: AuthUser = Depends(require_user)):
    """Serve PNG from /tmp/mercantil_*.png. Name validated to prevent path traversal."""
    if not _SCREENSHOT_NAME_RE.match(name):
        raise HTTPException(400, "invalid name")
    path = Path("/tmp") / name
    if not path.is_file():
        raise HTTPException(404, "not found")
    if not path.name.startswith("mercantil_"):
        raise HTTPException(403, "forbidden")
    return FileResponse(path, media_type="image/png")


@router.get("/bot/runs")
def list_runs(limit: int = 20, user: AuthUser = Depends(require_user)):
    db = get_db()
    rows = (
        scoped(db, "mercantil_bot_runs", user.user_id)
        .select("id,started_at,finished_at,status,num_workers,total_processed,total_elegiveis,total_inelegiveis")
        .order("started_at", desc=True)
        .limit(min(limit, 100))
        .execute().data or []
    )
    return {"runs": rows}
