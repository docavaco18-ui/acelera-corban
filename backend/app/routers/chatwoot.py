"""Chatwoot CRM cross-reference router."""
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from datetime import datetime, timezone
import logging
import statistics

from ..auth_deps import require_user, AuthUser
from ..database import db as get_db
from ..services import chatwoot_service
from ..credentials.crypto import encrypt


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_unique_violation(err: Exception) -> bool:
    msg = str(err).lower()
    return (
        "uniq_chatwoot_running_per_owner" in msg
        or "duplicate key" in msg
        or "23505" in msg
    )

router = APIRouter(prefix="/api/chatwoot", tags=["chatwoot"])
logger = logging.getLogger(__name__)


# ─── Settings ────────────────────────────────────────────────────────────────

class SettingsIn(BaseModel):
    chatwoot_url: str
    account_id: str
    api_token: str | None = None  # vazio = manter token existente
    inbox_ids: str | None = None


@router.get("/settings")
async def get_settings(user: AuthUser = Depends(require_user)):
    db = get_db()
    res = (db.table("chatwoot_settings")
             .select("chatwoot_url,account_id,inbox_ids,last_sync_at,updated_at")
             .eq("owner_id", user.user_id).maybe_single().execute())
    if not res or not res.data:
        return {"configured": False}
    d = res.data
    return {"configured": True, **d}


@router.put("/settings")
async def put_settings(payload: SettingsIn, user: AuthUser = Depends(require_user)):
    db = get_db()
    body = {
        "owner_id": user.user_id,
        "chatwoot_url": payload.chatwoot_url.rstrip("/"),
        "account_id": payload.account_id,
        "inbox_ids": payload.inbox_ids,
        "updated_at": _utcnow_iso(),
    }
    # F1: token salvo encriptado (Fernet via APP_ENCRYPTION_KEY).
    # Token vazio → preserva o ciphertext existente (suporta edição sem redigitar).
    if payload.api_token and payload.api_token.strip():
        body["api_token"] = encrypt(payload.api_token.strip())
    else:
        existing = (db.table("chatwoot_settings").select("api_token")
                      .eq("owner_id", user.user_id).maybe_single().execute())
        if not existing or not existing.data or not existing.data.get("api_token"):
            raise HTTPException(400, "Token obrigatório no primeiro cadastro.")
        body["api_token"] = existing.data["api_token"]  # já está encriptado
    db.table("chatwoot_settings").upsert(body, on_conflict="owner_id").execute()
    return {"ok": True}


# ─── Sync ────────────────────────────────────────────────────────────────────

def _run_sync_bg(owner_id: str, settings_row: dict, run_id: str):
    db = get_db()
    try:
        chatwoot_service.run_sync(db, owner_id, settings_row, run_id)
    except Exception as e:
        logger.exception("chatwoot sync failed")
        try:
            db.table("chatwoot_sync_runs").update({
                "finished_at": _utcnow_iso(),
                "status": "failed",
                "error": str(e)[:500],
            }).eq("id", run_id).execute()
        except Exception:
            pass


@router.post("/sync")
async def start_sync(bg: BackgroundTasks, user: AuthUser = Depends(require_user)):
    db = get_db()
    s = (db.table("chatwoot_settings").select("*")
           .eq("owner_id", user.user_id).maybe_single().execute())
    if not s or not s.data:
        raise HTTPException(400, "Configure CHATWOOT_URL/ACCOUNT_ID/TOKEN antes de sincronizar.")

    # F3: defesa em camadas. Pre-check pra mensagem clara, unique partial index
    # (migration 012) garante atomicidade se dois POST chegarem em paralelo.
    running = (db.table("chatwoot_sync_runs").select("id")
                 .eq("owner_id", user.user_id).eq("status", "running")
                 .limit(1).execute())
    if running.data:
        raise HTTPException(409, "Já existe sync em andamento.")

    try:
        run = db.table("chatwoot_sync_runs").insert({
            "owner_id": user.user_id, "status": "running",
        }).execute()
    except Exception as e:
        if _is_unique_violation(e):
            raise HTTPException(409, "Já existe sync em andamento.")
        raise
    run_id = run.data[0]["id"]

    bg.add_task(_run_sync_bg, user.user_id, s.data, run_id)
    return {"run_id": run_id, "status": "running"}


@router.get("/sync/status")
async def sync_status(user: AuthUser = Depends(require_user)):
    db = get_db()
    res = (db.table("chatwoot_sync_runs").select("*")
             .eq("owner_id", user.user_id)
             .order("started_at", desc=True).limit(1).execute())
    if not res.data:
        return {"never_synced": True}
    return res.data[0]


@router.get("/sync/history")
async def sync_history(limit: int = 10, user: AuthUser = Depends(require_user)):
    db = get_db()
    res = (db.table("chatwoot_sync_runs").select("*")
             .eq("owner_id", user.user_id)
             .order("started_at", desc=True).limit(min(limit, 50)).execute())
    return {"runs": res.data or []}


# ─── Métricas / Relatórios ───────────────────────────────────────────────────

PAGE = 1000


def _scan(db, table, user_id, cols, **filters):
    rows, off = [], 0
    while True:
        q = db.table(table).select(cols).eq("owner_id", user_id)
        for k, v in filters.items():
            q = q.eq(k, v)
        chunk = q.range(off, off + PAGE - 1).execute().data or []
        rows.extend(chunk)
        if len(chunk) < PAGE:
            break
        off += PAGE
    return rows


@router.get("/metrics")
async def metrics(batch_id: str | None = None, user: AuthUser = Depends(require_user)):
    """Métricas agregadas: bucket counts, taxa por status_v8, taxa por batch."""
    db = get_db()

    # Junta v8_leads + chatwoot_lead_status
    leads = _scan(db, "v8_leads", user.user_id, "id,status,batch_id,valor_liberado,margem_disponivel")
    if batch_id:
        leads = [l for l in leads if l.get("batch_id") == batch_id]
    cls_rows = _scan(db, "chatwoot_lead_status", user.user_id,
                     "lead_id,bucket,status_conversa,canal,n_msgs_outgoing,n_msgs_incoming,tempo_resposta_horas")
    cls_by_id = {r["lead_id"]: r for r in cls_rows}

    bucket_counts = {"respondeu": 0, "visualizou_sem_responder": 0, "conversa_sem_msg": 0, "nunca_contatado": 0, "nao_sincronizado": 0}
    by_status_v8 = {}
    by_batch = {}
    by_canal = {}
    tempos = []

    for ld in leads:
        c = cls_by_id.get(ld["id"])
        if not c:
            bucket_counts["nao_sincronizado"] += 1
            bucket = "nao_sincronizado"
        else:
            bucket = c["bucket"]
            bucket_counts[bucket] = bucket_counts.get(bucket, 0) + 1
            if c.get("tempo_resposta_horas") is not None:
                tempos.append(float(c["tempo_resposta_horas"]))
            canal = c.get("canal") or "?"
            by_canal[canal] = by_canal.get(canal, 0) + 1

        st = ld.get("status") or "?"
        by_status_v8.setdefault(st, {"total": 0, "respondeu": 0})
        by_status_v8[st]["total"] += 1
        if bucket == "respondeu":
            by_status_v8[st]["respondeu"] += 1

        b = ld.get("batch_id") or "_sem_batch"
        by_batch.setdefault(b, {"total": 0, "respondeu": 0})
        by_batch[b]["total"] += 1
        if bucket == "respondeu":
            by_batch[b]["respondeu"] += 1

    # F13: statistics.median lida com listas pares corretamente (média dos dois do meio).
    media = statistics.fmean(tempos) if tempos else None
    mediana = statistics.median(tempos) if tempos else None

    total = len(leads)
    return {
        "total_leads": total,
        "bucket_counts": bucket_counts,
        "respondeu_total": bucket_counts.get("respondeu", 0),
        "taxa_resposta_pct": round(bucket_counts.get("respondeu", 0) / total * 100, 2) if total else 0,
        "by_status_v8": by_status_v8,
        "by_batch": by_batch,
        "by_canal": by_canal,
        "tempo_resposta": {"media_h": round(media, 1) if media else None, "mediana_h": round(mediana, 1) if mediana else None, "n": len(tempos)},
    }


@router.get("/labels")
async def list_labels(user: AuthUser = Depends(require_user)):
    """Retorna labels (tags) únicas com contagem de leads em cada uma."""
    db = get_db()
    rows = _scan(db, "chatwoot_lead_status", user.user_id, "labels")
    counts: dict[str, int] = {}
    for r in rows:
        labs = (r.get("labels") or "").strip()
        if not labs:
            continue
        for lab in labs.split(","):
            lab = lab.strip()
            if lab:
                counts[lab] = counts.get(lab, 0) + 1
    out = sorted([{"label": k, "count": v} for k, v in counts.items()], key=lambda x: -x["count"])
    return {"labels": out}


@router.get("/leads")
async def list_leads(
    bucket: str | None = None,
    status_v8: str | None = None,
    batch_id: str | None = None,
    label: str | None = None,
    limit: int = 100,
    offset: int = 0,
    user: AuthUser = Depends(require_user),
):
    """Lista leads cruzados com Chatwoot. Filtros opcionais."""
    db = get_db()

    # Se filtro por label, primeiro pega lead_ids que têm esse label
    label_lead_ids: set | None = None
    if label:
        cls_with_label = (db.table("chatwoot_lead_status")
                            .select("lead_id,labels")
                            .eq("owner_id", user.user_id)
                            .ilike("labels", f"%{label.lower()}%")
                            .execute().data or [])
        # Confere match exato em CSV (não substring)
        label_lead_ids = {
            r["lead_id"] for r in cls_with_label
            if label.lower() in {x.strip() for x in (r.get("labels") or "").split(",")}
        }
        if not label_lead_ids:
            return {"leads": [], "limit": limit, "offset": offset}

    q = (db.table("v8_leads")
           .select("id,cpf,nome,telefone,status,batch_id,valor_liberado,margem_disponivel,created_at")
           .eq("owner_id", user.user_id))
    if status_v8:
        q = q.eq("status", status_v8)
    if batch_id:
        q = q.eq("batch_id", batch_id)
    if label_lead_ids is not None:
        # in_ aceita list
        ids = list(label_lead_ids)
        # Postgrest pode ter limite de tamanho; se muitos, paginar (aqui MVP)
        q = q.in_("id", ids[:1000])
    q = q.order("created_at", desc=True).range(offset, offset + min(limit, 500) - 1)
    leads = q.execute().data or []

    if leads:
        ids2 = [l["id"] for l in leads]
        cls = (db.table("chatwoot_lead_status").select("*")
                 .eq("owner_id", user.user_id).in_("lead_id", ids2).execute().data or [])
        cls_by = {c["lead_id"]: c for c in cls}
    else:
        cls_by = {}

    out = []
    for ld in leads:
        c = cls_by.get(ld["id"], {})
        b = c.get("bucket", "nao_sincronizado")
        if bucket and b != bucket:
            continue
        out.append({**ld, **{k: c.get(k) for k in (
            "chatwoot_contact_id", "bucket", "status_conversa", "canal",
            "n_msgs_outgoing", "n_msgs_incoming",
            "ultima_outgoing_at", "ultima_incoming_at", "tempo_resposta_horas",
            "labels",
        )}})
        out[-1]["bucket"] = b
    return {"leads": out, "limit": limit, "offset": offset}
