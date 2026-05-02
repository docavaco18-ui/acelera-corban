from cryptography.fernet import Fernet
from ..config import settings

_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        key = settings.app_encryption_key
        if not key:
            raise RuntimeError(
                "APP_ENCRYPTION_KEY não configurado. "
                "Gere com: python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"
            )
        _fernet = Fernet(key.encode() if isinstance(key, str) else key)
    return _fernet


def encrypt(plaintext: str | None) -> str | None:
    """Retorna Fernet token como string urlsafe-base64 ASCII (JSON-safe)."""
    if plaintext is None:
        return None
    return _get_fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt(ciphertext: str | bytes | None) -> str | None:
    if ciphertext is None:
        return None
    if isinstance(ciphertext, str):
        ciphertext = ciphertext.encode("ascii")
    return _get_fernet().decrypt(ciphertext).decode("utf-8")
