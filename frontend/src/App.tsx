import { BrowserRouter, Routes, Route, NavLink, Navigate } from "react-router-dom";
import Higienizacao from "./pages/Higienizacao";
import DashboardAgregado from "./pages/DashboardAgregado";
import Configuracoes from "./pages/Configuracoes";
import Records from "./pages/Records";
import Login from "./pages/Login";
import Admin from "./pages/Admin";
import CRM from "./pages/CRM";
import Chatwoot from "./pages/Chatwoot";
import Disparo from "./pages/Disparo";
import DisparoAesir from "./pages/DisparoAesir";
import DisparoChipcare from "./pages/DisparoChipcare";
import Mercantil from "./pages/Mercantil";
import Presenca from "./pages/Presenca";
import PowerHub from "./pages/PowerHub";
import { useSession } from "./hooks/useSession";
import { useBank } from "./hooks/useBank";
import { supabase } from "./lib/supabase";
import MercantilSmsModal from "./components/MercantilSmsModal";

function BankToggle() {
  const { bank, setBank } = useBank();
  const reload = (b: "v8" | "vctex" | "mercantil" | "presenca" | "powerhub") => {
    setBank(b as any);
    if (b === "mercantil") {
      window.location.href = "/mercantil";
    } else if (b === "presenca") {
      window.location.href = "/presenca";
    } else if (b === "powerhub") {
      window.location.href = "/powerhub";
    } else {
      window.location.reload();
    }
  };
  const labels: Record<"v8" | "vctex" | "mercantil" | "presenca" | "powerhub", string> = {
    v8: "V8",
    vctex: "VCTex",
    mercantil: "Mercantil",
    presenca: "Presença",
    powerhub: "PowerHub",
  };
  return (
    <div style={{ display: "flex", gap: 0, marginRight: 8, border: "1px solid #334155", borderRadius: 14, overflow: "hidden" }}>
      {(["v8", "vctex", "mercantil", "presenca", "powerhub"] as const).map(b => (
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
          {labels[b]}
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
        {bank === "vctex" ? "VCTex" : bank === "mercantil" ? "Mercantil" : bank === "presenca" ? "Presença" : "V8"}
      </span>
      {[
        ["/", "Higienização"],
        ["/dashboard", "Dashboard"],
        ["/crm", "CRM"],
        ["/chatwoot", "CRM Chatwoot"],
        ["/disparo", "Disparo WhatsApp"],
        ["/disparo-aesir", "Disparo Aesir"],
        ["/disparo-chipcare", "Disparo Chipcare"],
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
              <MercantilSmsModal />
              <Routes>
                <Route path="/" element={<Higienizacao />} />
                <Route path="/higienizacao" element={<Higienizacao />} />
                <Route path="/dashboard" element={<DashboardAgregado />} />
                <Route path="/configuracoes" element={<Configuracoes />} />
                <Route path="/crm" element={<CRM />} />
                <Route path="/chatwoot" element={<Chatwoot />} />
                <Route path="/disparo" element={<Disparo />} />
                <Route path="/disparo-aesir" element={<DisparoAesir />} />
                <Route path="/disparo-chipcare" element={<DisparoChipcare />} />
                <Route path="/mercantil" element={<Mercantil />} />
                <Route path="/presenca" element={<Presenca />} />
                <Route path="/powerhub" element={<PowerHub />} />
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
