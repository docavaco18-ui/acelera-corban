"""PresencaApiWorker — higienização via REST API (sem browser).

Fluxo por CPF: gerar_termo → assinar_termo → consultar_vinculos → consultar_margem.
"""
import asyncio
import logging
import random
from typing import Any, Callable

from .api_client import PresencaApiClient
from .config import PresencaConfig
from ...db_scoped import scoped
from ...credentials.service import BankCredentials

log = logging.getLogger("presenca.api_worker")


class PresencaApiWorker:
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
        self.cfg = PresencaConfig()
        self.name = f"Presença API Worker {worker_id + 1}"
        self._client = PresencaApiClient(
            login_cpf=creds.login,
            password=creds.password,
        )

    def _emit(self, type: str, cpf: str | None = None, fase: str | None = None, message: str | None = None):
        if self.on_event:
            self.on_event({
                "type": type,
                "user_id": self.user_id,
                "worker_id": self.worker_id,
                "worker_name": self.name,
                "worker_role": "presenca_api",
                "cpf": cpf,
                "fase": fase,
                "message": message,
            })

    def _processar_cpf(self, record: dict) -> dict:
        """Fluxo síncrono de 4 passos — roda em asyncio.to_thread."""
        cpf = record["cpf"]
        nome = (record.get("nome") or "").strip() or "Cliente"
        telefone = (record.get("telefone") or "").strip() or "11999999999"

        try:
            autorizacao_id = self._client.gerar_termo(cpf, nome, telefone)
            self._client.assinar_termo(autorizacao_id)

            vinculos = self._client.consultar_vinculos(cpf)
            if vinculos is None:
                return {"status": "inelegivel", "valor_liberado": None, "erro": "sem_vinculo_esocial"}

            v = vinculos[0]
            margem = self._client.consultar_margem(cpf, v.matricula, v.cnpj)

            return {
                "status": "elegivel",
                "valor_liberado": margem.valor_margem_disponivel,
                "erro": None,
                # extras → salvo em payload
                "valor_margem_base": margem.valor_margem_base,
                "data_nascimento": margem.data_nascimento,
                "nome_mae": margem.nome_mae,
                "sexo": margem.sexo,
                "cnpj_empregador": margem.cnpj_empregador,
                "matricula": v.matricula,
                "data_admissao": margem.data_admissao,
            }

        except Exception as e:
            err = str(e)
            log.error("presenca api %d | CPF %s — %s", self.worker_id, cpf, err[:200])
            return {"status": "erro", "valor_liberado": None, "erro": err[:200]}

    _ALLOWED_COLS = {"status", "nome", "telefone", "valor_liberado", "erro"}

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
                lambda: scoped(self.db, "presenca_leads", self.user_id)
                    .update(clean).eq("cpf", cpf).execute()
            )
        except Exception as e:
            log.error("presenca api save failed | worker=%d cpf=%s err=%s",
                      self.worker_id, cpf, str(e)[:200])

    async def run(self, queue: asyncio.Queue, stop_event: asyncio.Event | None = None):
        if self.startup_delay > 0:
            await asyncio.sleep(self.startup_delay)

        try:
            await asyncio.to_thread(self._client.login)
            log.info("presenca API Worker %d — login OK", self.worker_id)
        except Exception as e:
            log.error("presenca API Worker %d — login falhou: %s", self.worker_id, e)
            self._emit("worker_idle", message="login_failed")
            return

        self._emit("worker_start")

        try:
            empty_polls = 0
            while True:
                if stop_event and stop_event.is_set() and queue.empty():
                    log.info("presenca API Worker %d — stop_event + fila vazia, encerrando", self.worker_id)
                    break
                try:
                    record = await asyncio.wait_for(queue.get(), timeout=2.0)
                    empty_polls = 0
                except asyncio.TimeoutError:
                    empty_polls += 1
                    if empty_polls >= 150:
                        log.info("presenca API Worker %d — fila vazia há 5min, encerrando", self.worker_id)
                        break
                    continue

                cpf = record["cpf"]
                self._emit("status_update", cpf=cpf, fase="api_consulta")

                try:
                    updates = await asyncio.to_thread(self._processar_cpf, record)
                except asyncio.CancelledError:
                    raise
                except BaseException as e:
                    log.exception("presenca API Worker %d | CPF %s — exc %s", self.worker_id, cpf, type(e).__name__)
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
            log.info("presenca API Worker %d cancelado", self.worker_id)
        finally:
            self._client.close()
            self._emit("worker_idle")
            log.info("presenca API Worker %d encerrado", self.worker_id)
