import { useState } from "react";
import { useEligibleScore } from "../hooks/useEligibleScore";
import { leadsApi } from "../lib/api";
import { fmtBRL } from "../lib/scoring";
import type { ScoredRecord, Tier } from "../lib/types";

const tierBadge: Record<Tier, { emoji: string; color: string; label: string }> = {
  gold:   { emoji: "🥇", color: "#fbbf24", label: "Gold" },
  silver: { emoji: "🥈", color: "#94a3b8", label: "Silver" },
  bronze: { emoji: "🥉", color: "#d97706", label: "Bronze" },
};

function maskCPF(cpf: string): string {
  const digits = cpf.replace(/\D/g, "");
  if (digits.length < 11) return cpf;
  return `${digits.slice(0, 3)}.***.***-${digits.slice(-2)}`;
}

function exportGoldCSV(records: ScoredRecord[]) {
  const gold = records.filter((r) => r.tier === "gold");
  const cols = ["cpf", "nome", "telefone", "margem_disponivel", "valor_liberado", "valor_parcela", "num_parcelas", "cet_mensal"] as const;
  const headers = cols.join(";");
  const rows = gold.map((r) => cols.map((c) => `"${(r[c] ?? "").toString()}"`).join(";"));
  const csv = "\uFEFF" + [headers, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `v8-gold-${date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function EligibleRanking() {
  const { records, loading } = useEligibleScore();
  const [sortBy, setSortBy] = useState<"score" | "margem" | "valor">("score");
  const [filterTier, setFilterTier] = useState<Tier | "all">("all");

  if (loading) return <div style={{ color: "#475569", padding: 16 }}>Calculando scores...</div>;

  const sorted = [...records]
    .filter((r) => filterTier === "all" || r.tier === filterTier)
    .sort((a, b) => {
      if (sortBy === "score") return b.score - a.score;
      if (sortBy === "margem") return (b.margem_disponivel ?? 0) - (a.margem_disponivel ?? 0);
      if (sortBy === "valor") return (b.valor_liberado ?? 0) - (a.valor_liberado ?? 0);
      return 0;
    });

  const tierCount: Record<Tier, number> = {
    gold: records.filter((r) => r.tier === "gold").length,
    silver: records.filter((r) => r.tier === "silver").length,
    bronze: records.filter((r) => r.tier === "bronze").length,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        {(["all", "gold", "silver", "bronze"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setFilterTier(t)}
            style={{
              padding: "6px 14px", borderRadius: 20, border: "none", cursor: "pointer", fontSize: 13,
              background: filterTier === t ? "#6366f1" : "#1a1f2e",
              color: filterTier === t ? "#fff" : "#94a3b8",
            }}
          >
            {t === "all" ? `Todos (${records.length})` : `${tierBadge[t].emoji} ${tierBadge[t].label} (${tierCount[t]})`}
          </button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ color: "#475569", fontSize: 12 }}>Ordenar por:</span>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            style={{ padding: "6px 10px", background: "#1a1f2e", border: "1px solid #334155", color: "#fff", borderRadius: 6 }}>
            <option value="score">Score</option>
            <option value="margem">Margem</option>
            <option value="valor">Valor Liberado</option>
          </select>
          <button onClick={() => leadsApi.exportCsv("elegivel")}
            style={{ padding: "6px 14px", background: "#22c55e", color: "#000", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
            ⬇ CSV Elegíveis
          </button>
          <button onClick={() => exportGoldCSV(records)}
            style={{ padding: "6px 14px", background: "#fbbf24", color: "#000", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
            🥇 Exportar Gold
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
        {sorted.map((r, i) => {
          const tb = tierBadge[r.tier];
          return (
            <div key={r.id} style={{
              background: "#1a1f2e",
              border: `1px solid ${tb.color}`,
              borderRadius: 10,
              padding: "14px 16px",
              position: "relative",
            }}>
              <div style={{ position: "absolute", top: 10, right: 12, fontSize: 20 }}>{tb.emoji}</div>
              <div style={{ fontSize: 10, color: "#475569", marginBottom: 4 }}>#{i + 1}</div>
              <div style={{ fontFamily: "monospace", fontSize: 13, color: "#94a3b8", marginBottom: 2 }}>
                {maskCPF(r.cpf)}
              </div>
              <div style={{ fontWeight: 600, color: "#e2e8f0", marginBottom: 8, fontSize: 14 }}>
                {r.nome || "—"}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={{ background: "#0f1117", padding: "3px 8px", borderRadius: 4, fontSize: 11, color: "#22c55e" }}>
                  margem {fmtBRL(r.margem_disponivel)}
                </span>
                <span style={{ background: "#0f1117", padding: "3px 8px", borderRadius: 4, fontSize: 11, color: "#6366f1" }}>
                  {fmtBRL(r.valor_liberado)}
                </span>
                {r.num_parcelas && (
                  <span style={{ background: "#0f1117", padding: "3px 8px", borderRadius: 4, fontSize: 11, color: "#94a3b8" }}>
                    {r.num_parcelas}x
                  </span>
                )}
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: "#475569" }}>
                Score: <span style={{ color: tb.color, fontWeight: 600 }}>{r.score.toFixed(1)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {sorted.length === 0 && (
        <div style={{ color: "#475569", padding: 24, textAlign: "center" }}>
          Nenhum elegível encontrado.
        </div>
      )}
    </div>
  );
}
