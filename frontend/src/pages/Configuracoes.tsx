import { useEffect, useState } from "react";
import { credentialsApi } from "../lib/api";
import { useBank } from "../hooks/useBank";

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

interface BankSummary {
  configured: boolean;
  login: string | null;
  has_password: boolean;
  proxies: string[];
}

export default function Configuracoes() {
  const { bank } = useBank();
  const bankLabel = bank === "vctex" ? "VCTex" : "V8";
  const bankIcon = bank === "vctex" ? "🌐" : "🏦";
  const loginLabel = bank === "vctex" ? "Login (CPF / usuário do portal)" : "Login (e-mail V8)";

  const [current, setCurrent] = useState<BankSummary | null | undefined>(undefined);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [proxies, setProxies] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = async () => {
    try {
      const data = await credentialsApi.list();
      const c = data[bank];
      setCurrent(c);
      if (c) {
        setLogin(c.login || "");
        setProxies((c.proxies || []).join("\n"));
      } else {
        setLogin("");
        setProxies("");
      }
      setPassword("");
      setMsg(null);
    } catch {
      setCurrent(null);
    }
  };

  // Recarrega ao trocar bank
  useEffect(() => { setCurrent(undefined); load(); }, [bank]);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const proxyList = proxies
        .split(/\r?\n|,/)
        .map(p => p.trim())
        .filter(Boolean);
      if (!login.trim()) { setMsg({ kind: "err", text: "Login é obrigatório" }); setBusy(false); return; }
      if (!password.trim() && !current?.has_password) {
        setMsg({ kind: "err", text: "Senha é obrigatória no primeiro cadastro" }); setBusy(false); return;
      }
      if (!password.trim()) {
        setMsg({ kind: "err", text: "Digite a senha (não é possível atualizar só os proxies sem reenviar a senha)" });
        setBusy(false); return;
      }
      await credentialsApi.upsert(bank, {
        login: login.trim(),
        password: password,
        proxies: proxyList,
      });
      setMsg({ kind: "ok", text: `✓ Salvo. ${proxyList.length} proxy(ies).` });
      setPassword("");
      await load();
    } catch (e: any) {
      const detail = e?.response?.data?.detail || e?.message || "Erro desconhecido";
      setMsg({ kind: "err", text: `Erro: ${detail}` });
    } finally {
      setBusy(false);
    }
  };

  if (current === undefined) {
    return <div style={{ padding: 40, color: "#94a3b8" }}>Carregando…</div>;
  }

  const proxyCount = proxies.split(/\r?\n|,/).map(p => p.trim()).filter(Boolean).length;

  return (
    <div style={{ background: C.bg, minHeight: "100vh", padding: "24px 28px", color: "#e0e0f0", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#fff", marginBottom: 8 }}>⚙️ Configurações</h1>
      <p style={{ color: "#64748b", fontSize: ".88rem", marginBottom: 22 }}>
        Credenciais <b style={{ color: "#cbd5e1" }}>{bankLabel}</b> e lista de proxies (IPs) — troque o banco no toggle do header.
      </p>

      <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 14, padding: 22, marginBottom: 16, maxWidth: 760 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <h2 style={{ fontSize: "1rem", color: "#fff", margin: 0 }}>{bankIcon} Credencial {bankLabel}</h2>
          <span style={{
            padding: "3px 10px", borderRadius: 12, fontSize: ".7rem", fontWeight: 700, textTransform: "uppercase",
            background: current?.configured ? "rgba(0,255,136,.12)" : "rgba(255,215,0,.12)",
            color: current?.configured ? C.green : C.gold,
            border: `1px solid ${current?.configured ? "rgba(0,255,136,.3)" : "rgba(255,215,0,.3)"}`,
          }}>
            {current?.configured ? "Cadastrada" : "Pendente"}
          </span>
        </div>

        <Field label={loginLabel}>
          <input
            value={login}
            onChange={e => setLogin(e.target.value)}
            placeholder={bank === "vctex" ? "usuário do portal" : "seu@email.com"}
            style={inputStyle}
          />
        </Field>

        <Field label={current?.has_password ? "Senha (digite pra atualizar)" : "Senha"}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={current?.has_password ? "(••• salvada — digite pra trocar)" : ""}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              onClick={() => setShowPassword(v => !v)}
              type="button"
              style={{
                padding: "8px 14px", background: C.bg2, color: "#888",
                border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer",
              }}
            >
              {showPassword ? "🙈" : "👁"}
            </button>
          </div>
        </Field>

        <Field label={`Proxies (IPs) — um por linha · ${proxyCount} ativos`}>
          <textarea
            value={proxies}
            onChange={e => setProxies(e.target.value)}
            placeholder="http://user:pass@host:port&#10;http://user:pass@host:port"
            rows={6}
            style={{ ...inputStyle, fontFamily: "monospace", fontSize: ".82rem" }}
          />
          <div style={{ fontSize: ".72rem", color: "#64748b", marginTop: 6 }}>
            Aceita um proxy por linha ou separados por vírgula. Vazio = bot roda direto, sem proxy (IP da VPS aparece pra V8).
          </div>
        </Field>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18 }}>
          <button
            onClick={save}
            disabled={busy}
            style={{
              padding: "9px 20px", background: busy ? "#1a1a2e" : "rgba(0,255,136,.15)",
              color: busy ? "#444" : C.green,
              border: `1px solid ${busy ? C.border : "rgba(0,255,136,.4)"}`,
              borderRadius: 18, cursor: busy ? "not-allowed" : "pointer",
              fontSize: ".82rem", fontWeight: 700,
            }}
          >
            {busy ? "Salvando…" : "💾 Salvar"}
          </button>
          {msg && (
            <span style={{ fontSize: ".82rem", color: msg.kind === "ok" ? C.green : C.red }}>
              {msg.text}
            </span>
          )}
        </div>

        <div style={{ marginTop: 18, padding: 12, background: "rgba(0,191,255,.06)", border: "1px solid rgba(0,191,255,.18)", borderRadius: 10, fontSize: ".8rem", color: "#94a3b8" }}>
          <b style={{ color: C.blue }}>ℹ️ Sobre as credenciais:</b> O bot só roda com login + senha cadastrados.
          Sem proxy, todas as chamadas saem do IP da VPS — pode aparecer rate-limit. Recomendado configurar 3-5 proxies pra distribuir.
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  background: "#0d0d1f",
  border: `1px solid ${C.border}`,
  color: "#fff",
  borderRadius: 8,
  fontSize: ".85rem",
  outline: "none",
  boxSizing: "border-box",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: ".72rem", color: "#94a3b8", textTransform: "uppercase", letterSpacing: .8, fontWeight: 700, marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  );
}
