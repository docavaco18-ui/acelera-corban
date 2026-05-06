import React from "react";
import type { Batch } from "../lib/types";

const C = {
  bg2: "rgba(255,255,255,.04)",
  border: "rgba(255,255,255,.07)",
  green: "#00ff88",
  red: "#ff2d78",
  gold: "#ffd700",
  purple: "#b44aff",
  blue: "#00bfff",
};

const fmt = (x: number, d = 0) =>
  Number(x).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtBRL = (v: number | string | null | undefined) => {
  const n = Number(v ?? 0);
  return "R$ " + fmt(isFinite(n) ? n : 0, 2);
};
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

const fmtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const fmtDuration = (start: string | null, end: string | null): string => {
  if (!start) return "—";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  if (isNaN(s) || isNaN(e) || e < s) return "—";
  const sec = Math.floor((e - s) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}m`;
};

const statusBadge = (status: Batch["status"]): React.CSSProperties => {
  const map: Record<Batch["status"], { bg: string; color: string; border: string }> = {
    pendente:   { bg: "rgba(180,180,180,.1)", color: "#aaa",     border: "rgba(180,180,180,.25)" },
    processando:{ bg: "rgba(0,191,255,.12)",  color: C.blue,     border: "rgba(0,191,255,.3)" },
    concluida:  { bg: "rgba(0,255,136,.12)",  color: C.green,    border: "rgba(0,255,136,.3)" },
    cancelada:  { bg: "rgba(255,45,120,.1)",  color: C.red,      border: "rgba(255,45,120,.3)" },
  };
  const s = map[status] ?? map.pendente;
  return {
    background: s.bg, color: s.color, border: `1px solid ${s.border}`,
    padding: "3px 10px", borderRadius: 10, fontSize: ".68rem",
    fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px",
  };
};

const statusLabel: Record<Batch["status"], string> = {
  pendente: "Aguardando",
  processando: "Rodando",
  concluida: "Concluído",
  cancelada: "Cancelado",
};

interface Props {
  batches: Batch[];
  downloading: string | null;
  onDownload: (batch: Batch) => void;
  onRefresh: () => void;
}

export default function BatchHistoryList({ batches, downloading, onDownload, onRefresh }: Props) {
  if (batches.length === 0) {
    return (
      <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 22px", marginBottom: 14 }}>
        <div style={{ color: "#666", fontSize: ".9rem" }}>Nenhuma higienização registrada ainda.</div>
        <div style={{ color: "#444", fontSize: ".75rem", marginTop: 6 }}>Faça upload de um CSV pra começar.</div>
      </div>
    );
  }

  // Soma dos elegíveis e R$ liberado de batches concluídas — pra header
  const totais = batches.reduce(
    (acc, b) => {
      acc.batches += 1;
      acc.elegiveis += b.total_elegiveis ?? 0;
      acc.liberado += Number(b.total_liberado ?? 0);
      acc.processados += b.total_processed ?? 0;
      return acc;
    },
    { batches: 0, elegiveis: 0, liberado: 0, processados: 0 }
  );

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontSize: ".82rem", color: "#94a3b8" }}>
          📦 <b style={{ color: "#cbd5e1" }}>{totais.batches}</b> higienizações ·
          <b style={{ color: C.green, marginLeft: 6 }}>{fmt(totais.elegiveis)}</b> elegíveis no total ·
          <b style={{ color: C.gold, marginLeft: 6 }}>{fmtBRL(totais.liberado)}</b> liberados acumulado
        </div>
        <button onClick={onRefresh}
          style={{ padding: "6px 14px", background: "rgba(180,74,255,.12)", color: C.purple, border: "1px solid rgba(180,74,255,.3)", borderRadius: 14, cursor: "pointer", fontSize: ".72rem", fontWeight: 700 }}>
          ↺ Atualizar
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {batches.map((b) => {
          const liberado = Number(b.total_liberado ?? 0);
          const conv = pct(b.total_elegiveis ?? 0, b.total_processed ?? 0);
          const totalLeads = b.total_leads ?? 0;
          const processados = b.total_processed ?? 0;
          const progresso = pct(processados, totalLeads);
          const isDownloading = downloading === b.id;
          const canDownload = (b.total_elegiveis ?? 0) > 0;

          return (
            <div key={b.id} style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 16, alignItems: "center" }}>
                {/* Lado esquerdo: identidade + métricas */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                    <div style={{ fontSize: ".95rem", fontWeight: 700, color: "#e0e0f0" }}>
                      {b.name || b.file_name || `Batch ${b.id.slice(0, 8)}`}
                    </div>
                    <div style={statusBadge(b.status)}>{statusLabel[b.status]}</div>
                    <div style={{ fontSize: ".72rem", color: "#666" }}>
                      {fmtDateTime(b.created_at)}
                      {b.finished_at && (
                        <> · duração <b style={{ color: "#888" }}>{fmtDuration(b.started_at, b.finished_at)}</b></>
                      )}
                      {!b.finished_at && b.started_at && (
                        <> · há <b style={{ color: "#888" }}>{fmtDuration(b.started_at, null)}</b></>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 8 }}>
                    <Metric label="Total" value={fmt(totalLeads)} color="#cbd5e1" />
                    <Metric label="Processados" value={`${fmt(processados)} (${progresso}%)`} color="#aaa" />
                    <Metric label="Elegíveis" value={fmt(b.total_elegiveis ?? 0)} color={C.green} />
                    <Metric label="Conversão" value={`${conv}%`} color={C.gold} />
                    <Metric label="R$ Liberado" value={fmtBRL(liberado)} color={C.gold} />
                  </div>

                  {totalLeads > 0 && (
                    <div style={{ height: 6, background: "rgba(255,255,255,.06)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{
                        height: "100%",
                        width: `${Math.min(progresso, 100)}%`,
                        background: b.status === "processando"
                          ? `linear-gradient(90deg,${C.blue},${C.purple})`
                          : `linear-gradient(90deg,${C.green},${C.gold})`,
                        transition: "width .8s ease",
                      }} />
                    </div>
                  )}
                </div>

                {/* Lado direito: download */}
                <button
                  onClick={() => onDownload(b)}
                  disabled={!canDownload || isDownloading}
                  title={canDownload ? `Baixar ${b.total_elegiveis} elegíveis em CSV` : "Sem elegíveis pra baixar"}
                  style={{
                    padding: "10px 16px",
                    background: canDownload ? "rgba(0,255,136,.12)" : "rgba(100,100,100,.08)",
                    color: canDownload ? C.green : "#444",
                    border: `1px solid ${canDownload ? "rgba(0,255,136,.3)" : C.border}`,
                    borderRadius: 12,
                    cursor: canDownload && !isDownloading ? "pointer" : "not-allowed",
                    fontSize: ".75rem",
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                  }}>
                  {isDownloading ? "⏳ Gerando..." : `⬇ Baixar elegíveis (${fmt(b.total_elegiveis ?? 0)})`}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: "rgba(0,0,0,.18)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 10px" }}>
      <div style={{ fontSize: ".62rem", color: "#666", textTransform: "uppercase", letterSpacing: ".4px", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: ".95rem", fontWeight: 800, color, lineHeight: 1.2, marginTop: 2 }}>{value}</div>
    </div>
  );
}
