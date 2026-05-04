import { useEffect, useRef, useState } from "react";
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

function BatchRow({ batch, onRenamed, onDeleted }: {
  batch: Batch;
  onRenamed: (id: string, name: string) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(batch.name);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pill = STATUS_PILL[batch.status] ?? STATUS_PILL.pendente;

  const startEdit = () => {
    setEditName(batch.name);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 30);
  };

  const saveEdit = async () => {
    const name = editName.trim();
    if (!name || name === batch.name) { setEditing(false); return; }
    setSaving(true);
    try {
      await batchesApi.rename(batch.id, name);
      onRenamed(batch.id, name);
    } catch {}
    setSaving(false);
    setEditing(false);
  };

  const handleDelete = async () => {
    if (!confirm(`Apagar base "${batch.name}" e todos os seus leads? Esta ação não pode ser desfeita.`)) return;
    try {
      await batchesApi.delete(batch.id);
      onDeleted(batch.id);
    } catch (e: any) {
      alert(e?.response?.data?.detail ?? "Erro ao apagar base");
    }
  };

  return (
    <tr style={{ borderTop: `1px solid ${C.border}` }}>
      <td style={td}>
        {editing ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              ref={inputRef}
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditing(false); }}
              style={{ padding: "4px 8px", background: "#0d0d1f", border: `1px solid ${C.purple}`, borderRadius: 6, color: "#fff", fontSize: ".85rem", width: 200 }}
            />
            <button onClick={saveEdit} disabled={saving} style={smallBtn(C.green)}>{saving ? "…" : "✓"}</button>
            <button onClick={() => setEditing(false)} style={smallBtn("#666")}>✕</button>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#cbd5e1" }}>{batch.name}</span>
            <button onClick={startEdit} style={{ background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: ".75rem", padding: "2px 4px" }} title="Renomear">✏️</button>
          </div>
        )}
      </td>
      <td style={td}>
        <span style={{ padding: "3px 10px", borderRadius: 12, background: pill.bg, color: pill.color, fontSize: ".7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: .4 }}>
          {pill.label}
        </span>
      </td>
      <td style={tdRight}>{fmtN(batch.total_leads)}</td>
      <td style={{ ...tdRight, color: C.green, fontWeight: 700 }}>{fmtN(batch.total_elegiveis)}</td>
      <td style={{ ...tdRight, color: C.gold, fontWeight: 700 }}>{fmtBRL(Number(batch.total_liberado) || 0)}</td>
      <td style={td}>{fmtDate(batch.created_at)}</td>
      <td style={td}>{fmtDate(batch.finished_at)}</td>
      <td style={{ ...td, display: "flex", gap: 8, alignItems: "center" }}>
        <Link to={`/higienizacao?batch=${batch.id}`} style={{ color: C.purple, fontSize: ".78rem", textDecoration: "none", fontWeight: 700 }}>
          ver →
        </Link>
        <button onClick={handleDelete} style={smallBtn(C.red)} title="Apagar base e leads">🗑</button>
      </td>
    </tr>
  );
}

export default function DashboardAgregado() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [agg, setAgg] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    Promise.all([
      batchesApi.list().catch(() => [] as Batch[]),
      statsApi.dashboard().catch(() => null),
    ]).then(([b, s]) => {
      setBatches(b);
      setAgg(s);
      setLoading(false);
    });
  };

  useEffect(() => { load(); }, []);

  const handleRenamed = (id: string, name: string) =>
    setBatches(prev => prev.map(b => b.id === id ? { ...b, name } : b));

  const handleDeleted = (id: string) =>
    setBatches(prev => prev.filter(b => b.id !== id));

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

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ fontSize: "1.05rem", color: "#fff", margin: 0 }}>📦 Histórico de bases</h2>
        <button onClick={load} style={{ background: "transparent", color: "#666", border: `1px solid ${C.border}`, borderRadius: 14, padding: "5px 12px", fontSize: ".75rem", cursor: "pointer" }}>↻ Atualizar</button>
      </div>
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
            {batches.map(b => (
              <BatchRow key={b.id} batch={b} onRenamed={handleRenamed} onDeleted={handleDeleted} />
            ))}
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
const smallBtn = (color: string): React.CSSProperties => ({
  padding: "3px 8px", borderRadius: 8, border: `1px solid ${color}44`,
  background: `${color}12`, color, fontSize: ".72rem", cursor: "pointer", fontWeight: 700,
});

function Card({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px" }}>
      <div style={{ fontSize: ".7rem", color: "#64748b", textTransform: "uppercase", letterSpacing: .8, fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: "1.6rem", fontWeight: 800, color, lineHeight: 1.1 }}>{value}</div>
    </div>
  );
}
