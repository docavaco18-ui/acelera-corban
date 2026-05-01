import { useMemo, useEffect, useState } from "react";
import type { WorkerState, BotEvent } from "../lib/types";

interface WorkersLiveProps {
  workerStates: WorkerState[];
  events: BotEvent[];
  runStartedAt: number | null;
  isRunning: boolean;
}

const XP_THRESHOLDS = [0, 100, 300, 600, 1000];

function xpForLevel(level: number): { current: number; next: number } {
  const current = XP_THRESHOLDS[level - 1] ?? 0;
  const next = XP_THRESHOLDS[level] ?? XP_THRESHOLDS[XP_THRESHOLDS.length - 1];
  return { current, next };
}

function useElapsed(startedAt: number | null): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!startedAt) return "00:00:00";
  const s = Math.floor((now - startedAt) / 1000);
  const h = Math.floor(s / 3600).toString().padStart(2, "0");
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

function phaseLabel(fase: string | null): string {
  const map: Record<string, string> = {
    pendente: "Aguardando",
    enriquecido: "Enriquecido",
    consentido: "Consentido",
    autorizado: "Autorizado",
    aguardando_resultado: "Aguardando Resultado",
    elegivel: "Elegível",
    inelegivel: "Inelegível",
    erro: "⚠ Erro",
    concluido: "Concluído",
  };
  return fase ? (map[fase] ?? fase) : "Aguardando fila...";
}

function WorkerCard({ w, isFlash, isKing }: { w: WorkerState; isFlash: boolean; isKing: boolean }) {
  const { current: xpCurrent, next: xpNext } = xpForLevel(w.level);
  const xpRange = (xpNext - xpCurrent) || 1;
  const xpPct = Math.min(100, ((w.xp - xpCurrent) / xpRange) * 100);
  const isActive = w.currentPhase !== null && w.currentPhase !== "elegivel" && w.currentPhase !== "inelegivel";
  const isError = w.currentPhase === "erro";
  const isElegivel = w.currentPhase === "elegivel";
  const taskElapsed = useElapsed(w.startedAt);

  return (
    <div style={{
      background: "#1a1f2e",
      border: `1px solid ${isError ? "#ef4444" : isElegivel ? "#f59e0b" : w.color}`,
      borderRadius: 12,
      padding: 16,
      display: "flex",
      flexDirection: "column",
      gap: 10,
      position: "relative",
      boxShadow: isActive ? `0 0 12px ${w.color}33` : "none",
      transition: "all 0.3s",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 22, filter: `drop-shadow(0 0 4px ${w.color})` }}>🤖</span>
        <div>
          <div style={{ color: w.color, fontWeight: 700, fontSize: 14 }}>{w.name}</div>
          <div style={{ color: "#475569", fontSize: 10 }}>Nível {w.level}</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {isFlash && <span title="Flash">⚡</span>}
          {isKing && <span title="Rei da Run">👑</span>}
        </div>
      </div>

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#475569", marginBottom: 4 }}>
          <span>XP {w.xp}</span>
          <span>{w.level < 5 ? `Lv${w.level + 1}: ${xpNext}` : "MAX"}</span>
        </div>
        <div style={{ background: "#0f1117", borderRadius: 4, height: 6, overflow: "hidden" }}>
          <div style={{
            height: "100%",
            width: `${xpPct}%`,
            background: `linear-gradient(90deg, ${w.color}, ${w.color}88)`,
            borderRadius: 4,
            transition: "width 0.4s ease",
          }} />
        </div>
      </div>

      <div style={{
        background: "#0f1117",
        borderRadius: 8,
        padding: "8px 10px",
        fontSize: 11,
        border: `1px solid ${isError ? "#ef444433" : "#1e293b"}`,
      }}>
        <div style={{ marginBottom: 2, fontWeight: 600, color: isError ? "#ef4444" : w.color }}>
          {phaseLabel(w.currentPhase)}
        </div>
        {w.currentNome && (
          <div style={{ color: "#cbd5e1", fontSize: 11, marginBottom: 2 }}>
            {w.currentNome}
          </div>
        )}
        {w.currentCpf && (
          <div style={{ color: "#64748b", fontFamily: "monospace", display: "flex", justifyContent: "space-between" }}>
            <span>CPF: {w.currentCpf}</span>
            {w.startedAt && <span style={{ color: "#475569" }}>⏱ {taskElapsed}</span>}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 16, fontSize: 11 }}>
        <span>⚡ <b style={{ color: "#6366f1" }}>{w.cpm}/min</b></span>
        <span>🔥 <b style={{ color: w.streak > 10 ? "#f59e0b" : "#94a3b8" }}>Streak: {w.streak}</b></span>
      </div>

      <div style={{ display: "flex", gap: 12, fontSize: 12 }}>
        <span style={{ color: "#94a3b8" }}>✓ <b style={{ color: "#22c55e" }}>{w.processed}</b></span>
        <span style={{ color: "#94a3b8" }}>🥇 <b style={{ color: "#f59e0b" }}>{w.elegiveis}</b></span>
        <span style={{ color: "#94a3b8" }}>✗ <b style={{ color: "#ef4444" }}>{w.erros}</b></span>
      </div>

      {w.badges.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {w.badges.map(b => (
            <span key={b.id} title={b.label} style={{
              background: "#0f1117",
              border: "1px solid #334155",
              borderRadius: 6,
              padding: "2px 8px",
              fontSize: 14,
              cursor: "default",
            }}>
              {b.icon}
            </span>
          ))}
        </div>
      )}

      {w.recentLog.length > 0 && (
        <div style={{ borderTop: "1px solid #1e293b", paddingTop: 8 }}>
          {w.recentLog.map((entry, i) => (
            <div key={i} style={{
              fontSize: 10,
              fontFamily: "monospace",
              color: entry.includes("ELEGÍVEL") ? "#f59e0b" : entry.includes("✗") ? "#ef4444" : "#475569",
              padding: "1px 0",
            }}>
              {entry}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function WorkersLive({ workerStates, events, runStartedAt, isRunning }: WorkersLiveProps) {
  const elapsed = useElapsed(runStartedAt);

  const globalCpm = useMemo(() => workerStates.reduce((s, w) => s + w.cpm, 0), [workerStates]);
  const totalProcessed = useMemo(() => workerStates.reduce((s, w) => s + w.processed, 0), [workerStates]);
  const totalElegiveis = useMemo(() => workerStates.reduce((s, w) => s + w.elegiveis, 0), [workerStates]);
  const totalErros = useMemo(() => workerStates.reduce((s, w) => s + w.erros, 0), [workerStates]);

  const flashWorkerId = useMemo(() => {
    if (workerStates.length === 0) return -1;
    return workerStates.reduce((best, w) => w.cpm > best.cpm ? w : best, workerStates[0]).id;
  }, [workerStates]);

  const kingWorkerId = useMemo(() => {
    if (workerStates.length === 0) return -1;
    return workerStates.reduce((best, w) => w.xp > best.xp ? w : best, workerStates[0]).id;
  }, [workerStates]);

  const processedEvents = useMemo(() =>
    events.filter(e => e.type === "lead_result" || e.type === "cpf_processed"),
    [events]
  );

  const NAMES = [
    "ORELHA SECA 1","ORELHA SECA 2","ORELHA SECA 3",
    "ORELHA SECA 4","ORELHA SECA 5","ORELHA SECA 6",
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, height: "100%", overflow: "hidden" }}>
      <div style={{
        background: "#1a1f2e",
        borderRadius: 10,
        padding: "12px 20px",
        display: "flex",
        gap: 24,
        alignItems: "center",
        flexWrap: "wrap",
        border: "1px solid #1e293b",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: isRunning ? "#22c55e" : "#334155",
            boxShadow: isRunning ? "0 0 8px #22c55e" : "none",
          }} />
          <span style={{ fontFamily: "monospace", fontSize: 20, color: "#fff", letterSpacing: 2 }}>
            ⏱ {elapsed}
          </span>
        </div>
        {[
          { label: "CPFs/min", value: globalCpm.toFixed(1), color: "#6366f1" },
          { label: "Processados", value: totalProcessed, color: "#94a3b8" },
          { label: "Elegíveis", value: totalElegiveis, color: "#f59e0b" },
          { label: "Erros", value: totalErros, color: "#ef4444" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
            <div style={{ fontSize: 10, color: "#475569" }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16, overflow: "hidden", minHeight: 0 }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: 12,
          overflowY: "auto",
          flex: "0 0 auto",
          maxHeight: "52%",
          paddingBottom: 4,
        }}>
          {workerStates.length === 0 && (
            <div style={{
              gridColumn: "1/-1",
              color: "#475569",
              textAlign: "center",
              padding: 40,
              fontSize: 13,
              background: "#1a1f2e",
              borderRadius: 10,
              border: "1px dashed #1e293b",
            }}>
              {isRunning
                ? "⏳ Aguardando eventos dos workers..."
                : "Inicie o bot para ver os workers ao vivo"}
            </div>
          )}
          {workerStates.map(w => (
            <WorkerCard
              key={w.id}
              w={w}
              isFlash={w.id === flashWorkerId && w.cpm > 0}
              isKing={w.id === kingWorkerId && w.xp > 0}
            />
          ))}
        </div>

        <div style={{
          flex: 1,
          background: "#1a1f2e",
          borderRadius: 10,
          border: "1px solid #1e293b",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}>
          <div style={{
            padding: "8px 16px",
            borderBottom: "1px solid #1e293b",
            fontSize: 11,
            color: "#475569",
            display: "flex",
            justifyContent: "space-between",
            flexShrink: 0,
          }}>
            <span>LOG GLOBAL</span>
            <span>{processedEvents.length} eventos</span>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px", fontFamily: "monospace", fontSize: 11 }}>
            {processedEvents.slice(0, 100).map((e, i) => {
              const isEleg = e.resultado === "Elegível" || e.status === "elegivel";
              const isErr = e.fase === "erro" || e.status === "erro";
              const wname = e.worker_name ?? (e.worker_id !== undefined ? (NAMES[e.worker_id] ?? `W${e.worker_id}`) : "?");
              const ts = e.ts
                ? new Date(e.ts).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
                : "";
              return (
                <div key={i} style={{
                  padding: "2px 0",
                  color: isEleg ? "#f59e0b" : isErr ? "#ef4444" : "#475569",
                  borderBottom: "1px solid #0f111722",
                }}>
                  <span style={{ color: "#334155" }}>[{ts}]</span>{" "}
                  <span style={{ color: isEleg ? "#f59e0b" : "#6366f1" }}>Worker {wname}</span>{" "}
                  {isEleg ? "✨ ELEGÍVEL" : isErr ? "✗ erro" : `→ ${e.fase ?? e.status ?? "?"}`}{" "}
                  — {e.nome ? `${e.nome} (${e.cpf ?? "?"})` : `CPF ${e.cpf ?? "???"}`}
                  {e.message && <span style={{ color: "#64748b", marginLeft: 8 }}>· {e.message}</span>}
                  {isEleg && <span style={{ color: "#22c55e", marginLeft: 8 }}>🥇</span>}
                </div>
              );
            })}
            {processedEvents.length === 0 && (
              <div style={{ color: "#334155", textAlign: "center", paddingTop: 20 }}>
                Nenhum evento ainda
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
