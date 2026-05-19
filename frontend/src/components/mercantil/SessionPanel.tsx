import { useState, useEffect } from "react";
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
  const [extensionToken, setExtensionToken] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [showExtSetup, setShowExtSetup] = useState(false);

  useEffect(() => {
    mercantilApi.getExtensionToken().then((r) => setExtensionToken(r.token)).catch(() => {});
  }, []);

  async function copyToken() {
    if (!extensionToken) return;
    await navigator.clipboard.writeText(extensionToken);
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 2000);
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

      {/* Chrome Extension section */}
      <div style={{
        marginTop: 16,
        background: "#0c1a2e",
        border: `1px solid #1e3a5f`,
        borderRadius: 10,
        padding: 14,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#38bdf8" }}>
            ⚡ Extensão Chrome (recomendado)
          </span>
          <button
            onClick={() => setShowExtSetup(!showExtSetup)}
            style={{
              background: "none", border: "none", color: C.muted,
              fontSize: 11, cursor: "pointer", padding: "2px 6px",
            }}
          >
            {showExtSetup ? "fechar ▲" : "como instalar ▼"}
          </button>
        </div>

        <p style={{ fontSize: 11, color: C.muted, margin: "0 0 10px" }}>
          Instala 1x. A extensão renova a sessão automaticamente enquanto o banco estiver aberto no Chrome — sem F12, sem copiar/colar.
        </p>

        {extensionToken && (
          <div>
            <p style={{ fontSize: 11, color: C.muted, margin: "0 0 4px" }}>Seu token da extensão:</p>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                readOnly
                value={extensionToken.slice(0, 20) + "…"}
                style={{
                  flex: 1, padding: "6px 8px", borderRadius: 6,
                  background: "#1e293b", border: "1px solid #334155",
                  color: "#64748b", fontSize: 11, fontFamily: "monospace",
                }}
              />
              <button
                onClick={copyToken}
                style={{
                  padding: "6px 12px", borderRadius: 6,
                  background: tokenCopied ? C.green : "#0ea5e9",
                  color: "#fff", border: "none", fontSize: 11,
                  fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                {tokenCopied ? "✓ Copiado!" : "Copiar token"}
              </button>
            </div>
          </div>
        )}

        {showExtSetup && (
          <div style={{
            marginTop: 12, padding: 12,
            background: "#0f2137", borderRadius: 8,
            fontSize: 11, color: C.muted, lineHeight: 1.7,
          }}>
            <b style={{ color: C.text }}>Instalação (1x, ~3 minutos):</b><br/>
            1. Baixe a pasta <code style={{ color: "#38bdf8" }}>chrome-extension/</code> do projeto<br/>
            2. Chrome → <code>chrome://extensions</code> → ative <b>Modo do desenvolvedor</b><br/>
            3. Clique <b>Carregar sem compactação</b> → selecione a pasta<br/>
            4. Clique no ícone da extensão → cole a URL do backend e o token acima → Salvar<br/>
            5. Acesse <a href="https://meu.bancomercantil.com.br" target="_blank" rel="noreferrer" style={{ color: "#38bdf8" }}>meu.bancomercantil.com.br</a> e faça login normalmente<br/>
            <b style={{ color: C.green }}>✓ Pronto — extensão enviará a sessão automaticamente e renovará a cada mudança.</b>
          </div>
        )}
      </div>

      <p style={{ margin: "12px 0 0", fontSize: 11, color: C.muted }}>
        <b>Auto-retry:</b> bot tenta login várias vezes, re-dispara SMS automaticamente.<br/>
        <b>Manual:</b> bot só preenche login/senha, pede 1 SMS e para.
      </p>
    </div>
  );
}
