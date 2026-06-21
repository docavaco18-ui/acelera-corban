// frontend/src/pages/CentralUsuarios.tsx
import { useEffect, useState } from "react";
import { adminUsersMonitorApi } from "../lib/api";
import { C, G, glassCard, sectionTitle, btnStyle, SHARED_CSS, PulseDot } from "../components/disparo-shared";
import OverviewDashboard, { type Overview } from "../components/OverviewDashboard";

interface Pending { severity: string; label: string; detail: string }
interface UserSummary {
  owner_id: string; email: string | null; client_label: string;
  score: { score: number; status: string; label: string };
  bms: { connected: number; error: number; total: number };
  numbers: { total: number; healthy: number; warning: number; critical: number };
  quality: { green: number; yellow: number; red: number; unknown: number };
  capacity_today: number;
  templates: { approved: number; total: number } | null;
  crm: Record<string, string>;
  pending: Pending[];
  live: boolean; live_failed: boolean; error: boolean;
}
interface Aggregate {
  users_total: number; users_healthy: number; users_warning: number; users_critical: number;
  capacity_total: number; numbers_total: number; bms_total: number; generated_at: string;
}

const fmt = (n: number) => Number(n || 0).toLocaleString("pt-BR");
const colorFor = (s: string) => s === "ok" ? C.green : s === "warning" ? C.yellow : s === "critical" ? C.red : C.sec;

export default function CentralUsuarios() {
  const [agg, setAgg] = useState<Aggregate | null>(null);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError("");
    try {
      const d = await adminUsersMonitorApi.list();
      setAgg(d.aggregate); setUsers(d.users);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Falha ao carregar Central de Usuários");
    } finally { setLoading(false); }
  };
  const liveAll = async () => {
    setLive(true); setError("");
    try {
      const d = await adminUsersMonitorApi.refreshLiveAll();
      setAgg(d.aggregate); setUsers(d.users);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Falha na auditoria ao vivo");
    } finally { setLive(false); }
  };
  useEffect(() => { load(); }, []);

  if (loading && !agg) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, color: C.muted, padding: 32 }}>
        <style>{SHARED_CSS}</style>
        <div style={glassCard(G.primary, 32)}>
          <div style={{ ...sectionTitle(G.primary), marginBottom: 4, fontSize: 12 }}>Central de Usuários</div>
          <div style={{ color: C.text, fontSize: 18, fontWeight: 700 }}>Carregando clientes…</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text,
      fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", padding: '22px 24px 56px' }}>
      <style>{SHARED_CSS}</style>

      <div style={{ ...glassCard(G.primary, 28), marginBottom: 22, display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 40 }}>🧠</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...sectionTitle(G.primary), marginBottom: 6 }}>Central de Usuários</div>
          <h1 style={{ margin: 0, color: C.text, fontSize: 30, fontWeight: 800 }}>
            {fmt(agg?.users_total || 0)} clientes ·{' '}
            <span style={{ color: C.red }}>{fmt(agg?.users_critical || 0)} em risco</span>
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={load} disabled={loading} className="ds-btn" style={btnStyle(G.primary, loading)}>
            {loading ? 'Atualizando…' : '↻ Atualizar'}
          </button>
          <button onClick={liveAll} disabled={live} className="ds-btn" style={btnStyle(G.purple, live)}>
            {live ? 'Auditando ao vivo…' : '⚡ Auditar todos ao vivo'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ border: `1px solid ${C.red}55`, color: C.red, background: `${C.red}10`,
          borderRadius: 12, padding: 12, marginBottom: 18, fontSize: 13 }}>{error}</div>
      )}

      <section className="spot-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 14, marginBottom: 18 }}>
        <Kpi label="Clientes saudáveis" value={agg?.users_healthy || 0} color={C.green} icon="✅" />
        <Kpi label="Em risco crítico" value={agg?.users_critical || 0} color={C.red} icon="🚨" />
        <Kpi label="Capacidade total/dia" value={agg?.capacity_total || 0} color={C.yellow} icon="🚀" />
        <Kpi label="Números conectados" value={agg?.numbers_total || 0} color="#7c3aed" icon="📱" />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
        {users.map((u) => (
          <UserCard key={u.owner_id} u={u} onOpen={() => setOpenId(u.owner_id)} />
        ))}
      </section>

      {openId && <DetailDrawer ownerId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function Kpi({ label, value, color, icon }: { label: string; value: number; color: string; icon: string }) {
  return (
    <div className="spot-card" style={{ background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.06)',
      borderRadius: 14, padding: 18, position: 'relative', overflow: 'hidden', '--spot-color': color } as any}>
      <div className="spot-glow" /><div className="spot-shine" />
      <div style={{ color: C.sec, fontSize: 11, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 8 }}>{icon} {label}</div>
      <div style={{ color, fontSize: 30, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{fmt(value)}</div>
    </div>
  );
}

function UserCard({ u, onOpen }: { u: UserSummary; onOpen: () => void }) {
  const color = colorFor(u.score.status);
  return (
    <div className="spot-card" onClick={onOpen} style={{ background: 'rgba(255,255,255,.02)',
      border: `1px solid ${color}33`, borderRadius: 16, padding: 18, cursor: 'pointer', position: 'relative',
      overflow: 'hidden', '--spot-color': color } as any}>
      <div className="spot-glow" /><div className="spot-shine" />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: C.text, fontSize: 15, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.client_label}</div>
          <div style={{ color: C.sec, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email}</div>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999,
          color, background: `${color}14`, border: `1px solid ${color}55`, fontSize: 13, fontWeight: 900 }}>
          <PulseDot color={color} />{u.score.score}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
        <Mini label="BMs" value={`${u.bms.connected}/${u.bms.total}`} />
        <Mini label="Números" value={`${u.numbers.healthy}/${u.numbers.total}`} />
        <Mini label="Cap/dia" value={fmt(u.capacity_today)} />
        <Mini label="Templates" value={u.templates ? `${u.templates.approved}` : '—'} />
        <Mini label="🟢🟡🔴" value={`${u.quality.green}·${u.quality.yellow}·${u.quality.red}`} />
        <Mini label="Live" value={u.live ? (u.live_failed ? '⚠' : '✓') : '—'} />
      </div>
      {u.pending.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {u.pending.slice(0, 4).map((p, i) => (
            <span key={i} style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
              color: colorFor(p.severity), background: `${colorFor(p.severity)}14`, border: `1px solid ${colorFor(p.severity)}44` }}>{p.label}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 10, padding: '8px 10px' }}>
      <div style={{ color: C.sec, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
      <div style={{ color: C.text, fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function DetailDrawer({ ownerId, onClose }: { ownerId: string; onClose: () => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const load = async (liveMeta = false) => {
    setLoading(true);
    try { setData(await adminUsersMonitorApi.detail(ownerId, liveMeta)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(false); }, [ownerId]);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 1000, overflow: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1280, margin: '24px auto', position: 'relative' }}>
        <button onClick={onClose} className="ds-btn" style={{ ...btnStyle(G.red), position: 'sticky', top: 12, left: 12, zIndex: 2, margin: 12 }}>✕ Fechar</button>
        {loading && !data
          ? <div style={{ color: C.muted, padding: 40 }}>Carregando detalhe…</div>
          : data && <OverviewDashboard data={data} loading={loading} onRefresh={() => load(false)} onLiveAudit={() => load(true)} title="Central de Usuários · detalhe" />}
      </div>
    </div>
  );
}
