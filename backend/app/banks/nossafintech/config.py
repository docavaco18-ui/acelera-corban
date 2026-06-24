"""Configuração Nossa Fintech CLT — higienização via REST API (sem browser).

Banco "Nossa Fintech" (spixii). Produto: Crédito do Trabalhador (CLT consignado).
Doc: https://nossa-fintech-doc.spixiiservices.com.br/docs/intro
"""
import os
from dataclasses import dataclass, field


@dataclass
class NossaFintechConfig:
    # ── API ──────────────────────────────────────────────────────────────────
    base_url: str = field(default_factory=lambda: os.getenv(
        "NOSSAFINTECH_BASE_URL", "https://nossa-fintech-api.spixiiservices.com.br"
    ))
    # Bancarizadora default — sobrescrita pelo retorno de /banking-institutions.
    default_service_type: str = field(default_factory=lambda: os.getenv(
        "NOSSAFINTECH_SERVICE_TYPE", "QITECH"
    ))

    # ── Timeouts (s) ─────────────────────────────────────────────────────────
    timeout_default: float = 45.0
    timeout_margin: float = 60.0     # get-margin consulta DataPrev/eSocial, pode demorar

    # ── Jitter entre CPFs (segundos) ─────────────────────────────────────────
    cpf_jitter_min: float = field(default_factory=lambda: float(os.getenv("NOSSAFINTECH_CPF_JITTER_MIN", "2")))
    cpf_jitter_max: float = field(default_factory=lambda: float(os.getenv("NOSSAFINTECH_CPF_JITTER_MAX", "5")))

    # ── Simulação ────────────────────────────────────────────────────────────
    # "Payment" = simula a partir do valor da parcela (usamos a margem utilizável
    # como teto de parcela → retorna o valor liberado máximo). "Liquid" = a partir
    # do valor líquido desejado.
    simulation_type: str = field(default_factory=lambda: os.getenv("NOSSAFINTECH_SIM_TYPE", "Payment"))
