"""
Probe script — testa BFF Mercantil usando bff_client.py

Precisa de JWT em .bot_state/mercantil/last_jwt.json (salvo pelo bot após login).
Se não tiver, instrui como obter.

Usage: python3 tmp_bff_probe.py [cpf]
  cpf: CPF para testar (padrão: usa CPF de teste)
"""
import asyncio
import json
import sys
import urllib3
from pathlib import Path

urllib3.disable_warnings()

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent / "backend"))

from app.banks.mercantil.bff_client import BffSession, load_session_from_cache, BFF_BASE

STATE_DIR = Path(__file__).parent / "backend/.bot_state/mercantil"
TEST_CPF = "33115840007"  # CPF de teste (do contexto anterior)


async def test_session_info(session: BffSession):
    """Test basic session info endpoints."""
    print("\n── Session info ──")
    mb = session._parse_mb_data()
    print(f"  mb.data keys: {list(mb.keys())}")
    print(f"  correspondente: {session.correspondente}")
    print(f"  usuario: {session.usuario}")
    print(f"  substabelecido: {session.substabelecido}")
    print(f"  sessaoId: {session.sessao_id}")


async def test_convenios(session: BffSession):
    """Test /Convenios/Publicos."""
    import httpx
    print("\n── Convenios/Publicos ──")
    async with session:
        try:
            convenios = await session._get("Convenios/Publicos")
            if isinstance(convenios, list):
                print(f"  Total: {len(convenios)} convenios")
                for c in convenios:
                    print(f"  - {c.get('id')}: {c.get('nome')} (modalidade={c.get('modalidadeConvenio')})")
                    if "MINISTERIO" in (c.get("nome") or "").upper() or "TRABALHO" in (c.get("nome") or "").upper():
                        print(f"    *** MTE ENCONTRADO ***")
            else:
                print(f"  Response: {str(convenios)[:300]}")
        except httpx.HTTPStatusError as e:
            print(f"  ERROR {e.response.status_code}: {e.response.text[:200]}")
        except Exception as e:
            print(f"  ERROR: {e}")


async def test_iniciar_operacao(session: BffSession, cpf: str):
    """Test POST /PropostasProspect/IniciarOperacao."""
    import httpx
    import re
    cpf_digits = re.sub(r"\D", "", cpf)
    print(f"\n── IniciarOperacao CPF={cpf_digits} ──")

    async with session:
        try:
            conv = await session.load_mte_convenio()
            print(f"  convenio: {conv}")
            body = session._build_iniciar_body(cpf_digits, conv)
            print(f"  body: {json.dumps(body, indent=2)}")

            resp = await session._post("PropostasProspect/IniciarOperacao", body)
            print(f"\n  RESPONSE:")
            print(f"  {json.dumps(resp, indent=2, ensure_ascii=False)[:2000]}")

        except httpx.HTTPStatusError as e:
            print(f"  ERROR {e.response.status_code}: {e.response.text[:400]}")
            # Try to parse error body
            try:
                err = e.response.json()
                print(f"  Error JSON: {json.dumps(err, indent=2)[:400]}")
            except Exception:
                pass
        except Exception as e:
            import traceback
            print(f"  EXCEPTION: {e}")
            traceback.print_exc()


async def test_full_consulta(session: BffSession, cpf: str):
    """Run full consultar_cpf flow."""
    print(f"\n── Full consultar_cpf CPF={cpf} ──")
    async with session:
        result = await session.consultar_cpf(cpf, poll_interval=5, poll_max=120)
        print(f"\n  RESULT: {json.dumps(result, indent=2, ensure_ascii=False)}")


async def main():
    cpf = sys.argv[1] if len(sys.argv) > 1 else TEST_CPF

    # Try to load JWT
    session = load_session_from_cache("", STATE_DIR)
    if session is None:
        print("[BLOCKED] No JWT cache found.")
        print()
        print("Para obter JWT:")
        print("  1. Acesse localhost:3002 → Mercantil")
        print("  2. Inicie o Bot (precisa de SMS no celular -5744)")
        print("  3. Após login, JWT é salvo em backend/.bot_state/mercantil/last_jwt.json")
        print("  4. Execute este script novamente")
        sys.exit(1)

    print(f"[OK] JWT loaded")

    await test_session_info(session)

    # Need fresh session for each test (context manager)
    session2 = load_session_from_cache("", STATE_DIR)
    await test_convenios(session2)

    session3 = load_session_from_cache("", STATE_DIR)
    await test_iniciar_operacao(session3, cpf)

    # Full flow only if we have convenio
    ans = input("\nRunar full consulta (poll + simulate)? [y/N] ")
    if ans.lower() == "y":
        session4 = load_session_from_cache("", STATE_DIR)
        await test_full_consulta(session4, cpf)


if __name__ == "__main__":
    asyncio.run(main())
