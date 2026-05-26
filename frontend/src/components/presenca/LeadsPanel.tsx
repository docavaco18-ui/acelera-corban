import { useCallback, useEffect, useRef, useState } from "react";
import { presencaApi } from "../../lib/api";
import { getAccessToken } from "../../lib/supabase";

const C = {
  bg: "#1e293b", border: "#334155",
  green: "#22c55e", red: "#ef4444", yellow: "#f59e0b",
  purple: "#6366f1", text: "#e2e8f0", muted: "#94a3b8",
};

type LeadRow = {
  cpf: string;
  status: string;
  valor_liberado?: number | null;
  erro?: string | null;
  nome?: string | null;
};

type BotStatusType = "idle" | "running" | "stopped";

const WS_BASE = (() => {
  const envBase = import.meta.env.VITE_API_URL;
  if (envBase) return envBase.replace(/^http/, "ws") + "/ws/events";
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws/events`;
})();

export default function PresencaLeadsPanel({ onStatsRefresh }: { onStatsRefresh?: () => void }) {
  const [botStatus, setBotStatus] = useState<BotStatusType>("idle");
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ processed: number; total: number } | null>(null);
  const [currentBatchId, setCurrentBatchId] = useState<string | null>(null);
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleInput, setScheduleInput] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    presencaApi.botStatus().then((r) => {
      if (!mountedRef.current) return;
      setBotStatus((r.status as BotStatusType) || "idle");
    }).catch(() => {});

    presencaApi.currentBatch().then((b) => {
      if (!mountedRef.current || !b) return;
      setCurrentBatchId(b.id);
      setScheduledFor(b.scheduled_for ?? null);
    }).catch(() => {});

    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = async () => {
      if (cancelled) return;
      const token = await getAccessToken();
      if (cancelled) return;
      const ws = new WebSocket(`${WS_BASE}?token=${encodeURIComponent(token ?? "")}`);
      wsRef.current = ws;
      ws.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data);
          if (ev.bank !== "presenca") return;

          if (ev.type === "lead_result") {
            setLeads((prev) => {
              const exists = prev.findIndex((l) => l.cpf === ev.cpf);
              const row: LeadRow = {
                cpf: ev.cpf,
                status: ev.fase || ev.status,
                valor_liberado: ev.valor_liberado,
                erro: ev.erro || ev.message,
                nome: ev.nome,
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
            if (ev.status === "idle") onStatsRefresh?.();
          }
        } catch {}
      };
      ws.onclose = () => {
        if (!cancelled) reconnectTimer = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  const handleUpload = useCallback(async (file: File) => {
    setUploadMsg("Enviando…");
    setUploadProgress(null);
    try {
      const { job_id, batch_id } = await presencaApi.uploadCsv(file);
      setCurrentBatchId(batch_id);
      for (let i = 0; i < 600; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const st = await presencaApi.uploadStatus(job_id);
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
    setLoading(true);
    try {
      await presencaApi.botStart(currentBatchId || undefined);
      setBotStatus("running");
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Erro ao iniciar bot");
    } finally {
      setLoading(false);
    }
  }, [currentBatchId]);

  const stopBot = useCallback(async () => {
    setLoading(true);
    try {
      await presencaApi.botStop();
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
          <label style={{
            padding: "7px 14px", borderRadius: 8, background: C.border,
            color: C.text, fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}>
            Upload CSV
            <input type="file" accept=".csv" style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
          </label>

          {!isRunning ? (
            <>
              <button onClick={startBot} disabled={loading}
                style={{
                  padding: "7px 14px", borderRadius: 8, border: "none",
                  background: loading ? C.border : C.purple,
                  color: loading ? C.muted : "#fff",
                  fontSize: 13, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer",
                }}>
                {loading ? "…" : "▶ Rodar Bot"}
              </button>
              <button onClick={() => setShowSchedule(true)} disabled={!currentBatchId || loading}
                title={!currentBatchId ? "Faça upload do CSV primeiro" : "Agendar disparo automático"}
                style={{
                  padding: "7px 14px", borderRadius: 8, border: `1px solid ${C.border}`,
                  background: "transparent",
                  color: !currentBatchId ? C.muted : C.text,
                  fontSize: 13, fontWeight: 700,
                  cursor: !currentBatchId || loading ? "not-allowed" : "pointer",
                }}>
                ⏰ Agendar
              </button>
            </>
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

      {uploadMsg && (
        <p style={{ fontSize: 13, color: uploadMsg.startsWith("✓") ? C.green : uploadMsg.startsWith("Erro") ? C.red : C.muted, marginBottom: 8 }}>
          {uploadMsg}
        </p>
      )}

      {scheduledFor && !isRunning && (
        <div style={{ padding: "8px 12px", background: "#0f172a", border: `1px solid ${C.purple}`, borderRadius: 8, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13, color: C.text }}>
            ⏰ Agendado para <strong>{new Date(scheduledFor).toLocaleString("pt-BR")}</strong>
          </span>
          <button onClick={async () => {
            if (!currentBatchId) return;
            await presencaApi.scheduleBatch(currentBatchId, null);
            setScheduledFor(null);
          }} style={{ background: "transparent", border: "none", color: C.red, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
            Cancelar agendamento
          </button>
        </div>
      )}

      {showSchedule && (
        <div onClick={() => setShowSchedule(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, minWidth: 360 }}>
            <h3 style={{ margin: "0 0 12px", color: C.text, fontSize: 15 }}>Agendar disparo do bot</h3>
            <p style={{ fontSize: 12, color: C.muted, margin: "0 0 12px" }}>
              Bot dispara sozinho na hora escolhida. Sem precisar deixar nada aberto.
            </p>
            <input type="datetime-local" value={scheduleInput} onChange={(e) => setScheduleInput(e.target.value)}
              style={{ width: "100%", padding: 10, borderRadius: 8, border: `1px solid ${C.border}`, background: "#0f172a", color: C.text, fontSize: 14, marginBottom: 16 }} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowSchedule(false)}
                style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.border}`, background: "transparent", color: C.text, fontSize: 13, cursor: "pointer" }}>
                Cancelar
              </button>
              <button onClick={async () => {
                if (!currentBatchId || !scheduleInput) return;
                const dt = new Date(scheduleInput);
                if (dt.getTime() <= Date.now()) {
                  alert("Escolha uma data futura");
                  return;
                }
                try {
                  const r = await presencaApi.scheduleBatch(currentBatchId, dt.toISOString());
                  setScheduledFor(r.scheduled_for);
                  setShowSchedule(false);
                  setScheduleInput("");
                } catch (e: any) {
                  alert(e?.response?.data?.detail || "Erro ao agendar");
                }
              }} disabled={!scheduleInput}
                style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: scheduleInput ? C.purple : C.border, color: scheduleInput ? "#fff" : C.muted, fontSize: 13, fontWeight: 700, cursor: scheduleInput ? "pointer" : "not-allowed" }}>
                Agendar
              </button>
            </div>
          </div>
        </div>
      )}
      {uploadProgress && uploadProgress.total > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1, height: 4, background: C.border, borderRadius: 2 }}>
            <div style={{ width: `${Math.min(100, uploadProgress.processed / uploadProgress.total * 100)}%`, height: "100%", background: C.purple, borderRadius: 2, transition: "width .3s" }} />
          </div>
          <span style={{ fontSize: 11, color: C.muted }}>{uploadProgress.processed}/{uploadProgress.total}</span>
        </div>
      )}

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

      <div style={{ overflowX: "auto", maxHeight: 500, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead style={{ position: "sticky", top: 0, background: C.bg }}>
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
