"""MercantilLeadWorker — 1 página Playwright por worker, login uma vez por run.

Diferença vs VCTexLeadWorker:
- Login chama login_with_sms() que bloqueia em BLPOP do código SMS humano.
- Não tem fase0 (registro) — Mercantil identifica CPF na fase1_consultar.
- Fluxo per-CPF: fase1_consultar → (se cenário B) fase3_autorizar + fase2_aguardar → fase4_simular.
- Default mercantil_max_workers_per_user=1 (cada worker triggera SMS).
"""
from __future__ import annotations

import asyncio
import logging
import random
from typing import Any, Callable

from .engine import MercantilEngine
from .config import MercantilConfig
from .phases import (
    fase1_consultar_cpf,
    fase1_consultar_cpf_api,
    fase2_aguardar_produtos,
    fase3_autorizar_dataprev,
    fase4_simular,
    voltar_para_dashboard,
)
from .humanize import human_delay_between_actions
from ...db_scoped import scoped
from ...credentials.service import BankCredentials

log = logging.getLogger("mercantil.worker")

_SESSION_ERROR_KEYWORDS = (
    "JWT_NOT_FOUND", "SessaoUsuarioInativa", "Unauthorized",
    "sessão expirou", "sessao expirou", "relogin falhou",
)


def _is_session_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return any(k.lower() in msg for k in _SESSION_ERROR_KEYWORDS)


async def _try_headless_relogin(engine, page, user_id: str) -> bool:
    """Navigate to dashboard using existing storage state. Returns True if still logged in."""
    try:
        await page.goto(engine.cfg.dashboard_url, wait_until="domcontentloaded", timeout=20000)
        await asyncio.sleep(3)
        nova = page.locator(engine.cfg.SEL_NOVA_PROPOSTA_BTN).first
        if await nova.count() > 0 and await nova.is_visible():
            await engine._save_state(page.context, user_id)
            return True
    except Exception as e:
        log.warning("headless relogin check failed user=%s: %s", user_id, e)
    return False


class MercantilLeadWorker:
    def __init__(
        self,
        worker_id: int,
        user_id: str,
        run_id: str,
        creds: BankCredentials,
        db: Any,
        on_event: Callable | None = None,
        startup_delay: float = 0.0,
        batch_id: str | None = None,
        config: MercantilConfig | None = None,
        mode: str = "dom",  # "dom" (clica botões) ou "bff" (chama API direto, bypassa reCAPTCHA)
    ):
        self.worker_id = worker_id
        self.user_id = user_id
        self.run_id = run_id
        self.creds = creds
        self.db = db
        self.on_event = on_event
        self.startup_delay = startup_delay
        self.batch_id = batch_id
        self.cfg = config or MercantilConfig()
        self.mode = mode if mode in ("dom", "bff") else "dom"
        self.engine = MercantilEngine(
            login=creds.login,
            password=creds.password,
            config=self.cfg,
        )
        self.name = f"Mercantil Worker {worker_id + 1}"
        self._session_fail_count: int = 0

    def _emit(self, type: str, **kwargs) -> None:
        if not self.on_event:
            return
        payload = {
            "type": type,
            "user_id": self.user_id,
            "run_id": self.run_id,
            "worker_id": self.worker_id,
            "worker_name": self.name,
            "worker_role": "mercantil_full",
            "bank": "mercantil",
        }
        payload.update({k: v for k, v in kwargs.items() if v is not None})
        try:
            self.on_event(payload)
        except Exception:
            log.exception("mercantil emit failed payload=%s", payload)

    # ─── Per-CPF orchestration ────────────────────────────────────────────────

    async def process_cpf(self, page, record: dict) -> dict:
        cpf = record["cpf"]
        telefone = record.get("telefone")

        # Injeta context pra _screenshot emitir WS com cpf+url
        from .phases import set_emit_context
        set_emit_context(lambda p: self.on_event(p) if self.on_event else None, cpf)

        # Live screenshot loop (1.5s) pro frontend ver "browser ao vivo"
        live_task = asyncio.create_task(self._live_screenshot_loop(page, cpf))
        try:
            return await self._process_cpf_inner(page, record)
        finally:
            live_task.cancel()
            try:
                await live_task
            except (asyncio.CancelledError, Exception):
                pass

    async def _live_screenshot_loop(self, page, cpf: str) -> None:
        from pathlib import Path
        name = f"mercantil_live_{self.user_id}.png"
        path = f"/tmp/{name}"
        url = f"/api/mercantil/screenshot/{name}"
        try:
            Path("/tmp").mkdir(exist_ok=True)
            while True:
                try:
                    await page.screenshot(path=path, full_page=False, type="png")
                    self._emit("live_frame", cpf=cpf, url=url)
                except Exception:
                    pass
                await asyncio.sleep(1.5)
        except asyncio.CancelledError:
            return

    async def _process_cpf_inner(self, page, record: dict) -> dict:
        cpf = record["cpf"]
        telefone = record.get("telefone")

        # Garante que estamos logados antes de cada CPF (session pode expirar mid-batch)
        ok = await self.engine.ensure_logged_in(
            page, user_id=self.user_id, run_id=self.run_id,
            emit=lambda p: self._emit(**p),
        )
        if not ok:
            return {"status": "erro", "erro": "sessão expirou e relogin falhou"}

        # MODO BFF — chama API direto, bypassa reCAPTCHA. Cenário B ainda usa Plurio (DOM).
        if self.mode == "bff":
            return await self._process_cpf_bff(page, cpf, telefone)

        # FASE 1 — consultar via DOM (simular-proposta → Consultar → Nova operação)
        self._emit("status_update", cpf=cpf, status="fase1_consulta")
        r1 = await fase1_consultar_cpf(page, cpf, self.cfg)

        status1 = r1.get("status")

        if status1 == "erro":
            return {"status": "erro", "erro": r1.get("erro", "fase1 falhou")}

        uuid_portal = r1.get("uuid_portal")

        # Cenário A: já está em /consignado-privado/{uuid} → aguarda produtos → simula
        if status1 == "cenario_A":
            updates_base = {"uuid_portal": uuid_portal, "cenario": "A"}

            self._emit("status_update", cpf=cpf, status="aguardando_produtos")
            r2 = await fase2_aguardar_produtos(page, uuid_portal, self.cfg)
            if r2["status"] == "inelegivel":
                return {**updates_base, "status": "inelegivel",
                        "erro": r2.get("erro", "sem vínculo de trabalho válido")}
            if r2["status"] != "ready":
                return {**updates_base, "status": "aguardando_autorizacao",
                        "erro": "pipeline não ficou pronto — reprocessar"}

            self._emit("status_update", cpf=cpf, status="fase4_simular")
            r4 = await fase4_simular(page, uuid_portal, self.cfg)
            result = {**updates_base, **r4}

            try:
                await voltar_para_dashboard(page, self.cfg)
            except Exception:
                pass

            return result

        # Cenário B: já está em /solicitar-dataprev/{uuid} → DataPrev + Plurio → simula
        updates_base = {"uuid_portal": uuid_portal, "cenario": "B"}

        self._emit("status_update", cpf=cpf, status="fase3_dataprev")
        r3 = await fase3_autorizar_dataprev(page, uuid_portal, telefone, self.cfg)
        if r3["status"] != "autorizado":
            return {**updates_base, "status": "erro",
                    "erro": r3.get("erro", "fase3 falhou")}

        self._emit("status_update", cpf=cpf, status="aguardando_autorizacao")
        r2 = await fase2_aguardar_produtos(page, uuid_portal, self.cfg)
        if r2["status"] == "inelegivel":
            return {**updates_base, "status": "inelegivel",
                    "erro": r2.get("erro", "sem vínculo de trabalho válido")}
        if r2["status"] != "ready":
            return {**updates_base, "status": "aguardando_autorizacao",
                    "erro": "DataPrev ainda não liberou — será reprocessado"}

        self._emit("status_update", cpf=cpf, status="fase4_simular")
        r4 = await fase4_simular(page, uuid_portal, self.cfg)
        result = {**updates_base, **r4}

        try:
            await voltar_para_dashboard(page, self.cfg)
        except Exception:
            pass

        return result

    # ─── Modo BFF (bypassa reCAPTCHA) ─────────────────────────────────────────

    async def _process_cpf_bff(self, page, cpf: str, telefone: str | None) -> dict:
        from . import bff_bridge

        self._emit("status_update", cpf=cpf, status="bff_consultar")
        r = await bff_bridge.consultar_cpf(page, cpf,
                                           poll_interval=self.cfg.poll_dataprev_interval_s,
                                           poll_max=self.cfg.poll_dataprev_max_seconds)
        status_bff = r.get("status")

        # Resultado terminal direto do BFF — preserva schema sem forçar cenário em inelegível/erro
        if status_bff in ("elegivel", "inelegivel", "erro"):
            out = dict(r)
            if status_bff == "elegivel" and "cenario" not in out:
                out["cenario"] = "A"  # elegível terminal = Cenário A (não precisou DataPrev)
            return out

        # Cenário B — precisa autorizar DataPrev via Plurio (DOM, sem alternativa)
        if status_bff == "aguardando_autorizacao":
            uuid_portal = r.get("uuid_portal")
            updates_base = {"uuid_portal": uuid_portal, "cenario": "B", "nome": r.get("nome")}

            try:
                await page.goto(
                    f"https://meu.bancomercantil.com.br/solicitar-dataprev/{uuid_portal}",
                    wait_until="domcontentloaded", timeout=self.cfg.timeout_page,
                )
            except Exception as e:
                log.warning("mercantil BFF cenário B goto dataprev falhou cpf=%s url_atual=%s: %s",
                            cpf, page.url, str(e)[:120])
                # cleanup: tenta voltar pro dashboard pra próximo CPF não herdar estado
                try:
                    await voltar_para_dashboard(page, self.cfg)
                except Exception:
                    pass
                return {**updates_base, "status": "erro", "erro": f"goto dataprev: {str(e)[:200]}"}

            self._emit("status_update", cpf=cpf, status="fase3_dataprev")
            r3 = await fase3_autorizar_dataprev(page, uuid_portal, telefone, self.cfg)
            if r3.get("status") != "autorizado":
                try:
                    await voltar_para_dashboard(page, self.cfg)
                except Exception:
                    pass
                return {**updates_base, "status": "erro",
                        "erro": r3.get("erro", "fase3 falhou")}

            # Volta ao BFF pra finalizar — agora token deve estar válido
            self._emit("status_update", cpf=cpf, status="bff_reconsultar")
            r2 = await bff_bridge.consultar_cpf(page, cpf,
                                                poll_interval=self.cfg.poll_dataprev_interval_s,
                                                poll_max=self.cfg.poll_dataprev_max_seconds)
            # Detecta divergência uuid_portal (BFF poderia retornar outro id pós-autorização)
            r2_uuid = r2.get("uuid_portal")
            if r2_uuid and r2_uuid != uuid_portal:
                log.warning("mercantil BFF reconsulta uuid divergente cpf=%s old=%s new=%s",
                            cpf, uuid_portal, r2_uuid)
            return {**updates_base, **r2, "cenario": "B"}

        return {"status": "erro", "erro": f"BFF retornou status inesperado: {status_bff}"}

    # ─── Persistência ─────────────────────────────────────────────────────────

    _ALLOWED_COLS = {
        "status", "telefone", "nome", "erro", "tentativas",
        "cenario", "uuid_portal",
        "valor_liberado", "valor_parcela", "qtd_parcelas", "prazo",
        "taxa_juros_mes", "valor_financiado", "valor_emprestimo",
        "valor_iof", "capital_segurado", "valor_seguro_prestamista",
        "data_vencimento",
    }

    @classmethod
    def _split_updates(cls, updates: dict) -> dict:
        clean: dict = {}
        extras: dict = {}
        for k, v in updates.items():
            if k in cls._ALLOWED_COLS:
                clean[k] = v
            else:
                extras[k] = v
        if extras:
            clean["payload"] = extras
        return clean

    async def _save(self, cpf: str, updates: dict) -> None:
        clean = self._split_updates(updates)
        try:
            await asyncio.to_thread(
                lambda: scoped(self.db, "mercantil_leads", self.user_id)
                    .update(clean).eq("cpf", cpf).execute()
            )
        except Exception as e:
            log.error("mercantil save failed | worker=%d cpf=%s err=%s",
                      self.worker_id, cpf, str(e)[:200])

    # ─── Main loop ────────────────────────────────────────────────────────────

    async def run(self, queue: asyncio.Queue, stop_event: asyncio.Event | None = None) -> None:
        if self.startup_delay > 0:
            await asyncio.sleep(self.startup_delay)

        # headless=None → default da engine (HEADED com Xvfb pra Akamai bypass).
        # Override via env MERCANTIL_HEADLESS=1 pra debug headless.
        try:
            await self.engine.start(headless=None)
        except Exception:
            log.exception("mercantil Worker %d — engine.start() falhou", self.worker_id)
            self._emit("worker_idle", message="engine_start_failed")
            return
        try:
            ctx = await self.engine.new_context(user_id=self.user_id)
            page = await ctx.new_page()
            page.set_default_timeout(self.cfg.timeout_page)

            try:
                ok = await self.engine.login_with_sms(
                    page,
                    user_id=self.user_id,
                    run_id=self.run_id,
                    emit=lambda p: self._emit(**p),
                )
                if not ok:
                    log.error("mercantil Worker %d — login falhou", self.worker_id)
                    self._emit("worker_idle", message="login_failed")
                    return

                self._emit("worker_start")
                log.info("mercantil Worker %d — login OK, processando fila", self.worker_id)

                empty_polls = 0
                while True:
                    if stop_event and stop_event.is_set() and queue.empty():
                        log.info("mercantil Worker %d — stop_event setado, encerrando", self.worker_id)
                        break
                    try:
                        record = await asyncio.wait_for(queue.get(), timeout=2.0)
                        empty_polls = 0
                    except asyncio.TimeoutError:
                        empty_polls += 1
                        if empty_polls >= 150:  # 5min
                            log.info("mercantil Worker %d — fila vazia há ~5min, encerrando",
                                     self.worker_id)
                            break
                        continue

                    cpf = record["cpf"]
                    try:
                        updates = await self.process_cpf(page, record)
                        self._session_fail_count = 0  # reset on success
                    except asyncio.CancelledError:
                        raise
                    except BaseException as e:
                        if _is_session_error(e):
                            self._session_fail_count += 1
                            log.warning(
                                "mercantil Worker %d | CPF %s — session error %d/2: %s",
                                self.worker_id, cpf, self._session_fail_count, e,
                            )
                            if self._session_fail_count < 2:
                                # Try headless re-login before giving up
                                ok = await _try_headless_relogin(self.engine, page, self.user_id)
                                if ok:
                                    log.info("mercantil Worker %d — headless relogin OK", self.worker_id)
                                    try:
                                        queue.put_nowait(record)
                                    except Exception:
                                        pass
                                    continue
                            # 2 consecutive session failures → stop and notify frontend
                            log.error(
                                "mercantil Worker %d — sessão expirou após %d tentativas, parando",
                                self.worker_id, self._session_fail_count,
                            )
                            self._emit(
                                "session_expired",
                                message="Sessão expirou e re-login automático falhou. Faça Login Visual.",
                            )
                            try:
                                queue.put_nowait(record)
                            except Exception:
                                pass
                            break  # stop this worker
                        else:
                            log.exception(
                                "mercantil Worker %d | CPF %s — exc %s; re-enfileirando",
                                self.worker_id, cpf, type(e).__name__,
                            )
                            try:
                                queue.put_nowait(record)
                            except Exception:
                                pass
                            continue

                    await self._save(cpf, updates)
                    self._emit(
                        "lead_result",
                        cpf=cpf,
                        status=updates.get("status"),
                        nome=updates.get("nome") or record.get("nome"),
                        valor_liberado=updates.get("valor_liberado"),
                        erro=updates.get("erro"),
                        message=updates.get("erro"),
                    )

                    jitter = random.uniform(self.cfg.cpf_jitter_min, self.cfg.cpf_jitter_max)
                    await asyncio.sleep(jitter)

            except asyncio.CancelledError:
                log.info("mercantil Worker %d cancelado", self.worker_id)
            finally:
                try: await page.close()
                except Exception: pass
                try: await ctx.close()
                except Exception: pass
        finally:
            await self.engine.stop()
            self._emit("worker_idle")
            log.info("mercantil Worker %d encerrado", self.worker_id)
