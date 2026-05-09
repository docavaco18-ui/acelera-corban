interface Alert {
  id: string;
  alert_type: string;
  severity: 'warn' | 'critical';
  message: string;
  phone_id: string;
  ts: string;
}

interface Props {
  alerts: Alert[];
}

const severityColor: Record<string, string> = {
  warn: '#ffd700',
  critical: '#ff2d78',
};

export function AlertFeed({ alerts }: Props) {
  if (!alerts.length) {
    return (
      <div style={{ color: '#475569', textAlign: 'center', padding: 24 }}>
        Nenhum alerta registrado.
      </div>
    );
  }

  return (
    <div style={{
      maxHeight: 320,
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      {alerts.map(a => (
        <div
          key={a.id}
          style={{
            background: '#0d0d1f',
            border: `1px solid ${(severityColor[a.severity] ?? '#1e1e3a')}44`,
            borderLeft: `3px solid ${severityColor[a.severity] ?? '#1e1e3a'}`,
            borderRadius: 8,
            padding: '10px 14px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ color: severityColor[a.severity] ?? '#ffd700', fontSize: 12, fontWeight: 700 }}>
              {a.alert_type.replace('_', ' ').toUpperCase()}
            </span>
            <span style={{ color: '#e2e8f0', fontSize: 13 }}>{a.message}</span>
            <span style={{ color: '#475569', fontSize: 11 }}>{a.phone_id}</span>
          </div>
          <span style={{ color: '#475569', fontSize: 11, whiteSpace: 'nowrap' }}>
            {new Date(a.ts).toLocaleTimeString('pt-BR')}
          </span>
        </div>
      ))}
    </div>
  );
}
