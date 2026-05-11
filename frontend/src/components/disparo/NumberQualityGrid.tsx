interface BroadcastNumber {
  phone_id: string;
  display_phone: string;
  quality_rating: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';
  messaging_tier: string | null;
  daily_limit: number;
  throughput_level: string | null;
  can_send: 'AVAILABLE' | 'LIMITED' | 'BLOCKED' | 'UNKNOWN';
  name_status: string | null;
  phone_status: string | null;
  restriction_codes: number[];
  chatwoot_connected: boolean;
  chatwoot_inbox_id: string | null;
  is_paused: boolean;
}

interface Props {
  numbers: BroadcastNumber[];
  onResume?: (phoneId: string) => void;
}

const qualityColor: Record<string, string> = {
  GREEN:   '#00ff88',
  YELLOW:  '#ffd700',
  RED:     '#ff2d78',
  UNKNOWN: '#475569',
};

const qualityLabel: Record<string, string> = {
  GREEN:   'Saúde Alta',
  YELLOW:  'Saúde Média',
  RED:     'Saúde Baixa',
  UNKNOWN: 'Sem histórico',
};

function CanSendBadge({ canSend, nameStatus, restrictionCodes }: {
  canSend: string;
  nameStatus: string | null;
  restrictionCodes: number[];
}) {
  if (canSend === 'AVAILABLE') return null;

  let label = '';
  let color = '#ffd700';
  let bg = '#ffd70022';

  if (canSend === 'BLOCKED') {
    color = '#ff2d78';
    bg = '#ff2d7822';
    if (restrictionCodes.includes(141001) || restrictionCodes.includes(141000)) {
      label = 'Número não ativado';
    } else if (restrictionCodes.includes(141006)) {
      label = 'Problema de pagamento';
    } else {
      label = 'Bloqueado pela Meta';
    }
  } else if (canSend === 'LIMITED') {
    color = '#ffd700';
    bg = '#ffd70022';
    if (nameStatus === 'DECLINED') {
      label = 'Nome recusado pela Meta';
    } else {
      label = 'Envios limitados';
    }
  }

  if (!label) return null;

  return (
    <span style={{
      background: bg,
      color,
      borderRadius: 6,
      padding: '2px 8px',
      fontSize: 10,
      fontWeight: 700,
      border: `1px solid ${color}44`,
    }}>
      ⚠ {label}
    </span>
  );
}

export function NumberQualityGrid({ numbers, onResume }: Props) {
  if (!numbers.length) {
    return (
      <div style={{ color: '#475569', textAlign: 'center', padding: 32 }}>
        Nenhum número cadastrado. Configure credenciais e clique em Refresh.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
      {numbers.map(n => {
        const qColor = qualityColor[n.quality_rating] ?? '#475569';
        const canSend = n.can_send ?? 'UNKNOWN';
        const isOperational = canSend === 'AVAILABLE';
        const isLimited = canSend === 'LIMITED';
        const isBlocked = canSend === 'BLOCKED' || n.phone_status === 'PENDING';

        let borderColor = qColor + '22';
        if (isBlocked) borderColor = '#ff2d7833';
        else if (isLimited) borderColor = '#ffd70033';

        return (
          <div
            key={n.phone_id}
            style={{
              background: '#0d0d1f',
              border: `1px solid ${borderColor}`,
              borderRadius: 12,
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              opacity: isBlocked ? 0.75 : 1,
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 14 }}>
                {n.display_phone || n.phone_id}
              </span>
              <span style={{
                background: qColor + '22',
                color: qColor,
                borderRadius: 6,
                padding: '2px 8px',
                fontSize: 11,
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}>
                {qualityLabel[n.quality_rating] ?? n.quality_rating}
              </span>
            </div>

            {/* Capacidade */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span style={{
                background: '#1e1e3a',
                color: isBlocked ? '#475569' : '#94a3b8',
                borderRadius: 6,
                padding: '2px 8px',
                fontSize: 11,
              }}>
                {n.messaging_tier ?? '—'}
              </span>
              {n.daily_limit > 0 && (
                <span style={{
                  background: '#1e1e3a',
                  color: isBlocked ? '#475569' : '#94a3b8',
                  borderRadius: 6,
                  padding: '2px 8px',
                  fontSize: 11,
                }}>
                  {n.daily_limit.toLocaleString('pt-BR')} msgs
                </span>
              )}
              {isOperational && (
                <span style={{
                  background: '#00ff8822',
                  color: '#00ff88',
                  borderRadius: 6,
                  padding: '2px 8px',
                  fontSize: 11,
                  fontWeight: 700,
                }}>
                  ✓ Operacional
                </span>
              )}
            </div>

            {/* Restrição */}
            <CanSendBadge
              canSend={canSend}
              nameStatus={n.name_status ?? null}
              restrictionCodes={n.restriction_codes ?? []}
            />

            {/* Chatwoot */}
            {n.chatwoot_connected ? (
              <span style={{
                background: '#6366f122',
                color: '#818cf8',
                borderRadius: 6,
                padding: '2px 8px',
                fontSize: 10,
                fontWeight: 700,
                border: '1px solid #6366f144',
              }}>
                📲 Chatwoot #{n.chatwoot_inbox_id}
              </span>
            ) : (
              <span style={{
                background: '#1e1e3a',
                color: '#475569',
                borderRadius: 6,
                padding: '2px 8px',
                fontSize: 10,
                fontWeight: 600,
              }}>
                Sem Chatwoot
              </span>
            )}

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
        );
      })}
    </div>
  );
}
