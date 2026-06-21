"""NossaFintechApiWorker — higienização CLT via REST API.

Fluxo por CPF:
  check_authorization → AUTHORIZED? segue. NOT_AUTHORIZED/PENDING?
    request_authorization (envia SMS ao cliente se primeira vez) → PENDING:
      marca pendente (tentativas+1), bot retenta na próxima rodada.
    Após MAX_AUTH_RETRIES sem AUTHORIZED: inelegível.
  check_enrollment    → employer_cnpj (sem vínculo: inelegível)
  get_margin          → saldo/margem (sem margem: inelegível)
  list_rebates + simulate_loan → valor liberado, parcela, prazo (best-effort)
"""
import asyncio
import logging
import random
from typing import Any, Callable

from .api_client import NossaFintechApiClient
from .config import NossaFintechConfig
from ...db_scoped import scoped
from ...credentials.service import BankCredentials

log = logging.getLogger("nossafintech.api_worker")

MAX_AUTH_RETRIES = 3


class NossaFintechApiWorker:
    def __init__(
        self,
        worker_id: int,
        user_id: str,
        creds: BankCredentials,
        db: Any,
        on_event: Callable | None = None,
        startup_delay: float = 0.0,
        batch_id: str | None = None,
    ):
        self.worker_id = worker_id
        self.user_id = user_id
        self.creds = creds
        self.db = db
        self.on_event = on_event
        self.startup_delay = startup_delay
        self.batch_id = batch_id
        self.cfg = NossaFintechConfig()
        self.name = f"Nossa Fintech API Worker {worker_id + 1}"
        promot_id = str((creds.extra or {}).get("promot_id") or "")
        self._client = NossaFintechApiClient(
            cpf=creds.login or "",
            promot_id=promot_id,
            password=creds.password or "",
            cfg=self.cfg,
        )

    def _emit(self, type: str, cpf: str | None = None, fase: str | None = None, message: str | None = None):
        if self.on_event:
            self.on_event({
                "type": type,
                "user_id": self.user_id,
                "worker_id": self.worker_id,
                "worker_name": self.name,
                "worker_role": "nossafintech_api",
                "cpf": cpf,
                "fase": fase,
                "message": message,
            })

    def _processar_cpf(self, record: dict) -> dict:
        """Fluxo síncrono — roda em asyncio.to_thread."""
        cpf = record["cpf"]
        tentativas = int(record.get("tentativas") or 0)
        try:
            auth_status = self._client.check_authorization(cpf)

            if auth_status != "AUTHORIZED":
                if tentativas >= MAX_AUTH_RETRIES:
                    return {"status": "inelegivel", "valor_liberado": None,
                            "erro": f"sem_autorizacao ({tentativas} tentativas)"}

                nome = record.get("nome") or ""
                telefone = record.get("telefone") or ""
                req_status = self._client.request_authorization(cpf, nome, telefone)
                log.info("nossafintech %d | CPF %s request_authorization → %s",
                         self.worker_id, cpf, req_status)

                if req_status != "AUTHORIZED":
                    return {"status": "pendente", "valor_liberado": None,
                            "erro": "aguardando_autorizacao_sms",
                            "tentativas": tentativas + 1}
                # req_status == AUTHORIZED: autorização já existia, prossegue

            vinculos = self._client.check_enrollment(cpf)
            if not vinculos:
                return {"status": "inelegivel", "valor_liberado": None, "erro": "sem_vinculo"}

            v = vinculos[0]
            margem = self._client.get_margin(cpf, v.employer_cnpj)
            if margem.utilizable_balance <= 0 and margem.base_margin_value <= 0:
                return {"status": "inelegivel", "valor_liberado": None, "erro": "sem_margem",
                        "saldo_disponivel": margem.available_balance,
                        "cnpj_empregador": margem.employer_cnpj,
                        "nome_empregador": margem.employer_name}

            out: dict = {
                "status": "elegivel",
                "erro": None,
                # saldo/margem (sempre presente quando elegível)
                "saldo_disponivel": margem.available_balance,
                "saldo_utilizavel": margem.utilizable_balance,
                "margem_base": margem.base_margin_value,
                "cnpj_empregador": margem.employer_cnpj,
                "nome_empregador": margem.employer_name,
                "nome": margem.name,
                "data_nascimento": margem.birth_date,
                "data_admissao": margem.admission_date,
                "nome_mae": margem.mother_name,
                "sexo": margem.gender,
                "cargo": margem.job_description,
                "matricula": v.work_registration,
            }

            # Simulação (valor liberado / parcela / prazo) — best-effort.
            try:
                rebates = self._client.list_rebates(margem.margin_key)
                table = NossaFintechApiClient.pick_table(rebates, margem.utilizable_balance)
                if table and margem.margin_key:
                    sim = self._client.simulate_loan(
                        margin_key=margem.margin_key,
                        employer_cnpj=margem.employer_cnpj or v.employer_cnpj,
                        requested_amount=margem.utilizable_balance,
                        cod_tabela=str(table.get("cod_tabela")),
                    )
                    out["valor_liberado"] = sim.disbursement_amount
                    out["valor_parcela"] = sim.installment
                    out["prazo"] = sim.num_periods
                    out["valor_financiado"] = sim.financed_amount
                    out["total_devido"] = sim.total_amount_owed
                    out["taxa_juros_mes"] = sim.interest_rate
                    out["cod_tabela"] = sim.cod_tabela
            except Exception as e:
                log.warning("nossafintech %d | CPF %s simulação falhou: %s",
                            self.worker_id, cpf, str(e)[:160])
                out["sim_erro"] = str(e)[:160]

            # Sem simulação: valor liberado = saldo utilizável (margem consignável).
            if out.get("valor_liberado") is None:
                out["valor_liberado"] = margem.utilizable_balance

            return out

        except Exception as e:
            err = str(e)
            log.error("nossafintech %d | CPF %s — %s", self.worker_id, cpf, err[:200])
            return {"status": "erro", "valor_liberado": None, "erro": err[:200]}

    _ALLOWED_COLS = {"status", "nome", "telefone", "valor_liberado", "erro", "tentativas"}

    @staticmethod
    def _parse_valor(v) -> float | None:
        if v is None:
            return None
        s = str(v).replace("R$", "").replace("\xa0", "").replace(" ", "").strip()
        if "," in s:
            s = s.replace(".", "").replace(",", ".")
        try:
            return float(s)
        except (ValueError, TypeError):
            return None

    @classmethod
    def _split_updates(cls, updates: dict) -> dict:
        clean: dict = {}
        extras: dict = {}
        for k, v in updates.items():
            if k in cls._ALLOWED_COLS:
                clean[k] = cls._parse_valor(v) if k == "valor_liberado" else v
            else:
                extras[k] = v
        if extras:
            clean["payload"] = extras
        return clean

    async def _save(self, cpf: str, updates: dict):
        clean = self._split_updates(updates)
        try:
            await asyncio.to_thread(
                lambda: scoped(self.db, "nossafintech_leads", self.user_id)
                    .update(clean).eq("cpf", cpf).execute()
            )
        except Exception as e:
            log.error("nossafintech save failed | worker=%d cpf=%s err=%s",
                      self.worker_id, cpf, str(e)[:200])

    async def run(self, queue: asyncio.Queue, stop_event: asyncio.Event | None = None):
        if self.startup_delay > 0:
            await asyncio.sleep(self.startup_delay)

        try:
            await asyncio.to_thread(self._client.login)
            log.info("nossafintech API Worker %d — login OK", self.worker_id)
        except Exception as e:
            log.error("nossafintech API Worker %d — login falhou: %s", self.worker_id, e)
            self._emit("worker_idle", message="login_failed")
            return

        self._emit("worker_start")

        try:
            empty_polls = 0
            while True:
                if stop_event and stop_event.is_set() and queue.empty():
                    break
                try:
                    record = await asyncio.wait_for(queue.get(), timeout=2.0)
                    empty_polls = 0
                except asyncio.TimeoutError:
                    empty_polls += 1
                    if empty_polls >= 150:
                        log.info("nossafintech API Worker %d — fila vazia há 5min, encerrando", self.worker_id)
                        break
                    continue

                cpf = record["cpf"]
                self._emit("status_update", cpf=cpf, fase="api_consulta")

                try:
                    updates = await asyncio.to_thread(self._processar_cpf, record)
                except asyncio.CancelledError:
                    raise
                except BaseException as e:
                    log.exception("nossafintech API Worker %d | CPF %s — exc %s",
                                  self.worker_id, cpf, type(e).__name__)
                    try:
                        queue.put_nowait(record)
                    except Exception:
                        pass
                    continue

                await self._save(cpf, updates)
                self._emit("lead_result", cpf=cpf, fase=updates.get("status"), message=updates.get("erro"))

                jitter = random.uniform(self.cfg.cpf_jitter_min, self.cfg.cpf_jitter_max)
                await asyncio.sleep(jitter)

        except asyncio.CancelledError:
            log.info("nossafintech API Worker %d cancelado", self.worker_id)
        finally:
            self._client.close()
            self._emit("worker_idle")
            log.info("nossafintech API Worker %d encerrado", self.worker_id)
