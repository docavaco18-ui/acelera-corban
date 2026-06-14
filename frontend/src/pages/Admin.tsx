import { useEffect, useRef, useState } from "react";
import { adminApi } from "../lib/api";

interface SbUser {
  id: string;
  email: string;
  app_metadata?: { role?: string };
  banned_until?: string | null;
  created_at: string;
  last_sign_in_at?: string | null;
}

const C = {
  bg2: "rgba(255,255,255,.04)",
  border: "rgba(255,255,255,.07)",
  green: "#00ff88",
  red: "#ff2d78",
  purple: "#b44aff",
  gold: "#ffd700",
  blue: "#00bfff",
};

const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

function ResetPasswordModal({ user, onClose }: { user: SbUser; onClose: () => void }) {
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    if (pwd.length < 6) { setMsg({ ok: false, text: "Mínimo 6 caracteres" }); return; }
    setBusy(true);
    try {
      await adminApi.updateUser(user.id, { password: pwd });
      setMsg({ ok: true, text: "✓ Senha redefinida" });
      setTimeout(onClose, 1200);
    } catch (e: any) {
      setMsg({ ok: false, text: e?.response?.data?.detail ?? "Erro" });
    } finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#0d0d1f", border: `1px solid ${C.border}`, borderRadius: 14, padding: 28, minWidth: 340 }}>
        <div style={{ fontSize: "1rem", fontWeight: 700, color: "#fff", marginBottom: 6 }}>🔑 Redefinir senha</div>
        <div style={{ fontSize: ".78rem", color: "#64748b", marginBottom: 18 }}>{user.email}</div>
        <input
          type="text"
          placeholder="Nova senha (mín. 6 caracteres)"
          value={pwd}
          onChange={e => setPwd(e.target.value)}
          onKeyDown={e => e.key === "Enter" && save()}
          autoFocus
          style={{ width: "100%", padding: "9px 12px", background: "#080818", border: `1px solid ${C.border}`, borderRadius: 8, color: "#fff", fontSize: ".85rem", boxSizing: "border-box", marginBottom: 14 }}
        />
        {msg && <div style={{ fontSize: ".8rem", color: msg.ok ? C.green : C.red, marginBottom: 10 }}>{msg.text}</div>}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={save} disabled={busy}
            style={{ flex: 1, padding: "9px 0", background: "rgba(0,255,136,.15)", color: C.green, border: `1px solid rgba(0,255,136,.3)`, borderRadius: 10, fontWeight: 700, cursor: busy ? "not-allowed" : "pointer" }}>
            {busy ? "Salvando…" : "Salvar"}
          </button>
          <button onClick={onClose}
            style={{ flex: 1, padding: "9px 0", background: C.bg2, color: "#666", border: `1px solid ${C.border}`, borderRadius: 10, cursor: "pointer" }}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

interface AdminRun {
  id: string;
  owner_id: string;
  bank: "v8" | "vctex" | "mercantil" | "presenca" | "powerhub";
  started_at: string;
  finished_at: string | null;
  status: string;
  num_workers: number | null;
  total_processed: number;
  total_elegiveis: number;
  total_inelegiveis: number;
}

interface Overview {
  users: { total: number; active_today: number; active_list: { id: string; email: string; last_sign_in_at: string | null }[] };
  bots: { running: number; list: { bank: string; owner_id: string; started_at: string; num_workers: number | null }[] };
  dispatches: { today_total: number; today_active: number; today_leads: number; list: { id: string; owner_id: string; status: string; total_leads: number | null; source: string; created_at: string }[] };
  recent_runs: AdminRun[];
}

const BANK_COLOR: Record<string, string> = {
  v8: "#818cf8", vctex: "#00bfff", mercantil: "#22c55e",
  presenca: "#f59e0b", powerhub: "#e879f9",
};
const BANK_BORDER: Record<string, string> = {
  v8: "rgba(99,102,241,.3)", vctex: "rgba(0,191,255,.25)", mercantil: "rgba(34,197,94,.3)",
  presenca: "rgba(245,158,11,.3)", powerhub: "rgba(232,121,249,.3)",
};
const BANK_BG: Record<string, string> = {
  v8: "rgba(99,102,241,.12)", vctex: "rgba(0,191,255,.10)", mercantil: "rgba(34,197,94,.10)",
  presenca: "rgba(245,158,11,.10)", powerhub: "rgba(232,121,249,.10)",
};
const SOURCE_COLOR: Record<string, string> = {
  vendeai: "#00ff88", chipcare: "#00bfff", aesir: "#f59e0b",
};

function BankBadge({ bank }: { bank: string }) {
  return (
    <span style={{
      padding: "2px 8px", borderRadius: 8, fontSize: ".7rem",
      background: BANK_BG[bank] || "rgba(255,255,255,.06)",
      color: BANK_COLOR[bank] || "#aaa",
      border: `1px solid ${BANK_BORDER[bank] || "rgba(255,255,255,.1)"}`,
    }}>
      {bank.toUpperCase()}
    </span>
  );
}

function KpiCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div style={{
      background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 14,
      padding: "18px 22px", flex: "1 1 180px",
    }}>
      <div style={{ fontSize: ".7rem", color: "#666", textTransform: "uppercase", letterSpacing: ".8px", fontWeight: 700, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: "2rem", fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: ".72rem", color: "#555", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function OverviewTab() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async () => {
    try {
      const d = await adminApi.overview();
      setData(d);
    } catch { /* silencioso */ }
    finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, 30_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  if (loading) return <div style={{ color: "#666", fontSize: ".85rem" }}>Carregando…</div>;
  if (!data) return <div style={{ color: C.red, fontSize: ".85rem" }}>Erro ao carregar overview</div>;

  const { users, bots, dispatches, recent_runs } = data;

  return (
    <div>
      {/* KPIs */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <KpiCard label="Usuários ativos hoje" value={users.active_today} sub={`de ${users.total} total`} color={C.green} />
        <KpiCard label="Bots rodando agora" value={bots.running} sub={bots.running > 0 ? bots.list.map(b => b.bank.toUpperCase()).join(", ") : "nenhum"} color={bots.running > 0 ? C.gold : "#555"} />
        <KpiCard label="Disparos hoje" value={dispatches.today_total} sub={`${dispatches.today_active} ativos · ${dispatches.today_leads.toLocaleString("pt-BR")} leads`} color={C.blue} />
        <KpiCard label="Runs hoje" value={recent_runs.filter(r => r.started_at >= new Date().toISOString().slice(0, 10)).length} sub="todos os bancos" color={C.purple} />
      </div>

      {/* Usuários ativos */}
      {users.active_list.length > 0 && (
        <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 14, padding: "16px 20px", marginBottom: 14 }}>
          <div style={{ fontSize: ".7rem", color: "#888", textTransform: "uppercase", letterSpacing: ".8px", fontWeight: 700, marginBottom: 10 }}>
            Usuários ativos (últimas 24h)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {users.active_list.map(u => (
              <div key={u.id} style={{ background: "rgba(0,255,136,.07)", border: "1px solid rgba(0,255,136,.15)", borderRadius: 10, padding: "5px 12px", fontSize: ".78rem" }}>
                <span style={{ color: C.green }}>{u.email}</span>
                {u.last_sign_in_at && (
                  <span style={{ color: "#555", marginLeft: 8, fontSize: ".7rem" }}>
                    {fmtDate(u.last_sign_in_at)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bots rodando */}
      {bots.list.length > 0 && (
        <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 14, padding: "16px 20px", marginBottom: 14 }}>
          <div style={{ fontSize: ".7rem", color: "#888", textTransform: "uppercase", letterSpacing: ".8px", fontWeight: 700, marginBottom: 10 }}>
            Bots rodando agora
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {bots.list.map(b => (
              <div key={b.bank + b.owner_id} style={{ background: `${BANK_BG[b.bank]}`, border: `1px solid ${BANK_BORDER[b.bank]}`, borderRadius: 10, padding: "6px 14px", fontSize: ".78rem" }}>
                <span style={{ color: BANK_COLOR[b.bank], fontWeight: 700 }}>{b.bank.toUpperCase()}</span>
                <span style={{ color: "#555", marginLeft: 8 }}>{b.owner_id.slice(0, 8)}… · {b.num_workers || 1}w · desde {fmtDate(b.started_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Disparos hoje */}
      {dispatches.list.length > 0 && (
        <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 14, padding: "16px 20px", marginBottom: 14 }}>
          <div style={{ fontSize: ".7rem", color: "#888", textTransform: "uppercase", letterSpacing: ".8px", fontWeight: 700, marginBottom: 10 }}>
            Disparos de hoje ({dispatches.today_total})
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".8rem" }}>
              <thead>
                <tr style={{ color: "#555" }}>
                  {["Canal", "Owner", "Leads", "Status", "Início"].map(h => (
                    <th key={h} style={{ padding: "6px 8px", textAlign: "left", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dispatches.list.map(d => (
                  <tr key={d.id} style={{ color: "#ccc" }}>
                    <td style={td}>
                      <span style={{ padding: "2px 8px", borderRadius: 8, fontSize: ".7rem", background: `${SOURCE_COLOR[d.source]}15`, color: SOURCE_COLOR[d.source] || "#aaa", border: `1px solid ${SOURCE_COLOR[d.source]}33` }}>
                        {d.source}
                      </span>
                    </td>
                    <td style={{ ...td, fontSize: ".7rem", color: "#555" }}>{d.owner_id.slice(0, 8)}…</td>
                    <td style={{ ...td, fontWeight: 700, color: C.blue }}>{(d.total_leads || 0).toLocaleString("pt-BR")}</td>
                    <td style={td}>
                      <span style={{ color: d.status === "completed" ? C.green : d.status === "dispatching" || d.status === "running" ? C.gold : "#777" }}>
                        {d.status}
                      </span>
                    </td>
                    <td style={{ ...td, fontSize: ".72rem", color: "#555" }}>{fmtDate(d.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Runs recentes cross-banco */}
      <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 14, padding: "16px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: ".7rem", color: "#888", textTransform: "uppercase", letterSpacing: ".8px", fontWeight: 700 }}>
            Runs recentes — todos os bancos
          </div>
          <button onClick={load} style={{ background: "transparent", color: "#666", border: `1px solid ${C.border}`, borderRadius: 14, padding: "4px 12px", fontSize: ".72rem", cursor: "pointer" }}>↻</button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".8rem" }}>
            <thead>
              <tr style={{ color: "#555" }}>
                {["Banco", "Owner", "Início", "Duração", "Status", "Proc.", "Eleg.", "Ineleg."].map(h => (
                  <th key={h} style={{ padding: "6px 8px", textAlign: "left", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recent_runs.map(r => {
                const dur = r.finished_at
                  ? (() => { const s = Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`; })()
                  : r.status === "running" ? "rodando…" : "—";
                return (
                  <tr key={r.id} style={{ color: "#ccc" }}>
                    <td style={td}><BankBadge bank={r.bank} /></td>
                    <td style={{ ...td, fontSize: ".7rem", color: "#555" }}>{r.owner_id.slice(0, 8)}…</td>
                    <td style={{ ...td, fontSize: ".72rem", color: "#555" }}>{fmtDate(r.started_at)}</td>
                    <td style={{ ...td, color: "#94a3b8" }}>{dur}</td>
                    <td style={td}>
                      <span style={{ color: r.status === "completed" ? C.green : r.status === "running" ? C.gold : "#777" }}>
                        {r.status}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: "center" }}>{r.total_processed ?? "—"}</td>
                    <td style={{ ...td, color: C.green, textAlign: "center", fontWeight: 700 }}>{r.total_elegiveis ?? "—"}</td>
                    <td style={{ ...td, color: "#94a3b8", textAlign: "center" }}>{r.total_inelegiveis ?? "—"}</td>
                  </tr>
                );
              })}
              {recent_runs.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 16, color: "#555", textAlign: "center" }}>Nenhum run encontrado</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function Admin() {
  const [tab, setTab] = useState<"overview" | "users" | "runs">("overview");
  const [users, setUsers] = useState<SbUser[]>([]);
  const [runs, setRuns] = useState<AdminRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [creating, setCreating] = useState(false);
  const [resetTarget, setResetTarget] = useState<SbUser | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await adminApi.listUsers();
      setUsers(list as SbUser[]);
      setErr(null);
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? e?.message ?? "Erro ao listar usuários");
    } finally { setLoading(false); }
  };

  const loadRuns = async () => {
    setRunsLoading(true);
    try {
      const data = await adminApi.runs(100);
      setRuns(data as AdminRun[]);
    } catch { /* silencioso */ }
    finally { setRunsLoading(false); }
  };

  useEffect(() => { refresh(); }, []);
  useEffect(() => { if (tab === "runs") loadRuns(); }, [tab]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setErr(null);
    try {
      await adminApi.createUser(email, password, role);
      setEmail(""); setPassword(""); setRole("user");
      await refresh();
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? e?.message ?? "Erro ao criar usuário");
    } finally { setCreating(false); }
  };

  const toggleBan = async (u: SbUser) => {
    const banned = !!(u.banned_until && new Date(u.banned_until) > new Date());
    if (!confirm(banned ? `Reativar ${u.email}?` : `Banir ${u.email}?`)) return;
    await adminApi.updateUser(u.id, { banned: !banned });
    refresh();
  };

  const remove = async (u: SbUser) => {
    if (!confirm(`Apagar usuário ${u.email}? (não apaga os leads dele)`)) return;
    await adminApi.deleteUser(u.id);
    refresh();
  };

  const promote = async (u: SbUser) => {
    const isAdmin = u.app_metadata?.role === "admin";
    if (!confirm(isAdmin ? `Remover admin de ${u.email}?` : `Promover ${u.email} a admin?`)) return;
    await adminApi.updateUser(u.id, { role: isAdmin ? "user" : "admin" });
    refresh();
  };

  const card: React.CSSProperties = {
    background: C.bg2, border: `1px solid ${C.border}`,
    borderRadius: 14, padding: "20px 22px", marginBottom: 14,
  };

  const fmtDur = (a: string, b: string | null) => {
    if (!b) return "—";
    const s = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m${s % 60}s`;
  };

  return (
    <div style={{ padding: 20, color: "#e0e0f0", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      <h1 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: 18 }}>⚙️ Administração</h1>

      {/* Abas */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {(["overview", "users", "runs"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: "7px 18px", borderRadius: 12, border: `1px solid ${tab === t ? C.purple : C.border}`, background: tab === t ? `${C.purple}22` : "transparent", color: tab === t ? C.purple : "#666", fontWeight: 700, fontSize: ".8rem", cursor: "pointer" }}>
            {t === "overview" ? "📊 Overview" : t === "users" ? "👥 Usuários" : "📜 Runs"}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab />}

      {tab === "users" && <><div style={card}>
        <div style={{ fontSize: ".7rem", color: "#888", textTransform: "uppercase", letterSpacing: ".8px", fontWeight: 700, marginBottom: 12 }}>
          ➕ Criar novo usuário
        </div>
        <form onSubmit={create} style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end" }}>
          <div style={{ flex: "1 1 220px" }}>
            <label style={{ fontSize: ".7rem", color: "#666", display: "block", marginBottom: 4 }}>Email</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
              style={inp} />
          </div>
          <div style={{ flex: "1 1 180px" }}>
            <label style={{ fontSize: ".7rem", color: "#666", display: "block", marginBottom: 4 }}>Senha</label>
            <input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)}
              style={inp} />
          </div>
          <div>
            <label style={{ fontSize: ".7rem", color: "#666", display: "block", marginBottom: 4 }}>Papel</label>
            <select value={role} onChange={e => setRole(e.target.value as any)} style={inp}>
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <button type="submit" disabled={creating}
            style={{ padding: "8px 18px", borderRadius: 18, background: "rgba(0,255,136,.15)", color: C.green, border: `1px solid rgba(0,255,136,.4)`, fontWeight: 700, fontSize: ".8rem", cursor: creating ? "wait" : "pointer" }}>
            {creating ? "Criando..." : "Criar"}
          </button>
        </form>
        {err && <div style={{ marginTop: 10, color: C.red, fontSize: ".8rem" }}>{err}</div>}
      </div>

      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: ".7rem", color: "#888", textTransform: "uppercase", letterSpacing: ".8px", fontWeight: 700 }}>
            👥 Usuários ({users.length})
          </div>
          <button onClick={refresh} style={{ background: "transparent", color: "#666", border: `1px solid ${C.border}`, borderRadius: 14, padding: "5px 12px", fontSize: ".75rem", cursor: "pointer" }}>↻ Atualizar</button>
        </div>

        {loading ? (
          <div style={{ color: "#666", fontSize: ".85rem" }}>Carregando...</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".82rem" }}>
              <thead>
                <tr style={{ color: "#666", textAlign: "left" }}>
                  {["Email", "Papel", "Status", "Criado", "Último login", "Ações"].map(h => (
                    <th key={h} style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map(u => {
                  const isAdmin = u.app_metadata?.role === "admin";
                  const banned = !!(u.banned_until && new Date(u.banned_until) > new Date());
                  return (
                    <tr key={u.id} style={{ color: "#ccc" }}>
                      <td style={td}>{u.email}</td>
                      <td style={td}>
                        <span style={{ padding: "2px 10px", borderRadius: 10, fontSize: ".7rem", background: isAdmin ? "rgba(180,74,255,.15)" : "rgba(255,255,255,.06)", color: isAdmin ? C.purple : "#888", border: `1px solid ${isAdmin ? "rgba(180,74,255,.3)" : "rgba(255,255,255,.08)"}` }}>
                          {isAdmin ? "admin" : "user"}
                        </span>
                      </td>
                      <td style={td}>
                        {banned ? <span style={{ color: C.red }}>banido</span> : <span style={{ color: C.green }}>ativo</span>}
                      </td>
                      <td style={{ ...td, color: "#666", fontSize: ".75rem" }}>{fmtDate(u.created_at)}</td>
                      <td style={{ ...td, color: "#666", fontSize: ".75rem" }}>{fmtDate(u.last_sign_in_at)}</td>
                      <td style={td}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button onClick={() => promote(u)} style={btn(C.purple)}>{isAdmin ? "→ user" : "→ admin"}</button>
                          <button onClick={() => setResetTarget(u)} style={btn(C.gold)}>🔑 senha</button>
                          <button onClick={() => toggleBan(u)} style={btn(banned ? C.green : "#ff8c00")}>{banned ? "Reativar" : "Banir"}</button>
                          <button onClick={() => remove(u)} style={btn(C.red)}>Apagar</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {resetTarget && <ResetPasswordModal user={resetTarget} onClose={() => setResetTarget(null)} />}
      </>}

      {tab === "runs" && (
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: ".7rem", color: "#888", textTransform: "uppercase", letterSpacing: ".8px", fontWeight: 700 }}>
              📜 Histórico de Runs — todos os usuários ({runs.length})
            </div>
            <button onClick={loadRuns} style={{ background: "transparent", color: "#666", border: `1px solid ${C.border}`, borderRadius: 14, padding: "5px 12px", fontSize: ".75rem", cursor: "pointer" }}>↻ Atualizar</button>
          </div>
          {runsLoading ? (
            <div style={{ color: "#666", fontSize: ".85rem" }}>Carregando...</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".8rem" }}>
                <thead>
                  <tr style={{ color: "#666", textAlign: "left" }}>
                    {["Banco", "Owner", "Início", "Fim", "Duração", "Status", "Processados", "Elegíveis", "Inelegíveis"].map(h => (
                      <th key={h} style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {runs.map(r => (
                    <tr key={r.id} style={{ color: "#ccc" }}>
                      <td style={td}>
                        {(() => {
                          const bg = r.bank === "v8" ? "rgba(99,102,241,.15)"
                                  : r.bank === "vctex" ? "rgba(0,191,255,.12)"
                                  : "rgba(34,197,94,.12)";
                          const fg = r.bank === "v8" ? "#818cf8"
                                  : r.bank === "vctex" ? C.blue
                                  : "#22c55e";
                          const bd = r.bank === "v8" ? "rgba(99,102,241,.3)"
                                  : r.bank === "vctex" ? "rgba(0,191,255,.25)"
                                  : "rgba(34,197,94,.3)";
                          return (
                            <span style={{ padding: "2px 8px", borderRadius: 8, fontSize: ".7rem", background: bg, color: fg, border: `1px solid ${bd}` }}>
                              {r.bank.toUpperCase()}
                            </span>
                          );
                        })()}
                      </td>
                      <td style={{ ...td, fontSize: ".7rem", color: "#666", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.owner_id.slice(0, 8)}…</td>
                      <td style={{ ...td, fontSize: ".72rem", color: "#666" }}>{fmtDate(r.started_at)}</td>
                      <td style={{ ...td, fontSize: ".72rem", color: "#666" }}>{fmtDate(r.finished_at)}</td>
                      <td style={{ ...td, color: "#94a3b8" }}>{fmtDur(r.started_at, r.finished_at)}</td>
                      <td style={td}>
                        <span style={{ color: r.status === "completed" ? C.green : r.status === "running" ? C.gold : "#888" }}>
                          {r.status}
                        </span>
                      </td>
                      <td style={{ ...td, color: "#ccc", textAlign: "center" }}>{r.total_processed}</td>
                      <td style={{ ...td, color: C.green, textAlign: "center", fontWeight: 700 }}>{r.total_elegiveis}</td>
                      <td style={{ ...td, color: "#94a3b8", textAlign: "center" }}>{r.total_inelegiveis}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const inp: React.CSSProperties = { padding: "8px 10px", background: "#0d0d1f", border: "1px solid rgba(255,255,255,.1)", borderRadius: 6, color: "#fff", fontSize: ".85rem", width: "100%" };
const td: React.CSSProperties = { padding: "8px 6px", borderBottom: "1px solid rgba(255,255,255,.04)" };
const btn = (color: string): React.CSSProperties => ({
  padding: "4px 10px", borderRadius: 12, border: `1px solid ${color}55`,
  background: `${color}15`, color, fontSize: ".72rem", fontWeight: 700, cursor: "pointer",
});

export default Admin;
