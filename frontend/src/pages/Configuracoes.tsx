import { useEffect, useState } from "react";
import { credentialsApi, crmSettingsApi } from "../lib/api";
import { useBank } from "../hooks/useBank";
import { useSession } from "../hooks/useSession";
import { C, G, glassCard, sectionTitle, INPUT_STYLE, SHARED_CSS } from "../components/disparo-shared";

interface BankSummary {
  configured: boolean;
  login: string | null;
  has_password: boolean;
  proxies: string[];
}

const BANK_META: Record<string, { label: string; icon: string; grad: string }> = {
  v8:       { label: "V8",        icon: "🏦", grad: G.primary },
  vctex:    { label: "VCTex",     icon: "🌐", grad: G.cyan },
  mercantil:{ label: "Mercantil", icon: "🏛️", grad: G.purple },
  presenca: { label: "Presença",  icon: "🏦", grad: G.green },
  powerhub: { label: "PowerHub",  icon: "📞", grad: G.pink },
};

export default function Configuracoes() {
  const { bank } = useBank();
  const { isAdmin } = useSession();
  const meta = BANK_META[bank] ?? BANK_META.v8;
  const loginLabel =
    bank === "vctex"    ? "Login (CPF / usuário do portal)"
    : bank === "mercantil" ? "Login (usuário do portal Mercantil)"
    : bank === "presenca"  ? "Login (usuário do portal Presença Bank)"
    : bank === "powerhub"  ? "Usuário PowerHub (ex: 1243)"
    : "Login (e-mail V8)";

  const [current, setCurrent]       = useState<BankSummary | null | undefined>(undefined);
  const [loadErr, setLoadErr]        = useState<string | null>(null);
  const [login, setLogin]            = useState("");
  const [password, setPassword]      = useState("");
  const [proxies, setProxies]        = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy]              = useState(false);
  const [msg, setMsg]                = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [hasCrmPassword, setHasCrmPassword]   = useState(false);
  const [crmPwd, setCrmPwd]                   = useState("");
  const [crmPwdConfirm, setCrmPwdConfirm]     = useState("");
  const [crmBusy, setCrmBusy]                 = useState(false);
  const [crmMsg, setCrmMsg]                   = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = async () => {
    try {
      const data = await credentialsApi.list();
      const c = data[bank];
      setCurrent(c);
      setLoadErr(null);
      if (c) {
        setLogin(c.login || "");
        setProxies((c.proxies || []).join("\n"));
      } else {
        setLogin(""); setProxies("");
      }
      setPassword(""); setMsg(null);
    } catch (e: any) {
      setCurrent(null);
      setLoadErr(e?.response?.data?.detail || e?.message || "Falha ao carregar credenciais");
    }
    if (isAdmin) {
      try {
        const cfg = await crmSettingsApi.get();
        setHasCrmPassword(cfg.has_crm_password);
      } catch { /* ignora */ }
    }
  };

  useEffect(() => { setCurrent(undefined); setLoadErr(null); load(); }, [bank]);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const proxyList = proxies.split(/\r?\n|,/).map(p => p.trim()).filter(Boolean);
      if (!login.trim()) { setMsg({ kind: "err", text: "Login é obrigatório" }); setBusy(false); return; }
      if (!password.trim() && !current?.has_password) {
        setMsg({ kind: "err", text: "Senha obrigatória no primeiro cadastro" }); setBusy(false); return;
      }
      await credentialsApi.upsert(bank, {
        login: login.trim(),
        ...(password.trim() ? { password } : {}),
        proxies: proxyList,
      });
      setMsg({ kind: "ok", text: `✓ Salvo. ${proxyList.length} proxy(ies).` });
      setPassword("");
      await load();
    } catch (e: any) {
      const detail = e?.response?.data?.detail || e?.message || "Erro desconhecido";
      setMsg({ kind: "err", text: `Erro: ${detail}` });
    } finally { setBusy(false); }
  };

  if (current === undefined) {
    return <div style={{ padding: 40, color: "#94a3b8", background: C.bg, minHeight: "100vh" }}>Carregando…</div>;
  }

  if (current === null) {
    return (
      <div style={{ background: C.bg, minHeight: "100vh", padding: "28px 28px", color: C.text, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
        <style>{SHARED_CSS}</style>
        <div style={{ ...glassCard(G.red, 24), maxWidth: 720 }}>
          <h2 style={{ ...sectionTitle(G.red), fontSize: 16 }}>⚠️ Erro ao carregar credenciais</h2>
          <p style={{ color: C.sec, fontSize: 14, margin: "0 0 8px 0" }}>
            Não foi possível carregar credenciais. Tente recarregar a página.
          </p>
          {loadErr && <p style={{ color: C.red, fontSize: 13, margin: "0 0 14px 0" }}>{loadErr}</p>}
          <button
            onClick={() => window.location.reload()}
            style={{ padding: "10px 22px", background: G.cyan, color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 700 }}
          >
            🔄 Recarregar
          </button>
        </div>
      </div>
    );
  }

  const proxyCount = proxies.split(/\r?\n|,/).map(p => p.trim()).filter(Boolean).length;

  return (
    <div style={{ background: C.bg, minHeight: "100vh", padding: "28px 28px", color: C.text, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      <style>{SHARED_CSS}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28 }}>
        <div style={{
          width: 44, height: 44, borderRadius: "50%",
          background: "linear-gradient(135deg,rgba(124,58,237,.3),rgba(6,182,212,.3))",
          border: "1.5px solid rgba(124,58,237,.5)",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20,
        }}>⚙️</div>
        <div>
          <h1 style={{ ...sectionTitle(meta.grad), fontSize: 22, marginBottom: 2 }}>Configurações</h1>
          <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>
            Credenciais <b style={{ color: C.sec }}>{meta.label}</b> · troque o banco no menu Higienização CLT
          </p>
        </div>
      </div>

      {/* Credenciais do banco */}
      <div style={{ ...glassCard(meta.grad, 24), marginBottom: 16, maxWidth: 760 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
          <h2 style={{ ...sectionTitle(meta.grad), fontSize: 14, marginBottom: 0 }}>
            {meta.icon} Credencial {meta.label}
          </h2>
          <span style={{
            padding: "3px 10px", borderRadius: 6, fontSize: 10, fontWeight: 800, textTransform: "uppercase",
            background: current?.configured ? "rgba(16,185,129,.15)" : "rgba(245,158,11,.15)",
            color: current?.configured ? C.green : C.yellow,
            border: `1px solid ${current?.configured ? "rgba(16,185,129,.3)" : "rgba(245,158,11,.3)"}`,
          }}>
            {current?.configured ? "✓ Cadastrada" : "⚠ Pendente"}
          </span>
        </div>

        <Field label={loginLabel}>
          <input
            value={login}
            onChange={e => setLogin(e.target.value)}
            placeholder={
              bank === "vctex" ? "usuário do portal"
              : bank === "mercantil" ? "ex: 35275CF.GABRIEL"
              : bank === "presenca" ? "usuário do portal Presença"
              : bank === "powerhub" ? "ex: 1243"
              : "seu@email.com"
            }
            className="ds-input"
            style={INPUT_STYLE}
          />
        </Field>

        <Field label={current?.has_password ? "Senha (opcional — só pra trocar)" : "Senha *"}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={current?.has_password ? "(••• salvada — digite pra trocar)" : ""}
              className="ds-input"
              style={{ ...INPUT_STYLE, flex: 1 }}
            />
            <button
              onClick={() => setShowPassword(v => !v)}
              type="button"
              style={{
                padding: "8px 14px", background: "rgba(255,255,255,.04)", color: C.sec,
                border: "1px solid rgba(255,255,255,.1)", borderRadius: 10, cursor: "pointer",
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
            rows={5}
            className="ds-input"
            style={{ ...INPUT_STYLE, fontFamily: "monospace", fontSize: 13, resize: "vertical" }}
          />
          <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
            Aceita um proxy por linha ou separados por vírgula. Vazio = bot roda direto, sem proxy (IP da VPS aparece pra V8).
          </div>
        </Field>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 20 }}>
          <button
            onClick={save}
            disabled={busy}
            className="ds-btn"
            style={{
              padding: "10px 24px",
              background: busy ? "rgba(255,255,255,.04)" : G.green,
              color: busy ? C.muted : "#fff",
              border: busy ? "1px solid rgba(255,255,255,.06)" : "none",
              borderRadius: 10, cursor: busy ? "not-allowed" : "pointer",
              fontSize: 14, fontWeight: 700,
              boxShadow: busy ? "none" : "0 4px 14px rgba(0,0,0,.35)",
            }}
          >
            {busy ? "Salvando…" : "💾 Salvar"}
          </button>
          {msg && (
            <span style={{ fontSize: 13, color: msg.kind === "ok" ? C.green : C.red }}>
              {msg.text}
            </span>
          )}
        </div>

        <div style={{ marginTop: 18, padding: "12px 16px", background: "rgba(6,182,212,.06)", border: "1px solid rgba(6,182,212,.18)", borderRadius: 10, fontSize: 12, color: C.sec }}>
          <b style={{ color: "#06b6d4" }}>ℹ️ Sobre as credenciais:</b> O bot só roda com login + senha cadastrados.
          Sem proxy, todas as chamadas saem do IP da VPS — pode aparecer rate-limit. Recomendado configurar 3-5 proxies pra distribuir.
        </div>
      </div>

      {/* Segurança CRM — somente admin */}
      {isAdmin && (
        <div style={{ ...glassCard(G.purple, 24), marginBottom: 16, maxWidth: 760 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
            <h2 style={{ ...sectionTitle(G.purple), fontSize: 14, marginBottom: 0 }}>🔒 Segurança CRM</h2>
            <span style={{
              padding: "3px 10px", borderRadius: 6, fontSize: 10, fontWeight: 800, textTransform: "uppercase",
              background: hasCrmPassword ? "rgba(16,185,129,.15)" : "rgba(245,158,11,.15)",
              color: hasCrmPassword ? C.green : C.yellow,
              border: `1px solid ${hasCrmPassword ? "rgba(16,185,129,.3)" : "rgba(245,158,11,.3)"}`,
            }}>
              {hasCrmPassword ? "✓ Senha ativa" : "⚠ Sem senha"}
            </span>
          </div>

          <p style={{ fontSize: 13, color: C.sec, marginBottom: 20 }}>
            Quando ativa, a senha CRM é exigida de qualquer usuário para <b style={{ color: C.text }}>adicionar</b> ou <b style={{ color: C.text }}>apagar</b> propostas.
            Deixe vazio para remover a proteção.
          </p>

          <Field label="Nova Senha CRM (mín. 4 caracteres)">
            <input
              type="password"
              value={crmPwd}
              onChange={e => setCrmPwd(e.target.value)}
              placeholder={hasCrmPassword ? "(••• ativa — digite pra trocar)" : "Digite uma senha…"}
              className="ds-input"
              style={INPUT_STYLE}
            />
          </Field>

          <Field label="Confirmar Senha">
            <input
              type="password"
              value={crmPwdConfirm}
              onChange={e => setCrmPwdConfirm(e.target.value)}
              placeholder="Repita a senha…"
              className="ds-input"
              style={INPUT_STYLE}
            />
          </Field>

          <div style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap", alignItems: "center" }}>
            <button
              disabled={crmBusy}
              className="ds-btn"
              onClick={async () => {
                if (!crmPwd.trim()) { setCrmMsg({ kind: "err", text: "Digite a nova senha" }); return; }
                if (crmPwd !== crmPwdConfirm) { setCrmMsg({ kind: "err", text: "Senhas não conferem" }); return; }
                if (crmPwd.length < 4) { setCrmMsg({ kind: "err", text: "Mínimo 4 caracteres" }); return; }
                setCrmBusy(true); setCrmMsg(null);
                try {
                  await crmSettingsApi.setPassword(crmPwd);
                  setCrmMsg({ kind: "ok", text: "✓ Senha CRM salva com sucesso" });
                  setCrmPwd(""); setCrmPwdConfirm("");
                  setHasCrmPassword(true);
                } catch (e: any) {
                  setCrmMsg({ kind: "err", text: e?.response?.data?.detail ?? "Erro ao salvar senha" });
                } finally { setCrmBusy(false); }
              }}
              style={{ padding: "10px 22px", background: crmBusy ? "rgba(255,255,255,.04)" : G.green, color: crmBusy ? C.muted : "#fff", border: crmBusy ? "1px solid rgba(255,255,255,.06)" : "none", borderRadius: 10, cursor: crmBusy ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 700 }}>
              {crmBusy ? "Salvando…" : "💾 Salvar Senha CRM"}
            </button>

            {hasCrmPassword && (
              <button
                disabled={crmBusy}
                className="ds-btn"
                onClick={async () => {
                  if (!confirm("Remover a senha CRM? Qualquer um poderá adicionar/apagar propostas.")) return;
                  setCrmBusy(true); setCrmMsg(null);
                  try {
                    await crmSettingsApi.removePassword();
                    setCrmMsg({ kind: "ok", text: "✓ Senha CRM removida" });
                    setHasCrmPassword(false);
                  } catch { setCrmMsg({ kind: "err", text: "Erro ao remover senha" }); }
                  finally { setCrmBusy(false); }
                }}
                style={{ padding: "10px 22px", background: "rgba(239,68,68,.12)", color: C.red, border: "1px solid rgba(239,68,68,.3)", borderRadius: 10, cursor: crmBusy ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 700 }}>
                🗑 Remover Proteção
              </button>
            )}

            {crmMsg && (
              <span style={{ fontSize: 13, color: crmMsg.kind === "ok" ? C.green : C.red }}>
                {crmMsg.text}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Aviso credenciais disparo */}
      <div style={{ ...glassCard(G.primary, 20), maxWidth: 760 }}>
        <h3 style={{ ...sectionTitle(G.primary), fontSize: 13, marginBottom: 10 }}>📨 Credenciais de Disparo</h3>
        <p style={{ color: C.sec, fontSize: 13, margin: 0, lineHeight: 1.7 }}>
          Cada disparador (VendeAI · Aesir · Chipcare) tem suas próprias credenciais — email/senha do CRM,
          token Meta System User e WABA IDs — gerenciadas <b style={{ color: C.text }}>direto na página do disparo</b>:{' '}
          <a href="/disparo" style={{ color: "#a78bfa" }}>/disparo</a> ·{' '}
          <a href="/disparo-aesir" style={{ color: "#a78bfa" }}>/disparo-aesir</a> ·{' '}
          <a href="/disparo-chipcare" style={{ color: "#a78bfa" }}>/disparo-chipcare</a>
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 11, color: C.sec, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700, marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  );
}
