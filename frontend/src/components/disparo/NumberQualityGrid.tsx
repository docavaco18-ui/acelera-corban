interface BroadcastNumber {
  phone_id: string;
  display_phone: string;
  quality_rating: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';
  messaging_tier: string;
  daily_limit: number;
  is_paused: boolean;
}

interface Props {
  numbers: BroadcastNumber[];
  onResume?: (phoneId: string) => void;
}

const qualityColor: Record<string, string> = {
  GREEN: '#00ff88',
  YELLOW: '#ffd700',
  RED: '#ff2d78',
  UNKNOWN: '#475569',
};

export function NumberQualityGrid({ numbers, onResume }: Props) {
  if (!numbers.length) {
    return (
      <div style={{ color: '#475569', textAlign: 'center', padding: 32 }}>
        Nenhum número cadastrado. Configure credenciais e faça Refresh.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
      {numbers.map(n => (
        <div
          key={n.phone_id}
          style={{
            background: '#0d0d1f',
            border: `1px solid ${(qualityColor[n.quality_rating] ?? '#1e1e3a')}22`,
            borderRadius: 12,
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 14 }}>
              {n.display_phone || n.phone_id}
            </span>
            <span style={{
              background: (qualityColor[n.quality_rating] ?? '#475569') + '22',
              color: qualityColor[n.quality_rating] ?? '#475569',
              borderRadius: 6,
              padding: '2px 8px',
              fontSize: 11,
              fontWeight: 700,
            }}>
              {n.quality_rating}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{
              background: '#1e1e3a',
              color: '#94a3b8',
              borderRadius: 6,
              padding: '2px 8px',
              fontSize: 11,
            }}>
              {n.messaging_tier}/dia
            </span>
            <span style={{
              background: '#1e1e3a',
              color: '#94a3b8',
              borderRadius: 6,
              padding: '2px 8px',
              fontSize: 11,
            }}>
              {n.daily_limit.toLocaleString()} lim.
            </span>
          </div>

          {n.is_paused && (
            <button
              onClick={() => onResume?.(n.phone_id)}
              style={{
                background: '#6366f133',
                border: '1px solid #6366f1',
                color: '#6366f1',
                borderRadius: 8,
                padding: '6px 12px',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                marginTop: 4,
              }}
            >
              Retomar
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
