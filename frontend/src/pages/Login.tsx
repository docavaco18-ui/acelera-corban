import { useState, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "Email ou senha incorretos.";
  if (m.includes("email not confirmed")) return "Email ainda não confirmado. Verifique sua caixa de entrada.";
  if (m.includes("rate limit") || m.includes("too many")) return "Muitas tentativas. Aguarde um momento e tente novamente.";
  if (m.includes("network") || m.includes("fetch")) return "Falha de conexão. Verifique sua internet e tente novamente.";
  return "Não foi possível entrar. Tente novamente.";
}

export function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      console.error("login:", error.message);
      setErr(friendlyAuthError(error.message));
      return;
    }
    nav("/", { replace: true });
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#080818", display: "flex",
      alignItems: "center", justifyContent: "center", color: "#e0e0f0",
      fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    }}>
      <form onSubmit={submit} style={{
        background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.07)",
        borderRadius: 16, padding: 32, width: "min(420px, 90vw)",
      }}>
        <h1 style={{ fontSize: "1.4rem", fontWeight: 800, marginBottom: 6 }}>Acelera Corban</h1>
        <p style={{ color: "#666", fontSize: ".85rem", marginBottom: 24 }}>
          Acesso restrito. Faça login para continuar.
        </p>

        <label htmlFor="login-email" style={{ display: "block", fontSize: ".75rem", color: "#888", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".5px" }}>
          Email
        </label>
        <input
          id="login-email" name="email" autoComplete="email"
          type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus
          style={{
            width: "100%", padding: "10px 12px", background: "#0d0d1f",
            border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, color: "#fff",
            fontSize: ".9rem", marginBottom: 16,
          }}
        />

        <label htmlFor="login-password" style={{ display: "block", fontSize: ".75rem", color: "#888", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".5px" }}>
          Senha
        </label>
        <input
          id="login-password" name="password" autoComplete="current-password"
          type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
          style={{
            width: "100%", padding: "10px 12px", background: "#0d0d1f",
            border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, color: "#fff",
            fontSize: ".9rem", marginBottom: 20,
          }}
        />

        {err && (
          <div role="alert" style={{
            background: "rgba(255,45,120,.1)", border: "1px solid rgba(255,45,120,.3)",
            color: "#ff2d78", padding: "8px 12px", borderRadius: 8, marginBottom: 14,
            fontSize: ".82rem",
          }}>
            {err}
          </div>
        )}

        <button type="submit" disabled={loading} style={{
          width: "100%", padding: "11px 16px", borderRadius: 22,
          background: loading ? "#1a1a2e" : "rgba(180,74,255,.18)",
          color: loading ? "#666" : "#b44aff",
          border: `1px solid ${loading ? "rgba(255,255,255,.07)" : "rgba(180,74,255,.4)"}`,
          fontWeight: 700, fontSize: ".85rem", cursor: loading ? "wait" : "pointer",
          letterSpacing: ".4px", textTransform: "uppercase",
        }}>
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}

export default Login;
