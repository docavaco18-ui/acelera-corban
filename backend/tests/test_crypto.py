from app.credentials.crypto import encrypt, decrypt


def test_encrypt_decrypt_roundtrip():
    plain = "minha-senha-secreta"
    cipher = encrypt(plain)
    assert isinstance(cipher, bytes)
    assert cipher != plain.encode()
    assert decrypt(cipher) == plain


def test_encrypt_handles_unicode():
    plain = "senh@çãõéü"
    assert decrypt(encrypt(plain)) == plain


def test_encrypt_none_returns_none():
    assert encrypt(None) is None


def test_decrypt_none_returns_none():
    assert decrypt(None) is None


def test_encrypt_empty_string():
    cipher = encrypt("")
    assert cipher is not None
    assert decrypt(cipher) == ""
