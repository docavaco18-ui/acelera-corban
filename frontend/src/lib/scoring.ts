import type { Lead, Tier, ScoredRecord } from "./types";

export function calcScore(lead: Lead, maxMargem: number, maxValor: number): number {
  const margem = lead.margem_disponivel ?? 0;
  const valor = lead.valor_liberado ?? 0;
  const margemNorm = maxMargem > 0 ? (margem / maxMargem) * 100 : 0;
  const valorNorm = maxValor > 0 ? (valor / maxValor) * 100 : 0;
  // 50/50 weight (V8 has no tempo_de_casa)
  return margemNorm * 0.5 + valorNorm * 0.5;
}

export function getTier(score: number, allScores: number[]): Tier {
  if (allScores.length === 0) return "bronze";
  const sorted = [...allScores].sort((a, b) => b - a);
  const cutGold = sorted[Math.max(0, Math.ceil(sorted.length * 0.25) - 1)] ?? 0;
  const cutBronze = sorted[Math.max(0, Math.ceil(sorted.length * 0.75) - 1)] ?? 0;
  if (score >= cutGold) return "gold";
  if (score >= cutBronze) return "silver";
  return "bronze";
}

export function calcAllScores(leads: Lead[]): ScoredRecord[] {
  const maxMargem = Math.max(...leads.map((l) => l.margem_disponivel ?? 0), 0);
  const maxValor = Math.max(...leads.map((l) => l.valor_liberado ?? 0), 0);
  const scored = leads.map((l) => ({
    ...l,
    score: calcScore(l, maxMargem, maxValor),
    tier: "bronze" as Tier,
  }));
  const allScores = scored.map((r) => r.score);
  return scored.map((r) => ({ ...r, tier: getTier(r.score, allScores) }));
}

export function fmtBRL(v: number | null): string {
  const n = v ?? 0;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
