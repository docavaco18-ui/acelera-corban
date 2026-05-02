from app.credentials.crypto import encrypt, decrypt


def test_encrypt_decrypt_roundtrip():
    plain = "minha-senha-secreta"
    cipher = encrypt(plain)
    assert isinstance(cipher, str)
    assert cipher != plain
    assert decrypt(cipher) == plain


def test_decrypt_accepts_bytes_for_legacy_rows():
    # Compat: rows escritas antes do hotfix (BYTEA) chegavam como bytes.
    plain = "x"
    cipher_str = encrypt(plain)
    assert decrypt(cipher_str.encode("ascii")) == plain


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
