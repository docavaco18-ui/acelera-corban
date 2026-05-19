import { useState } from "react";
import { useMercantilSession } from "../../hooks/useMercantilSession";
import { mercantilApi } from "../../lib/api";

const C = {
  bg: "#1e293b",
  border: "#334155",
  green: "#22c55e",
  red: "#ef4444",
  yellow: "#f59e0b",
  purple: "#6366f1",
  text: "#e2e8f0",
  muted: "#94a3b8",
};

export default function SessionPanel() {
  const session = useMercantilSession();
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  async function handleImport() {
    setImportMsg(null);
    const raw = window.prompt(
      "Cole aqui o JSON do console do Chrome.\n\n" +
      "Como obter:\n" +
      "1) Loga em meu.bancomercantil.com.br no Chrome\n" +
      "2) F12 → Console → digita: allow pasting (se pedir)\n" +
      "3) Cola este JS e aperta Enter:\n\n" +
      "JSON.stringify({url:location.href,cookies:document.cookie,localStorage:Object.fromEntries(Object.entries(localStorage)),sessionStorage:Object.fromEntries(Object.entries(sessionStorage))})\n\n" +
      "4) Copia o output (clica direito → Copy string contents) e cola aqui:"
    );
    if (!raw) return;
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (e: any) {
      setImportMsg("❌ JSON inválido: " + e.message);
      return;
    }
    setImporting(true);
    try {
      const r = await mercantilApi.importSession(parsed);
      setImportMsg(
        `✅ Sessão importada. Cookies: ${r.cookies_count}, PCB_AUTH: ${r.has_pcb_auth ? "sim" : "não"}`
      );
      setTimeout(() => session.refresh(), 500);
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e.message || "erro";
      setImportMsg("❌ " + msg);
    } finally {
      setImporting(false);
    }
  }

  const statusColor =
    session.status === "valid" ? C.green :
    session.status === "logging_in" ? C.yellow : C.red;

  const statusLabel =
    session.status === "loading" ? "Verificando…" :
    session.status === "valid" ? "✅ Sessão válida" :
    session.status === "logging_in" ? "⏳ Aguardando SMS…" :
    "❌ Sem sessão";

  const savedAtLabel = session.savedAt
    ? `Salva em ${new Date(session.savedAt).toLocaleString("pt-BR")}`
    : null;

  const btnDisabled = session.isStartingLogin || session.status === "logging_in";

  return (
    <div style={{
      background: C.bg,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      padding: 24,
      minWidth: 280,
      maxWidth: 340,
    }}>
      <h2 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: C.text }}>
        Sessão Mercantil
      </h2>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{
          width: 10, height: 10, borderRadius: "50%",
          background: statusColor, flexShrink: 0,
        }} />
        <span style={{ color: C.text, fontSize: 14, fontWeight: 600 }}>
          {statusLabel}
        </span>
      </div>

      {savedAtLabel && (
        <p style={{ margin: "0 0 16px", fontSize: 12, color: C.muted }}>
          {savedAtLabel}
        </p>
      )}

      {session.status === "logging_in" && (
        <p style={{ margin: "0 0 16px", fontSize: 13, color: C.yellow }}>
          Browser aberto. Aguardando você digitar o código SMS no modal acima.
        </p>
      )}

      {session.error && (
        <div style={{
          background: "#7f1d1d", color: "#fecaca",
          borderRadius: 8, padding: "8px 12px",
          fontSize: 13, marginBottom: 16,
        }}>
          {session.error}
        </div>
      )}

      <button
        onClick={() => session.startLoginVisual()}
        disabled={btnDisabled}
        style={{
          width: "100%",
          padding: "10px 16px",
          borderRadius: 8,
          background: btnDisabled ? C.border : C.purple,
          color: btnDisabled ? C.muted : "#fff",
          border: "none",
          fontSize: 14,
          fontWeight: 700,
          cursor: btnDisabled ? "not-allowed" : "pointer",
        }}
      >
        {session.status === "logging_in" ? "Aguardando SMS…" : "Login Visual (auto-retry)"}
      </button>

      <button
        onClick={() => session.startLoginVisual({ manual: true })}
        disabled={btnDisabled}
        style={{
          width: "100%",
          marginTop: 8,
          padding: "10px 16px",
          borderRadius: 8,
          background: btnDisabled ? C.border : C.green,
          color: btnDisabled ? C.muted : "#fff",
          border: "none",
          fontSize: 14,
          fontWeight: 700,
          cursor: btnDisabled ? "not-allowed" : "pointer",
        }}
      >
        Login Manual (eu insiro o SMS)
      </button>

      <button
        onClick={handleImport}
        disabled={importing}
        style={{
          width: "100%",
          marginTop: 8,
          padding: "10px 16px",
          borderRadius: 8,
          background: importing ? C.border : "#0ea5e9",
          color: importing ? C.muted : "#fff",
          border: "none",
          fontSize: 14,
          fontWeight: 700,
          cursor: importing ? "not-allowed" : "pointer",
        }}
      >
        {importing ? "Importando…" : "Importar sessão do meu Chrome"}
      </button>

      {importMsg && (
        <p style={{ marginTop: 8, fontSize: 12, color: importMsg.startsWith("✅") ? C.green : C.red }}>
          {importMsg}
        </p>
      )}

      <p style={{ margin: "12px 0 0", fontSize: 11, color: C.muted }}>
        <b>Auto-retry:</b> bot tenta login várias vezes, re-dispara SMS automaticamente.<br/>
        <b>Manual:</b> bot só preenche login/senha, pede 1 SMS e para.<br/>
        <b>Importar:</b> copia sessão do teu Chrome (sem SMS, sem bloqueio).
      </p>
    </div>
  );
}
