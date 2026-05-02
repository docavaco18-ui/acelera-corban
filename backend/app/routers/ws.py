import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from ..redis_client import get_redis
from ..auth_deps import verify_token, AuthUser

router = APIRouter(tags=["ws"])
_connections: dict[str, set[WebSocket]] = {}


@router.websocket("/ws/events")
async def websocket_events(ws: WebSocket, token: str = ""):
    """Canal WS por user_id. Eventos com user_id != ao do conectado são filtrados."""
    try:
        user: AuthUser = verify_token(token)
    except Exception:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await ws.accept()
    _connections.setdefault(user.user_id, set()).add(ws)
    redis = await get_redis()
    pubsub = redis.pubsub()
    await pubsub.subscribe("bot:events")
    try:
        async for message in pubsub.listen():
            if message["type"] != "message":
                continue
            try:
                ev = json.loads(message["data"])
            except (TypeError, ValueError):
                continue
            ev_user = ev.get("user_id")
            if ev_user is not None and ev_user != user.user_id:
                continue
            await ws.send_text(message["data"] if isinstance(message["data"], str) else message["data"].decode())
    except WebSocketDisconnect:
        pass
    finally:
        _connections.get(user.user_id, set()).discard(ws)
        await pubsub.unsubscribe("bot:events")
        await pubsub.aclose()
