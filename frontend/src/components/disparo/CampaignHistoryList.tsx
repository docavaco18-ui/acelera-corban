import { useEffect, useState } from 'react';
import { broadcastApi } from '../../lib/api';

interface Assignment {
  id: string;
  phone_id: string;
  display_phone?: string;
  planned_count: number;
  sent_count: number;
  failed_count: number;
  status: string;
  vendeai_mailing_id?: string;
  template_id?: string;
  quality_at_start?: string;
}

interface Dispatch {
  id: string;
  csv_filename: string;
  campaign_name?: string;
  total_leads: number;
  status: string;
  created_at: string;
  started_at?: string;
  finished_at?: string;
  broadcast_dispatch_assignments?: Assignment[];
}

interface Props {
  onRefresh?: () => void;
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  running:         { label: 'Rodando',   color: '#00ff88' },
  paused:          { label: 'Pausado',   color: '#ffd700' },
  pending_confirm: { label: 'Pendente',  color: '#6366f1' },
  revoked:         { label: 'Cancelado', color: '#ff2d78' },
  done:            { label: 'Concluído', color: '#94a3b8' },
};

function statusBadge(status: string) {
  const s = STATUS_LABEL[status] ?? { label: status, color: '#475569' };
  return (
    <span style={{
      background: s.color + '22', color: s.color,
      border: `1px solid ${s.color}44`,
      borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 700,
    }}>
      {s.label}
    </span>
  );
}

function fmtDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function totalSent(asns?: Assignment[]) {
  return (asns || []).reduce((s, a) => s + (a.sent_count || 0), 0);
}

function totalPlanned(asns?: Assignment[]) {
  return (asns || []).reduce((s, a) => s + (a.planned_count || 0), 0);
}

interface Metrics {
  total_recipients: number;
  planned_count: number;
  queued_count: number;
  sent_count: number;
  failed_count: number;
  delivered_count: number;
  read_count: number;
  reply_count: number;
  conversion_count: number;
  has_per_recipient_data: boolean;
  has_delivered_data: boolean;
  has_read_data: boolean;
  has_reply_data: boolean;
  has_conversion_data: boolean;
}

function FunnelBar({ label, value, total, color, hasData }: {
  label: string; value: number; total: number; color: string; hasData: boolean;
}) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
      <span style={{ color: hasData ? '#e2e8f0' : '#475569', minWidth: 90, fontWeight: 600 }}>{label}</span>
      <div style={{ flex: 1, height: 8, background: '#1e1e3a', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: hasData ? `linear-gradient(90deg, ${color}88, ${color})` : '#33415544',
          borderRadius: 4,
          transition: 'width 0.4s ease',
        }} />
      </div>
      <span style={{
        color: hasData ? color : '#475569',
        minWidth: 100, textAlign: 'right',
        fontVariantNumeric: 'tabular-nums', fontWeight: 700,
      }}>
        {hasData
          ? `${value.toLocaleString('pt-BR')} (${pct.toFixed(1)}%)`
          : 'sem dados ainda'}
      </span>
    </div>
  );
}

function CampaignFunnel({ metrics }: { metrics: Metrics }) {
  const base = metrics.total_recipients || metrics.planned_count || 0;
  const sentReal = metrics.has_per_recipient_data || metrics.sent_count > 0;
  return (
    <div style={{
      background: '#0a0a1a',
      border: '1px solid #1e1e3a',
      borderRadius: 8,
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div style={{
        color: '#94a3b8', fontSize: 10, fontWeight: 800,
        letterSpacing: '.12em', textTransform: 'uppercase',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span>Funil de campanha</span>
        <span style={{ color: '#475569', textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>
          base: {base.toLocaleString('pt-BR')} destinatários
        </span>
      </div>
      <FunnelBar label="Enviados"   value={metrics.sent_count}       total={base} color="#06b6d4" hasData={sentReal} />
      <FunnelBar label="Entregues"  value={metrics.delivered_count}  total={base} color="#10b981" hasData={metrics.has_delivered_data} />
      <FunnelBar label="Lidos"      value={metrics.read_count}       total={base} color="#7c3aed" hasData={metrics.has_read_data} />
      <FunnelBar label="Responderam" value={metrics.reply_count}     total={base} color="#f59e0b" hasData={metrics.has_reply_data} />
      <FunnelBar label="Converteram" value={metrics.conversion_count} total={base} color="#ec4899" hasData={metrics.has_conversion_data} />
      {metrics.failed_count > 0 && (
        <FunnelBar label="Falharam" value={metrics.failed_count} total={base} color="#ef4444" hasData />
      )}
      {(!metrics.has_delivered_data && !metrics.has_reply_data) && (
        <div style={{
          color: '#64748b', fontSize: 11, marginTop: 6, lineHeight: 1.5,
          background: 'rgba(124,58,237,.04)', border: '1px dashed #1e1e3a',
          borderRadius: 6, padding: '8px 10px',
        }}>
          VendeAI hoje só devolve enviados agregados. Entregues/Lidos/Respostas/Conversões aparecem quando Chatwoot ou webhook estiverem conectados.
        </div>
      )}
    </div>
  );
}

export function CampaignHistoryList({ onRefresh }: Props) {
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [actErr, setActErr] = useState('');
  const [metricsCache, setMetricsCache] = useState<Record<string, Metrics>>({});
  const [metricsLoading, setMetricsLoading] = useState<Record<string, boolean>>({});

  const load = async () => {
    setLoading(true);
    try {
      const r = await broadcastApi.listDispatches();
      setDispatches(r.data || []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!expanded || metricsCache[expanded] || metricsLoading[expanded]) return;
    setMetricsLoading(prev => ({ ...prev, [expanded]: true }));
    broadcastApi.getDispatchMetrics(expanded)
      .then(r => setMetricsCache(prev => ({ ...prev, [expanded]: r.data })))
      .catch(() => { /* ignore */ })
      .finally(() => setMetricsLoading(prev => ({ ...prev, [expanded]: false })));
  }, [expanded]);

  const act = async (id: string, action: 'pause' | 'resume' | 'revoke') => {
    setActing(id + action);
    setActErr('');
    try {
      if (action === 'pause') await broadcastApi.pauseDispatch(id);
      else if (action === 'resume') await broadcastApi.resumeDispatch(id);
      else await broadcastApi.revokeDispatch(id);
      await load();
      onRefresh?.();
    } catch (e: any) {
      // pause/cancel falho = campanha continua rodando no CRM — não engolir
      const verb = action === 'pause' ? 'pausar' : action === 'resume' ? 'retomar' : 'cancelar';
      setActErr(`Falha ao ${verb}: ${e?.response?.data?.detail || e?.message || 'erro desconhecido'}`);
    } finally {
      setActing(null);
    }
  };

  if (loading) {
    return <div style={{ color: '#475569', fontSize: 13, padding: 16 }}>Carregando histórico...</div>;
  }

  if (!dispatches.length) {
    return <div style={{ color: '#475569', fontSize: 13, padding: 16 }}>Nenhum disparo realizado ainda.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {actErr && (
        <div style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, padding: '10px 14px', color: '#f87171', fontSize: 13 }}>
          ⚠️ {actErr}
        </div>
      )}
      {dispatches.map((d, idx) => {
        const asns = d.broadcast_dispatch_assignments || [];
        const sent = totalSent(asns);
        const planned = totalPlanned(asns) || d.total_leads;
        const pct = planned > 0 ? Math.min(100, Math.round(sent / planned * 100)) : 0;
        const isActive = d.status === 'running' || d.status === 'paused';
        const isOpen = expanded === d.id;

        return (
          <div key={d.id} style={{
            background: isActive ? '#0d1a0d' : '#080818',
            border: `1px solid ${isActive ? '#00ff8833' : '#1e1e3a'}`,
            borderRadius: 10,
            overflow: 'hidden',
          }}>
            {/* Header row */}
            <div
              onClick={() => setExpanded(isOpen ? null : d.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer' }}
            >
              {/* Active pulse dot */}
              {isActive && (
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: d.status === 'running' ? '#00ff88' : '#ffd700', flexShrink: 0 }} />
              )}
              {idx === 0 && !isActive && (
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#475569', flexShrink: 0 }} />
              )}

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.campaign_name || d.csv_filename || 'Disparo'}
                  </span>
                  {statusBadge(d.status)}
                  {idx === 0 && (
                    <span style={{ color: '#6366f1', fontSize: 10, fontWeight: 700 }}>● MAIS RECENTE</span>
                  )}
                </div>
                <div style={{ color: '#475569', fontSize: 11, marginTop: 2 }}>
                  {fmtDate(d.started_at || d.created_at)} · {planned.toLocaleString('pt-BR')} leads · {asns.length} número{asns.length !== 1 ? 's' : ''}
                </div>
              </div>

              {/* Progress bar */}
              <div style={{ width: 100, flexShrink: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ color: '#94a3b8', fontSize: 10 }}>{sent.toLocaleString('pt-BR')} enviados</span>
                  <span style={{ color: '#475569', fontSize: 10 }}>{pct}%</span>
                </div>
                <div style={{ height: 4, background: '#1e1e3a', borderRadius: 2 }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: d.status === 'paused' ? '#ffd700' : '#00ff88', borderRadius: 2, transition: 'width 0.3s' }} />
                </div>
              </div>

              {/* Action buttons */}
              {isActive && (
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                  {d.status === 'running' && (
                    <button
                      onClick={() => act(d.id, 'pause')}
                      disabled={acting === d.id + 'pause'}
                      style={{ background: '#ffd70022', border: '1px solid #ffd70044', color: '#ffd700', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}
                    >
                      ⏸ Pausar
                    </button>
                  )}
                  {d.status === 'paused' && (
                    <button
                      onClick={() => act(d.id, 'resume')}
                      disabled={acting === d.id + 'resume'}
                      style={{ background: '#00ff8822', border: '1px solid #00ff8844', color: '#00ff88', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}
                    >
                      ▶ Retomar
                    </button>
                  )}
                  <button
                    onClick={() => act(d.id, 'revoke')}
                    disabled={acting === d.id + 'revoke'}
                    style={{ background: '#ff2d7811', border: '1px solid #ff2d7833', color: '#ff2d78', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}
                  >
                    ✕ Cancelar
                  </button>
                </div>
              )}

              <span style={{ color: '#475569', fontSize: 14, flexShrink: 0 }}>{isOpen ? '▲' : '▼'}</span>
            </div>

            {/* Expanded — funil + assignments */}
            {isOpen && (
              <div style={{ borderTop: '1px solid #1e1e3a', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {metricsLoading[d.id] && !metricsCache[d.id] && (
                  <div style={{ color: '#475569', fontSize: 12 }}>Carregando funil...</div>
                )}
                {metricsCache[d.id] && <CampaignFunnel metrics={metricsCache[d.id]} />}
                {asns.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {asns.map(a => {
                  const aStatus = STATUS_LABEL[a.status] ?? { label: a.status, color: '#475569' };
                  const aSent = a.sent_count || 0;
                  const aPct = a.planned_count > 0 ? Math.min(100, Math.round(aSent / a.planned_count * 100)) : 0;
                  return (
                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                      <span style={{ color: '#94a3b8', minWidth: 120 }}>{a.display_phone || a.phone_id.slice(-10)}</span>
                      <span style={{ color: aStatus.color, minWidth: 70 }}>{aStatus.label}</span>
                      <div style={{ flex: 1, height: 4, background: '#1e1e3a', borderRadius: 2 }}>
                        <div style={{ height: '100%', width: `${aPct}%`, background: aStatus.color, borderRadius: 2 }} />
                      </div>
                      <span style={{ color: '#475569', minWidth: 80, textAlign: 'right' }}>
                        {aSent.toLocaleString('pt-BR')} / {a.planned_count.toLocaleString('pt-BR')}
                      </span>
                      {a.quality_at_start && (
                        <span style={{ color: a.quality_at_start === 'GREEN' ? '#00ff88' : a.quality_at_start === 'YELLOW' ? '#ffd700' : '#ff2d78', fontSize: 10 }}>
                          Q:{a.quality_at_start}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
