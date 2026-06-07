import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
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
import ModoDeUso from "./pages/ModoDeUso";
import CentralControle from "./pages/CentralControle";
import { useSession } from "./hooks/useSession";
import { useBank } from "./hooks/useBank";
import { supabase } from "./lib/supabase";
import MercantilSmsModal from "./components/MercantilSmsModal";

function NavDropdown({ label, items, activePaths }: {
  label: string;
  items: { to: string; label: string; onClick?: () => void }[];
  activePaths: string[];
}) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const isActiveGroup = activePaths.some(p =>
    p === "/" ? location.pathname === "/" || location.pathname === "/higienizacao" : location.pathname.startsWith(p)
  );
  return (
    <div
      style={{ position: "relative" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button className={`nav-dropdown-btn${isActiveGroup ? " group-active" : ""}`}>
        {label}
        <span style={{ fontSize: 9, opacity: .6, marginTop: 1, transition: "transform .2s", transform: open ? "rotate(180deg)" : "none" }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0,
          paddingTop: 6, zIndex: 200,
          minWidth: 180,
        }}>
        <div style={{
          background: "rgba(8,8,22,.96)",
          border: "1px solid rgba(124,58,237,.25)",
          borderRadius: 10, padding: "6px 0",
          boxShadow: "0 16px 40px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.04)",
          backdropFilter: "blur(16px)",
        }}>
          {items.map(item => (
            <NavLink
              key={item.to + (item.label)}
              to={item.to}
              onClick={item.onClick}
              className={({ isActive }) => `nav-drop-item${isActive ? " active" : ""}`}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
        </div>
      )}
    </div>
  );
}

function TopBar() {
  const { email, isAdmin } = useSession();
  const { setBank } = useBank();
  const navigate = useNavigate();

  const goBank = (b: "v8" | "vctex" | "mercantil" | "presenca") => {
    setBank(b as any);
    if (b === "mercantil") navigate("/mercantil");
    else if (b === "presenca") navigate("/presenca");
    else navigate("/higienizacao");
  };

  const singleLinks = [
    ["/dashboard", "Dashboard"],
    ["/crm", "CRM"],
    ["/powerhub", "PowerHub"],
    ["/configuracoes", "Configurações"],
    ["/central-controle", "Central de Controle"],
    ["/modo-de-uso", "Modo de Uso"],
    ...(isAdmin ? [["/admin", "Admin"]] : []),
  ] as [string, string][];

  return (
    <nav style={{
      padding: "10px 24px",
      background: "rgba(6,6,18,.88)",
      backdropFilter: "blur(20px)",
      WebkitBackdropFilter: "blur(20px)",
      borderBottom: "1px solid rgba(255,255,255,.07)",
      display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap",
      position: "sticky", top: 0, zIndex: 100,
      boxShadow: "0 2px 24px rgba(0,0,0,.55)",
    }}>
      <style>{`
        @keyframes nav-logo-pulse{0%,100%{opacity:1}50%{opacity:.8}}
        @keyframes nav-shine{0%{background-position:200% center}100%{background-position:-200% center}}
        .nav-logo{
          background: linear-gradient(135deg,#a78bfa 0%,#06b6d4 50%,#a78bfa 100%);
          background-size: 200% auto;
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: nav-shine 4s linear infinite;
          font-weight: 900; font-size: 19px; letter-spacing: -.3px; cursor: default;
        }
        .nav-link-item{
          color: #64748b; text-decoration: none; font-size: 13px; font-weight: 500;
          padding: 4px 0; position: relative; transition: color .2s;
        }
        .nav-link-item:hover{color:#a78bfa!important}
        .nav-link-item.active{color:#a78bfa!important}
        .nav-link-item.active::after{
          content:''; position:absolute; bottom:-2px; left:0; right:0;
          height:2px; border-radius:2px;
          background: linear-gradient(90deg,#7c3aed,#06b6d4);
        }
        .nav-drop-item{display:block;padding:9px 18px;color:#94a3b8;text-decoration:none;font-size:13px;font-weight:400;background:transparent;transition:background .15s,color .15s}
        .nav-drop-item:hover{background:rgba(124,58,237,.12)!important;color:#a78bfa!important}
        .nav-drop-item.active{color:#7c3aed!important;font-weight:700}
        .nav-dropdown-btn{background:none;border:none;cursor:pointer;font-size:13px;font-weight:500;color:#64748b;display:flex;align-items:center;gap:5px;padding:4px 0;font-family:inherit;transition:color .2s}
        .nav-dropdown-btn:hover,.nav-dropdown-btn.group-active{color:#a78bfa!important}
        .nav-badge{background:rgba(124,58,237,.18);color:#a78bfa;border:1px solid rgba(124,58,237,.35);border-radius:4px;font-size:9px;font-weight:800;padding:1px 5px;letter-spacing:.04em}
      `}</style>
      <span className="nav-logo">Acelera</span>

      {/* Higienização CLT dropdown */}
      <NavDropdown
        label="Higienização CLT"
        activePaths={["/", "/mercantil", "/presenca"]}
        items={[
          { to: "/higienizacao", label: "V8", onClick: () => goBank("v8") },
          { to: "/higienizacao", label: "VCTex", onClick: () => goBank("vctex") },
          { to: "/mercantil", label: "Mercantil", onClick: () => goBank("mercantil") },
          { to: "/presenca", label: "Presença", onClick: () => goBank("presenca") },
        ]}
      />

      {/* Disparo dropdown */}
      <NavDropdown
        label="Disparo"
        activePaths={["/disparo"]}
        items={[
          { to: "/disparo", label: "VendeAI" },
          { to: "/disparo-aesir", label: "Aesir" },
          { to: "/disparo-chipcare", label: "Chipcare" },
        ]}
      />

      {/* Links avulsos */}
      {singleLinks.map(([to, label]) => (
        <NavLink key={to} to={to}
          className={({ isActive }) => `nav-link-item${isActive ? " active" : ""}`}
        >
          {label}
        </NavLink>
      ))}

      <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
        {isAdmin && (
          <span style={{
            background: "rgba(124,58,237,.15)", color: "#a78bfa",
            border: "1px solid rgba(124,58,237,.3)", borderRadius: 5,
            fontSize: 9, fontWeight: 800, padding: "2px 7px", letterSpacing: ".06em",
          }}>ADMIN</span>
        )}
        <span style={{ color: "#475569", fontSize: 11, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {email}
        </span>
        <button
          onClick={() => supabase.auth.signOut()}
          style={{
            background: "rgba(255,255,255,.04)", color: "#64748b",
            border: "1px solid rgba(255,255,255,.08)", borderRadius: 8,
            padding: "4px 14px", fontSize: 11, cursor: "pointer",
            transition: "all .2s", fontWeight: 600,
          }}
          onMouseEnter={e => { (e.target as HTMLElement).style.color = "#ef4444"; (e.target as HTMLElement).style.borderColor = "rgba(239,68,68,.3)"; }}
          onMouseLeave={e => { (e.target as HTMLElement).style.color = "#64748b"; (e.target as HTMLElement).style.borderColor = "rgba(255,255,255,.08)"; }}
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
                <Route path="/modo-de-uso" element={<ModoDeUso />} />
                <Route path="/mercantil" element={<Mercantil />} />
                <Route path="/presenca" element={<Presenca />} />
                <Route path="/powerhub" element={<PowerHub />} />
                <Route path="/registros" element={<Records />} />
                <Route path="/admin" element={<Protected adminOnly><Admin /></Protected>} />
                <Route path="/central-controle" element={<CentralControle />} />
              </Routes>
            </Protected>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
