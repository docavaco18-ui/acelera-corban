import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { batchesApi, statsApi, broadcastApi, aesirApi, chipcareApi } from "../lib/api";
import type { Batch, DashboardStats } from "../lib/types";
import { C, G, glassCard, sectionTitle, SHARED_CSS } from "../components/disparo-shared";

const fmtBRL = (v: number) =>
  "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtN = (n: number) => Number(n).toLocaleString("pt-BR");
const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

const STATUS_PILL: Record<Batch["status"], { label: string; color: string; bg: string }> = {
  pendente:    { label: "Pendente",    color: "#f59e0b",  bg: "rgba(245,158,11,.12)" },
  processando: { label: "Processando", color: "#06b6d4",  bg: "rgba(6,182,212,.12)" },
  concluida:   { label: "Concluída",   color: "#10b981",  bg: "rgba(16,185,129,.12)" },
  cancelada:   { label: "Cancelada",   color: "#475569",  bg: "rgba(71,85,105,.12)" },
};

interface DispatchStats {
  total: number;
  running: number;
  done: number;
  totalSent: number;
  totalLeads: number;
  sources: { name: string; color: string; total: number; sent: number }[];
}

function KpiCard({ label, value, sub, color, icon }: {
  label: string; value: string; sub?: string; color: string; icon: string;
}) {
  return (
    <div className="spot-card" style={{
      ...glassCard(color, 20),
      display: "flex", flexDirection: "column", gap: 6,
      "--spot-color": color.match(/#[0-9a-f]{6}/i)?.[0] ?? "#7c3aed",
    } as React.CSSProperties}>
      <div className="spot-glow" /><div className="spot-shine" />
      <div style={{ fontSize: 20 }}>{icon}</div>
      <div style={{ fontSize: 22, fontWeight: 900, color: "#f1f5f9", lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.sec, textTransform: "uppercase", letterSpacing: ".08em" }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: C.muted }}>{sub}</div>}
    </div>
  );
}

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
    <tr className="spot-row" style={{ borderTop: "1px solid rgba(255,255,255,.05)" }}>
      <td style={td}>
        {editing ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              ref={inputRef}
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditing(false); }}
              style={{ padding: "4px 8px", background: "rgba(255,255,255,.06)", border: "1px solid rgba(124,58,237,.4)", borderRadius: 6, color: "#fff", fontSize: ".85rem", width: 200, outline: "none" }}
            />
            <button onClick={saveEdit} disabled={saving} style={smallBtn("#10b981")}>{saving ? "…" : "✓"}</button>
            <button onClick={() => setEditing(false)} style={smallBtn("#475569")}>✕</button>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#cbd5e1" }}>{batch.name}</span>
            <button onClick={startEdit} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: ".75rem", padding: "2px 4px" }} title="Renomear">✏️</button>
          </div>
        )}
      </td>
      <td style={td}>
        <span style={{ padding: "3px 10px", borderRadius: 8, background: pill.bg, color: pill.color, fontSize: ".7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: .4 }}>
          {pill.label}
        </span>
      </td>
      <td style={tdRight}>{fmtN(batch.total_leads)}</td>
      <td style={{ ...tdRight, color: "#10b981", fontWeight: 700 }}>{fmtN(batch.total_elegiveis)}</td>
      <td style={{ ...tdRight, color: "#f59e0b", fontWeight: 700 }}>{fmtBRL(Number(batch.total_liberado) || 0)}</td>
      <td style={td}>{fmtDate(batch.created_at)}</td>
      <td style={td}>{fmtDate(batch.finished_at)}</td>
      <td style={{ ...td, display: "flex", gap: 8, alignItems: "center" }}>
        <Link to={`/higienizacao?batch=${batch.id}`} style={{ color: "#a78bfa", fontSize: ".78rem", textDecoration: "none", fontWeight: 700 }}>
          ver →
        </Link>
        <button onClick={handleDelete} style={smallBtn("#ef4444")} title="Apagar base e leads">🗑</button>
      </td>
    </tr>
  );
}

export default function DashboardAgregado() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [agg, setAgg] = useState<DashboardStats | null>(null);
  const [dispatchStats, setDispatchStats] = useState<DispatchStats | null>(null);
  const [loading, setLoading] = useState(true);

  const loadDispatchStats = async () => {
    try {
      const [vendeaiRes, aesirRes, chipcareRes] = await Promise.allSettled([
        broadcastApi.listDispatches().then(r => r.data || []).catch(() => []),
        aesirApi.listDispatches().catch(() => []),
        chipcareApi.listDispatches().catch(() => []),
      ]);

      const vendeai = vendeaiRes.status === "fulfilled" ? vendeaiRes.value as any[] : [];
      const aesir   = aesirRes.status   === "fulfilled" ? aesirRes.value   as any[] : [];
      const chipcare= chipcareRes.status=== "fulfilled" ? chipcareRes.value as any[] : [];

      const calcSent = (ds: any[], sentField = "sent_count") =>
        ds.reduce((s, d) => {
          const asns = d.broadcast_dispatch_assignments || d.assignments || [];
          if (asns.length) return s + asns.reduce((a: number, x: any) => a + (x.sent_count || 0), 0);
          return s + (d[sentField] || 0);
        }, 0);

      const calcLeads = (ds: any[]) => ds.reduce((s, d) => s + (d.total_leads || 0), 0);

      const isRunning = (d: any) => d.status === "running" || d.status === "active";
      const isDone = (d: any) => d.status === "done" || d.status === "finished" || d.status === "completed" || d.status === "revoked";

      const allDispatches = [...vendeai, ...aesir, ...chipcare];
      const stats: DispatchStats = {
        total:      allDispatches.length,
        running:    allDispatches.filter(isRunning).length,
        done:       allDispatches.filter(isDone).length,
        totalSent:  calcSent(vendeai) + calcSent(aesir, "sent_count") + calcSent(chipcare, "sent_count"),
        totalLeads: calcLeads(allDispatches),
        sources: [
          { name: "VendeAI", color: "#7c3aed", total: vendeai.length, sent: calcSent(vendeai) },
          { name: "Aesir",   color: "#06b6d4", total: aesir.length,   sent: calcSent(aesir) },
          { name: "Chipcare",color: "#10b981", total: chipcare.length, sent: calcSent(chipcare) },
        ].filter(s => s.total > 0),
      };
      setDispatchStats(stats);
    } catch {/* ignore */}
  };

  const load = () => {
    Promise.all([
      batchesApi.list().catch(() => [] as Batch[]),
      statsApi.dashboard().catch(() => null),
    ]).then(([b, s]) => {
      setBatches(b);
      setAgg(s);
      setLoading(false);
    });
    loadDispatchStats();
  };

  useEffect(() => { load(); }, []);

  const handleRenamed = (id: string, name: string) =>
    setBatches(prev => prev.map(b => b.id === id ? { ...b, name } : b));

  const handleDeleted = (id: string) =>
    setBatches(prev => prev.filter(b => b.id !== id));

  if (loading) {
    return <div style={{ padding: 40, color: "#94a3b8", background: C.bg, minHeight: "100vh" }}>Carregando…</div>;
  }

  return (
    <div style={{ background: C.bg, minHeight: "100vh", padding: "28px 28px", color: C.text, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      <style>{SHARED_CSS}</style>

      {/* Hero header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 8 }}>
          <div style={{
            width: 44, height: 44, borderRadius: "50%",
            background: "linear-gradient(135deg,rgba(124,58,237,.3),rgba(6,182,212,.3))",
            border: "1.5px solid rgba(124,58,237,.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, flexShrink: 0,
          }}>📊</div>
          <div>
            <h1 style={{ ...sectionTitle(G.primary), fontSize: 22, marginBottom: 2 }}>Dashboard</h1>
            <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>
              Visão consolidada de higienização CLT + disparos WhatsApp
            </p>
          </div>
          <div style={{ marginLeft: "auto" }}>
            <button
              onClick={load}
              style={{
                background: "rgba(255,255,255,.04)", color: C.sec,
                border: "1px solid rgba(255,255,255,.08)", borderRadius: 8,
                padding: "6px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600,
              }}
            >↻ Atualizar</button>
          </div>
        </div>
      </div>

      {/* ── Higienização KPIs ──────────────────────────────────────────────── */}
      {agg && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <h2 style={{ ...sectionTitle("linear-gradient(135deg,#10b981,#06b6d4)"), fontSize: 13, marginBottom: 0 }}>
              Higienização CLT
            </h2>
            <div style={{ flex: 1, height: 1, background: "rgba(16,185,129,.2)" }} />
          </div>
          <div className="spot-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 28 }}>
            <KpiCard label="Total leads" value={fmtN(agg.total)}                     color={G.primary}  icon="📋" />
            <KpiCard label="Elegíveis"   value={fmtN(agg.elegiveis)}                 color={G.green}    icon="✅" sub={agg.total > 0 ? `${Math.round(agg.elegiveis/agg.total*100)}% da base` : undefined} />
            <KpiCard label="Liberado"    value={fmtBRL(agg.total_liberado || 0)}     color={G.yellow}   icon="💰" />
            <KpiCard label="Margem"      value={fmtBRL(agg.total_margem || 0)}       color={G.cyan}     icon="📈" />
            <KpiCard label="Inelegíveis" value={fmtN(agg.inelegiveis)}               color={G.purple}   icon="❌" />
            <KpiCard label="Processando" value={fmtN(agg.em_processamento)}          color={G.pink}     icon="⚡" />
          </div>
        </>
      )}

      {/* ── Disparo KPIs ──────────────────────────────────────────────────── */}
      {dispatchStats && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <h2 style={{ ...sectionTitle("linear-gradient(135deg,#7c3aed,#ec4899)"), fontSize: 13, marginBottom: 0 }}>
              Disparo WhatsApp
            </h2>
            <div style={{ flex: 1, height: 1, background: "rgba(124,58,237,.2)" }} />
          </div>

          <div className="spot-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 20 }}>
            <KpiCard label="Campanhas"   value={String(dispatchStats.total)}     color={G.primary} icon="📨" />
            <KpiCard label="Ativas"      value={String(dispatchStats.running)}   color={G.yellow}  icon="▶" sub={dispatchStats.running > 0 ? "rodando agora" : "nenhuma ativa"} />
            <KpiCard label="Concluídas"  value={String(dispatchStats.done)}      color={G.green}   icon="✅" />
            <KpiCard label="Total Leads" value={fmtN(dispatchStats.totalLeads)}  color={G.cyan}    icon="👥" />
            <KpiCard label="Enviadas"    value={fmtN(dispatchStats.totalSent)}   color={G.pink}    icon="📤" sub={dispatchStats.totalLeads > 0 ? `${Math.round(dispatchStats.totalSent/dispatchStats.totalLeads*100)}% dos leads` : undefined} />
          </div>

          {/* Per-source breakdown */}
          {dispatchStats.sources.length > 0 && (
            <div style={{ ...glassCard(G.purple, 16), marginBottom: 28 }}>
              <div style={{ fontSize: 11, color: C.sec, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 12 }}>Por plataforma</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }} className="spot-list">
                {dispatchStats.sources.map(src => {
                  const pct = dispatchStats.totalSent > 0 ? Math.round(src.sent / dispatchStats.totalSent * 100) : 0;
                  return (
                    <div key={src.name} className="spot-row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 8px", borderRadius: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: src.color, flexShrink: 0 }} />
                      <span style={{ color: C.text, fontWeight: 600, minWidth: 70, fontSize: 13 }}>{src.name}</span>
                      <span style={{ color: C.sec, fontSize: 12 }}>{src.total} campanha{src.total !== 1 ? "s" : ""}</span>
                      <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,.06)", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: src.color, borderRadius: 2, transition: "width .6s" }} />
                      </div>
                      <span style={{ color: src.color, fontWeight: 700, fontSize: 12, minWidth: 60, textAlign: "right" }}>{fmtN(src.sent)} env.</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Histórico de bases ─────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <h2 style={{ ...sectionTitle("linear-gradient(135deg,#f59e0b,#ef4444)"), fontSize: 13, marginBottom: 0 }}>
          Histórico de Bases
        </h2>
        <div style={{ flex: 1, height: 1, background: "rgba(245,158,11,.2)" }} />
      </div>
      <div style={{ ...glassCard(G.yellow, 0), overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".85rem" }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,.03)", color: C.muted, fontSize: ".68rem", textTransform: "uppercase", letterSpacing: ".08em" }}>
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
          <tbody className="spot-list">
            {batches.length === 0 && (
              <tr><td colSpan={8} style={{ padding: 28, textAlign: "center", color: C.muted }}>Nenhuma base ainda.</td></tr>
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
  padding: "3px 8px", borderRadius: 6, border: `1px solid ${color}44`,
  background: `${color}12`, color, fontSize: ".72rem", cursor: "pointer", fontWeight: 700,
});
