import { useEffect, useRef, useState } from "react";
import { chatwootApi } from "../lib/api";

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

const fmtN = (n: number) => Number(n || 0).toLocaleString("pt-BR");
const fmtPct = (n: number | null | undefined) => (n == null ? "—" : `${Number(n).toFixed(1)}%`);
const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

const BUCKET_LABEL: Record<string, { label: string; color: string }> = {
  respondeu:                 { label: "Respondeu",                color: C.green },
  visualizou_sem_responder:  { label: "Visualizou sem responder", color: C.gold },
  conversa_sem_msg:          { label: "Conversa sem msg",         color: C.blue },
  nunca_contatado:           { label: "Nunca contatado",          color: "#888" },
  nao_sincronizado:          { label: "Não sincronizado",         color: "#444" },
};


function SettingsModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [url, setUrl] = useState("");
  const [accId, setAccId] = useState("");
  const [token, setToken] = useState("");
  const [inboxIds, setInboxIds] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    chatwootApi.getSettings().then(s => {
      if (s.configured) {
        setUrl(s.chatwoot_url || "");
        setAccId(s.account_id || "");
        setInboxIds(s.inbox_ids || "");
      }
      setLoaded(true);
    });
  }, []);

  const save = async () => {
    if (!url || !accId) {
      alert("URL e Account ID são obrigatórios");
      return;
    }
    setSaving(true);
    try {
      await chatwootApi.putSettings({ chatwoot_url: url, account_id: accId, api_token: token || undefined, inbox_ids: inboxIds || null });
      onSaved();
      onClose();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Erro ao salvar");
    }
    setSaving(false);
  };

  if (!loaded) return null;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#111127", border: `1px solid ${C.border}`, borderRadius: 14, padding: 24, width: 480, maxWidth: "90vw" }}>
        <h2 style={{ color: "#fff", margin: 0, marginBottom: 16 }}>⚙️ Configurar Chatwoot</h2>
        <Field label="URL (sem /app/...)" value={url} onChange={setUrl} placeholder="https://crm.exemplo.com.br" />
        <Field label="Account ID" value={accId} onChange={setAccId} placeholder="6927" />
        <Field
          label={url && accId ? "API Token (deixe em branco pra manter o atual)" : "API Token"}
          value={token} onChange={setToken}
          placeholder={url && accId ? "•••••••• (já salvo)" : "cole o token aqui"}
          type="password"
        />
        <Field label="Inbox IDs (opcional)" value={inboxIds} onChange={setInboxIds} placeholder="separados por vírgula" />
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
          <button onClick={onClose} style={btn("#666", "transparent")}>Cancelar</button>
          <button onClick={save} disabled={saving} style={btn(C.purple, `${C.purple}22`)}>{saving ? "Salvando..." : "Salvar"}</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }: any) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: "block", color: "#94a3b8", fontSize: ".75rem", textTransform: "uppercase", marginBottom: 4, fontWeight: 700, letterSpacing: .4 }}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: "100%", padding: "8px 12px", background: "#0d0d1f", border: `1px solid ${C.border}`, borderRadius: 8, color: "#fff", fontSize: ".88rem", boxSizing: "border-box" }} />
    </div>
  );
}


export default function Chatwoot() {
  const [settings, setSettings] = useState<any>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [metrics, setMetrics] = useState<any>(null);
  const [leads, setLeads] = useState<any[]>([]);
  const [syncStatus, setSyncStatus] = useState<any>(null);
  const [filters, setFilters] = useState<{ bucket?: string; status_v8?: string; label?: string }>({});
  const [labelOpts, setLabelOpts] = useState<{ label: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const pollRef = useRef<number | null>(null);

  const refreshAll = async () => {
    const [s, m, l, st, labs] = await Promise.all([
      chatwootApi.getSettings().catch(() => null),
      chatwootApi.metrics().catch(() => null),
      chatwootApi.leads({ ...filters, limit: 100 }).catch(() => ({ leads: [] })),
      chatwootApi.syncStatus().catch(() => null),
      chatwootApi.labels().catch(() => []),
    ]);
    setSettings(s);
    setMetrics(m);
    setLeads(l.leads || []);
    setSyncStatus(st);
    setLabelOpts(labs);
    setLoading(false);
  };

  useEffect(() => { refreshAll(); }, []);
  useEffect(() => {
    chatwootApi.leads({ ...filters, limit: 100 }).then(r => setLeads(r.leads || []));
  }, [filters]);

  // Polling enquanto sincronizando
  useEffect(() => {
    const isRunning = syncStatus?.status === "running";
    if (isRunning && !pollRef.current) {
      pollRef.current = window.setInterval(async () => {
        const st = await chatwootApi.syncStatus().catch(() => null);
        setSyncStatus(st);
        if (st && st.status !== "running") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setSyncing(false);
          refreshAll();
        }
      }, 5000);
    }
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [syncStatus?.status]);

  const startSync = async () => {
    if (!settings?.configured) {
      alert("Configure o Chatwoot antes (botão ⚙️)");
      return;
    }
    if (!confirm("Iniciar sync? Pode demorar 30-60 min se for a primeira vez.")) return;
    setSyncing(true);
    try {
      const r = await chatwootApi.startSync();
      setSyncStatus({ ...r, started_at: new Date().toISOString() });
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Erro ao iniciar sync");
      setSyncing(false);
    }
  };

  if (loading) return <div style={{ padding: 40, color: "#94a3b8" }}>Carregando…</div>;

  const isRunning = syncStatus?.status === "running" || syncing;
  const bc = metrics?.bucket_counts || {};
  const total = metrics?.total_leads || 0;

  return (
    <div style={{ background: C.bg, minHeight: "100vh", padding: "24px 28px", color: "#e0e0f0", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} onSaved={refreshAll} />}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#fff", margin: 0 }}>Disparo Chatwoot</h1>
          <p style={{ color: "#64748b", fontSize: ".88rem", margin: "4px 0 0 0" }}>
            Cruzamento dos leads higienizados com as conversas no CRM.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => setShowSettings(true)} style={btn("#94a3b8", "transparent")}>
            ⚙️ Configurar
          </button>
          <button onClick={startSync} disabled={isRunning || !settings?.configured} style={btn(C.purple, `${C.purple}22`)}>
            {isRunning ? "🔄 Sincronizando…" : "↻ Sincronizar agora"}
          </button>
        </div>
      </div>

      {/* Status do sync */}
      {syncStatus && (
        <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 16px", marginBottom: 18, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontSize: ".85rem" }}>
            {syncStatus.never_synced ? (
              <span style={{ color: "#94a3b8" }}>Nunca sincronizado.</span>
            ) : (
              <>
                <span style={{ color: "#94a3b8" }}>Última sync: </span>
                <span style={{ color: "#fff", fontWeight: 700 }}>{fmtDate(syncStatus.started_at)}</span>
                <span style={{ color: "#64748b", marginLeft: 10 }}>·</span>
                <span style={{ color: pillColor(syncStatus.status), fontWeight: 700, marginLeft: 10 }}>
                  {syncStatus.status}
                </span>
                {syncStatus.total_responded != null && (
                  <span style={{ color: "#64748b", marginLeft: 10 }}>
                    · {fmtN(syncStatus.total_matched || 0)} matches · {fmtN(syncStatus.total_responded)} respondeu
                  </span>
                )}
                {syncStatus.error && (
                  <div style={{ color: C.red, fontSize: ".75rem", marginTop: 4 }}>Erro: {syncStatus.error}</div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Cards de buckets */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 22 }}>
        <Card label="Total leads" value={fmtN(total)} color="#fff" />
        <Card label="🟢 Respondeu" value={fmtN(bc.respondeu || 0)} sub={fmtPct(metrics?.taxa_resposta_pct)} color={C.green} />
        <Card label="🟡 Visualizou s/ resp." value={fmtN(bc.visualizou_sem_responder || 0)} color={C.gold} />
        <Card label="🔵 Conversa sem msg" value={fmtN(bc.conversa_sem_msg || 0)} color={C.blue} />
        <Card label="⚫ Nunca contatado" value={fmtN(bc.nunca_contatado || 0)} color="#888" />
        <Card label="⏱ Tempo médio resp." value={metrics?.tempo_resposta?.media_h ? `${metrics.tempo_resposta.media_h}h` : "—"} color={C.purple} />
      </div>

      {/* Por status V8 */}
      {metrics?.by_status_v8 && (
        <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px", marginBottom: 18 }}>
          <h3 style={{ color: "#fff", fontSize: ".95rem", margin: 0, marginBottom: 10 }}>📊 Taxa de resposta por status V8</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
            {Object.entries(metrics.by_status_v8 as Record<string, any>)
              .sort((a, b) => b[1].total - a[1].total)
              .map(([st, v]: any) => {
                const pct = v.total ? (v.respondeu / v.total) * 100 : 0;
                return (
                  <div key={st} style={{ background: "rgba(255,255,255,.03)", borderRadius: 8, padding: "8px 12px" }}>
                    <div style={{ color: "#94a3b8", fontSize: ".7rem", textTransform: "uppercase", fontWeight: 700 }}>{st}</div>
                    <div style={{ color: "#fff", fontSize: "1rem", fontWeight: 700 }}>{fmtN(v.respondeu)} <span style={{ color: "#64748b", fontSize: ".75rem", fontWeight: 400 }}>/ {fmtN(v.total)}</span></div>
                    <div style={{ color: pct > 10 ? C.green : pct > 3 ? C.gold : "#888", fontSize: ".75rem", fontWeight: 700 }}>{pct.toFixed(1)}%</div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ color: "#94a3b8", fontSize: ".75rem", fontWeight: 700, textTransform: "uppercase" }}>Filtros:</span>
        <select value={filters.bucket || ""} onChange={e => setFilters({ ...filters, bucket: e.target.value || undefined })} style={selectStyle}>
          <option value="">Todos buckets</option>
          {Object.entries(BUCKET_LABEL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={filters.status_v8 || ""} onChange={e => setFilters({ ...filters, status_v8: e.target.value || undefined })} style={selectStyle}>
          <option value="">Todos status V8</option>
          {["elegivel", "inelegivel", "autorizado", "consentido", "aguardando_resultado", "pendente", "erro"].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.label || ""} onChange={e => setFilters({ ...filters, label: e.target.value || undefined })} style={selectStyle}>
          <option value="">Todas tags Chatwoot</option>
          {labelOpts.map(l => <option key={l.label} value={l.label}>{l.label} ({l.count})</option>)}
        </select>
        {labelOpts.length === 0 && (
          <span style={{ color: "#64748b", fontSize: ".7rem" }}>(sem tags ainda — sincronize pra popular)</span>
        )}
      </div>

      {/* Tabela */}
      <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "auto", maxHeight: "60vh" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".82rem" }}>
          <thead style={{ position: "sticky", top: 0, background: "#101025", zIndex: 1 }}>
            <tr style={{ color: "#94a3b8", fontSize: ".7rem", textTransform: "uppercase", letterSpacing: 1 }}>
              <th style={th}>Nome</th>
              <th style={th}>Telefone</th>
              <th style={th}>Status V8</th>
              <th style={th}>Bucket</th>
              <th style={th}>Conversa</th>
              <th style={th}>Canal</th>
              <th style={th}>Tags</th>
              <th style={thRight}>Out / In</th>
              <th style={th}>Última msg</th>
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 && (
              <tr><td colSpan={9} style={{ padding: 24, textAlign: "center", color: "#64748b" }}>
                {settings?.configured ? "Nenhum lead com esses filtros. Roda o sync se ainda não fez." : "Configure o Chatwoot pra começar."}
              </td></tr>
            )}
            {leads.map((l) => {
              const b = BUCKET_LABEL[l.bucket] || BUCKET_LABEL.nao_sincronizado;
              return (
                <tr key={l.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={td}>{l.nome || "—"}</td>
                  <td style={td}>{l.telefone || "—"}</td>
                  <td style={td}><span style={{ color: "#cbd5e1", fontSize: ".75rem" }}>{l.status}</span></td>
                  <td style={td}>
                    <span style={{ padding: "2px 8px", borderRadius: 10, background: `${b.color}22`, color: b.color, fontSize: ".7rem", fontWeight: 700 }}>{b.label}</span>
                  </td>
                  <td style={td}><span style={{ color: "#94a3b8", fontSize: ".75rem" }}>{l.status_conversa || "—"}</span></td>
                  <td style={td}><span style={{ color: "#94a3b8", fontSize: ".75rem" }}>{l.canal || "—"}</span></td>
                  <td style={td}>
                    {l.labels ? (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {String(l.labels).split(",").map((t: string) => (
                          <span key={t} style={{ padding: "1px 6px", borderRadius: 8, background: "rgba(180,74,255,.18)", color: C.purple, fontSize: ".68rem", fontWeight: 700, textTransform: "uppercase" }}>{t.trim()}</span>
                        ))}
                      </div>
                    ) : <span style={{ color: "#444", fontSize: ".75rem" }}>—</span>}
                  </td>
                  <td style={tdRight}>{l.n_msgs_outgoing != null ? `${l.n_msgs_outgoing} / ${l.n_msgs_incoming}` : "—"}</td>
                  <td style={td}>{fmtDate(l.ultima_incoming_at || l.ultima_outgoing_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ color: "#64748b", fontSize: ".75rem", marginTop: 8 }}>
        Mostrando primeiros {leads.length} resultados.
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: "10px 12px", textAlign: "left", fontWeight: 700 };
const thRight: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = { padding: "10px 12px", color: "#cbd5e1" };
const tdRight: React.CSSProperties = { ...td, textAlign: "right" };

const btn = (color: string, bg: string): React.CSSProperties => ({
  padding: "7px 14px", borderRadius: 10, border: `1px solid ${color}55`,
  background: bg, color, fontSize: ".82rem", cursor: "pointer", fontWeight: 700,
});

const selectStyle: React.CSSProperties = {
  padding: "5px 10px", background: "#0d0d1f", border: `1px solid ${C.border}`,
  borderRadius: 8, color: "#fff", fontSize: ".8rem",
};

function pillColor(status: string) {
  if (status === "running") return C.blue;
  if (status === "completed") return C.green;
  if (status === "failed") return C.red;
  return "#888";
}

function Card({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ fontSize: ".7rem", color: "#64748b", textTransform: "uppercase", letterSpacing: .8, fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: "1.5rem", fontWeight: 800, color, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: ".75rem", color, marginTop: 2, fontWeight: 700, opacity: .8 }}>{sub}</div>}
    </div>
  );
}
