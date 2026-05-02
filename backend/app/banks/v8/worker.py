import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Callable
import httpx

from ...services.v8_api_service import (
    enrich_cpf, create_consent, authorize_consent, get_simulation_configs,
    pick_config, _max_installments, create_simulation, get_consult, V8APIError,
)
from .auth import get_token, invalidate as invalidate_token
from ...db_scoped import scoped
from ...credentials.service import BankCredentials

logger = logging.getLogger(__name__)

POLL_TIMEOUT = 90
POLL_INTERVAL = 3
RETRY_DELAY_MINUTES = 5
MAX_TENTATIVAS = 5

ERRO_WHITELIST = {
    "id", "status", "type", "title", "description", "detail",
    "marginBaseValue", "availableMarginValue", "consultEligible",
    "admissionDate", "terminationDate", "employerName",
    "workerCategoryCode", "admissionDateMonthsDifference",
    "simulationLimit",
}


def _sanitize_v8_payload(payload: dict) -> dict:
    return {k: v for k, v in payload.items() if k in ERRO_WHITELIST}


class LeadWorker:
    def __init__(
        self,
        worker_id: int,
        user_id: str,
        creds: BankCredentials,
        db,
        on_event: Callable,
        role: str = "full",
        role_index: int = 0,
    ):
        self.worker_id = worker_id
        self.user_id = user_id
        self.creds = creds
        self.db = db
        self.on_event = on_event
        self.role = role
        self.role_index = role_index
        self.name = self._build_name(role, role_index)
        self._current_nome: str | None = None
        proxies = creds.proxies or []
        self.proxy = proxies[worker_id % len(proxies)] if proxies else None
        if self.proxy:
            host = self.proxy.split("@")[-1]
            logger.info(f"{self.name} usando proxy {host}")
        else:
            logger.info(f"{self.name} sem proxy (cliente não cadastrou; rodando direto)")

    @staticmethod
    def _build_name(role: str, idx: int) -> str:
        if role == "retry":
            return f"PUXADOR DE MARGEM {idx + 1}"
        return f"ORELHA SECA {idx + 1}"

    async def _token(self) -> str:
        return await get_token(self.user_id, self.creds.login, self.creds.password)

    def _emit(self, type: str, cpf: str = None, status: str = None, message: str = None, nome: str | None = None):
        self.on_event({
            "type": type,
            "user_id": self.user_id,
            "worker_id": self.worker_id,
            "worker_name": self.name,
            "worker_role": self.role,
            "cpf": cpf,
            "nome": nome if nome is not None else self._current_nome,
            "status": status,
            "message": message,
            "ts": datetime.now(timezone.utc).isoformat(),
        })

    async def _update_lead(self, cpf: str, updates: dict):
        await asyncio.to_thread(
            lambda: scoped(self.db, "v8_leads", self.user_id).update(updates).eq("cpf", cpf).execute()
        )

    async def _poll_consult(self, consult_id: str, interval: int = POLL_INTERVAL, timeout: int = POLL_TIMEOUT) -> dict:
        terminal = {"SUCCESS", "REJECTED", "FAILED", "ERROR"}
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        while loop.time() < deadline:
            try:
                data = await get_consult(await self._token(), consult_id, proxy=self.proxy)
                if data.get("status") in terminal:
                    return data
            except (httpx.HTTPStatusError, httpx.TransportError, httpx.TimeoutException) as e:
                logger.warning(f"Worker {self.worker_id} polling {consult_id}: {e}, retrying...")
            await asyncio.sleep(interval)
        raise TimeoutError(f"Timeout polling consult {consult_id}")

    async def _defer(self, cpf: str, tentativas: int, motivo: str):
        next_attempt = tentativas + 1
        if next_attempt >= MAX_TENTATIVAS:
            await self._update_lead(cpf, {
                "status": "erro",
                "tentativas": next_attempt,
                "proxima_tentativa": None,
                "erro": f"max_tentativas ({MAX_TENTATIVAS}): {motivo[:500]}",
            })
            self._emit("lead_result", cpf=cpf, status="erro",
                       message=f"Esgotou {MAX_TENTATIVAS} tentativas: {motivo[:200]}")
            return
        proxima = (datetime.now(timezone.utc) + timedelta(minutes=RETRY_DELAY_MINUTES)).isoformat()
        await self._update_lead(cpf, {
            "status": "aguardando_resultado",
            "tentativas": next_attempt,
            "proxima_tentativa": proxima,
            "erro": motivo,
        })
        self._emit("status_update", cpf=cpf, status="aguardando_resultado",
                   message=f"Tentativa #{next_attempt}/{MAX_TENTATIVAS} — volta em {RETRY_DELAY_MINUTES}min ({motivo[:120]})")

    async def _finalize_terminal(self, cpf: str, consult_id: str, payload: dict):
        if payload.get("status") != "SUCCESS":
            erro_resumo = payload.get("description") or payload.get("status") or "rejeitado"
            erro_full = json.dumps(_sanitize_v8_payload(payload), ensure_ascii=False)
            await self._update_lead(cpf, {"status": "inelegivel", "erro": erro_full, "proxima_tentativa": None})
            self._emit("lead_result", cpf=cpf, status="inelegivel", message=erro_resumo)
            return

        margin_raw = payload.get("marginBaseValue") or payload.get("availableMarginValue")
        if margin_raw is None:
            await self._defer(cpf, payload.get("_tentativas", 0), "SUCCESS sem marginBaseValue")
            return
        margin = float(margin_raw)

        simulation: dict | None = None
        used_seguro = False
        sim_error: str | None = None
        try:
            configs = await get_simulation_configs(await self._token(), proxy=self.proxy)
            for prefer_seguro in (True, False):
                cfg = pick_config(configs, prefer_seguro=prefer_seguro)
                if not cfg:
                    continue
                try:
                    simulation = await create_simulation(
                        await self._token(), consult_id, cfg["id"], margin,
                        num_installments=_max_installments(cfg),
                        proxy=self.proxy,
                    )
                    used_seguro = prefer_seguro
                    break
                except Exception as e:
                    sim_error = f"{'com' if prefer_seguro else 'sem'} seguro: {e}"
                    logger.warning(f"Worker {self.worker_id} simulação CPF {cpf} {sim_error}")
        except Exception as e:
            sim_error = f"configs: {e}"
            logger.warning(f"Worker {self.worker_id} get_simulation_configs CPF {cpf}: {e}")

        if simulation:
            option = simulation.get("disbursement_option") or {}
            valor_liberado = (
                option.get("final_disbursement_amount")
                or simulation.get("disbursement_amount")
                or simulation.get("disbursed_issue_amount")
            )
            await self._update_lead(cpf, {
                "status": "elegivel",
                "margem_disponivel": margin,
                "valor_liberado": valor_liberado,
                "valor_parcela": simulation.get("installment_value"),
                "num_parcelas": simulation.get("number_of_installments"),
                "cet_mensal": simulation.get("monthly_interest_rate"),
                "proxima_tentativa": None,
                "erro": None,
            })
            seguro_tag = "c/ seguro" if used_seguro else "s/ seguro"
            self._emit("lead_result", cpf=cpf, status="elegivel",
                      message=f"Margem R${margin:.2f} | Libera R${(valor_liberado or 0):.2f} ({seguro_tag})")
        else:
            await self._update_lead(cpf, {
                "status": "elegivel",
                "margem_disponivel": margin,
                "valor_liberado": None,
                "proxima_tentativa": None,
                "erro": f"simulacao_falhou: {sim_error}" if sim_error else "simulacao_indisponivel",
            })
            self._emit("lead_result", cpf=cpf, status="elegivel",
                      message=f"Margem R${margin:.2f} | simulação indisponível ({sim_error or 'sem config'})")

    async def process(self, lead: dict):
        cpf_raw = lead["cpf"]
        cpf = ''.join(c for c in cpf_raw if c.isdigit())
        tentativas = lead.get("tentativas") or 0
        existing_consult_id = lead.get("consult_id")
        is_retry = lead.get("status") == "aguardando_resultado" and existing_consult_id
        self._current_nome = lead.get("nome")
        self._emit("worker_start", cpf=cpf, status="retry" if is_retry else "enriquecendo")

        try:
            if is_retry:
                self._emit("status_update", cpf=cpf, status="aguardando_resultado",
                           message=f"Reprocessando consult {existing_consult_id[:8]} (tentativa #{tentativas+1})")
                try:
                    payload = await self._poll_consult(existing_consult_id)
                    payload["_tentativas"] = tentativas
                    await self._finalize_terminal(cpf, existing_consult_id, payload)
                except TimeoutError:
                    await self._defer(cpf, tentativas, "polling timeout")
                return

            telefone = lead.get("telefone") or ""
            if len(''.join(c for c in telefone if c.isdigit())) < 10:
                telefone = "11999999999"

            client_data = await enrich_cpf(await self._token(), cpf, proxy=self.proxy)
            self._current_nome = client_data.get("name")
            await self._update_lead(cpf, {
                "status": "enriquecido",
                "nome": client_data.get("name"),
                "email": client_data.get("email"),
                "data_nascimento": client_data.get("birthDate"),
            })
            self._emit("status_update", cpf=cpf, status="enriquecido")

            consult_id = await create_consent(await self._token(), cpf, client_data, telefone, proxy=self.proxy)
            await self._update_lead(cpf, {"status": "consentido", "consult_id": consult_id})
            self._emit("status_update", cpf=cpf, status="consentido")

            await authorize_consent(await self._token(), consult_id, proxy=self.proxy)
            await self._update_lead(cpf, {"status": "autorizado"})
            self._emit("status_update", cpf=cpf, status="autorizado", message="Consultando resultado...")

            try:
                payload = await self._poll_consult(consult_id)
                payload["_tentativas"] = tentativas
                await self._finalize_terminal(cpf, consult_id, payload)
            except TimeoutError:
                await self._defer(cpf, tentativas, "polling timeout")

        except V8APIError as e:
            if e.status in (401, 429):
                invalidate_token(self.user_id)
                logger.warning(f"V8 {e.status} pra user {self.user_id} — token invalidado")
            logger.error(f"Worker {self.worker_id} CPF {cpf}: {e} — agendando retry")
            payload_san = _sanitize_v8_payload(e.payload) if isinstance(e.payload, dict) else {"raw": str(e.payload)[:300]}
            try:
                erro_full = json.dumps({"endpoint": e.endpoint, "status": e.status, "payload": payload_san}, ensure_ascii=False)
            except Exception:
                erro_full = str(e)[:500]
            await self._defer(cpf, tentativas, erro_full)
            self._emit("lead_result", cpf=cpf, status="aguardando_resultado", message=str(e))
        except Exception as e:
            logger.error(f"Worker {self.worker_id} CPF {cpf}: {e} — agendando retry")
            await self._defer(cpf, tentativas, f"{type(e).__name__}: {str(e)[:300]}")
            self._emit("lead_result", cpf=cpf, status="aguardando_resultado", message=str(e))
        finally:
            self._emit("worker_idle", cpf=cpf)
