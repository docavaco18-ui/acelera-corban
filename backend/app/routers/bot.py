from fastapi import APIRouter, Depends, HTTPException, Request
from ..services import bot_service
from ..auth_deps import require_user, AuthUser
from ..database import db as get_db
from ..banks.v8.credentials_helper import get_v8_runtime_creds

router = APIRouter(prefix="/api/bot", tags=["bot"])
_events: list[dict] = []


def _on_event(event: dict):
    _events.append(event)
    if len(_events) > 500:
        _events.pop(0)


@router.post("/start")
async def start(
    request: Request,
    num_workers: int = 6,
    num_retry_workers: int = 3,
    batch_id: str | None = None,
    user: AuthUser = Depends(require_user),
):
    db = get_db()
    creds = get_v8_runtime_creds(user.user_id, db)  # 400 se sem creds
    pool = request.app.state.v8_pool
    vctex_pool = request.app.state.vctex_pool
    if vctex_pool.status(user.user_id) is not None:
        raise HTTPException(409, "Bot VCTex já em execução. Pare-o antes de iniciar o V8.")
    return await bot_service.start_bot(
        pool=pool,
        user_id=user.user_id,
        num_workers=num_workers,
        creds=creds,
        db=db,
        on_event=_on_event,
        num_retry_workers=num_retry_workers,
        batch_id=batch_id,
    )


@router.post("/stop")
async def stop(request: Request, user: AuthUser = Depends(require_user)):
    pool = request.app.state.v8_pool
    return await bot_service.stop_bot(pool, user.user_id)


@router.get("/status")
async def status(request: Request, user: AuthUser = Depends(require_user)):
    pool = request.app.state.v8_pool
    return await bot_service.get_bot_status(pool, user.user_id)


@router.get("/events")
async def events(user: AuthUser = Depends(require_user)):
    return {"events": [e for e in _events if e.get("user_id") == user.user_id][-100:]}
