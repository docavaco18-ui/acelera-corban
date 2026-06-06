import { useEffect, useState, useCallback } from "react";
import PresencaLeadsPanel from "../components/presenca/LeadsPanel";
import { presencaApi } from "../lib/api";
import { getAccessToken } from "../lib/supabase";

const C = {
  bg: "#0f172a", card: "#1e293b", border: "#334155",
  green: "#22c55e", red: "#ef4444", yellow: "#f59e0b",
  purple: "#6366f1", text: "#e2e8f0", muted: "#94a3b8",
};

type Stats = {
  total: number; elegiveis: number; inelegiveis: number;
  pendentes: number; erros: number; processados: number; total_liberado: number;
} | null;

type Batch = {
  id: string; name: string; status: string; created_at: string;
  total_processed?: number; total_elegiveis?: number; total_liberado?: number;
};

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

const statusColor: Record<string, string> = {
  concluida: C.green, processando: C.yellow, pendente: C.muted, cancelada: C.red,
};

export default function Presenca() {
  const [stats, setStats] = useState<Stats>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loadingStats, setLoadingStats] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryMsg, setRetryMsg] = useState<string | null>(null);
  const [retryOk, setRetryOk] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const refreshStats = useCallback(() => {
    setLoadingStats(true);
    Promise.allSettled([presencaApi.statsDashboard(), presencaApi.listBatches()])
      .then(([sRes, bRes]) => {
        const errs: string[] = [];
        if (sRes.status === "fulfilled") setStats(sRes.value);
        else errs.push(`stats: ${(sRes.reason as Error)?.message || "falha"}`);
        if (bRes.status === "fulfilled") setBatches(bRes.value || []);
        else errs.push(`batches: ${(bRes.reason as Error)?.message || "falha"}`);
        setLoadErr(errs.length ? errs.join(" | ") : null);
      })
      .finally(() => setLoadingStats(false));
  }, []);

  useEffect(() => {
    refreshStats();
    const t = setInterval(refreshStats, 30_000);
    return () => clearInterval(t);
  }, [refreshStats]);

  const handleRetry = useCallback(async () => {
    setRetrying(true);
    setRetryMsg(null);
    setRetryOk(false);
    try {
      const { resetados } = await presencaApi.retryErrors();
      setRetryMsg(`↺ ${resetados} leads recolocados na fila`);
      setRetryOk(true);
      refreshStats();
    } catch (e) {
      setRetryMsg(`Erro ao retentar: ${(e as Error)?.message || "falha"}`);
      setRetryOk(false);
    } finally {
      setRetrying(false);
    }
  }, [refreshStats]);

  const handleExport = useCallback(async () => {
    try {
      const token = await getAccessToken();
      const base = import.meta.env.VITE_API_URL || "";
      const url = `${base}/api/presenca/leads/export?status=elegivel`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const peek = (await blob.slice(0, 16).text()).trim();
      if (peek.startsWith('{"detail')) {
        const full = await blob.text();
        throw new Error(`Backend: ${full.slice(0, 200)}`);
      }
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = "presenca_elegiveis.csv";
      link.click();
      URL.revokeObjectURL(href);
      setLoadErr(null);
    } catch (e) {
      setLoadErr(`Export falhou: ${(e as Error)?.message || "falha"}`);
    }
  }, []);

  const statCards = [
    { label: "Elegíveis", value: stats?.elegiveis ?? "—", color: C.green },
    { label: "Inelegíveis", value: stats?.inelegiveis ?? "—", color: C.red },
    { label: "Pendentes", value: stats?.pendentes ?? "—", color: C.yellow },
    { label: "Erros", value: stats?.erros ?? "—", color: C.yellow },
    { label: "Total Liberado", value: stats ? fmtBRL(stats.total_liberado) : "—", color: C.purple },
  ];

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <h1 style={{ color: "#fff", fontSize: "1.4rem", fontWeight: 800, margin: 0 }}>
            🏦 Presença Bank — API REST
          </h1>
          <p style={{ color: C.muted, fontSize: 13, marginTop: 4, marginBottom: 0 }}>
            Higienização via API REST. Certifique-se que as credenciais estão em Configurações.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {retryMsg && (
            <span
              style={{
                fontSize: 12, fontWeight: 600,
                padding: "6px 10px", borderRadius: 6,
                color: retryOk ? C.green : C.red,
                border: `1px solid ${retryOk ? C.green : C.red}`,
                background: retryOk ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
              }}
            >
              {retryMsg}
            </span>
          )}
          <button
            onClick={handleRetry}
            disabled={retrying}
            style={{
              padding: "7px 12px", borderRadius: 8, border: `1px solid ${C.border}`,
              background: "transparent", color: retrying ? C.muted : C.yellow,
              fontSize: 12, fontWeight: 600, cursor: retrying ? "not-allowed" : "pointer",
            }}
          >
            {retrying ? "…" : "↺ Retentar Erros"}
          </button>
          <button
            onClick={handleExport}
            style={{
              padding: "7px 12px", borderRadius: 8, border: `1px solid ${C.border}`,
              background: "transparent", color: C.green,
              fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}
          >
            ⬇ Export Elegíveis CSV
          </button>
        </div>
      </div>

      {loadErr && (
        <div
          style={{
            marginTop: 14,
            padding: 12,
            borderRadius: 8,
            border: `1px solid ${C.red}`,
            background: "rgba(239,68,68,0.10)",
            color: C.red,
            fontSize: 13, fontWeight: 600,
            display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
          }}
        >
          <span>⚠ {loadErr}</span>
          <button
            onClick={() => setLoadErr(null)}
            style={{
              background: "transparent", border: "none", color: C.red,
              fontSize: 16, fontWeight: 700, cursor: "pointer", padding: 0,
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Stats cards */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24, marginTop: 20, flexWrap: "wrap" }}>
        {statCards.map((c) => (
          <div
            key={c.label}
            style={{
              flex: "1 1 140px", background: C.card, border: `1px solid ${C.border}`,
              borderRadius: 10, padding: "14px 18px",
            }}
          >
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
              {c.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: c.color }}>
              {loadingStats && stats === null ? "…" : c.value}
            </div>
          </div>
        ))}
      </div>

      {/* Leads panel */}
      <PresencaLeadsPanel onStatsRefresh={refreshStats} />

      {/* Batch history */}
      {batches.length > 0 && (
        <div style={{ marginTop: 24, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
          <h2 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700, color: C.text }}>
            Histórico de Batches
          </h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ color: C.muted, textAlign: "left" }}>
                  {["Nome", "Status", "Processados", "Elegíveis", "Total Liberado", "Data"].map((h) => (
                    <th key={h} style={{ padding: "6px 10px", borderBottom: `1px solid ${C.border}`, fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "8px 10px", color: C.text }}>{b.name || b.id.slice(0, 8)}</td>
                    <td style={{ padding: "8px 10px" }}>
                      <span style={{ color: statusColor[b.status] || C.muted, fontWeight: 600, textTransform: "capitalize" }}>
                        {b.status}
                      </span>
                    </td>
                    <td style={{ padding: "8px 10px", color: C.muted }}>{b.total_processed ?? "—"}</td>
                    <td style={{ padding: "8px 10px", color: C.green, fontWeight: 600 }}>{b.total_elegiveis ?? "—"}</td>
                    <td style={{ padding: "8px 10px", color: C.purple, fontWeight: 600 }}>
                      {b.total_liberado != null ? fmtBRL(b.total_liberado) : "—"}
                    </td>
                    <td style={{ padding: "8px 10px", color: C.muted, fontFamily: "monospace", fontSize: 12 }}>
                      {fmtDate(b.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
