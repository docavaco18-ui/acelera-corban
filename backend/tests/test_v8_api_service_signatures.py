"""Smoke: garante que todas as funções V8 públicas aceitam token explícito."""
import inspect
from app.services import v8_api_service as v8

PUBLIC_FNS = ["enrich_cpf", "create_consent", "authorize_consent",
              "get_simulation_configs", "create_simulation", "get_consult"]


def test_all_public_fns_accept_token_first():
    for name in PUBLIC_FNS:
        fn = getattr(v8, name)
        sig = inspect.signature(fn)
        params = list(sig.parameters.values())
        assert params, f"{name} sem args"
        assert params[0].name == "token", f"{name} primeiro arg deveria ser 'token', tem {params[0].name!r}"
        assert params[0].annotation is str
