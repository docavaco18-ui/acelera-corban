"""VCTexLeadWorker — multi-tenant + batch_id + scoped queries.

Adaptado do `app/bot/worker.py` original do projeto VCTex pra rodar
com isolamento por user (creds, proxies, batch) seguindo a arquitetura V8.
"""
import asyncio
import logging
import random
from typing import Any, Callable

from .engine import BotEngine
from .phases import fase0_adicionar_termo, fase1_assinar_link, fase2_simular
from .humanize import human_delay_between_actions
from ...db_scoped import scoped
from ...credentials.service import BankCredentials

log = logging.getLogger("vctex.worker")


class VCTexLeadWorker:
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
        proxies = creds.proxies or []
        self.proxy = proxies[worker_id % len(proxies)] if proxies else None
        self.engine = BotEngine(
            login=creds.login,
            password=creds.password,
            proxy_url=self.proxy,
        )
        self.name = f"VCTex Worker {worker_id + 1}"

    def _emit(self, type: str, cpf: str | None = None, fase: str | None = None, message: str | None = None):
        if self.on_event:
            self.on_event({
                "type": type,
                "user_id": self.user_id,
                "worker_id": self.worker_id,
                "worker_name": self.name,
                "worker_role": "vctex_full",
                "cpf": cpf,
                "fase": fase,
                "message": message,
            })

    async def _ensure_login(self, page) -> bool:
        if "/login" in page.url or page.url == "about:blank":
            ok = await self.engine.login_page(page)
            if not ok:
                log.error("Worker %d — falha no login", self.worker_id)
            return ok
        return True

    async def process_cpf(self, page, record: dict) -> dict:
        cpf = record["cpf"]
        fase = record.get("status", "pendente")
        nome = record.get("nome")
        tel = record.get("telefone")

        updates: dict = {}

        try:
            if not await self._ensure_login(page):
                return {"status": "erro", "erro": "Falha no login"}

            if fase in ("pendente", "erro"):
                self._emit("status_update", cpf=cpf, fase="fase0")
                await human_delay_between_actions(1.0, 3.0)
                status = await fase0_adicionar_termo(page, cpf, nome, tel)
                if status == "ja_existe":
                    fase = "fase1"
                    updates["status"] = "fase1"
                elif status.startswith("erro"):
                    return {"status": "erro", "erro": status[5:]}
                else:
                    fase = "fase1"
                    updates["status"] = "fase1"
                    log.info("Worker %d | CPF %s — aguardando portal indexar (30s)", self.worker_id, cpf)
                    await asyncio.sleep(30)
                    await human_delay_between_actions(2.0, 5.0)

            if fase == "fase1":
                self._emit("status_update", cpf=cpf, fase="fase1")
                await human_delay_between_actions(1.5, 3.5)
                if not await self._ensure_login(page):
                    return {"status": "erro", "erro": "Sessão expirou antes da fase1"}
                status = await fase1_assinar_link(page, cpf)
                if status.startswith("erro"):
                    return {"status": "erro", "erro": status[5:]}
                await human_delay_between_actions(2.0, 4.0)
                fase = "fase2"
                updates["status"] = "fase2"

            if fase == "fase2":
                self._emit("status_update", cpf=cpf, fase="fase2")
                await human_delay_between_actions(2.0, 5.0)
                if not await self._ensure_login(page):
                    return {"status": "erro", "erro": "Sessão expirou antes da fase2"}
                result = await fase2_simular(page, cpf)
                # Mapeia 'fase' do projeto antigo → 'status' aqui
                if "fase" in result:
                    result["status"] = result.pop("fase")
                if "observacao" in result:
                    result["erro"] = result.pop("observacao")
                if "valor_aprovado" in result:
                    result["valor_liberado"] = result.pop("valor_aprovado")
                updates.update(result)

        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.exception("Worker %d | CPF %s — erro inesperado", self.worker_id, cpf)
            updates = {"status": "erro", "erro": str(e)[:200]}

        return updates

    async def _save(self, cpf: str, updates: dict):
        try:
            await asyncio.to_thread(
                lambda: scoped(self.db, "vctex_leads", self.user_id)
                    .update(updates).eq("cpf", cpf).execute()
            )
        except Exception as e:
            log.error("vctex update failed | worker=%d cpf=%s err=%s",
                      self.worker_id, cpf, str(e)[:200])

    async def run(self, queue: asyncio.Queue):
        """Loop principal: pega leads da fila e processa."""
        if self.startup_delay > 0:
            await asyncio.sleep(self.startup_delay)

        await self.engine.start(headless=True)
        try:
            ctx = await self.engine.new_context()
            page = await ctx.new_page()
            page.set_default_timeout(self.engine.cfg.timeout_page)

            try:
                if not await self.engine.login_page(page):
                    log.error("Worker %d — não conseguiu fazer login", self.worker_id)
                    return

                self._emit("worker_start")
                log.info("Worker %d — login OK, processando fila", self.worker_id)

                while True:
                    try:
                        record = queue.get_nowait()
                    except asyncio.QueueEmpty:
                        break

                    cpf = record["cpf"]
                    try:
                        updates = await self.process_cpf(page, record)
                    except asyncio.CancelledError:
                        raise
                    except BaseException as e:
                        log.exception("Worker %d | CPF %s — exc %s; re-enfileirando",
                                       self.worker_id, cpf, type(e).__name__)
                        try:
                            queue.put_nowait(record)
                        except Exception:
                            pass
                        continue

                    await self._save(cpf, updates)
                    self._emit("lead_result", cpf=cpf, fase=updates.get("status"),
                               message=updates.get("erro"))

                    jitter = random.uniform(
                        self.engine.cfg.cpf_jitter_min,
                        self.engine.cfg.cpf_jitter_max,
                    )
                    await asyncio.sleep(jitter)

            except asyncio.CancelledError:
                log.info("Worker %d cancelado", self.worker_id)
            finally:
                try: await page.close()
                except Exception: pass
                try: await ctx.close()
                except Exception: pass
        finally:
            await self.engine.stop()
            self._emit("worker_idle")
            log.info("Worker %d encerrado", self.worker_id)
