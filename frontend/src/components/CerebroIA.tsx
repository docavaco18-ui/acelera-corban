import { useMemo, useState, useCallback } from "react";
import ReactFlow, { Background, BackgroundVariant, type Node, type Edge } from "reactflow";
import "reactflow/dist/style.css";
import BotCanvasNode, { type PhaseStatus } from "./BotCanvasNode";
import type { DashboardStats, WorkerState, Lead } from "../lib/types";

interface CerebroIAProps {
  stats: DashboardStats;
  leads: Lead[];
  botStatus: string;
  workerStates: WorkerState[];
}

const WORKER_NAMES = ["Alpha","Beta","Gamma","Delta","Epsilon","Zeta","Eta","Theta"];
const nodeTypes = { botPhase: BotCanvasNode };

const PHASE_COL: Record<string, { x: number; y: number }> = {
  pendente:              { x: 320, y: 0 },
  enriquecido:           { x: 320, y: 120 },
  consentido:            { x: 320, y: 240 },
  autorizado:            { x: 320, y: 360 },
  aguardando_resultado:  { x: 320, y: 480 },
  elegivel:              { x: 100, y: 600 },
  inelegivel:            { x: 540, y: 600 },
};

const fmtBRL = (v: number) => "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function SatelliteCard({ title, children, style }: { title: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      position: "absolute",
      background: "#1a1f2eee",
      border: "1px solid #1e293b",
      borderRadius: 10,
      padding: "12px 14px",
      minWidth: 170,
      zIndex: 10,
      backdropFilter: "blur(4px)",
      ...style,
    }}>
      <div style={{ fontSize: 10, color: "#475569", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>{title}</div>
      {children}
    </div>
  );
}

export default function CerebroIA({ stats, leads, botStatus, workerStates }: CerebroIAProps) {
  const [heatmap, setHeatmap] = useState(false);
  const isRunning = botStatus === "running";

  const by = stats.by_status ?? {};
  const counts = {
    pendente: by.pendente ?? 0,
    enriquecido: by.enriquecido ?? 0,
    consentido: by.consentido ?? 0,
    autorizado: by.autorizado ?? 0,
    aguardando_resultado: by.aguardando_resultado ?? 0,
    elegivel: by.elegivel ?? 0,
    inelegivel: by.inelegivel ?? 0,
  };

  const totals = useMemo(() => {
    const elegiveis = leads.filter(l => l.status === "elegivel");
    const inelegiveis = leads.filter(l => l.status === "inelegivel");
    const totalLiberado = elegiveis.reduce((s, l) => s + (l.valor_liberado ?? 0), 0);
    const totalMargem = elegiveis.reduce((s, l) => s + (l.margem_disponivel ?? 0), 0);
    const decididos = elegiveis.length + inelegiveis.length;
    const aprovacao = decididos > 0 ? (elegiveis.length / decididos) * 100 : 0;
    return { elegiveis: elegiveis.length, inelegiveis: inelegiveis.length, totalLiberado, totalMargem, aprovacao };
  }, [leads]);

  const globalCpm = useMemo(() => workerStates.reduce((s, w) => s + w.cpm, 0), [workerStates]);

  const maxActiveCount = Math.max(counts.enriquecido, counts.consentido, counts.autorizado, counts.aguardando_resultado, 1);

  const heatColor = useCallback((count: number): string => {
    if (!heatmap) return "#6366f1";
    const ratio = count / maxActiveCount;
    if (ratio < 0.2) return "#1e3a5f";
    if (ratio < 0.5) return "#f59e0b";
    return "#ef4444";
  }, [heatmap, maxActiveCount]);

  const phaseStatus = useCallback((status: keyof typeof counts): PhaseStatus => {
    if (!isRunning) return counts[status] > 0 ? "running" : "idle";
    return counts[status] > 0 ? "running" : "idle";
  }, [isRunning, counts]);

  const edgeWidth = (count: number) => Math.max(1.2, Math.min(7, count / 2));

  const nodes: Node[] = useMemo(() => [
    { id: "pendente", type: "botPhase", position: PHASE_COL.pendente, data: {
        label: "Fila", sublabel: "pendente", count: counts.pendente,
        status: (isRunning && counts.pendente > 0 ? "running" : "idle") as PhaseStatus, isSource: true,
      }},
    { id: "enriquecido", type: "botPhase", position: PHASE_COL.enriquecido, data: {
        label: "Enriquecido", sublabel: "client-data V8", count: counts.enriquecido,
        status: phaseStatus("enriquecido"), isSource: true, isTarget: true,
        accent: heatmap ? heatColor(counts.enriquecido) : "#00bfff",
      }},
    { id: "consentido", type: "botPhase", position: PHASE_COL.consentido, data: {
        label: "Consentido", sublabel: "consent criado", count: counts.consentido,
        status: phaseStatus("consentido"), isSource: true, isTarget: true,
        accent: heatmap ? heatColor(counts.consentido) : "#b44aff",
      }},
    { id: "autorizado", type: "botPhase", position: PHASE_COL.autorizado, data: {
        label: "Autorizado", sublabel: "consult enviado", count: counts.autorizado,
        status: phaseStatus("autorizado"), isSource: true, isTarget: true,
        accent: heatmap ? heatColor(counts.autorizado) : "#7c3aed",
      }},
    { id: "aguardando_resultado", type: "botPhase", position: PHASE_COL.aguardando_resultado, data: {
        label: "Aguardando Retry", sublabel: "polling V8", count: counts.aguardando_resultado,
        status: phaseStatus("aguardando_resultado"), isSource: true, isTarget: true,
        accent: heatmap ? heatColor(counts.aguardando_resultado) : "#f59e0b",
      }},
    { id: "elegivel", type: "botPhase", position: PHASE_COL.elegivel, data: {
        label: "Elegível", sublabel: "✅ aprovado", count: counts.elegivel,
        status: (counts.elegivel > 0 ? "done" : "idle") as PhaseStatus, isTarget: true,
        accent: "#22c55e",
      }},
    { id: "inelegivel", type: "botPhase", position: PHASE_COL.inelegivel, data: {
        label: "Inelegível", sublabel: "❌ rejeitado", count: counts.inelegivel,
        status: (counts.inelegivel > 0 ? "done" : "idle") as PhaseStatus, isTarget: true,
        accent: "#ef4444",
      }},
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [counts, isRunning, heatmap, heatColor]);

  const edges: Edge[] = useMemo(() => [
    { id: "e-p-e", source: "pendente", target: "enriquecido",
      style: { stroke: "#00bfff", strokeWidth: edgeWidth(counts.enriquecido) }, animated: isRunning },
    { id: "e-e-c", source: "enriquecido", target: "consentido",
      style: { stroke: "#b44aff", strokeWidth: edgeWidth(counts.consentido) }, animated: isRunning },
    { id: "e-c-a", source: "consentido", target: "autorizado",
      style: { stroke: "#7c3aed", strokeWidth: edgeWidth(counts.autorizado) }, animated: isRunning },
    { id: "e-a-w", source: "autorizado", target: "aguardando_resultado",
      style: { stroke: "#f59e0b", strokeWidth: edgeWidth(counts.aguardando_resultado), strokeDasharray: "5 3" }, animated: isRunning, label: "polling" },
    { id: "e-w-el", source: "aguardando_resultado", target: "elegivel",
      style: { stroke: "#22c55e", strokeWidth: edgeWidth(counts.elegivel) }, animated: isRunning },
    { id: "e-w-iel", source: "aguardando_resultado", target: "inelegivel",
      style: { stroke: "#ef4444", strokeWidth: edgeWidth(counts.inelegivel) }, animated: isRunning },
    { id: "e-a-el", source: "autorizado", target: "elegivel",
      style: { stroke: "#22c55e88", strokeWidth: 1, strokeDasharray: "2 4" } },
    { id: "e-a-iel", source: "autorizado", target: "inelegivel",
      style: { stroke: "#ef444488", strokeWidth: 1, strokeDasharray: "2 4" } },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [counts, isRunning]);

  return (
    <div style={{ position: "relative", height: "calc(100vh - 200px)", minHeight: 600, background: "#0f1117", borderRadius: 12, overflow: "hidden", border: "1px solid #1e293b" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll
      >
        <Background variant={BackgroundVariant.Dots} color="#1e293b" gap={24} />
      </ReactFlow>

      {workerStates
        .filter(w => w.currentPhase && w.currentCpf)
        .map((w, i) => {
          const pos = PHASE_COL[w.currentPhase ?? "pendente"];
          if (!pos) return null;
          const col = i % 4;
          const row = Math.floor(i / 4);
          return (
            <div key={w.id}
              title={`${w.name} — ${w.currentNome ?? w.currentCpf} — ${w.currentPhase}`}
              style={{
                position: "absolute",
                left: `calc(50% + ${col * 38 - 80}px)`,
                top: `${100 + (pos.y * 0.55) + row * 26}px`,
                fontSize: 18, zIndex: 20,
                filter: `drop-shadow(0 0 6px ${w.color})`,
                transition: "top 0.5s ease, left 0.5s ease",
                userSelect: "none", pointerEvents: "none",
              }}>
              🤖
              <div style={{ fontSize: 8, color: w.color, textAlign: "center", marginTop: -2, lineHeight: 1 }}>
                {WORKER_NAMES[w.id] ?? `W${w.id}`}
              </div>
            </div>
          );
        })}

      <SatelliteCard title="⚡ Velocidade" style={{ top: 16, left: 16 }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: "#6366f1" }}>
          {globalCpm.toFixed(1)}<span style={{ fontSize: 11, color: "#475569" }}>/min</span>
        </div>
        <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>
          {workerStates.length} worker{workerStates.length !== 1 ? "s" : ""}
        </div>
      </SatelliteCard>

      <SatelliteCard title="🎯 Aprovação" style={{ top: 16, right: 16 }}>
        <div style={{ fontSize: 28, fontWeight: 800, color: "#22c55e" }}>
          {totals.aprovacao.toFixed(1)}%
        </div>
        <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>
          ✅ <b style={{ color: "#22c55e" }}>{totals.elegiveis}</b> aprovados
        </div>
        <div style={{ fontSize: 11, color: "#475569" }}>
          ❌ <b style={{ color: "#ef4444" }}>{totals.inelegiveis}</b> rejeitados
        </div>
        <div style={{ fontSize: 11, color: "#475569" }}>
          ⏳ <b style={{ color: "#f59e0b" }}>{counts.aguardando_resultado}</b> em retry
        </div>
      </SatelliteCard>

      <SatelliteCard title="💰 Margem & Saldo" style={{ bottom: 70, left: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#ffd700", lineHeight: 1.1 }}>
          {fmtBRL(totals.totalLiberado)}
        </div>
        <div style={{ fontSize: 10, color: "#475569" }}>liberado total</div>
        <div style={{ marginTop: 6, fontSize: 11, color: "#94a3b8" }}>
          Margem: <b style={{ color: "#22c55e" }}>{fmtBRL(totals.totalMargem)}</b>
        </div>
        <div style={{ fontSize: 11, color: "#94a3b8" }}>
          Média: <b style={{ color: "#94a3b8" }}>{totals.elegiveis > 0 ? fmtBRL(totals.totalLiberado / totals.elegiveis) : "—"}</b>
        </div>
      </SatelliteCard>

      <SatelliteCard title="📊 Pipeline" style={{ bottom: 70, right: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {[
            { label: "Pendentes", value: counts.pendente, color: "#94a3b8" },
            { label: "Em processamento", value: stats.em_processamento, color: "#6366f1" },
            { label: "Aguardando Retry", value: counts.aguardando_resultado, color: "#f59e0b" },
            { label: "Concluídos", value: counts.elegivel + counts.inelegivel, color: "#22c55e" },
          ].map(({ label, value, color }) => {
            const pct = stats.total > 0 ? (value / stats.total) * 100 : 0;
            return (
              <div key={label}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#475569", marginBottom: 3 }}>
                  <span>{label}</span><span style={{ color }}>{value}</span>
                </div>
                <div style={{ background: "#0f1117", borderRadius: 3, height: 4 }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.5s ease" }} />
                </div>
              </div>
            );
          })}
        </div>
      </SatelliteCard>

      <button onClick={() => setHeatmap(h => !h)}
        style={{
          position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)",
          background: heatmap ? "#f59e0b" : "#1e293b", color: heatmap ? "#000" : "#94a3b8",
          border: `1px solid ${heatmap ? "#f59e0b" : "#334155"}`,
          borderRadius: 20, padding: "6px 18px", cursor: "pointer", fontSize: 12,
          fontWeight: 600, zIndex: 20, transition: "all 0.2s",
        }}>
        🌡 Mapa de Calor {heatmap ? "ON" : "OFF"}
      </button>

      <style>{`@keyframes pulse-glow{0%,100%{box-shadow:0 0 18px currentColor}50%{box-shadow:0 0 28px currentColor}}`}</style>
    </div>
  );
}
