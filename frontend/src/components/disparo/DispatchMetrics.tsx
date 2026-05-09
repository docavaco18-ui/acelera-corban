import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface PhoneMetric {
  phone_id: string;
  sent: number;
  failed: number;
  open: number;
  converted: number;
}

interface Props {
  metrics: PhoneMetric[];
}

export function DispatchMetrics({ metrics }: Props) {
  if (!metrics.length) {
    return (
      <div style={{ color: '#475569', textAlign: 'center', padding: 24 }}>
        Nenhuma métrica disponível.
      </div>
    );
  }

  const chartData = metrics.map(m => ({
    name: m.phone_id.slice(-8),
    Enviados: m.sent,
    Falhas: m.failed,
    Abertos: m.open,
    Convertidos: m.converted,
  }));

  const totals = metrics.reduce((acc, m) => ({
    sent: acc.sent + m.sent,
    converted: acc.converted + m.converted,
  }), { sent: 0, converted: 0 });

  const convRate = totals.sent > 0
    ? ((totals.converted / totals.sent) * 100).toFixed(1)
    : '0.0';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{
          background: '#0d0d1f', border: '1px solid #1e1e3a',
          borderRadius: 10, padding: '12px 20px',
        }}>
          <div style={{ color: '#475569', fontSize: 11 }}>Total Enviado</div>
          <div style={{ color: '#00ff88', fontSize: 22, fontWeight: 700 }}>
            {totals.sent.toLocaleString()}
          </div>
        </div>
        <div style={{
          background: '#0d0d1f', border: '1px solid #1e1e3a',
          borderRadius: 10, padding: '12px 20px',
        }}>
          <div style={{ color: '#475569', fontSize: 11 }}>Conversão (PAGO/OFERTADO)</div>
          <div style={{ color: '#6366f1', fontSize: 22, fontWeight: 700 }}>
            {convRate}%
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
          <XAxis dataKey="name" tick={{ fill: '#475569', fontSize: 11 }} />
          <YAxis tick={{ fill: '#475569', fontSize: 11 }} />
          <Tooltip
            contentStyle={{ background: '#0d0d1f', border: '1px solid #1e1e3a', borderRadius: 8 }}
            labelStyle={{ color: '#94a3b8' }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Enviados" fill="#6366f1" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Falhas" fill="#ff2d78" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Abertos" fill="#ffd700" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Convertidos" fill="#00ff88" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
