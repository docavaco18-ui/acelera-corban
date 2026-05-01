from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from ..redis_client import get_redis
from ..auth_deps import verify_token, AuthUser

router = APIRouter(tags=["ws"])
_connections: list[WebSocket] = []


@router.websocket("/ws/events")
async def websocket_events(ws: WebSocket, token: str = ""):
    # Valida JWT recebido via query string (?token=...) — WS não permite headers facilmente.
    try:
        user: AuthUser = verify_token(token)
    except Exception:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await ws.accept()
    _connections.append(ws)
    redis = await get_redis()
    pubsub = redis.pubsub()
    await pubsub.subscribe("bot:events")
    try:
        async for message in pubsub.listen():
            if message["type"] == "message":
                # Filtragem por owner_id pode ser feita aqui no futuro lendo o payload;
                # por ora, o bot é escopado por initiator e os eventos refletem só os leads dele.
                _ = user
                await ws.send_text(message["data"])
    except WebSocketDisconnect:
        if ws in _connections:
            _connections.remove(ws)
    finally:
        await pubsub.unsubscribe("bot:events")
        await pubsub.aclose()
