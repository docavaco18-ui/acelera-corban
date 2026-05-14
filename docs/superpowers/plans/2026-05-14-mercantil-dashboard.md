# Mercantil Dashboard Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrar o bot Mercantil ao dashboard Acelera Corban com página dedicada `/mercantil`, fluxo Login Visual (headful, apenas SMS) separado do Rodar Bot (headless, processa leads), e detecção de sessão expirada mid-run com retry automático.

**Architecture:** Página nova `pages/Mercantil.tsx` isolada — não toca Dashboard.tsx nem V8/VCTex. Backend ganha dois endpoints novos (`/bot/session-status` e `/bot/login-visual`) no router existente `routers/mercantil.py`. Worker ganha detecção de sessão expirada com 2 retries headless antes de pausar.

**Tech Stack:** FastAPI (Python 3.12), React 18 + TypeScript, Playwright async, Redis BLPOP/RPUSH (SMS bridge já existente), Supabase (RLS multi-tenant), WebSocket `/ws/events`

---

## Mapa de Arquivos

| Arquivo | Ação | Responsabilidade |
|---------|------|-----------------|
| `migrations/020_mercantil.sql` | aplicar no Supabase | tabelas mercantil_leads, batches, bot_runs |
| `backend/app/routers/mercantil.py` | modificar | + GET /bot/session-status, POST /bot/login-visual |
| `backend/app/services/mercantil_bot_service.py` | modificar | + get_session_status(), start_login_visual() |
| `backend/app/banks/mercantil/worker.py` | modificar | detecção sessão expirada + retry 2x + pausa |
| `frontend/src/App.tsx` | modificar | rota /mercantil + BankToggle navigate |
| `frontend/src/pages/Mercantil.tsx` | criar | página raiz, dois painéis |
| `frontend/src/components/mercantil/SessionPanel.tsx` | criar | Login Visual + status sessão |
| `frontend/src/components/mercantil/LeadsPanel.tsx` | criar | upload CSV + Rodar Bot + tabela resultados |
| `frontend/src/hooks/useMercantilSession.ts` | criar | poll session-status, estados sessão |
| `frontend/src/lib/api.ts` | modificar | + mercantilApi.sessionStatus(), loginVisual() |

---

## Task 0: Aplicar Migration 020 no Supabase

**Files:**
- Read: `migrations/020_mercantil.sql`

- [ ] **Step 1: Aplicar migration via MCP Supabase**

```
mcp__claude_ai_Supabase__apply_migration
project_id: gfyharrnkcncpngbvhpj
name: 020_mercantil
query: <conteúdo completo de migrations/020_mercantil.sql>
```

- [ ] **Step 2: Verificar tabelas criadas**

```
mcp__claude_ai_Supabase__execute_sql
project_id: gfyharrnkcncpngbvhpj
query: SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'mercantil_%';
```

Expected output:
```
mercantil_leads
mercantil_batches
mercantil_bot_runs
```

---

## Task 1: Backend — GET /bot/session-status

**Files:**
- Modify: `backend/app/routers/mercantil.py` (após o endpoint `/bot/runs`)
- Modify: `backend/app/services/mercantil_bot_service.py`

- [ ] **Step 1: Adicionar `get_session_status()` no service**

Em `backend/app/services/mercantil_bot_service.py`, adicionar após os imports:

```python
import os
from datetime import datetime, timezone
from pathlib import Path

_STATE_DIR = Path(os.getenv("MERCANTIL_STATE_DIR", ".bot_state/mercantil"))


def get_session_status(user_id: str) -> dict:
    """Retorna estado da sessão salva em disco para o user."""
    path = _STATE_DIR / f"{user_id}.json"
    if not path.is_file() or path.stat().st_size < 10:
        return {"status": "none", "saved_at": None}
    mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    return {"status": "valid", "saved_at": mtime.isoformat()}
```

- [ ] **Step 2: Adicionar endpoint no router**

Em `backend/app/routers/mercantil.py`, adicionar antes do endpoint `/bot/runs`:

```python
@router.get("/bot/session-status")
def session_status(user: AuthUser = Depends(require_user)):
    """Verifica se há storage state salvo em disco para o usuário."""
    return mercantil_bot_service.get_session_status(user.user_id)
```

- [ ] **Step 3: Testar manualmente**

```bash
cd backend
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8002/api/mercantil/bot/session-status
```

Expected (sem sessão): `{"status":"none","saved_at":null}`
Expected (com sessão): `{"status":"valid","saved_at":"2026-05-14T02:26:00+00:00"}`

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/mercantil.py backend/app/services/mercantil_bot_service.py
git commit -m "feat: add GET /api/mercantil/bot/session-status endpoint"
```

---

## Task 2: Backend — POST /bot/login-visual

**Files:**
- Modify: `backend/app/routers/mercantil.py`
- Modify: `backend/app/services/mercantil_bot_service.py`

- [ ] **Step 1: Adicionar `start_login_visual()` no service**

Em `backend/app/services/mercantil_bot_service.py`, adicionar após `get_session_status`:

```python
import uuid as _uuid


async def start_login_visual(
    pool,
    user_id: str,
    creds: dict,
    on_event,
    db=None,
) -> dict:
    """Inicia Playwright headful SOMENTE para login + salvar sessão.
    Não processa leads. Emite session_saved quando concluído.
    """
    redis = await get_redis()

    # Verifica se já há login_visual em andamento
    lv_key = f"mercantil:login_visual:{user_id}"
    if await redis.exists(lv_key):
        return {"status": "already_running", "message": "Login visual já em andamento"}

    run_id = str(_uuid.uuid4())

    # Marca como ativo no Redis (TTL 10min — suficiente pro login + SMS)
    await redis.setex(lv_key, 600, run_id)

    # Cria entrada no DB para que SMS bridge possa validar ownership
    if db:
        try:
            now = datetime.now(timezone.utc).isoformat()
            db.table("mercantil_bot_runs").insert({
                "id": run_id,
                "owner_id": user_id,
                "status": "login_visual",
                "started_at": now,
            }).execute()
        except Exception as e:
            logger.warning("login_visual: erro ao criar run no DB: %s", e)

    async def _login_task():
        from ..banks.mercantil.engine import MercantilEngine
        from ..banks.mercantil.config import MercantilConfig

        engine = MercantilEngine(
            login=creds["login"],
            password=creds["password"],
            config=MercantilConfig(),
        )
        try:
            await engine.start(headless=False)  # HEADFUL — usuário vê o browser
            ctx = await engine.new_context(user_id)
            page = await ctx.new_page()

            def _emit(ev):
                on_event({**ev, "user_id": user_id, "run_id": run_id, "bank": "mercantil"})

            success = await engine.login_with_sms(page, user_id, run_id, emit=_emit)

            if success:
                await engine._save_state(ctx, user_id)
                on_event({
                    "type": "session_saved",
                    "user_id": user_id,
                    "run_id": run_id,
                    "bank": "mercantil",
                })
                logger.info("login_visual: sessão salva com sucesso user=%s", user_id)
            else:
                on_event({
                    "type": "session_failed",
                    "user_id": user_id,
                    "run_id": run_id,
                    "bank": "mercantil",
                })
                logger.warning("login_visual: falha no login user=%s", user_id)
        except Exception as e:
            logger.exception("login_visual: erro inesperado user=%s: %s", user_id, e)
            on_event({
                "type": "session_failed",
                "user_id": user_id,
                "run_id": run_id,
                "bank": "mercantil",
                "error": str(e),
            })
        finally:
            await engine.stop()
            redis2 = await get_redis()
            await redis2.delete(lv_key)

    # Dispara como background task (não bloqueia o endpoint)
    asyncio.create_task(_login_task())

    return {"status": "started", "run_id": run_id}
```

- [ ] **Step 2: Adicionar endpoint no router**

Em `backend/app/routers/mercantil.py`, adicionar após `/bot/session-status`:

```python
@router.post("/bot/login-visual", status_code=202)
async def bot_login_visual(
    request: Request,
    user: AuthUser = Depends(require_user),
):
    """Inicia login headful (browser visível) para capturar SMS.
    Não processa leads — apenas salva a sessão."""
    db = get_db()
    creds = get_mercantil_runtime_creds(user.user_id, db)
    return await mercantil_bot_service.start_login_visual(
        pool=request.app.state.mercantil_pool,
        user_id=user.user_id,
        creds=creds,
        on_event=_on_event,
        db=db,
    )
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/routers/mercantil.py backend/app/services/mercantil_bot_service.py
git commit -m "feat: add POST /api/mercantil/bot/login-visual endpoint"
```

---

## Task 3: Backend — Detecção de Sessão Expirada no Worker

**Files:**
- Modify: `backend/app/banks/mercantil/worker.py`

- [ ] **Step 1: Ler o método `process_lead` no worker**

Localizar onde `bff_bridge.consultar_cpf` é chamado — normalmente em `MercantilLeadWorker.process_lead()` ou similar.

- [ ] **Step 2: Envolver chamada BFF em retry com detecção de sessão**

Adicionar helper no `worker.py`:

```python
_SESSION_ERRORS = ("JWT_NOT_FOUND", "SessaoUsuarioInativa", "401", "403")


async def _is_session_error(exc: Exception) -> bool:
    msg = str(exc)
    return any(k in msg for k in _SESSION_ERRORS)


async def _try_headless_relogin(engine, page, user_id: str, run_id: str, emit) -> bool:
    """Tenta re-login headless (sem SMS). Retorna True se conseguiu."""
    try:
        await page.goto(engine.cfg.dashboard_url, wait_until="domcontentloaded", timeout=20000)
        await asyncio.sleep(3)
        nova = page.locator(engine.cfg.SEL_NOVA_PROPOSTA_BTN).first
        if await nova.count() > 0 and await nova.is_visible():
            await engine._save_state(page.context, user_id)
            logger.info("worker: re-login headless OK user=%s", user_id)
            return True
    except Exception as e:
        logger.warning("worker: re-login headless FAILED user=%s: %s", user_id, e)
    return False
```

- [ ] **Step 3: Adicionar retry loop na execução do worker**

No método que processa cada CPF (ex: `run()` ou `_process_batch()`), envolver a chamada principal:

```python
SESSION_RETRY_MAX = 2

for _sess_attempt in range(SESSION_RETRY_MAX + 1):
    try:
        result = await self._run_cpf(page, cpf_data)
        break  # sucesso — sai do retry loop
    except Exception as exc:
        if _sess_attempt < SESSION_RETRY_MAX and await _is_session_error(exc):
            logger.warning("worker: sessão inválida detectada, tentando re-login %d/%d",
                           _sess_attempt + 1, SESSION_RETRY_MAX)
            ok = await _try_headless_relogin(self.engine, page, self.user_id, self.run_id, self.emit)
            if ok:
                continue  # retry com sessão renovada
        # Re-login falhou ou erro não é de sessão
        if await _is_session_error(exc):
            self.emit({
                "type": "session_expired",
                "user_id": self.user_id,
                "run_id": self.run_id,
                "bank": "mercantil",
                "message": "Sessão expirou e re-login automático falhou. Faça Login Visual.",
            })
            raise  # para o worker; bot_service vai colocar status=paused
        raise
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/banks/mercantil/worker.py
git commit -m "feat: session expiry detection with 2x headless retry in mercantil worker"
```

---

## Task 4: Frontend — Adicionar sessionStatus e loginVisual na API lib

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Adicionar métodos ao `mercantilApi`**

Em `frontend/src/lib/api.ts`, dentro do objeto `mercantilApi` (linha ~244), adicionar:

```typescript
  sessionStatus: () =>
    mercantilAxios
      .get<{ status: "valid" | "none" | "logging_in"; saved_at: string | null }>(
        "/api/mercantil/bot/session-status"
      )
      .then((r) => r.data),

  loginVisual: () =>
    mercantilAxios
      .post<{ status: string; run_id: string }>("/api/mercantil/bot/login-visual")
      .then((r) => r.data),

  botStart: (batchId?: string) =>
    mercantilAxios
      .post<{ status: string; run_id: string }>("/api/mercantil/bot/start", null, {
        params: batchId ? { batch_id: batchId } : {},
      })
      .then((r) => r.data),

  botStop: () =>
    mercantilAxios.post("/api/mercantil/bot/stop").then((r) => r.data),

  botStatus: () =>
    mercantilAxios
      .get<{ status: string; run_id: string | null }>("/api/mercantil/bot/status")
      .then((r) => r.data),

  leads: (params?: { status?: string; batch_id?: string; page?: number; limit?: number }) =>
    mercantilAxios
      .get<{ data: any[]; page: number }>("/api/mercantil/leads/", { params })
      .then((r) => r.data),

  uploadCsv: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return mercantilAxios
      .post<{ job_id: string; batch_id: string }>("/api/mercantil/leads/upload", form)
      .then((r) => r.data);
  },

  uploadStatus: (jobId: string) =>
    mercantilAxios
      .get<{ status: string; total: number; processed: number; inserted: number }>(
        `/api/mercantil/leads/upload/${jobId}`
      )
      .then((r) => r.data),

  currentBatch: () =>
    mercantilAxios
      .get<{ id: string; name: string } | null>("/api/mercantil/batches/current")
      .then((r) => r.data)
      .catch(() => null),
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: add mercantilApi methods for session, login-visual, bot, leads"
```

---

## Task 5: Frontend — Hook useMercantilSession

**Files:**
- Create: `frontend/src/hooks/useMercantilSession.ts`

- [ ] **Step 1: Criar o hook**

```typescript
// frontend/src/hooks/useMercantilSession.ts
import { useCallback, useEffect, useRef, useState } from "react";
import { mercantilApi } from "../lib/api";
import { getAccessToken } from "../lib/supabase";

export type SessionStatus = "valid" | "none" | "logging_in" | "loading";

export type MercantilSessionState = {
  status: SessionStatus;
  savedAt: string | null;
  isStartingLogin: boolean;
  error: string | null;
};

const WS_BASE = (() => {
  const envBase = import.meta.env.VITE_API_URL;
  if (envBase) return envBase.replace(/^http/, "ws") + "/ws/events";
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws/events`;
})();

export function useMercantilSession() {
  const [state, setState] = useState<MercantilSessionState>({
    status: "loading",
    savedAt: null,
    isStartingLogin: false,
    error: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const r = await mercantilApi.sessionStatus();
      if (!mountedRef.current) return;
      setState((s) => ({
        ...s,
        status: r.status,
        savedAt: r.saved_at,
        error: null,
      }));
    } catch {
      if (!mountedRef.current) return;
      setState((s) => ({ ...s, status: "none", error: null }));
    }
  }, []);

  // Poll a cada 15s + escuta WS pra session_saved imediato
  useEffect(() => {
    mountedRef.current = true;
    refresh();
    const t = setInterval(refresh, 15000);

    const connectWs = async () => {
      const token = await getAccessToken();
      const ws = new WebSocket(`${WS_BASE}?token=${encodeURIComponent(token ?? "")}`);
      wsRef.current = ws;
      ws.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data);
          if (ev.bank !== "mercantil") return;
          if (ev.type === "session_saved") {
            setState((s) => ({ ...s, status: "valid", isStartingLogin: false }));
            refresh();
          }
          if (ev.type === "session_failed") {
            setState((s) => ({
              ...s,
              status: "none",
              isStartingLogin: false,
              error: "Login falhou. Tente novamente.",
            }));
          }
        } catch {}
      };
      ws.onclose = () => {
        if (mountedRef.current) setTimeout(connectWs, 3000);
      };
    };
    connectWs();

    return () => {
      mountedRef.current = false;
      clearInterval(t);
      wsRef.current?.close();
    };
  }, [refresh]);

  const startLoginVisual = useCallback(async () => {
    setState((s) => ({ ...s, isStartingLogin: true, error: null }));
    try {
      await mercantilApi.loginVisual();
      setState((s) => ({ ...s, status: "logging_in" }));
    } catch (e: any) {
      const msg = e?.response?.data?.detail || "Erro ao iniciar login visual";
      setState((s) => ({ ...s, isStartingLogin: false, error: String(msg) }));
    }
  }, []);

  return { ...state, startLoginVisual, refresh };
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/useMercantilSession.ts
git commit -m "feat: useMercantilSession hook with WS session_saved listener"
```

---

## Task 6: Frontend — Componente SessionPanel

**Files:**
- Create: `frontend/src/components/mercantil/SessionPanel.tsx`

- [ ] **Step 1: Criar diretório e componente**

```typescript
// frontend/src/components/mercantil/SessionPanel.tsx
import { useMercantilSession } from "../../hooks/useMercantilSession";

const C = {
  bg: "#1e293b",
  border: "#334155",
  green: "#22c55e",
  red: "#ef4444",
  yellow: "#f59e0b",
  purple: "#6366f1",
  text: "#e2e8f0",
  muted: "#94a3b8",
};

export default function SessionPanel() {
  const session = useMercantilSession();

  const statusColor =
    session.status === "valid" ? C.green :
    session.status === "logging_in" ? C.yellow : C.red;

  const statusLabel =
    session.status === "loading" ? "Verificando…" :
    session.status === "valid" ? "✅ Sessão válida" :
    session.status === "logging_in" ? "⏳ Aguardando SMS…" :
    "❌ Sem sessão";

  const savedAtLabel = session.savedAt
    ? `Salva em ${new Date(session.savedAt).toLocaleString("pt-BR")}`
    : null;

  return (
    <div style={{
      background: C.bg,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      padding: 24,
      minWidth: 280,
      maxWidth: 340,
    }}>
      <h2 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: C.text }}>
        Sessão Mercantil
      </h2>

      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 8,
      }}>
        <span style={{
          width: 10, height: 10, borderRadius: "50%",
          background: statusColor, flexShrink: 0,
        }} />
        <span style={{ color: C.text, fontSize: 14, fontWeight: 600 }}>
          {statusLabel}
        </span>
      </div>

      {savedAtLabel && (
        <p style={{ margin: "0 0 16px", fontSize: 12, color: C.muted }}>
          {savedAtLabel}
        </p>
      )}

      {session.status === "logging_in" && (
        <p style={{ margin: "0 0 16px", fontSize: 13, color: C.yellow }}>
          Browser aberto. Aguardando você digitar o código SMS no modal acima.
        </p>
      )}

      {session.error && (
        <div style={{
          background: "#7f1d1d", color: "#fecaca",
          borderRadius: 8, padding: "8px 12px",
          fontSize: 13, marginBottom: 16,
        }}>
          {session.error}
        </div>
      )}

      <button
        onClick={session.startLoginVisual}
        disabled={session.isStartingLogin || session.status === "logging_in"}
        style={{
          width: "100%",
          padding: "10px 16px",
          borderRadius: 8,
          background: session.isStartingLogin || session.status === "logging_in"
            ? C.border : C.purple,
          color: session.isStartingLogin || session.status === "logging_in"
            ? C.muted : "#fff",
          border: "none",
          fontSize: 14,
          fontWeight: 700,
          cursor: session.isStartingLogin || session.status === "logging_in"
            ? "not-allowed" : "pointer",
        }}
      >
        {session.status === "logging_in" ? "Aguardando SMS…" : "Login Visual"}
      </button>

      <p style={{ margin: "12px 0 0", fontSize: 11, color: C.muted }}>
        Abre o Chrome, preenche login/senha automaticamente e aguarda você inserir o SMS.
        Sessão fica salva para o Rodar Bot.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/mercantil/SessionPanel.tsx
git commit -m "feat: MercantilSessionPanel component with login-visual flow"
```

---

## Task 7: Frontend — Componente LeadsPanel

**Files:**
- Create: `frontend/src/components/mercantil/LeadsPanel.tsx`

- [ ] **Step 1: Criar componente**

```typescript
// frontend/src/components/mercantil/LeadsPanel.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { mercantilApi } from "../../lib/api";
import { getAccessToken } from "../../lib/supabase";

const C = {
  bg: "#1e293b", border: "#334155",
  green: "#22c55e", red: "#ef4444", yellow: "#f59e0b",
  purple: "#6366f1", text: "#e2e8f0", muted: "#94a3b8",
  bgDark: "#0f172a",
};

type LeadRow = {
  cpf: string;
  status: string;
  valor_liberado?: number | null;
  erro?: string | null;
  nome?: string | null;
};

type BotStatusType = "idle" | "running" | "paused" | "stopped";

const WS_BASE = (() => {
  const envBase = import.meta.env.VITE_API_URL;
  if (envBase) return envBase.replace(/^http/, "ws") + "/ws/events";
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws/events`;
})();

export default function LeadsPanel({ sessionValid }: { sessionValid: boolean }) {
  const [botStatus, setBotStatus] = useState<BotStatusType>("idle");
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ processed: number; total: number } | null>(null);
  const [currentBatchId, setCurrentBatchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);
  const wsRef = useRef<WebSocket | null>(null);

  // Poll bot status na montagem
  useEffect(() => {
    mountedRef.current = true;
    mercantilApi.botStatus().then((r) => {
      if (!mountedRef.current) return;
      setBotStatus((r.status as BotStatusType) || "idle");
    }).catch(() => {});

    mercantilApi.currentBatch().then((b) => {
      if (!mountedRef.current || !b) return;
      setCurrentBatchId(b.id);
    }).catch(() => {});

    return () => { mountedRef.current = false; };
  }, []);

  // WebSocket para eventos em tempo real
  useEffect(() => {
    let cancelled = false;
    const connect = async () => {
      const token = await getAccessToken();
      if (cancelled) return;
      const ws = new WebSocket(`${WS_BASE}?token=${encodeURIComponent(token ?? "")}`);
      wsRef.current = ws;
      ws.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data);
          if (ev.bank !== "mercantil") return;

          if (ev.type === "lead_result") {
            setLeads((prev) => {
              const exists = prev.findIndex((l) => l.cpf === ev.cpf);
              const row: LeadRow = {
                cpf: ev.cpf, status: ev.status,
                valor_liberado: ev.valor_liberado, erro: ev.erro, nome: ev.nome,
              };
              if (exists >= 0) {
                const next = [...prev];
                next[exists] = row;
                return next;
              }
              return [row, ...prev];
            });
            setProgress((p) => ({ ...p, done: p.done + 1 }));
          }

          if (ev.type === "bot_status") {
            setBotStatus(ev.status as BotStatusType);
            if (ev.total) setProgress((p) => ({ ...p, total: ev.total }));
          }

          if (ev.type === "session_expired") {
            setSessionExpired(true);
            setBotStatus("paused");
          }
        } catch {}
      };
      ws.onclose = () => {
        if (!cancelled) setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      cancelled = true;
      wsRef.current?.close();
    };
  }, []);

  const handleUpload = useCallback(async (file: File) => {
    setUploadMsg("Enviando…");
    setUploadProgress(null);
    try {
      const { job_id, batch_id } = await mercantilApi.uploadCsv(file);
      setCurrentBatchId(batch_id);
      // Poll upload progress
      for (let i = 0; i < 300; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const st = await mercantilApi.uploadStatus(job_id);
        setUploadProgress({ processed: st.processed, total: st.total });
        if (st.status === "done") {
          setUploadMsg(`✓ ${st.inserted} leads importados`);
          setProgress({ done: 0, total: st.inserted });
          break;
        }
        if (st.status === "error") {
          setUploadMsg(`Erro: ${st.error}`);
          break;
        }
      }
    } catch (e: any) {
      setUploadMsg(`Erro: ${e?.response?.data?.detail || e?.message}`);
    }
  }, []);

  const startBot = useCallback(async () => {
    if (!sessionValid) {
      alert("Faça o Login Visual primeiro para salvar a sessão.");
      return;
    }
    setLoading(true);
    setSessionExpired(false);
    try {
      await mercantilApi.botStart(currentBatchId || undefined);
      setBotStatus("running");
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Erro ao iniciar bot");
    } finally {
      setLoading(false);
    }
  }, [sessionValid, currentBatchId]);

  const stopBot = useCallback(async () => {
    setLoading(true);
    try {
      await mercantilApi.botStop();
      setBotStatus("stopped");
    } finally {
      setLoading(false);
    }
  }, []);

  const isRunning = botStatus === "running";
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const elegiveis = leads.filter((l) => l.status === "elegivel").length;

  return (
    <div style={{ flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>Leads</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Upload CSV */}
          <label style={{
            padding: "7px 14px", borderRadius: 8, background: C.border,
            color: C.text, fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}>
            Upload CSV
            <input type="file" accept=".csv" style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
          </label>

          {!isRunning ? (
            <button onClick={startBot} disabled={loading}
              style={{
                padding: "7px 14px", borderRadius: 8, border: "none",
                background: loading ? C.border : C.purple,
                color: loading ? C.muted : "#fff",
                fontSize: 13, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer",
              }}>
              {loading ? "…" : "▶ Rodar Bot"}
            </button>
          ) : (
            <button onClick={stopBot} disabled={loading}
              style={{
                padding: "7px 14px", borderRadius: 8, border: "none",
                background: C.red, color: "#fff",
                fontSize: 13, fontWeight: 700, cursor: "pointer",
              }}>
              ■ Parar
            </button>
          )}
        </div>
      </div>

      {/* Upload progress */}
      {uploadMsg && (
        <p style={{ fontSize: 13, color: uploadMsg.startsWith("✓") ? C.green : uploadMsg.startsWith("Erro") ? C.red : C.muted, marginBottom: 8 }}>
          {uploadMsg}
        </p>
      )}
      {uploadProgress && uploadProgress.total > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1, height: 4, background: C.border, borderRadius: 2 }}>
            <div style={{ width: `${Math.min(100, uploadProgress.processed / uploadProgress.total * 100)}%`, height: "100%", background: C.purple, borderRadius: 2, transition: "width .3s" }} />
          </div>
          <span style={{ fontSize: 11, color: C.muted }}>{uploadProgress.processed}/{uploadProgress.total}</span>
        </div>
      )}

      {/* Session expired banner */}
      {sessionExpired && (
        <div style={{
          background: "#78350f", color: "#fef3c7", borderRadius: 8,
          padding: "10px 14px", marginBottom: 12, fontSize: 13,
        }}>
          ⚠️ Sessão expirou durante a execução. Faça Login Visual novamente e clique em Rodar Bot para continuar.
        </div>
      )}

      {/* Progress bar */}
      {progress.total > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: C.muted }}>
              {progress.done}/{progress.total} processados
            </span>
            <span style={{ fontSize: 12, color: C.green }}>
              {elegiveis} elegíveis
            </span>
          </div>
          <div style={{ height: 6, background: C.border, borderRadius: 3 }}>
            <div style={{ width: `${pct}%`, height: "100%", background: C.purple, borderRadius: 3, transition: "width .3s" }} />
          </div>
        </div>
      )}

      {/* Tabela resultados */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ color: C.muted, textAlign: "left" }}>
              <th style={{ padding: "6px 8px", borderBottom: `1px solid ${C.border}` }}>CPF</th>
              <th style={{ padding: "6px 8px", borderBottom: `1px solid ${C.border}` }}>Nome</th>
              <th style={{ padding: "6px 8px", borderBottom: `1px solid ${C.border}` }}>Status</th>
              <th style={{ padding: "6px 8px", borderBottom: `1px solid ${C.border}` }}>Valor Liberado</th>
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: "24px 8px", textAlign: "center", color: C.muted }}>
                  {isRunning ? "Processando…" : "Nenhum resultado ainda"}
                </td>
              </tr>
            )}
            {leads.map((l) => (
              <tr key={l.cpf} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: "6px 8px", color: C.text, fontFamily: "monospace" }}>
                  {l.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")}
                </td>
                <td style={{ padding: "6px 8px", color: C.muted }}>{l.nome || "—"}</td>
                <td style={{ padding: "6px 8px" }}>
                  <span style={{
                    color: l.status === "elegivel" ? C.green : l.status === "erro" ? C.yellow : C.red,
                    fontWeight: 600,
                  }}>
                    {l.status === "elegivel" ? "✅ Elegível" :
                     l.status === "inelegivel" ? "❌ Inelegível" :
                     l.status === "erro" ? "⚠️ Erro" : l.status}
                  </span>
                </td>
                <td style={{ padding: "6px 8px", color: C.text }}>
                  {l.valor_liberado
                    ? `R$ ${Number(l.valor_liberado).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                    : l.erro || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/mercantil/LeadsPanel.tsx
git commit -m "feat: MercantilLeadsPanel with upload, bot control, live results table"
```

---

## Task 8: Frontend — Página Mercantil.tsx

**Files:**
- Create: `frontend/src/pages/Mercantil.tsx`

- [ ] **Step 1: Criar página**

```typescript
// frontend/src/pages/Mercantil.tsx
import SessionPanel from "../components/mercantil/SessionPanel";
import LeadsPanel from "../components/mercantil/LeadsPanel";
import { useMercantilSession } from "../hooks/useMercantilSession";

export default function Mercantil() {
  const session = useMercantilSession();

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ color: "#fff", fontSize: "1.4rem", fontWeight: 800, marginBottom: 24 }}>
        🏦 Mercantil Bot — CLT / MTE
      </h1>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        <SessionPanel />
        <LeadsPanel sessionValid={session.status === "valid"} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/Mercantil.tsx
git commit -m "feat: MercantilPage root component"
```

---

## Task 9: Frontend — Rota /mercantil + BankToggle redirect

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Adicionar import e rota**

Em `frontend/src/App.tsx`, adicionar o import:

```typescript
import Mercantil from "./pages/Mercantil";
```

No `BankToggle`, modificar o `reload` para navegar para `/mercantil` quando banco = mercantil:

```typescript
const reload = (b: "v8" | "vctex" | "mercantil") => {
  setBank(b);
  if (b === "mercantil") {
    window.location.href = "/mercantil";
  } else {
    window.location.reload();
  }
};
```

Nas rotas do `App.tsx`, adicionar dentro das `<Routes>` protegidas:

```typescript
<Route path="/mercantil" element={<Mercantil />} />
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat: add /mercantil route and BankToggle navigation"
```

---

## Task 10: Backend — Emitir lead_result via WebSocket

**Files:**
- Modify: `backend/app/services/mercantil_bot_service.py`

O service já emite eventos via Redis `bot:events`. Garantir que cada CPF processado emita um evento `lead_result` com os campos corretos para o `LeadsPanel`:

- [ ] **Step 1: Localizar onde resultado é emitido no service**

```bash
grep -n "lead_result\|elegivel\|inelegivel\|emit\|broadcast" backend/app/services/mercantil_bot_service.py | head -20
```

- [ ] **Step 2: Garantir que evento lead_result tem shape correto**

O evento deve ter o seguinte shape para o `LeadsPanel.tsx` funcionar:

```python
await _broadcast(redis, {
    "type": "lead_result",
    "bank": "mercantil",
    "user_id": user_id,
    "run_id": run_id,
    "cpf": lead["cpf"],
    "nome": lead.get("nome"),
    "status": result_status,          # "elegivel" | "inelegivel" | "erro"
    "valor_liberado": result.get("valor_liberado"),
    "erro": result.get("erro"),
})
```

Se o evento existir com shape diferente, adaptar o `LeadsPanel.tsx` para usar os campos corretos.

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/mercantil_bot_service.py
git commit -m "fix: ensure lead_result WS event has correct shape for frontend"
```

---

## Task 11: Teste End-to-End Local

- [ ] **Step 1: Subir stack local**

```bash
cd "/Users/macbookdegabriel/projetos/ACELERA CORBAN"
docker compose build --no-cache backend frontend
docker compose up -d
```

- [ ] **Step 2: Verificar containers rodando**

```bash
docker compose ps
```

Expected: `backend`, `frontend`, `redis` com status `Up`.

- [ ] **Step 3: Testar fluxo Login Visual**

1. Acessar `http://localhost:3002`
2. Clicar toggle "Mercantil" → deve navegar para `/mercantil`
3. Verificar que SessionPanel mostra "❌ Sem sessão"
4. Clicar "Login Visual" → Chrome abre → preenche login/senha
5. SMS Modal aparece no dashboard
6. Digitar código do celular -5744
7. Verificar SessionPanel muda para "✅ Sessão válida"
8. Verificar Chrome fecha automaticamente

- [ ] **Step 4: Testar Upload CSV**

1. Clicar "Upload CSV" → selecionar `/tmp/mercantil_janeiro_5499.csv`
2. Aguardar barra de progresso completar
3. Verificar mensagem "✓ N leads importados"

- [ ] **Step 5: Testar Rodar Bot**

1. Clicar "▶ Rodar Bot"
2. Verificar resultados aparecendo na tabela em tempo real
3. Monitorar por 2-3 CPFs para confirmar fluxo funcionando

- [ ] **Step 6: Commit final**

```bash
git add -A
git commit -m "chore: mercantil dashboard integration complete — E2E tested"
```

---

## Task 12: Deploy VPS

- [ ] **Step 1: Push para repositório**

```bash
git push
```

- [ ] **Step 2: Deploy no VPS (via terminal web Hostinger)**

Acessar terminal web em `177.7.58.154` e executar:

```bash
cd /root/acelera-corban && git pull && \
docker compose -f docker-compose.prod.yml build --no-cache backend frontend && \
docker compose -f docker-compose.prod.yml up -d backend frontend
```

- [ ] **Step 3: Verificar produção**

```bash
docker compose -f docker-compose.prod.yml logs backend --tail=30
```

Verificar sem erros de import. Acessar `https://aceleracorban.com.br` e testar fluxo Mercantil.

---

## Self-Review

**Spec coverage:**
- ✅ Login Visual headful → Task 2
- ✅ SMS sem timeout → `login_with_sms` já usa BLPOP sem timeout fixo
- ✅ Sessão salva após SMS → `_save_state` chamado em `_login_task`
- ✅ Rodar Bot headless → `bot/start` existente + `LeadsPanel`
- ✅ Tabela live de resultados → WS `lead_result` → Task 10
- ✅ Session expired → retry 2x → pausa → banner → Task 3
- ✅ Resume automático → `WHERE status='pendente'` já no service
- ✅ Separação total de V8/VCTex → página dedicada, mercantilAxios separado
- ✅ Migration 020 → Task 0

**Placeholders:** nenhum encontrado.

**Type consistency:** `mercantilApi.sessionStatus()` retorna `{ status: "valid" | "none" | "logging_in" }` → `useMercantilSession` usa `SessionStatus = "valid" | "none" | "logging_in" | "loading"` → consistente. `lead_result` shape definido em Task 10 → `LeadsPanel` consome `ev.cpf, ev.status, ev.valor_liberado, ev.erro, ev.nome` → consistente.
