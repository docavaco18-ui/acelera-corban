import { memo } from "react";
import { Handle, Position } from "reactflow";

export type PhaseStatus = "idle" | "running" | "error" | "done";

interface BotCanvasNodeProps {
  data: {
    label: string;
    sublabel?: string;
    count: number;
    status: PhaseStatus;
    accent?: string;
    isSource?: boolean;
    isTarget?: boolean;
  };
}

const statusColors: Record<PhaseStatus, string> = {
  idle: "#334155",
  running: "#6366f1",
  error: "#ef4444",
  done: "#22c55e",
};

const BotCanvasNode = memo(({ data }: BotCanvasNodeProps) => {
  const color = data.accent ?? statusColors[data.status];
  const isRunning = data.status === "running";

  return (
    <div style={{
      padding: "12px 16px",
      borderRadius: 12,
      background: "#0f1117",
      border: `2px solid ${color}`,
      minWidth: 140,
      textAlign: "center",
      boxShadow: isRunning ? `0 0 18px ${color}66` : "none",
      animation: isRunning ? "pulse-glow 1.5s ease-in-out infinite" : "none",
      position: "relative",
    }}>
      {data.isTarget && <Handle type="target" position={Position.Top} style={{ background: color }} />}
      <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>{data.label}</div>
      {data.sublabel && (
        <div style={{ fontSize: 9, color: "#475569", marginBottom: 4 }}>{data.sublabel}</div>
      )}
      <div style={{ fontSize: 22, fontWeight: 800, color: "#fff", fontFamily: "monospace" }}>
        {data.count}
      </div>
      {data.status !== "idle" && (
        <div style={{
          position: "absolute", top: 8, right: 8,
          width: 8, height: 8, borderRadius: "50%", background: color,
          boxShadow: `0 0 8px ${color}`,
        }} />
      )}
      {data.isSource && <Handle type="source" position={Position.Bottom} style={{ background: color }} />}
    </div>
  );
});

BotCanvasNode.displayName = "BotCanvasNode";
export default BotCanvasNode;
