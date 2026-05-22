"""PowerHubApiWorker — enriquecimento de telefone via REST API."""
import asyncio
import logging
import random
from typing import Any, Callable

from .api_client import PowerHubApiClient
from .config import PowerHubConfig
from ...db_scoped import scoped
from ...credentials.service import BankCredentials

log = logging.getLogger("powerhub.worker")


class PowerHubApiWorker:
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
        self.cfg = PowerHubConfig()
        self.name = f"PowerHub Worker {worker_id + 1}"
        self._client = PowerHubApiClient(
            username=creds.login,
            password=creds.password,
        )

    def _emit(self, type: str, cpf: str | None = None, fase: str | None = None, message: str | None = None):
        if self.on_event:
            self.on_event({
                "type": type,
                "user_id": self.user_id,
                "worker_id": self.worker_id,
                "worker_name": self.name,
                "worker_role": "powerhub_api",
                "cpf": cpf,
                "fase": fase,
                "message": message,
            })

    def _processar_cpf(self, record: dict) -> dict:
        cpf = record["cpf"]
        try:
            result = self._client.buscar_telefones(cpf)
            return result
        except Exception as e:
            log.warning(f"Erro CPF {cpf}: {e}")
            return {"cpf": cpf, "nome": None, "phones": [], "status": "error", "erro": str(e)}

    def _save_result(self, lead_id: str, result: dict) -> None:
        import json
        update = {
            "status": result["status"],
            "nome": result.get("nome"),
            "phones": json.dumps(result.get("phones") or []),
        }
        scoped(self.db, "powerhub_leads", self.user_id).update(update).eq("id", lead_id).execute()

    async def run(self) -> None:
        if self.startup_delay:
            await asyncio.sleep(self.startup_delay)

        self._emit("worker_started")
        log.info(f"{self.name} iniciado")

        try:
            while True:
                pending = await asyncio.to_thread(self._fetch_pending)
                if not pending:
                    break

                for record in pending:
                    lead_id = record["id"]
                    cpf = record["cpf"]

                    await asyncio.to_thread(
                        lambda: scoped(self.db, "powerhub_leads", self.user_id)
                        .update({"status": "processing"}).eq("id", lead_id).execute()
                    )
                    self._emit("lead_processing", cpf=cpf, fase="buscando")

                    result = await asyncio.to_thread(self._processar_cpf, record)
                    await asyncio.to_thread(self._save_result, lead_id, result)

                    phones = result.get("phones") or []
                    self._emit(
                        "lead_result",
                        cpf=cpf,
                        fase=result["status"],
                        message=f"{len(phones)} telefone(s) encontrado(s)" if phones else "nenhum telefone",
                    )

                    jitter = random.uniform(self.cfg.jitter_min, self.cfg.jitter_max)
                    await asyncio.sleep(jitter)

        except asyncio.CancelledError:
            pass
        except Exception as e:
            log.exception(f"{self.name} erro fatal: {e}")
        finally:
            self._client.close()
            self._emit("worker_stopped")
            log.info(f"{self.name} encerrado")

    def _fetch_pending(self, limit: int = 10) -> list[dict]:
        q = scoped(self.db, "powerhub_leads", self.user_id).select("id,cpf,nome")
        q = q.eq("status", "pending")
        if self.batch_id:
            q = q.eq("batch_id", self.batch_id)
        return (q.limit(limit).execute().data or [])
