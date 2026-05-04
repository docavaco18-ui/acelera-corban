import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
} from "recharts";
import { botApi, leadsApi, statsApi } from "../lib/api";
import type { BotStatus, DashboardStats, Lead } from "../lib/types";
import { useBotWebSocket } from "../hooks/useBotWebSocket";
import { useBank } from "../hooks/useBank";
import WorkersLive from "../components/WorkersLive";
import EligibleRanking from "../components/EligibleRanking";
import ResultsTable from "../components/ResultsTable";
import MetricsDashboard from "../components/MetricsDashboard";
import CerebroIA from "../components/CerebroIA";
import UploadGameProgress, { type UploadPhase } from "../components/UploadGameProgress";

const C = {
  bg: "#080818", bg2: "rgba(255,255,255,.04)", border: "rgba(255,255,255,.07)",
  green: "#00ff88", red: "#ff2d78", blue: "#00bfff", purple: "#b44aff",
  gold: "#ffd700", orange: "#ff8c00",
};

const fmt = (x: number, d = 0) =>
  Number(x).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtBRL = (v: number) => "R$ " + fmt(v, 2);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

const MILESTONES = [10000, 25000, 50000, 100000, 200000, 500000, 1000000, 1500000, 2000000, 3000000, 4000000, 5000000];

type Tab = "historico" | "geral" | "ranking" | "graficos" | "tabela" | "workers" | "cerebro";
const TABS: { id: Tab; label: string }[] = [
  { id: "historico", label: "📦 Histórico" },
  { id: "geral",    label: "📊 Geral" },
  { id: "ranking",  label: "🏆 Ranking Elegíveis" },
  { id: "graficos", label: "📈 Gráficos" },
  { id: "tabela",   label: "📋 Todos os Resultados" },
  { id: "workers",  label: "⚡ Workers ao Vivo" },
  { id: "cerebro",  label: "🧠 Cérebro" },
];

const card = (extra?: React.CSSProperties): React.CSSProperties => ({
  background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 14,
  padding: "20px 22px", marginBottom: 14, ...extra,
});

const resCard = (): React.CSSProperties => ({
  background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 12,
  padding: 18, textAlign: "center",
});

const faseBox = (): React.CSSProperties => ({
  background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 12,
  padding: "16px 18px", textAlign: "center", flex: 1,
});

// Bucketed view: VCTex's fase 0/1/2 → V8 status groups
interface DashData {
  total: number;
  fase0: number;          // pendente + enriquecido
  fase1: number;          // consentido + autorizado + aguardando_resultado
  concluidos: number;     // elegivel + inelegivel
  elegivel: number;
  nao_elegivel: number;
  erros: number;
  pendentes: number;
  total_liberado: number;
}

function deriveDash(leads: Lead[], stats: DashboardStats): DashData {
  const fase0 = leads.filter(l => l.status === "pendente" || l.status === "enriquecido").length;
  const fase1 = leads.filter(l => l.status === "consentido" || l.status === "autorizado" || l.status === "aguardando_resultado").length;
  const concluidos = leads.filter(l => l.status === "elegivel" || l.status === "inelegivel").length;
  const elegivel = leads.filter(l => l.status === "elegivel").length;
  const nao_elegivel = leads.filter(l => l.status === "inelegivel").length;
  const total_liberado = leads
    .filter(l => l.status === "elegivel")
    .reduce((sum, l) => sum + (l.valor_liberado ?? 0), 0);

  return {
    total: stats.total || leads.length,
    fase0,
    fase1,
    concluidos,
    elegivel: stats.elegiveis || elegivel,
    nao_elegivel: stats.inelegiveis || nao_elegivel,
    erros: stats.erros,
    pendentes: stats.pendentes,
    total_liberado,
  };
}

const EMPTY_STATS: DashboardStats = {
  total: 0, elegiveis: 0, inelegiveis: 0, pendentes: 0, erros: 0,
  em_processamento: 0, aguardando_autorizacao: 0, by_status: {},
};

interface DashboardProps {
  batchId?: string;          // se fornecido, escopa stats/leads/bot start a essa batch
  batchName?: string;        // exibido no header
  hideUpload?: boolean;      // omite "Carregar CSV" no header (DASHBOARD agregado não tem upload)
}

export function Dashboard({ batchId, batchName, hideUpload }: DashboardProps = {}) {
  const { bank } = useBank();
  const bankLabel = bank === "vctex" ? "VCTex Bot" : "V8 Bot";
  const [tab, setTab]   = useState<Tab>("geral");
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [botStatus, setBotStatus] = useState<BotStatus>({ status: "idle", run_id: null });
  const [workers, setWorkers] = useState(6);
  const [loading, setLoading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ processed: number; total: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [gamePhase, setGamePhase] = useState<UploadPhase | null>(null);
  const [gameInserted, setGameInserted] = useState(0);
  const [gameTotal, setGameTotal] = useState(0);
  const [workerStartFired, setWorkerStartFired] = useState(false);

  const refresh = async () => {
    const [s, b, ls] = await Promise.all([
      statsApi.dashboard(batchId).catch(() => EMPTY_STATS),
      botApi.status().catch(() => botStatus),
      // listAll não suporta batch_id ainda; filtro server-side por status,
      // depois client filtra por batch_id se escopado
      leadsApi.listAll().catch(() => [] as Lead[]),
    ]);
    setStats(s);
    setBotStatus(b);
    setLeads(batchId ? ls.filter((l: any) => l.batch_id === batchId) : ls);
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [batchId]);

  const cutoff = stats.batch_cutoff ?? "";
  const currentLeads = useMemo(
    () => (cutoff ? leads.filter(l => (l.created_at ?? "") >= cutoff) : leads),
    [leads, cutoff]
  );
  const currentStats = useMemo<DashboardStats>(() => {
    if (!stats.batches) return stats;
    const a = stats.batches.atual;
    return {
      total: a.total,
      elegiveis: a.elegiveis,
      inelegiveis: a.inelegiveis,
      pendentes: a.pendentes,
      erros: a.erros,
      em_processamento: a.em_processamento,
      aguardando_autorizacao: a.aguardando_autorizacao,
      total_liberado: a.total_liberado,
      total_margem: a.total_margem,
      by_status: a.by_status,
      batch_cutoff: stats.batch_cutoff,
      batches: stats.batches,
    };
  }, [stats]);
  const data = useMemo(() => deriveDash(currentLeads, currentStats), [currentLeads, currentStats]);
  const historicoData = useMemo(() => {
    const h = stats.batches?.anterior;
    if (!h) return null;
    const processados = h.elegiveis + h.inelegiveis + h.erros;
    return { ...h, processados };
  }, [stats]);

  const exec = async (fn: () => Promise<BotStatus>) => {
    setLoading(true);
    const s = await fn().catch(() => botStatus);
    setBotStatus(s);
    setLoading(false);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploadMsg("Enviando...");
    setUploadProgress(null);
    setGamePhase("uploading");
    setGameInserted(0);
    setGameTotal(0);
    setWorkerStartFired(false);
    let jobId: string;
    try {
      const r = await leadsApi.uploadCsv(file);
      jobId = r.job_id;
    } catch {
      setUploadMsg("Erro ao enviar CSV");
      setGamePhase(null);
      setTimeout(() => setUploadMsg(null), 5000);
      return;
    }
    setUploadMsg("Processando…");
    setGamePhase("processing");
    while (true) {
      await new Promise((res) => setTimeout(res, 1000));
      try {
        const s = await leadsApi.uploadStatus(jobId);
        if (s.total > 0) {
          setUploadProgress({ processed: s.processed, total: s.total });
          setGameInserted(s.processed);
          setGameTotal(s.total);
        }
        if (s.status === "done") {
          setUploadMsg(`✓ ${s.inserted} de ${s.total} inseridos`);
          setGameInserted(s.inserted);
          setGameTotal(s.total);
          setGamePhase("done");
          refresh();
          break;
        }
        if (s.status === "error") {
          setUploadMsg(`Erro: ${s.error ?? "desconhecido"}`);
          setGamePhase(null);
          break;
        }
      } catch {
        setUploadMsg("Erro ao consultar progresso");
        setGamePhase(null);
        break;
      }
    }
    setTimeout(() => { setUploadMsg(null); setUploadProgress(null); }, 6000);
  };

  const ranking = useMemo(() => {
    return currentLeads
      .filter(l => l.status === "elegivel")
      .sort((a, b) => (b.valor_liberado ?? 0) - (a.valor_liberado ?? 0));
  }, [currentLeads]);

  const { events: wsEvents, botStatus: wsBotStatus, workerStates, runStartedAt } = useBotWebSocket();

  useEffect(() => {
    if (!wsEvents.length) return;
    const latest = wsEvents[0];
    if (latest.type === "worker_start" && gamePhase !== null) {
      setWorkerStartFired(true);
      setGamePhase("bot_running");
    }
  }, [wsEvents]);
  const liveStatus = wsBotStatus || botStatus.status;
  const isRunning = liveStatus === "running" || botStatus.status === "running";
  const processados = data.concluidos + data.erros;
  const pctGeral = pct(processados, data.total);
  const statusLabel = isRunning ? "Rodando" : botStatus.status === "stopped" ? "Parado" : "Aguardando";

  const pillStyle: React.CSSProperties = isRunning
    ? { background: "rgba(0,255,136,.12)", color: C.green, border: "1px solid rgba(0,255,136,.3)" }
    : { background: "rgba(255,215,0,.1)", color: C.gold, border: "1px solid rgba(255,215,0,.25)" };

  const dotColor = isRunning ? C.green : C.gold;

  return (
    <div style={{ background: C.bg, minHeight: "100vh", padding: "20px 18px", color: "#e0e0f0", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: "1.45rem", fontWeight: 800, color: "#fff" }}>🤖 {bankLabel}</h1>

        {batchName && (
          <span style={{ padding: "4px 12px", borderRadius: 14, background: "rgba(180,74,255,.12)", color: C.purple, border: "1px solid rgba(180,74,255,.3)", fontSize: ".75rem", fontWeight: 700 }}>
            📦 {batchName}
          </span>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 14px", borderRadius: 20, fontSize: ".75rem", fontWeight: 700, letterSpacing: ".5px", textTransform: "uppercase", ...pillStyle }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, boxShadow: isRunning ? `0 0 6px ${C.green}` : "none", animation: isRunning ? "pulse 1.6s infinite" : "none" }} />
          {statusLabel}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: ".78rem", color: "#666" }}>
            Workers:
            <input type="number" min={1} max={20} value={workers} onChange={e => setWorkers(Number(e.target.value))}
              style={{ width: 44, padding: "4px 7px", background: "#0d0d1f", border: `1px solid ${C.border}`, color: "#fff", borderRadius: 6, fontSize: ".78rem" }} />
          </label>
          <button onClick={() => exec(() => botApi.start(workers, batchId))} disabled={loading || isRunning}
            style={{ padding: "7px 16px", background: isRunning || loading ? "#1a1a2e" : "rgba(0,255,136,.15)", color: isRunning || loading ? "#444" : C.green, border: `1px solid ${isRunning || loading ? C.border : "rgba(0,255,136,.4)"}`, borderRadius: 18, cursor: isRunning || loading ? "not-allowed" : "pointer", fontSize: ".78rem", fontWeight: 700 }}>
            ▶ Iniciar
          </button>
          <button onClick={() => exec(() => botApi.stop())} disabled={loading || !isRunning}
            style={{ padding: "7px 16px", background: !isRunning || loading ? "#1a1a2e" : "rgba(255,45,120,.15)", color: !isRunning || loading ? "#444" : C.red, border: `1px solid ${!isRunning || loading ? C.border : "rgba(255,45,120,.4)"}`, borderRadius: 18, cursor: !isRunning || loading ? "not-allowed" : "pointer", fontSize: ".78rem", fontWeight: 700 }}>
            ■ Parar
          </button>
          {!hideUpload && (
            <>
              <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleUpload} />
              <button onClick={() => fileRef.current?.click()}
                style={{ padding: "7px 16px", background: "rgba(180,74,255,.15)", color: C.purple, border: "1px solid rgba(180,74,255,.4)", borderRadius: 18, cursor: "pointer", fontSize: ".78rem", fontWeight: 700 }}>
                ↑ Carregar CSV
              </button>
            </>
          )}
          <button onClick={() => leadsApi.exportCsv("elegivel")}
            style={{ padding: "7px 16px", background: "rgba(0,191,255,.15)", color: C.blue, border: "1px solid rgba(0,191,255,.4)", borderRadius: 18, cursor: "pointer", fontSize: ".78rem", fontWeight: 700 }}>
            ⬇ Exportar Elegíveis
          </button>
          {uploadMsg && <span style={{ fontSize: ".75rem", color: uploadMsg.startsWith("✓") ? C.green : uploadMsg.startsWith("Erro") ? C.red : "#888" }}>{uploadMsg}</span>}
          {uploadProgress && uploadProgress.total > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 180 }}>
              <div style={{ flex: 1, height: 6, background: "#1a1a2e", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, (uploadProgress.processed / uploadProgress.total) * 100)}%`, height: "100%", background: C.purple, transition: "width .3s" }} />
              </div>
              <span style={{ fontSize: ".7rem", color: "#888" }}>{uploadProgress.processed}/{uploadProgress.total}</span>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 22, flexWrap: "wrap" }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: "9px 20px", borderRadius: 22, border: `1px solid ${tab === t.id ? "rgba(180,74,255,.4)" : C.border}`, background: tab === t.id ? "rgba(180,74,255,.18)" : C.bg2, color: tab === t.id ? C.purple : "#666", fontSize: ".82rem", fontWeight: 700, cursor: "pointer", letterSpacing: ".4px", textTransform: "uppercase" }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "historico" && (
        <>
          {!historicoData && (
            <div style={card()}>
              <div style={{ color: "#666", fontSize: ".9rem" }}>Nenhum batch histórico disponível.</div>
            </div>
          )}
          {historicoData && (
            <>
              <div style={{ background: "rgba(100,116,139,.06)", border: "1px solid rgba(148,163,184,.18)", borderRadius: 18, padding: "28px 32px", marginBottom: 14, textAlign: "center" }}>
                <div style={{ fontSize: ".72rem", color: "#64748b", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700, marginBottom: 8 }}>📦 {historicoData.label}</div>
                <div style={{ fontSize: "3rem", fontWeight: 900, color: "#94a3b8", lineHeight: 1, letterSpacing: -2 }}>{fmtBRL(historicoData.total_liberado)}</div>
                <div style={{ fontSize: ".82rem", color: "#475569", marginTop: 10 }}>
                  <b style={{ color: "#cbd5e1" }}>{historicoData.elegiveis}</b> elegíveis ·
                  <b style={{ color: "#cbd5e1", marginLeft: 4 }}>{historicoData.processados}</b>/{historicoData.total} processados ·
                  conversão <b style={{ color: "#cbd5e1", marginLeft: 4 }}>{pct(historicoData.elegiveis, historicoData.processados)}%</b>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 14 }}>
                <div style={resCard()}>
                  <div style={{ fontSize: "2rem", fontWeight: 800, color: C.green, lineHeight: 1, marginBottom: 4 }}>{historicoData.elegiveis}</div>
                  <div style={{ fontSize: ".72rem", color: "#555", textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 600 }}>Elegíveis</div>
                </div>
                <div style={resCard()}>
                  <div style={{ fontSize: "2rem", fontWeight: 800, color: "#888", lineHeight: 1, marginBottom: 4 }}>{historicoData.inelegiveis}</div>
                  <div style={{ fontSize: ".72rem", color: "#555", textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 600 }}>Inelegíveis</div>
                </div>
                <div style={resCard()}>
                  <div style={{ fontSize: "2rem", fontWeight: 800, color: C.red, lineHeight: 1, marginBottom: 4 }}>{historicoData.erros}</div>
                  <div style={{ fontSize: ".72rem", color: "#555", textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 600 }}>Erros</div>
                </div>
                <div style={resCard()}>
                  <div style={{ fontSize: "2rem", fontWeight: 800, color: C.gold, lineHeight: 1, marginBottom: 4 }}>{fmtBRL(historicoData.total_margem)}</div>
                  <div style={{ fontSize: ".72rem", color: "#555", textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 600 }}>Margem total</div>
                </div>
              </div>
              <div style={card()}>
                <div style={{ fontSize: ".7rem", color: "#555", textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 12, fontWeight: 700 }}>Detalhamento por status</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {Object.entries(historicoData.by_status).map(([k, v]) => (
                    <div key={k} style={{ padding: "6px 14px", borderRadius: 14, fontSize: ".75rem", border: `1px solid ${C.border}`, background: "rgba(255,255,255,.03)", color: "#aaa" }}>
                      <b style={{ color: "#ddd" }}>{v}</b> {k}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {tab === "geral" && (
        <>
          {stats.batches && (
            <div style={{ marginBottom: 14, fontSize: ".75rem", color: "#64748b", letterSpacing: ".4px" }}>
              Mostrando dados do batch atual: <b style={{ color: "#cbd5e1" }}>{stats.batches.atual.label}</b> · histórico anterior disponível na aba 📦 Histórico
            </div>
          )}
          <div style={{ background: "linear-gradient(135deg,rgba(255,215,0,.08),rgba(180,74,255,.08))", border: "1px solid rgba(255,215,0,.2)", borderRadius: 18, padding: "28px 32px", marginBottom: 14, textAlign: "center" }}>
            <div style={{ fontSize: ".72rem", color: "#888", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700, marginBottom: 8 }}>💰 Total Liberado aos Elegíveis (batch atual)</div>
            <div style={{ fontSize: "3.2rem", fontWeight: 900, color: C.gold, lineHeight: 1, letterSpacing: -2, textShadow: "0 0 40px rgba(255,215,0,.4)" }}>{fmtBRL(data.total_liberado)}</div>
            <div style={{ fontSize: ".82rem", color: "#666", marginTop: 10 }}>
              em <b style={{ color: "#aaa" }}>{data.elegivel}</b> leads elegíveis · média <b style={{ color: "#aaa" }}>{data.elegivel > 0 ? fmtBRL(data.total_liberado / data.elegivel) : "R$ 0,00"}</b> por lead
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
              {MILESTONES.map(m => {
                const done = data.total_liberado >= m;
                const next = !done && MILESTONES.filter(x => x > data.total_liberado)[0] === m;
                return (
                  <div key={m} style={{ padding: "5px 14px", borderRadius: 12, fontSize: ".72rem", fontWeight: 700, background: done ? "rgba(0,255,136,.12)" : next ? "rgba(255,215,0,.08)" : "rgba(255,255,255,.04)", border: `1px solid ${done ? "rgba(0,255,136,.3)" : next ? "rgba(255,215,0,.2)" : C.border}`, color: done ? C.green : next ? C.gold : "#444" }}>
                    {done ? "✅" : next ? "🎯" : "🔒"} {fmtBRL(m)}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={card()}>
            <div style={{ fontSize: ".7rem", color: "#555", textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 14, fontWeight: 700 }}>📌 Progresso Geral</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <div style={{ fontSize: "2rem", fontWeight: 800, color: C.red, lineHeight: 1 }}>{pctGeral}%</div>
              <div style={{ fontSize: ".78rem", color: "#555" }}>{fmt(processados)} / {fmt(data.total)} processados</div>
            </div>
            <div style={{ height: 10, background: "rgba(255,255,255,.06)", borderRadius: 5, overflow: "hidden", margin: "10px 0" }}>
              <div style={{ height: "100%", width: `${Math.min(pctGeral, 100)}%`, borderRadius: 5, background: "linear-gradient(90deg,#ff2d78,#c2185b)", transition: "width .8s ease" }} />
            </div>
            <div style={{ display: "flex", gap: 16, fontSize: ".78rem", color: "#555", flexWrap: "wrap" }}>
              <span><b style={{ color: "#ccc" }}>{data.fase0}</b> enriquecimento</span>
              <span><b style={{ color: "#ccc" }}>{data.fase1}</b> autorizados</span>
              <span><b style={{ color: "#ccc" }}>{data.concluidos}</b> concluídos</span>
              <span><b style={{ color: "#ccc" }}>{data.erros}</b> erros</span>
              <span><b style={{ color: "#ccc" }}>{data.pendentes}</b> pendentes</span>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 14 }}>
            <div style={resCard()}>
              <div style={{ fontSize: "1.8rem", marginBottom: 8 }}>✅</div>
              <div style={{ fontSize: "2.2rem", fontWeight: 800, color: C.green, lineHeight: 1, marginBottom: 4 }}>{data.elegivel}</div>
              <div style={{ fontSize: ".72rem", color: "#555", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>Elegíveis</div>
              <div style={{ fontSize: ".72rem", fontWeight: 700, color: C.green }}>{pct(data.elegivel, processados)}%</div>
            </div>
            <div style={resCard()}>
              <div style={{ fontSize: "1.8rem", marginBottom: 8 }}>❌</div>
              <div style={{ fontSize: "2.2rem", fontWeight: 800, color: "#888", lineHeight: 1, marginBottom: 4 }}>{data.nao_elegivel}</div>
              <div style={{ fontSize: ".72rem", color: "#555", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>Inelegíveis</div>
              <div style={{ fontSize: ".72rem", fontWeight: 700, color: "#888" }}>{pct(data.nao_elegivel, processados)}%</div>
            </div>
            <div style={resCard()}>
              <div style={{ fontSize: "1.8rem", marginBottom: 8 }}>⚠️</div>
              <div style={{ fontSize: "2.2rem", fontWeight: 800, color: C.red, lineHeight: 1, marginBottom: 4 }}>{data.erros}</div>
              <div style={{ fontSize: ".72rem", color: "#555", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>Erros</div>
              <div style={{ fontSize: ".72rem", fontWeight: 700, color: C.red }}>{pct(data.erros, processados)}%</div>
            </div>
          </div>

          <div style={card()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: ".7rem", color: "#555", textTransform: "uppercase", letterSpacing: ".8px", fontWeight: 700 }}>⏳ Aguardando autorização (retry)</div>
                <div style={{ fontSize: ".75rem", color: "#666", marginTop: 4 }}>
                  Leads que não voltaram resposta da V8 — bot volta automaticamente
                </div>
              </div>
              <div style={{ fontSize: "2.4rem", fontWeight: 800, color: C.orange, lineHeight: 1 }}>
                {currentStats.aguardando_autorizacao}
              </div>
            </div>
            {(() => {
              const aguardando = currentLeads
                .filter(l => l.status === "aguardando_resultado")
                .sort((a, b) => (a.proxima_tentativa ?? "").localeCompare(b.proxima_tentativa ?? ""))
                .slice(0, 5);
              if (aguardando.length === 0) {
                return <div style={{ color: "#444", fontSize: ".8rem", padding: "8px 0" }}>Nenhum lead em retry no momento.</div>;
              }
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {aguardando.map(l => {
                    const prox = l.proxima_tentativa ? new Date(l.proxima_tentativa) : null;
                    const proxLabel = prox ? prox.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
                    const due = prox && prox.getTime() <= Date.now();
                    return (
                      <div key={l.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: "rgba(255,140,0,.05)", border: "1px solid rgba(255,140,0,.15)", borderRadius: 8, fontSize: ".8rem" }}>
                        <div>
                          <span style={{ color: "#ddd", fontFamily: "monospace" }}>{l.cpf}</span>
                          <span style={{ color: "#888", marginLeft: 8 }}>{l.nome ?? "—"}</span>
                        </div>
                        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                          <span style={{ color: "#666", fontSize: ".7rem" }}>tent. #{l.tentativas ?? 0}</span>
                          <span style={{ color: due ? C.green : C.orange, fontSize: ".7rem", fontWeight: 700 }}>
                            {due ? "🔄 pronto" : `⏰ ${proxLabel}`}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
            {[
              { icon: "🚀", label: "Primeiro Elegível", cond: data.elegivel >= 1 },
              { icon: "🔥", label: "10 Elegíveis", cond: data.elegivel >= 10 },
              { icon: "💎", label: "25 Elegíveis", cond: data.elegivel >= 25 },
              { icon: "🏆", label: "50 Elegíveis", cond: data.elegivel >= 50 },
              { icon: "⚡", label: "100 Processados", cond: processados >= 100 },
              { icon: "🎯", label: "500 Processados", cond: processados >= 500 },
              { icon: "🌟", label: "Base Completa", cond: data.pendentes === 0 && data.total > 0 },
              { icon: "💰", label: "R$ 10k Liberados", cond: data.total_liberado >= 10000 },
              { icon: "🤑", label: "R$ 50k Liberados", cond: data.total_liberado >= 50000 },
            ].map(a => (
              <div key={a.label} style={{ padding: "8px 16px", borderRadius: 22, fontSize: ".72rem", fontWeight: 700, display: "flex", alignItems: "center", gap: 6, border: `1px solid ${a.cond ? "rgba(255,215,0,.3)" : C.border}`, background: a.cond ? "rgba(255,215,0,.1)" : "rgba(255,255,255,.03)", color: a.cond ? C.gold : "#333" }}>
                {a.icon} {a.label}
              </div>
            ))}
          </div>

          <div style={card()}>
            <div style={{ fontSize: ".7rem", color: "#555", textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 14, fontWeight: 700 }}>🔄 Pipeline de Fases</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              {[
                { icon: "📝", name: "Fase 0", sub: "Enriquecimento", count: data.fase0, total: data.total, color: C.blue, bar: "linear-gradient(90deg,#0066ff,#00bfff)" },
                { icon: "🔗", name: "Fase 1", sub: "Autorizados", count: data.fase1, total: data.total, color: C.purple, bar: "linear-gradient(90deg,#7b1fa2,#b44aff)" },
                { icon: "💡", name: "Fase 2", sub: "Resultado", count: data.concluidos, total: data.total, color: C.green, bar: "linear-gradient(90deg,#00a854,#00ff88)" },
              ].map((f, i) => (
                <React.Fragment key={f.name}>
                  {i > 0 && <div style={{ fontSize: "1.4rem", color: "#333", padding: "0 4px" }}>›</div>}
                  <div style={faseBox()}>
                    <div style={{ fontSize: "1.5rem", marginBottom: 6 }}>{f.icon}</div>
                    <div style={{ fontSize: ".68rem", textTransform: "uppercase", letterSpacing: ".7px", color: "#444", marginBottom: 2, fontWeight: 700 }}>{f.name}</div>
                    <div style={{ fontSize: ".68rem", color: "#333", marginBottom: 8 }}>{f.sub}</div>
                    <div style={{ fontSize: "1.4rem", fontWeight: 800, color: f.color, marginBottom: 2, lineHeight: 1 }}>{f.count}</div>
                    <div style={{ fontSize: ".72rem", color: "#444", marginBottom: 8 }}>/ {f.total}</div>
                    <div style={{ height: 5, background: "rgba(255,255,255,.06)", borderRadius: 3, overflow: "hidden", marginBottom: 5 }}>
                      <div style={{ height: "100%", width: `${Math.min(pct(f.count, f.total), 100)}%`, borderRadius: 3, background: f.bar, transition: "width .8s" }} />
                    </div>
                    <div style={{ fontSize: ".68rem", fontWeight: 600, color: f.color }}>{pct(f.count, f.total)}%</div>
                  </div>
                </React.Fragment>
              ))}
            </div>
          </div>

          <div style={card()}>
            <MetricsDashboard stats={currentStats} />
          </div>
        </>
      )}

      {tab === "ranking" && (
        <>
          <div style={{ background: "linear-gradient(135deg,rgba(255,215,0,.08),rgba(180,74,255,.08))", border: "1px solid rgba(255,215,0,.2)", borderRadius: 18, padding: "28px 32px", marginBottom: 14, textAlign: "center" }}>
            <div style={{ fontSize: ".72rem", color: "#888", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700, marginBottom: 8 }}>🏆 Soma Total — Valor Liberado</div>
            <div style={{ fontSize: "3.2rem", fontWeight: 900, color: C.gold, lineHeight: 1, letterSpacing: -2, textShadow: "0 0 40px rgba(255,215,0,.4)" }}>{fmtBRL(data.total_liberado)}</div>
            <div style={{ fontSize: ".82rem", color: "#666", marginTop: 10 }}>
              <b style={{ color: "#aaa" }}>{data.elegivel}</b> leads elegíveis · maior valor: <b style={{ color: "#aaa" }}>{ranking[0]?.valor_liberado != null ? fmtBRL(ranking[0].valor_liberado) : "—"}</b>
            </div>
            <div style={{ marginTop: 18 }}>
              <button onClick={() => leadsApi.exportCsv("elegivel")}
                style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "11px 26px", borderRadius: 22, background: "linear-gradient(135deg,rgba(0,255,136,.15),rgba(0,200,100,.08))", border: "1px solid rgba(0,255,136,.4)", color: C.green, fontWeight: 700, fontSize: ".82rem", cursor: "pointer", letterSpacing: ".4px" }}>
                ⬇️ Baixar CSV dos Elegíveis
              </button>
            </div>
          </div>

          <div style={card()}>
            <EligibleRanking />
          </div>
        </>
      )}

      {tab === "graficos" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ fontSize: ".7rem", color: "#555", textTransform: "uppercase", letterSpacing: ".8px", fontWeight: 700, marginBottom: 14 }}>🍩 Distribuição de Resultados</div>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={[
                    { name: "Elegível", value: data.elegivel },
                    { name: "Inelegível", value: data.nao_elegivel },
                    { name: "Erros", value: data.erros },
                    { name: "Pendentes", value: data.pendentes },
                  ].filter(d => d.value > 0)} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} innerRadius={50}>
                    {["rgba(0,255,136,.8)", "rgba(255,45,120,.8)", "rgba(255,140,0,.8)", "rgba(100,100,150,.6)"].map((color, i) => (
                      <Cell key={i} fill={color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: "#0d0d1f", border: `1px solid ${C.border}`, color: "#e0e0f0", borderRadius: 8 }} />
                  <Legend formatter={(v) => <span style={{ color: "#888", fontSize: 11 }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ fontSize: ".7rem", color: "#555", textTransform: "uppercase", letterSpacing: ".8px", fontWeight: 700, marginBottom: 14 }}>📊 Pipeline de Fases</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={[
                  { name: "Fase 0", value: data.fase0 },
                  { name: "Fase 1", value: data.fase1 },
                  { name: "Fase 2", value: data.concluidos },
                ]}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.05)" />
                  <XAxis dataKey="name" tick={{ fill: "#666", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#666", fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "#0d0d1f", border: `1px solid ${C.border}`, color: "#e0e0f0", borderRadius: 8 }} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {["rgba(0,191,255,.7)", "rgba(180,74,255,.7)", "rgba(0,255,136,.7)"].map((color, i) => (
                      <Cell key={i} fill={color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ fontSize: ".7rem", color: "#555", textTransform: "uppercase", letterSpacing: ".8px", fontWeight: 700, marginBottom: 14 }}>💰 Top 20 Valores Liberados</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={ranking.slice(0, 20).map(r => ({ name: (r.nome || r.cpf).split(" ")[0], value: r.valor_liberado ?? 0 }))} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.04)" />
                  <XAxis type="number" tick={{ fill: "#666", fontSize: 10 }} tickFormatter={v => "R$" + fmt(v, 0)} />
                  <YAxis type="category" dataKey="name" width={60} tick={{ fill: "#888", fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "#0d0d1f", border: `1px solid ${C.border}`, color: "#e0e0f0", borderRadius: 8 }} formatter={(v) => [fmtBRL(Number(v)), "Valor"]} />
                  <Bar dataKey="value" fill="rgba(0,255,136,.6)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ fontSize: ".7rem", color: "#555", textTransform: "uppercase", letterSpacing: ".8px", fontWeight: 700, marginBottom: 14 }}>📈 Progresso Geral</div>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={[
                    { name: "Processados", value: processados },
                    { name: "Pendentes", value: Math.max(0, data.total - processados) },
                  ]} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} innerRadius={55}>
                    <Cell fill="rgba(180,74,255,.8)" />
                    <Cell fill="rgba(50,50,80,.5)" />
                  </Pie>
                  <Tooltip contentStyle={{ background: "#0d0d1f", border: `1px solid ${C.border}`, color: "#e0e0f0", borderRadius: 8 }} />
                  <Legend formatter={(v) => <span style={{ color: "#888", fontSize: 11 }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

      {tab === "tabela" && (
        <div style={card()}>
          <ResultsTable />
        </div>
      )}

      {tab === "workers" && (
        <WorkersLive
          workerStates={workerStates}
          events={wsEvents}
          runStartedAt={runStartedAt}
          isRunning={isRunning}
        />
      )}

      {tab === "cerebro" && (
        <CerebroIA
          stats={currentStats}
          leads={currentLeads}
          botStatus={liveStatus}
          workerStates={workerStates}
        />
      )}

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>

      {gamePhase && (
        <UploadGameProgress
          phase={gamePhase}
          inserted={gameInserted}
          total={gameTotal}
          workerStartFired={workerStartFired}
          onClose={() => setGamePhase(null)}
        />
      )}
    </div>
  );
}

export default Dashboard;
