import pytest
from unittest.mock import MagicMock
from fastapi import HTTPException
from app.banks.vctex.credentials_helper import get_vctex_runtime_creds
from app.credentials.service import BankCredentials


def _svc_returning(creds):
    svc = MagicMock()
    svc.get.return_value = creds
    return svc


def test_returns_creds_when_cadastrada(monkeypatch):
    creds = BankCredentials(user_id="u1", bank_code="vctex", login="alice", password="pw", proxies=[])
    svc = _svc_returning(creds)
    monkeypatch.setattr("app.banks.vctex.credentials_helper.CredentialService", lambda db: svc)
    out = get_vctex_runtime_creds("u1", db=MagicMock())
    assert out is creds
    svc.get.assert_called_once_with("u1", "vctex")


def test_raises_400_when_missing(monkeypatch):
    svc = _svc_returning(None)
    monkeypatch.setattr("app.banks.vctex.credentials_helper.CredentialService", lambda db: svc)
    with pytest.raises(HTTPException) as ei:
        get_vctex_runtime_creds("u1", db=MagicMock())
    assert ei.value.status_code == 400
    assert "credenciais VCTex não cadastradas" in ei.value.detail


def test_raises_400_when_login_missing(monkeypatch):
    creds = BankCredentials(user_id="u1", bank_code="vctex", login=None, password="pw", proxies=[])
    svc = _svc_returning(creds)
    monkeypatch.setattr("app.banks.vctex.credentials_helper.CredentialService", lambda db: svc)
    with pytest.raises(HTTPException) as ei:
        get_vctex_runtime_creds("u1", db=MagicMock())
    assert ei.value.status_code == 400


def test_raises_400_when_password_missing(monkeypatch):
    creds = BankCredentials(user_id="u1", bank_code="vctex", login="x", password=None, proxies=[])
    svc = _svc_returning(creds)
    monkeypatch.setattr("app.banks.vctex.credentials_helper.CredentialService", lambda db: svc)
    with pytest.raises(HTTPException) as ei:
        get_vctex_runtime_creds("u1", db=MagicMock())
    assert ei.value.status_code == 400
