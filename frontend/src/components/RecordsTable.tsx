import { fmtBRL } from "../lib/scoring";
import type { Lead, LeadStatus } from "../lib/types";

const corStatus = (s: LeadStatus): string => {
  if (s === "elegivel") return "#22c55e";
  if (s === "inelegivel") return "#ef4444";
  if (s === "erro") return "#dc2626";
  if (s === "autorizado" || s === "consentido") return "#3b82f6";
  return "#94a3b8";
};

interface Props {
  records: Lead[];
  loading: boolean;
}

export default function RecordsTable({ records, loading }: Props) {
  if (loading) return <p style={{ color: "#94a3b8" }}>Carregando registros...</p>;
  if (records.length === 0) return <p style={{ color: "#94a3b8" }}>Nenhum registro encontrado.</p>;

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#1a1f2e" }}>
            {["CPF", "Nome", "Telefone", "Status", "Margem", "Valor Liberado", "Parcelas"].map((h) => (
              <th
                key={h}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderBottom: "1px solid #334155",
                  fontWeight: 600,
                  color: "#94a3b8",
                  whiteSpace: "nowrap",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id} style={{ borderBottom: "1px solid #1e293b" }}>
              <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 12, color: "#94a3b8" }}>{r.cpf}</td>
              <td style={{ padding: "8px 12px", color: "#e2e8f0" }}>{r.nome ?? "—"}</td>
              <td style={{ padding: "8px 12px", color: "#94a3b8" }}>{r.telefone ?? "—"}</td>
              <td style={{ padding: "8px 12px", color: corStatus(r.status), fontWeight: 600 }}>
                {r.status}
              </td>
              <td style={{ padding: "8px 12px", color: "#e2e8f0" }}>{r.margem_disponivel != null ? fmtBRL(r.margem_disponivel) : "—"}</td>
              <td style={{ padding: "8px 12px", color: "#e2e8f0" }}>{r.valor_liberado != null ? fmtBRL(r.valor_liberado) : "—"}</td>
              <td style={{ padding: "8px 12px", color: "#e2e8f0" }}>{r.num_parcelas ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
