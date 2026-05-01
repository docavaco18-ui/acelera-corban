import {
  PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer,
} from "recharts";
import type { DashboardStats } from "../lib/types";

interface MetricsDashboardProps {
  stats: DashboardStats;
}

const PIE_COLORS = ["#22c55e", "#ef4444", "#f59e0b", "#94a3b8", "#6366f1"];

const cardStyle = (color: string): React.CSSProperties => ({
  padding: "16px 20px",
  background: "#1a1f2e",
  border: `1px solid ${color}`,
  borderRadius: 10,
  minWidth: 100,
  flex: 1,
});

export function MetricsDashboard({ stats }: MetricsDashboardProps) {
  const concluidos = stats.elegiveis + stats.inelegiveis;
  const pieData = [
    { name: "Elegíveis", value: stats.elegiveis },
    { name: "Inelegíveis", value: stats.inelegiveis },
    { name: "Pendentes", value: stats.pendentes },
    { name: "Em Processo", value: stats.em_processamento },
    { name: "Erros", value: stats.erros },
  ].filter((d) => d.value > 0);

  const barData = [
    { name: "Pendente", count: stats.pendentes },
    { name: "Em Processo", count: stats.em_processamento },
    { name: "Concluído", count: concluidos },
    { name: "Erro", count: stats.erros },
  ];

  const eligRate = concluidos > 0
    ? ((stats.elegiveis / concluidos) * 100).toFixed(1)
    : "0.0";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {[
          { label: "Total Leads", value: stats.total, color: "#6366f1" },
          { label: "Elegíveis", value: stats.elegiveis, color: "#22c55e" },
          { label: "Inelegíveis", value: stats.inelegiveis, color: "#ef4444" },
          { label: "Em Processo", value: stats.em_processamento, color: "#3b82f6" },
          { label: "Pendentes", value: stats.pendentes, color: "#f59e0b" },
          { label: "Erros", value: stats.erros, color: "#94a3b8" },
          { label: "Taxa Elegib.", value: `${eligRate}%`, color: "#06b6d4" },
        ].map((c) => (
          <div key={c.label} style={cardStyle(c.color)}>
            <div style={{ fontSize: 26, fontWeight: "bold", color: "#fff" }}>{c.value}</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{c.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 8 }}>Distribuição</div>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: "#1a1f2e", border: "1px solid #334155", color: "#fff" }} />
              <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 8 }}>Por Estágio</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={barData}>
              <XAxis dataKey="name" stroke="#475569" fontSize={11} />
              <YAxis stroke="#475569" fontSize={11} />
              <Tooltip contentStyle={{ background: "#1a1f2e", border: "1px solid #334155", color: "#fff" }} />
              <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

export default MetricsDashboard;
