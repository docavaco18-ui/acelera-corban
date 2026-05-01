import { useEffect, useState } from "react";
import { leadsApi } from "../lib/api";
import type { Lead, LeadStatus } from "../lib/types";
import RecordsTable from "../components/RecordsTable";

const PAGE_SIZE = 50;

const selectStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 6,
  border: "1px solid #334155",
  fontSize: 13,
  background: "#1a1f2e",
  color: "#fff",
};

const btnStyle = (disabled: boolean): React.CSSProperties => ({
  padding: "8px 14px",
  borderRadius: 6,
  border: "1px solid #334155",
  background: disabled ? "#1a1f2e" : "#6366f1",
  color: disabled ? "#475569" : "#fff",
  cursor: disabled ? "not-allowed" : "pointer",
  fontSize: 13,
});

const STATUSES: LeadStatus[] = [
  "pendente","enriquecido","consentido","autorizado",
  "aguardando_resultado","elegivel","inelegivel","erro",
];

export default function Records() {
  const [records, setRecords] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setLoading(true);
    leadsApi
      .list({ status: status || undefined, limit: PAGE_SIZE, page })
      .then((data) => {
        setRecords(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [status, page]);

  return (
    <div style={{ padding: 24, background: "#0f1117", minHeight: "100vh", color: "#fff" }}>
      <h1 style={{ color: "#e2e8f0", marginBottom: 16 }}>Registros V8</h1>

      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          style={selectStyle}
        >
          <option value="">Todos os status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <RecordsTable records={records} loading={loading} />

      <div style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "center" }}>
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1}
          style={btnStyle(page === 1)}
        >
          ← Anterior
        </button>
        <span style={{ fontSize: 13, color: "#94a3b8" }}>Página {page}</span>
        <button
          onClick={() => setPage((p) => p + 1)}
          disabled={records.length < PAGE_SIZE}
          style={btnStyle(records.length < PAGE_SIZE)}
        >
          Próxima →
        </button>
      </div>
    </div>
  );
}
