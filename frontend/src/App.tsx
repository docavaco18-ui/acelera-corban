import { BrowserRouter, Routes, Route, NavLink, Navigate } from "react-router-dom";
import Higienizacao from "./pages/Higienizacao";
import DashboardAgregado from "./pages/DashboardAgregado";
import Configuracoes from "./pages/Configuracoes";
import Records from "./pages/Records";
import Login from "./pages/Login";
import Admin from "./pages/Admin";
import CRM from "./pages/CRM";
import { useSession } from "./hooks/useSession";
import { useBank } from "./hooks/useBank";
import { supabase } from "./lib/supabase";

function BankToggle() {
  const { bank, setBank } = useBank();
  const reload = (b: "v8" | "vctex") => {
    setBank(b);
    // Força refetch das páginas que dependem do bank
    window.location.reload();
  };
  return (
    <div style={{ display: "flex", gap: 0, marginRight: 8, border: "1px solid #334155", borderRadius: 14, overflow: "hidden" }}>
      {(["v8", "vctex"] as const).map(b => (
        <button
          key={b}
          onClick={() => reload(b)}
          style={{
            padding: "5px 12px",
            background: bank === b ? "#6366f1" : "transparent",
            color: bank === b ? "#fff" : "#94a3b8",
            border: "none",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 700,
            textTransform: "uppercase",
          }}
        >
          {b === "v8" ? "V8" : "VCTex"}
        </button>
      ))}
    </div>
  );
}

function TopBar() {
  const { email, isAdmin } = useSession();
  const { bank } = useBank();
  return (
    <nav style={{
      padding: "12px 24px", background: "#1e293b",
      display: "flex", gap: 24, alignItems: "center",
    }}>
      <span style={{ color: "#6366f1", fontWeight: "bold", fontSize: 18 }}>
        {bank === "vctex" ? "VCTex" : "V8"}
      </span>
      {[
        ["/", "Higienização"],
        ["/dashboard", "Dashboard"],
        ["/crm", "CRM"],
        ["/registros", "Registros"],
        ["/configuracoes", "Configurações"],
        ...(isAdmin ? [["/admin", "Admin"] as const] : []),
      ].map(([to, label]) => (
        <NavLink key={to} to={to} end
          style={({ isActive }) => ({
            color: isActive ? "#6366f1" : "#94a3b8",
            textDecoration: "none", fontSize: 14,
          })}
        >
          {label}
        </NavLink>
      ))}
      <div style={{ marginLeft: "auto", display: "flex", gap: 14, alignItems: "center" }}>
        <BankToggle />
        <span style={{ color: "#94a3b8", fontSize: 12 }}>
          {email}{isAdmin ? " · admin" : ""}
        </span>
        <button
          onClick={() => supabase.auth.signOut()}
          style={{
            background: "transparent", color: "#94a3b8",
            border: "1px solid #334155", borderRadius: 14,
            padding: "4px 12px", fontSize: 12, cursor: "pointer",
          }}
        >
          Sair
        </button>
      </div>
    </nav>
  );
}

function Protected({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { session, loading, isAdmin } = useSession();
  if (loading) return <div style={{ padding: 40, color: "#94a3b8" }}>Carregando…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="*"
          element={
            <Protected>
              <TopBar />
              <Routes>
                <Route path="/" element={<Higienizacao />} />
                <Route path="/higienizacao" element={<Higienizacao />} />
                <Route path="/dashboard" element={<DashboardAgregado />} />
                <Route path="/configuracoes" element={<Configuracoes />} />
                <Route path="/crm" element={<CRM />} />
                <Route path="/registros" element={<Records />} />
                <Route path="/admin" element={<Protected adminOnly><Admin /></Protected>} />
              </Routes>
            </Protected>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
