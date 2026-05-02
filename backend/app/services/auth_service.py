"""DEPRECATED: chamadas diretas ao token global removidas. Use banks/v8/auth.get_token(user_id, login, password)."""
from ..banks.v8.auth import get_token as _user_get_token  # noqa: F401


async def get_token() -> str:
    raise RuntimeError(
        "auth_service.get_token() sem args foi removido. "
        "Use banks.v8.auth.get_token(user_id, login, password)."
    )
