import { useEffect, useState } from "react";
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

export function Admin() {
  const [users, setUsers] = useState<SbUser[]>([]);
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

  useEffect(() => { refresh(); }, []);

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

  return (
    <div style={{ padding: 20, color: "#e0e0f0", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      <h1 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: 18 }}>👥 Administração de Usuários</h1>

      <div style={card}>
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
            <input type="text" required minLength={6} value={password} onChange={e => setPassword(e.target.value)}
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
