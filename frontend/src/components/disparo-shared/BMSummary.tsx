import { C, G } from './tokens';
import { bmSummary } from './quality';

// 5 cards de resumo da BM acima da lista de números.
// Total · Capacidade/dia · OK · Problemas Graves · Problemas Leves
export function BMSummary({ instances }: { instances: any[] }) {
  const s = bmSummary(instances);

  const cards = [
    {
      label: 'Total de Números', value: s.total.toLocaleString('pt-BR'),
      icon: '📱', grad: G.cyan, color: '#06b6d4',
      sub: s.total ? 'sincronizados c/ a BM' : 'rode Refresh',
    },
    {
      label: 'Capacidade / dia', value: s.capacityActive.toLocaleString('pt-BR'),
      icon: '⚡', grad: G.primary, color: '#a78bfa',
      sub: 'soma dos limites dos ativos',
    },
    {
      label: 'OK p/ Disparar', value: s.okCount.toLocaleString('pt-BR'),
      icon: '✅', grad: G.green, color: '#10b981',
      sub: 'qualidade verde, sem restrição',
    },
    {
      label: 'Problemas Graves', value: s.graveCount.toLocaleString('pt-BR'),
      icon: '🚫', grad: G.red, color: '#ef4444',
      sub: 'bloqueado, RED ou suspenso',
    },
    {
      label: 'Problemas Leves', value: s.leveCount.toLocaleString('pt-BR'),
      icon: '⚠️', grad: G.yellow, color: '#f59e0b',
      sub: 'nome, pagamento ou tier',
    },
  ];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      gap: 12,
      marginBottom: 20,
    }}>
      {cards.map(c => (
        <div key={c.label} style={{
          background: `linear-gradient(rgba(15,15,35,.94),rgba(15,15,35,.94)) padding-box, ${c.grad} border-box`,
          border: '1px solid transparent',
          borderRadius: 14,
          padding: '16px 18px',
          boxShadow: `0 4px 20px ${c.color}22`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 18 }}>{c.icon}</span>
            <span style={{
              color: C.muted, fontSize: 10, fontWeight: 800,
              textTransform: 'uppercase', letterSpacing: '0.08em',
            }}>{c.label}</span>
          </div>
          <div style={{
            fontSize: 32, fontWeight: 800, lineHeight: 1,
            background: c.grad,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>{c.value}</div>
          <div style={{ color: C.muted, fontSize: 11, marginTop: 6, lineHeight: 1.4 }}>
            {c.sub}
          </div>
        </div>
      ))}
    </div>
  );
}
