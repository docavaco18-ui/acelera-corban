import { useMercantilSession } from "../../hooks/useMercantilSession";

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
        onClick={session.startLoginVisual}
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
        {session.status === "logging_in" ? "Aguardando SMS…" : "Login Visual"}
      </button>

      <p style={{ margin: "12px 0 0", fontSize: 11, color: C.muted }}>
        Abre o Chrome, preenche login/senha automaticamente e aguarda você inserir o SMS. Sessão fica salva para o Rodar Bot.
      </p>
    </div>
  );
}
