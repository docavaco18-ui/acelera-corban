import { C, G } from './tokens';
import { PulseDot } from './Section';

// Chip compacto pra credenciais já configuradas. Mostra status + botão editar.
export function CollapsedChip({
  icon, gradient = G.primary, title, detail, onEdit, dotColor = '#10b981',
}: {
  icon: string;
  gradient?: string;
  title: string;
  detail: string;
  onEdit: () => void;
  dotColor?: string;
}) {
  return (
    <div style={{
      background: `linear-gradient(rgba(15,15,35,.92),rgba(15,15,35,.92)) padding-box, ${gradient} border-box`,
      border: '1px solid transparent', borderRadius: 14,
      padding: '12px 18px',
      display: 'flex', alignItems: 'center', gap: 14, justifyContent: 'space-between',
      boxShadow: '0 4px 20px rgba(0,0,0,.4)',
      animation: 'fade-up .3s ease-out',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 10, background: gradient,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0,
        }}>{icon}</div>
        <PulseDot color={dotColor} />
        <span style={{ color: dotColor, fontSize: 13, fontWeight: 800, flexShrink: 0 }}>
          {title}
        </span>
        <span style={{ color: C.muted, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
          · {detail}
        </span>
      </div>
      <button onClick={onEdit}
        style={{
          background: 'rgba(124,58,237,.12)', border: '1px solid rgba(124,58,237,.3)',
          color: '#a78bfa', borderRadius: 8, padding: '6px 14px',
          cursor: 'pointer', fontSize: 12, fontWeight: 700, flexShrink: 0,
        }}>
        ✎ Editar
      </button>
    </div>
  );
}
