from fastapi import APIRouter, Depends
from ..services import bot_service
from ..auth_deps import require_user, AuthUser

router = APIRouter(prefix="/api/bot", tags=["bot"])
_events = []


def _on_event(event: dict):
    _events.append(event)
    if len(_events) > 500:
        _events.pop(0)


@router.post("/start")
async def start(
    num_workers: int = 6,
    num_retry_workers: int = 3,
    user: AuthUser = Depends(require_user),
):
    # Admin processa tudo (owner_filter=None), users processam só os próprios.
    owner_filter = None if user.is_admin else user.user_id
    return await bot_service.start_bot(
        num_workers, _on_event,
        num_retry_workers=num_retry_workers,
        owner_id=owner_filter,
        initiator_id=user.user_id,
    )


@router.post("/stop")
async def stop(user: AuthUser = Depends(require_user)):
    return await bot_service.stop_bot()


@router.get("/status")
async def status(user: AuthUser = Depends(require_user)):
    return await bot_service.get_bot_status()


@router.get("/events")
async def events(user: AuthUser = Depends(require_user)):
    return {"events": _events[-100:]}
