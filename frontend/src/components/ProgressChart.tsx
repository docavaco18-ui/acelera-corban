import { PieChart, Pie, Cell, Legend, Tooltip } from "recharts";
import type { DashboardStats } from "../lib/types";

const COLORS = ["#22c55e", "#ef4444", "#f59e0b", "#3b82f6", "#94a3b8"];

export default function ProgressChart({ stats }: { stats: DashboardStats }) {
  const data = [
    { name: "Elegíveis", value: stats.elegiveis },
    { name: "Inelegíveis", value: stats.inelegiveis },
    { name: "Pendentes", value: stats.pendentes },
    { name: "Em Processo", value: stats.em_processamento },
    { name: "Erros", value: stats.erros },
  ].filter((d) => d.value > 0);

  if (data.length === 0) {
    return <p style={{ color: "#94a3b8" }}>Nenhum dado disponível.</p>;
  }

  return (
    <PieChart width={420} height={300}>
      <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
        {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
      </Pie>
      <Tooltip />
      <Legend />
    </PieChart>
  );
}
