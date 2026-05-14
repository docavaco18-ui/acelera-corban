import SessionPanel from "../components/mercantil/SessionPanel";
import LeadsPanel from "../components/mercantil/LeadsPanel";
import { useMercantilSession } from "../hooks/useMercantilSession";

export default function Mercantil() {
  const session = useMercantilSession();

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1400, margin: "0 auto" }}>
      <h1 style={{ color: "#fff", fontSize: "1.4rem", fontWeight: 800, marginBottom: 24 }}>
        🏦 Mercantil Bot — CLT / MTE
      </h1>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
        <SessionPanel />
        <LeadsPanel sessionValid={session.status === "valid"} />
      </div>
    </div>
  );
}
