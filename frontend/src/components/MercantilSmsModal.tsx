/**
 * Modal SMS Mercantil. Montado em App.tsx dentro do Protected layout —
 * fica em background até receber sms_required via WS.
 *
 * UX:
 * - Modal centralizado, dark, 6 inputs separados
 * - Auto-foca primeiro input
 * - Auto-avança ao digitar
 * - Backspace volta um campo
 * - Submit ao chegar 6 dígitos OU clicar botão
 * - Mostra reason (1ª vez vs código errado) + attempt counter
 * - NÃO permite fechar manualmente enquanto pending=true (intencional —
 *   user precisa do código pra bot continuar; se quiser parar, usa Stop Bot)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMercantilSmsBridge } from "../hooks/useMercantilSmsBridge";

const SIX = [0, 1, 2, 3, 4, 5] as const;

export default function MercantilSmsModal() {
  const bridge = useMercantilSmsBridge();
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([null, null, null, null, null, null]);

  // Reset campos quando um novo prompt chega
  useEffect(() => {
    if (bridge.pending) {
      setDigits(["", "", "", "", "", ""]);
      setTimeout(() => inputsRef.current[0]?.focus(), 50);
    }
  }, [bridge.pending, bridge.attempt, bridge.reason]);

  const code = useMemo(() => digits.join(""), [digits]);
  const canSubmit = code.length === 6 && !bridge.submitting;

  if (!bridge.pending) return null;

  const reasonLabel = bridge.reason === "wrong_code"
    ? "Código incorreto. Tente novamente."
    : bridge.reason === "timeout"
    ? "Tempo esgotado da tentativa anterior. Aguarde novo SMS."
    : "Aguardando código SMS";

  const handleChange = (i: number, v: string) => {
    const onlyDigit = v.replace(/\D/g, "").slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[i] = onlyDigit;
      return next;
    });
    if (onlyDigit && i < 5) {
      inputsRef.current[i + 1]?.focus();
    }
  };

  const handleKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      inputsRef.current[i - 1]?.focus();
    } else if (e.key === "ArrowLeft" && i > 0) {
      inputsRef.current[i - 1]?.focus();
    } else if (e.key === "ArrowRight" && i < 5) {
      inputsRef.current[i + 1]?.focus();
    } else if (e.key === "Enter" && canSubmit) {
      bridge.submit(code);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const txt = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (txt.length === 0) return;
    e.preventDefault();
    const next = ["", "", "", "", "", ""];
    for (let i = 0; i < txt.length; i++) next[i] = txt[i];
    setDigits(next);
    const lastFilled = Math.min(txt.length, 6) - 1;
    inputsRef.current[Math.min(lastFilled + 1, 5)]?.focus();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(2, 6, 23, 0.85)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          background: "#1e293b",
          border: "1px solid #334155",
          borderRadius: 16,
          padding: 32,
          maxWidth: 480,
          width: "100%",
          color: "#e2e8f0",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 20, color: "#fff" }}>
          Token SMS — Banco Mercantil
        </h2>
        <p style={{ marginTop: 12, marginBottom: 4, fontSize: 14, color: "#94a3b8" }}>
          {reasonLabel}
        </p>
        <p style={{ marginTop: 0, marginBottom: 24, fontSize: 13, color: "#64748b" }}>
          Digite o código de 6 dígitos enviado para o número
          {bridge.phoneHint ? <> com final <b>{bridge.phoneHint}</b></> : <> cadastrado</>}.
          {" "}Pode levar até 5 minutos pra chegar.
          {bridge.attempt > 1 && (
            <> <span style={{ color: "#f59e0b" }}>(tentativa {bridge.attempt})</span></>
          )}
        </p>

        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 16 }}>
          {SIX.map((i) => (
            <input
              key={i}
              ref={(el) => { inputsRef.current[i] = el; }}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={1}
              value={digits[i]}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKey(i, e)}
              onPaste={handlePaste}
              disabled={bridge.submitting}
              style={{
                width: 48,
                height: 56,
                textAlign: "center",
                fontSize: 24,
                fontWeight: 700,
                background: "#0f172a",
                color: "#fff",
                border: "1px solid #334155",
                borderRadius: 10,
                outline: "none",
                fontFamily: "monospace",
              }}
            />
          ))}
        </div>

        {bridge.errorMessage && (
          <div style={{
            background: "#7f1d1d",
            color: "#fecaca",
            padding: 10,
            borderRadius: 8,
            fontSize: 13,
            marginBottom: 12,
          }}>
            {bridge.errorMessage}
          </div>
        )}

        <button
          onClick={() => bridge.submit(code)}
          disabled={!canSubmit}
          style={{
            width: "100%",
            padding: "12px 16px",
            borderRadius: 10,
            background: canSubmit ? "#6366f1" : "#334155",
            color: canSubmit ? "#fff" : "#64748b",
            border: "none",
            fontSize: 14,
            fontWeight: 700,
            cursor: canSubmit ? "pointer" : "not-allowed",
          }}
        >
          {bridge.submitting ? "Enviando…" : "Verificar código"}
        </button>

        <p style={{ marginTop: 16, fontSize: 11, color: "#64748b", textAlign: "center" }}>
          {bridge.connected ? "🟢 Conectado" : "🔴 Reconectando…"} ·
          {" "}Para cancelar, pare o bot na aba Higienização.
        </p>
      </div>
    </div>
  );
}
