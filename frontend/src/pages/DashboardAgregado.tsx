import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { batchesApi, statsApi } from "../lib/api";
import type { Batch, DashboardStats } from "../lib/types";

const C = {
  bg: "#080818",
  bg2: "rgba(255,255,255,.04)",
  border: "rgba(255,255,255,.07)",
  green: "#00ff88",
  red: "#ff2d78",
  blue: "#00bfff",
  purple: "#b44aff",
  gold: "#ffd700",
};

const fmtBRL = (v: number) =>
  "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtN = (n: number) => Number(n).toLocaleString("pt-BR");
const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

const STATUS_PILL: Record<Batch["status"], { label: string; color: string; bg: string }> = {
  pendente:    { label: "Pendente",    color: C.gold,   bg: "rgba(255,215,0,.12)" },
  processando: { label: "Processando", color: C.blue,   bg: "rgba(0,191,255,.12)" },
  concluida:   { label: "Concluída",   color: C.green,  bg: "rgba(0,255,136,.12)" },
  cancelada:   { label: "Cancelada",   color: "#888",   bg: "rgba(136,136,136,.12)" },
};

export default function DashboardAgregado() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [agg, setAgg] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([
      batchesApi.list().catch(() => []),
      statsApi.dashboard().catch(() => null),
    ]).then(([b, s]) => {
      if (!alive) return;
      setBatches(b);
      setAgg(s);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  if (loading) {
    return <div style={{ padding: 40, color: "#94a3b8" }}>Carregando…</div>;
  }

  return (
    <div style={{ background: C.bg, minHeight: "100vh", padding: "24px 28px", color: "#e0e0f0", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#fff", marginBottom: 8 }}>📊 Dashboard Agregado</h1>
      <p style={{ color: "#64748b", fontSize: ".88rem", marginBottom: 22 }}>
        Soma de todas as bases já processadas + histórico de uploads.
      </p>

      {agg && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 24 }}>
          <Card label="Total leads" value={fmtN(agg.total)} color="#fff" />
          <Card label="Elegíveis" value={fmtN(agg.elegiveis)} color={C.green} />
          <Card label="Total liberado" value={fmtBRL(agg.total_liberado || 0)} color={C.gold} />
          <Card label="Margem" value={fmtBRL(agg.total_margem || 0)} color={C.blue} />
          <Card label="Inelegíveis" value={fmtN(agg.inelegiveis)} color="#888" />
          <Card label="Em processamento" value={fmtN(agg.em_processamento)} color={C.purple} />
        </div>
      )}

      <h2 style={{ fontSize: "1.05rem", color: "#fff", marginBottom: 12 }}>📦 Histórico de bases</h2>
      <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".85rem" }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,.03)", color: "#94a3b8", fontSize: ".7rem", textTransform: "uppercase", letterSpacing: 1 }}>
              <th style={th}>Nome</th>
              <th style={th}>Status</th>
              <th style={thRight}>Leads</th>
              <th style={thRight}>Elegíveis</th>
              <th style={thRight}>Liberado</th>
              <th style={th}>Criada</th>
              <th style={th}>Concluída</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {batches.length === 0 && (
              <tr><td colSpan={8} style={{ padding: 24, textAlign: "center", color: "#64748b" }}>Nenhuma base ainda.</td></tr>
            )}
            {batches.map(b => {
              const pill = STATUS_PILL[b.status] ?? STATUS_PILL.pendente;
              return (
                <tr key={b.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={td}>{b.name}</td>
                  <td style={td}>
                    <span style={{ padding: "3px 10px", borderRadius: 12, background: pill.bg, color: pill.color, fontSize: ".7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: .4 }}>
                      {pill.label}
                    </span>
                  </td>
                  <td style={tdRight}>{fmtN(b.total_leads)}</td>
                  <td style={{ ...tdRight, color: C.green, fontWeight: 700 }}>{fmtN(b.total_elegiveis)}</td>
                  <td style={{ ...tdRight, color: C.gold, fontWeight: 700 }}>{fmtBRL(Number(b.total_liberado) || 0)}</td>
                  <td style={td}>{fmtDate(b.created_at)}</td>
                  <td style={td}>{fmtDate(b.finished_at)}</td>
                  <td style={td}>
                    <Link to={`/higienizacao?batch=${b.id}`} style={{ color: C.purple, fontSize: ".78rem", textDecoration: "none" }}>
                      ver →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: "10px 14px", textAlign: "left", fontWeight: 700 };
const thRight: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = { padding: "12px 14px", color: "#cbd5e1" };
const tdRight: React.CSSProperties = { ...td, textAlign: "right" };

function Card({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px" }}>
      <div style={{ fontSize: ".7rem", color: "#64748b", textTransform: "uppercase", letterSpacing: .8, fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: "1.6rem", fontWeight: 800, color, lineHeight: 1.1 }}>{value}</div>
    </div>
  );
}
