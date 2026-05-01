import { useEffect, useMemo, useState } from "react";
import { leadsApi } from "../lib/api";
import { fmtBRL } from "../lib/scoring";
import type { Lead, LeadStatus } from "../lib/types";

const PAGE_SIZE = 50;

const statusColor = (s: LeadStatus): string => {
  if (s === "elegivel") return "#22c55e";
  if (s === "inelegivel") return "#ef4444";
  if (s === "erro") return "#dc2626";
  if (s === "autorizado" || s === "consentido") return "#3b82f6";
  if (s === "enriquecido" || s === "aguardando_resultado") return "#f59e0b";
  return "#94a3b8";
};

const statusLabel = (s: LeadStatus): string => {
  const map: Record<LeadStatus, string> = {
    pendente: "Pendente",
    enriquecido: "Enriquecido",
    consentido: "Consentido",
    autorizado: "Autorizado",
    aguardando_resultado: "Aguardando",
    elegivel: "Elegível",
    inelegivel: "Inelegível",
    erro: "Erro",
  };
  return map[s] ?? s;
};

function tryParseJson(s: string | null): unknown | null {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function summarizeErro(s: string | null): string {
  if (!s) return "—";
  const j = tryParseJson(s);
  if (j && typeof j === "object") {
    const o = j as Record<string, unknown>;
    return String(o.description ?? o.title ?? o.status ?? o.detail ?? s).slice(0, 140);
  }
  return s.length > 140 ? s.slice(0, 140) + "…" : s;
}

function ErroModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const j = tryParseJson(lead.erro);
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "#0d0d1f", border: "1px solid #334155", borderRadius: 12,
        padding: 20, maxWidth: 720, width: "100%", maxHeight: "80vh", overflow: "auto",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <div style={{ color: "#fff", fontWeight: 700 }}>Retorno V8 — {lead.nome ?? lead.cpf}</div>
            <div style={{ color: "#64748b", fontSize: 12, fontFamily: "monospace" }}>{lead.cpf}</div>
          </div>
          <button onClick={onClose} style={{
            background: "transparent", color: "#94a3b8", border: "1px solid #334155",
            borderRadius: 6, padding: "4px 10px", cursor: "pointer",
          }}>Fechar ✕</button>
        </div>
        <pre style={{
          background: "#000", color: "#e0e0f0", padding: 14, borderRadius: 8, fontSize: 12,
          overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
          fontFamily: "monospace", margin: 0, border: "1px solid #1e293b",
        }}>
          {j ? JSON.stringify(j, null, 2) : (lead.erro ?? "")}
        </pre>
      </div>
    </div>
  );
}

export default function ResultsTable() {
  const [records, setRecords] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [erroContains, setErroContains] = useState("");
  const [erroDebounced, setErroDebounced] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [detalhe, setDetalhe] = useState<Lead | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setErroDebounced(erroContains.trim()), 350);
    return () => clearTimeout(t);
  }, [erroContains]);

  useEffect(() => {
    setLoading(true);
    leadsApi
      .list({
        status: statusFilter || undefined,
        erro_contains: erroDebounced || undefined,
        limit: PAGE_SIZE,
        page,
      })
      .then((data) => { setRecords(data); setLoading(false); });
  }, [statusFilter, erroDebounced, page]);

  const filtered = useMemo(() =>
    search
      ? records.filter(
          (r) => r.cpf.includes(search) ||
                 (r.nome?.toLowerCase().includes(search.toLowerCase()) ?? false)
        )
      : records,
    [records, search]
  );

  const setStatus = (v: string) => { setStatusFilter(v); setPage(1); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="Buscar CPF ou nome..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: 6, background: "#1a1f2e", border: "1px solid #334155", color: "#fff", fontSize: 13 }}
        />
        <select value={statusFilter} onChange={(e) => setStatus(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: 6, background: "#1a1f2e", border: "1px solid #334155", color: "#fff" }}>
          <option value="">Todos os status</option>
          {(["pendente","enriquecido","consentido","autorizado","aguardando_resultado","elegivel","inelegivel","erro"] as LeadStatus[]).map((s) => (
            <option key={s} value={s}>{statusLabel(s)}</option>
          ))}
        </select>
        <input
          placeholder="Motivo contém... (ex: REJECTED, marginBaseValue)"
          value={erroContains}
          onChange={(e) => { setErroContains(e.target.value); setPage(1); }}
          style={{ padding: "8px 12px", borderRadius: 6, background: "#1a1f2e", border: "1px solid #334155", color: "#fff", fontSize: 13, minWidth: 260 }}
        />
        <button onClick={() => leadsApi.exportCsv(statusFilter || "elegivel")}
          style={{ padding: "8px 14px", background: "#22c55e", color: "#000", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
          ⬇ CSV {statusFilter ? `(${statusLabel(statusFilter as LeadStatus)})` : "(elegíveis)"}
        </button>
        <span style={{ color: "#475569", fontSize: 12, marginLeft: "auto" }}>{filtered.length} registros</span>
      </div>

      {loading ? (
        <div style={{ color: "#475569", padding: 16 }}>Carregando...</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#1a1f2e" }}>
                {["CPF", "Nome", "Telefone", "Status", "Margem", "Valor Liberado", "Parcela", "Parcelas", "CET", "Motivo V8"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 12px", color: "#94a3b8", borderBottom: "1px solid #334155", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid #1e293b" }}>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#94a3b8" }}>{r.cpf}</td>
                  <td style={{ padding: "8px 12px", color: "#e2e8f0" }}>{r.nome || "—"}</td>
                  <td style={{ padding: "8px 12px", color: "#94a3b8" }}>{r.telefone || "—"}</td>
                  <td style={{ padding: "8px 12px", color: statusColor(r.status), fontWeight: 600 }}>{statusLabel(r.status)}</td>
                  <td style={{ padding: "8px 12px", color: "#e2e8f0" }}>{r.margem_disponivel != null ? fmtBRL(r.margem_disponivel) : "—"}</td>
                  <td style={{ padding: "8px 12px", color: "#e2e8f0" }}>{r.valor_liberado != null ? fmtBRL(r.valor_liberado) : "—"}</td>
                  <td style={{ padding: "8px 12px", color: "#e2e8f0" }}>{r.valor_parcela != null ? fmtBRL(r.valor_parcela) : "—"}</td>
                  <td style={{ padding: "8px 12px", color: "#e2e8f0" }}>{r.num_parcelas ?? "—"}</td>
                  <td style={{ padding: "8px 12px", color: "#e2e8f0" }}>{r.cet_mensal != null ? `${r.cet_mensal}%` : "—"}</td>
                  <td onClick={() => r.erro && setDetalhe(r)}
                      title={r.erro ? "clique para ver retorno cru da V8" : ""}
                      style={{
                        padding: "8px 12px", color: "#ef4444", fontSize: 11, maxWidth: 280,
                        cursor: r.erro ? "pointer" : "default",
                        textDecoration: r.erro ? "underline dotted" : "none",
                      }}>
                    {summarizeErro(r.erro)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
          style={{ padding: "6px 14px", background: "#1a1f2e", color: "#94a3b8", border: "1px solid #334155", borderRadius: 6, cursor: "pointer" }}>
          ← Anterior
        </button>
        <span style={{ color: "#94a3b8", fontSize: 13 }}>Página {page}</span>
        <button onClick={() => setPage((p) => p + 1)} disabled={records.length < PAGE_SIZE}
          style={{ padding: "6px 14px", background: "#1a1f2e", color: "#94a3b8", border: "1px solid #334155", borderRadius: 6, cursor: "pointer" }}>
          Próxima →
        </button>
      </div>

      {detalhe && <ErroModal lead={detalhe} onClose={() => setDetalhe(null)} />}
    </div>
  );
}
