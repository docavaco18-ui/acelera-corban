import PresencaLeadsPanel from "../components/presenca/LeadsPanel";

export default function Presenca() {
  return (
    <div style={{ padding: "24px 32px", maxWidth: 1400, margin: "0 auto" }}>
      <h1 style={{ color: "#fff", fontSize: "1.4rem", fontWeight: 800, marginBottom: 8 }}>
        🏦 Presença Bank — Click Bot
      </h1>
      <p style={{ color: "#94a3b8", fontSize: 13, marginBottom: 24 }}>
        Automação click bot. Certifique-se de que as credenciais estão cadastradas em Configurações.
      </p>

      <PresencaLeadsPanel />
    </div>
  );
}
