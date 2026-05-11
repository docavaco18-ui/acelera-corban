import { useEffect, useRef, useState } from 'react';
import { broadcastApi } from '../../lib/api';

interface Assignment {
  id: string;
  phone_id: string;
  display_phone?: string;
  planned_count: number;
  sent_count: number;
  failed_count: number;
  status: string;
  quality_at_start?: string;
  vendeai_mailing_id?: string;
}

interface Dispatch {
  id: string;
  campaign_name?: string;
  csv_filename?: string;
  total_leads: number;
  status: string;
  started_at?: string;
  broadcast_dispatch_assignments?: Assignment[];
}

interface NumberRecord {
  phone_id: string;
  display_phone: string;
  quality_rating: string;
  quality_previous?: string;
  can_send: string;
  daily_limit: number;
  is_paused?: boolean;
  chatwoot_connected?: boolean;
}

interface SnapshotData {
  numbers: NumberRecord[];
  active_dispatches: Dispatch[];
  alerts: { id: string; alert_type: string; message: string; severity: string; ts: string; phone_id?: string }[];
}

const QUALITY_COLOR: Record<string, string> = {
  GREEN:   '#00ff88',
  YELLOW:  '#ffd700',
  RED:     '#ff2d78',
  UNKNOWN: '#475569',
};

function qualityBadge(q: string, prev?: string) {
  const color = QUALITY_COLOR[q] ?? '#475569';
  const degraded = prev && prev !== q && (prev === 'GREEN' && q !== 'GREEN' || prev === 'YELLOW' && q === 'RED');
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ color, fontWeight: 700, fontSize: 11 }}>{q}</span>
      {degraded && <span style={{ color: '#ff2d78', fontSize: 10 }} title="Qualidade caiu">⚠</span>}
    </span>
  );
}

export function MonitorPanel() {
  const [monitoring, setMonitoring] = useState(false);
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSnapshot = async () => {
    try {
      const r = await broadcastApi.getSnapshot();
      setSnapshot(r.data);
      setLastUpdate(new Date());
      setError(null);
    } catch (e: any) {
      setError('Falha ao buscar dados de monitoramento');
    }
  };

  const startMonitor = () => {
    setMonitoring(true);
    fetchSnapshot();
    intervalRef.current = setInterval(fetchSnapshot, 30_000);
  };

  const stopMonitor = () => {
    setMonitoring(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
  };

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const activeDispatches = snapshot?.active_dispatches || [];
  const numbers = snapshot?.numbers || [];
  const alerts = snapshot?.alerts || [];
  const hasActive = activeDispatches.length > 0;

  // Build number lookup
  const numMap: Record<string, NumberRecord> = {};
  for (const n of numbers) numMap[n.phone_id] = n;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {!monitoring ? (
          <button
            onClick={startMonitor}
            style={{
              background: 'linear-gradient(135deg, #6366f1, #00ff88)',
              border: 'none', color: '#080818', borderRadius: 8,
              padding: '9px 20px', cursor: 'pointer', fontWeight: 700, fontSize: 14,
            }}
          >
            ◉ MONITORAR
          </button>
        ) : (
          <button
            onClick={stopMonitor}
            style={{
              background: '#ff2d7822', border: '1px solid #ff2d7844',
              color: '#ff2d78', borderRadius: 8, padding: '9px 20px',
              cursor: 'pointer', fontWeight: 700, fontSize: 14,
            }}
          >
            ⏹ Parar
          </button>
        )}

        {monitoring && (
          <button
            onClick={fetchSnapshot}
            style={{
              background: '#1e1e3a', border: '1px solid #6366f144',
              color: '#6366f1', borderRadius: 8, padding: '9px 14px',
              cursor: 'pointer', fontSize: 13,
            }}
          >
            ⟳ Atualizar agora
          </button>
        )}

        {lastUpdate && (
          <span style={{ color: '#475569', fontSize: 12 }}>
            Atualizado: {lastUpdate.toLocaleTimeString('pt-BR')} · refresh a cada 30s
          </span>
        )}

        {!monitoring && !snapshot && (
          <span style={{ color: '#475569', fontSize: 13 }}>
            Clique em MONITORAR para acompanhar disparos em tempo real
          </span>
        )}
      </div>

      {error && (
        <div style={{ background: '#ff2d7811', border: '1px solid #ff2d7844', borderRadius: 8, padding: '8px 12px', color: '#ff2d78', fontSize: 13 }}>
          {error}
        </div>
      )}

      {snapshot && (
        <>
          {/* Active dispatches monitor */}
          {hasActive ? activeDispatches.map(d => {
            const asns = d.broadcast_dispatch_assignments || [];
            const totalSent = asns.reduce((s, a) => s + (a.sent_count || 0), 0);
            const totalPlanned = asns.reduce((s, a) => s + (a.planned_count || 0), 0) || d.total_leads;
            const pct = totalPlanned > 0 ? Math.min(100, Math.round(totalSent / totalPlanned * 100)) : 0;

            return (
              <div key={d.id} style={{ background: '#0d1a0d', border: '1px solid #00ff8822', borderRadius: 10, padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: d.status === 'running' ? '#00ff88' : '#ffd700', display: 'inline-block' }} />
                  <span style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 15 }}>
                    {d.campaign_name || d.csv_filename || 'Disparo ativo'}
                  </span>
                  <span style={{ color: d.status === 'running' ? '#00ff88' : '#ffd700', fontSize: 12, fontWeight: 600 }}>
                    {d.status === 'running' ? 'Rodando' : 'Pausado'}
                  </span>
                  <span style={{ color: '#475569', fontSize: 12, marginLeft: 'auto' }}>
                    {totalSent.toLocaleString('pt-BR')} / {totalPlanned.toLocaleString('pt-BR')} enviados ({pct}%)
                  </span>
                </div>

                {/* Overall progress */}
                <div style={{ height: 6, background: '#1e1e3a', borderRadius: 3, marginBottom: 14 }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, #6366f1, #00ff88)', borderRadius: 3, transition: 'width 0.5s' }} />
                </div>

                {/* Per-number rows */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {asns.map(a => {
                    const numInfo = numMap[a.phone_id];
                    const aSent = a.sent_count || 0;
                    const aPct = a.planned_count > 0 ? Math.min(100, Math.round(aSent / a.planned_count * 100)) : 0;
                    const currentQuality = numInfo?.quality_rating ?? a.quality_at_start ?? 'UNKNOWN';
                    const qualityDegraded = a.quality_at_start && currentQuality !== a.quality_at_start &&
                      (a.quality_at_start === 'GREEN' || (a.quality_at_start === 'YELLOW' && currentQuality === 'RED'));

                    return (
                      <div key={a.id} style={{
                        background: qualityDegraded ? '#1a0a0a' : '#080818',
                        border: `1px solid ${qualityDegraded ? '#ff2d7844' : '#1e1e3a'}`,
                        borderRadius: 8, padding: '10px 12px',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                          <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 13, minWidth: 130 }}>
                            {a.display_phone || a.phone_id.slice(-10)}
                          </span>

                          {/* Quality badge */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ color: '#475569', fontSize: 11 }}>Qualidade:</span>
                            {qualityBadge(currentQuality, a.quality_at_start)}
                            {qualityDegraded && (
                              <span style={{ color: '#ff2d78', fontSize: 10, fontWeight: 700 }}>
                                ↘ era {a.quality_at_start}
                              </span>
                            )}
                          </div>

                          {numInfo?.daily_limit != null && (
                            <span style={{ color: '#475569', fontSize: 11 }}>
                              Limite: <span style={{ color: '#94a3b8' }}>{numInfo.daily_limit.toLocaleString('pt-BR')}/dia</span>
                            </span>
                          )}

                          <span style={{ marginLeft: 'auto', color: '#475569', fontSize: 11 }}>
                            {aSent.toLocaleString('pt-BR')} / {a.planned_count.toLocaleString('pt-BR')}
                            <span style={{ color: '#00ff88', marginLeft: 4 }}>({aPct}%)</span>
                          </span>

                          {(a.failed_count || 0) > 0 && (
                            <span style={{ color: '#ff2d78', fontSize: 11 }}>
                              {a.failed_count} falhas
                            </span>
                          )}
                        </div>

                        {/* Per-number progress bar */}
                        <div style={{ height: 4, background: '#1e1e3a', borderRadius: 2 }}>
                          <div style={{
                            height: '100%',
                            width: `${aPct}%`,
                            background: qualityDegraded ? '#ff2d78' : QUALITY_COLOR[currentQuality] ?? '#6366f1',
                            borderRadius: 2, transition: 'width 0.3s',
                          }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          }) : (
            <div style={{ background: '#080818', border: '1px solid #1e1e3a', borderRadius: 10, padding: 16, color: '#475569', fontSize: 13 }}>
              Nenhum disparo ativo no momento.
            </div>
          )}

          {/* Quality overview for all numbers */}
          {numbers.length > 0 && (
            <div style={{ background: '#080818', border: '1px solid #1e1e3a', borderRadius: 10, padding: 16 }}>
              <div style={{ color: '#6366f1', fontSize: 12, fontWeight: 700, marginBottom: 10 }}>QUALIDADE DOS NÚMEROS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {numbers.map(n => {
                  const qColor = QUALITY_COLOR[n.quality_rating] ?? '#475569';
                  const degraded = n.quality_previous && n.quality_previous !== n.quality_rating;
                  return (
                    <div key={n.phone_id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                      <span style={{ color: '#94a3b8', minWidth: 140 }}>{n.display_phone || n.phone_id.slice(-10)}</span>
                      <span style={{ color: qColor, fontWeight: 700, minWidth: 60 }}>{n.quality_rating}</span>
                      {degraded && (
                        <span style={{ color: '#ff2d78', fontSize: 10 }}>⚠ era {n.quality_previous}</span>
                      )}
                      <span style={{ color: '#475569', fontSize: 11 }}>{n.daily_limit?.toLocaleString('pt-BR') ?? '—'}/dia</span>
                      <span style={{ color: n.can_send === 'AVAILABLE' ? '#00ff88' : n.can_send === 'LIMITED' ? '#ffd700' : '#ff2d78', fontSize: 11 }}>
                        {n.can_send}
                      </span>
                      {!n.chatwoot_connected && (
                        <span style={{ color: '#ff2d78', fontSize: 10 }}>✕ Chatwoot</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Recent alerts */}
          {alerts.length > 0 && (
            <div style={{ background: '#1a0505', border: '1px solid #ff2d7833', borderRadius: 10, padding: 16 }}>
              <div style={{ color: '#ff2d78', fontSize: 12, fontWeight: 700, marginBottom: 10 }}>ALERTAS RECENTES</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {alerts.slice(0, 10).map(a => (
                  <div key={a.id} style={{ display: 'flex', gap: 10, fontSize: 12 }}>
                    <span style={{ color: '#475569', whiteSpace: 'nowrap' }}>
                      {new Date(a.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span style={{ color: a.severity === 'critical' ? '#ff2d78' : '#ffd700' }}>{a.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
