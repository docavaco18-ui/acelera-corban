from app.banks.nossafintech.api_client import NossaFintechApiClient, _money_from_cents
from app.banks.nossafintech.api_worker import _is_sandbox_mock_margin
from app.banks.nossafintech.api_client import MarginInfo
from app.routers.nossafintech import _aggregate, _flatten_lead


def test_flatten_lead_exposes_payload_under_dashboard_fields():
    row = {
        "cpf": "06561646541",
        "status": "elegivel",
        "valor_liberado": 4819.57,
        "payload": {
            "saldo_utilizavel": 400.0,
            "saldo_disponivel": 500.0,
            "margem_base": 4500.0,
            "valor_parcela": 400.0,
            "prazo": 24,
            "taxa_juros_mes": 0.0498,
        },
    }

    out = _flatten_lead(row)

    assert out["saldo_utilizavel"] == 400.0
    assert out["saldo_disponivel"] == 500.0
    assert out["margem_disponivel"] == 400.0
    assert out["valor_parcela"] == 400.0
    assert out["num_parcelas"] == 24
    assert out["cet_mensal"] == 0.0498


def test_aggregate_sums_nossafintech_margin_from_payload():
    stats = _aggregate([
        {"status": "elegivel", "valor_liberado": 4819.57, "payload": {"saldo_utilizavel": 400.0}},
        {"status": "inelegivel", "valor_liberado": None, "payload": {"saldo_utilizavel": 0}},
    ])

    assert stats["total_liberado"] == 4819.57
    assert stats["total_margem"] == 400.0


def test_pick_table_understands_k_suffix_and_start_end_ranges():
    rebates = [
        {"cod_tabela": "800008", "number_of_installments": 48, "complement": "500 a 26k", "start": "500.00", "end": "26000.00"},
        {"cod_tabela": "800010", "number_of_installments": 24, "complement": "300 a 11k", "start": "300.00", "end": "11000.00"},
    ]

    assert NossaFintechApiClient.pick_table(rebates, 400)["cod_tabela"] == "800010"
    assert NossaFintechApiClient.pick_table(rebates, 12000)["cod_tabela"] == "800008"


def test_simulation_money_values_are_returned_in_cents_by_api():
    assert _money_from_cents(481957.0) == 4819.57
    assert _money_from_cents(40000.0) == 400.0


def test_detects_nossafintech_sandbox_mock_margin():
    margem = MarginInfo(
        margin_key="mk",
        available_balance=500.0,
        utilizable_balance=400.0,
        base_margin_value=4500.0,
        name="CLIENTE",
        employer_name="EMPRESA XYZ LTDA",
        employer_cnpj="00000000000000",
        birth_date=None,
        admission_date=None,
        mother_name=None,
        gender=None,
        job_description=None,
    )

    assert _is_sandbox_mock_margin(margem)


def test_realistic_margin_is_not_sandbox_mock():
    margem = MarginInfo(
        margin_key="mk",
        available_balance=731.22,
        utilizable_balance=612.45,
        base_margin_value=3890.1,
        name="CLIENTE",
        employer_name="ACME SERVICOS LTDA",
        employer_cnpj="12345678000199",
        birth_date=None,
        admission_date=None,
        mother_name=None,
        gender=None,
        job_description=None,
    )

    assert not _is_sandbox_mock_margin(margem)
