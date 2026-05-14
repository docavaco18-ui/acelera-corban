"""Smoke test do SMS bridge (Redis BLPOP/RPUSH).

Roda standalone: precisa só do REDIS_URL no .env.
Não toca em Playwright nem em Supabase.

Uso:
    cd /Users/macbookdegabriel/projetos/ACELERA\\ CORBAN
    PYTHONPATH=. python scripts/test_mercantil_sms_bridge.py
"""
from __future__ import annotations

import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.app.banks.mercantil import sms_bridge


async def test_happy_path():
    """Test 1: user envia código antes do bot pedir → bot recebe imediatamente."""
    print("\n[1] Happy path: submit ANTES de request")
    user_id = "test-user-1"
    run_id = "run-happy"

    # Submete primeiro
    await sms_bridge.submit_sms_code(user_id, run_id, "123456")

    # Bot pede agora (com timeout pequeno)
    code = await sms_bridge.request_sms_code(user_id, run_id, timeout=5)
    assert code == "123456", f"Esperado 123456, recebido {code!r}"
    print(f"  ✓ Recebeu código: {code}")
    await sms_bridge.discard_code(user_id, run_id)


async def test_late_submit():
    """Test 2: bot pede antes, user envia depois."""
    print("\n[2] Late submit: request bloqueia até submit chegar")
    user_id = "test-user-2"
    run_id = "run-late"

    async def delayed_submit():
        await asyncio.sleep(2)
        await sms_bridge.submit_sms_code(user_id, run_id, "654321")

    asyncio.create_task(delayed_submit())
    code = await sms_bridge.request_sms_code(user_id, run_id, timeout=10)
    assert code == "654321", f"Esperado 654321, recebido {code!r}"
    print(f"  ✓ Recebeu após espera: {code}")
    await sms_bridge.discard_code(user_id, run_id)


async def test_timeout():
    """Test 3: ninguém envia → BLPOP retorna None após timeout."""
    print("\n[3] Timeout: BLPOP expira sem código")
    user_id = "test-user-3"
    run_id = "run-timeout"
    code = await sms_bridge.request_sms_code(user_id, run_id, timeout=2)
    assert code is None, f"Esperado None, recebido {code!r}"
    print("  ✓ Timeout funcionou (None)")
    await sms_bridge.discard_code(user_id, run_id)


async def test_state():
    """Test 4: state setter/getter persiste e expira."""
    print("\n[4] State: SETEX + GET")
    user_id = "test-user-4"
    run_id = "run-state"
    await sms_bridge.set_state(user_id, run_id, "waiting", ttl=30)
    state = await sms_bridge.get_state(user_id, run_id)
    assert state == {"status": "waiting"}, f"Esperado waiting, recebido {state!r}"
    print(f"  ✓ State persistido: {state}")
    await sms_bridge.discard_code(user_id, run_id)


async def test_isolation():
    """Test 5: chaves diferentes por user_id+run_id não colidem."""
    print("\n[5] Isolation: códigos diferentes pra users diferentes")
    await sms_bridge.submit_sms_code("user-A", "run-A", "111111")
    await sms_bridge.submit_sms_code("user-B", "run-B", "222222")
    code_a = await sms_bridge.request_sms_code("user-A", "run-A", timeout=3)
    code_b = await sms_bridge.request_sms_code("user-B", "run-B", timeout=3)
    assert code_a == "111111"
    assert code_b == "222222"
    print(f"  ✓ user-A={code_a} user-B={code_b}")
    await sms_bridge.discard_code("user-A", "run-A")
    await sms_bridge.discard_code("user-B", "run-B")


async def main():
    try:
        await test_happy_path()
        await test_late_submit()
        await test_timeout()
        await test_state()
        await test_isolation()
        print("\n✅ TODOS OS TESTES PASSARAM")
        return 0
    except AssertionError as e:
        print(f"\n❌ TESTE FALHOU: {e}")
        return 1
    except Exception as e:
        print(f"\n❌ ERRO INESPERADO: {e}")
        import traceback
        traceback.print_exc()
        return 2


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
