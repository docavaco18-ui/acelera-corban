"""PresencaLeadWorker — click bot Presença Bank, mesma arquitetura VCTex."""
import asyncio
import logging
import random
from typing import Any, Callable

from .engine import PresencaEngine
from .phases import fase1_consultar, nova_consulta
from .humanize import human_delay_between_actions
from ...db_scoped import scoped
from ...credentials.service import BankCredentials

log = logging.getLogger("presenca.worker")


class PresencaLeadWorker:
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
        self.engine = PresencaEngine(
            login=creds.login,
            password=creds.password,
            proxy_url=self.proxy,
        )
        self.name = f"Presença Worker {worker_id + 1}"

    def _emit(self, type: str, cpf: str | None = None, fase: str | None = None, message: str | None = None):
        if self.on_event:
            self.on_event({
                "type": type,
                "user_id": self.user_id,
                "worker_id": self.worker_id,
                "worker_name": self.name,
                "worker_role": "presenca_full",
                "cpf": cpf,
                "fase": fase,
                "message": message,
            })

    async def _ensure_login(self, page) -> bool:
        if "/login" in page.url or page.url == "about:blank":
            return await self.engine.login_page(page)
        return True

    async def process_cpf(self, page, record: dict) -> dict:
        cpf = record["cpf"]

        try:
            if not await self._ensure_login(page):
                return {"status": "erro", "erro": "Falha no login"}

            self._emit("status_update", cpf=cpf, fase="fase1")
            result = await fase1_consultar(page, cpf, self.engine.cfg)

            # Volta ao estado de nova consulta para próximo CPF
            await nova_consulta(page, self.engine.cfg)

            return result

        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.exception("presenca worker %d | CPF %s — erro", self.worker_id, cpf)
            return {"status": "erro", "erro": str(e)[:200]}

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
            log.error("presenca update failed | worker=%d cpf=%s err=%s",
                      self.worker_id, cpf, str(e)[:200])

    async def run(self, queue: asyncio.Queue, stop_event: asyncio.Event | None = None):
        if self.startup_delay > 0:
            await asyncio.sleep(self.startup_delay)

        await self.engine.start(headless=True)
        try:
            ctx = await self.engine.new_context()
            page = await ctx.new_page()
            page.set_default_timeout(self.engine.cfg.timeout_page)

            try:
                if not await self.engine.login_page(page):
                    log.error("presenca Worker %d — login falhou", self.worker_id)
                    self._emit("worker_idle", message="login_failed")
                    return

                self._emit("worker_start")
                log.info("presenca Worker %d — login OK", self.worker_id)

                empty_polls = 0
                while True:
                    if stop_event and stop_event.is_set() and queue.empty():
                        log.info("presenca Worker %d — stop_event + fila vazia, encerrando", self.worker_id)
                        break
                    try:
                        record = await asyncio.wait_for(queue.get(), timeout=2.0)
                        empty_polls = 0
                    except asyncio.TimeoutError:
                        empty_polls += 1
                        if empty_polls >= 150:  # ~5 min
                            log.info("presenca Worker %d — fila vazia há 5min, encerrando", self.worker_id)
                            break
                        continue

                    cpf = record["cpf"]
                    try:
                        updates = await self.process_cpf(page, record)
                    except asyncio.CancelledError:
                        raise
                    except BaseException as e:
                        log.exception("presenca Worker %d | CPF %s — exc %s", self.worker_id, cpf, type(e).__name__)
                        try:
                            queue.put_nowait(record)
                        except Exception:
                            pass
                        continue

                    await self._save(cpf, updates)
                    self._emit("lead_result", cpf=cpf, fase=updates.get("status"), message=updates.get("erro"))

                    jitter = random.uniform(self.engine.cfg.cpf_jitter_min, self.engine.cfg.cpf_jitter_max)
                    await asyncio.sleep(jitter)

            except asyncio.CancelledError:
                log.info("presenca Worker %d cancelado", self.worker_id)
            finally:
                try: await page.close()
                except Exception: pass
                try: await ctx.close()
                except Exception: pass
        finally:
            await self.engine.stop()
            self._emit("worker_idle")
            log.info("presenca Worker %d encerrado", self.worker_id)
