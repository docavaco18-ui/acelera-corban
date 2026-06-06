import { useEffect, useState } from 'react';
import { C, G, QUALITY_GRAD } from './tokens';
import { PulseDot, GradientBar } from './Section';
import { effectiveQuality, bmSummary } from './quality';

// Animated AI brain — centerpiece da seção de monitoramento.
// Click = aciona Refresh (mesmo efeito do botão lá em cima).
export function AICore({ refreshing, onClick }: { refreshing: boolean; onClick: () => void }) {
  const mult = refreshing ? 0.35 : 1;

  const particles = [
    { r: 95, sp: 8, c: '#7c3aed', s: 11 },
    { r: 105, sp: 12, c: '#06b6d4', s: 9 },
    { r: 85, sp: 10, c: '#00ff88', s: 8 },
    { r: 100, sp: 14, c: '#ec4899', s: 10 },
    { r: 90, sp: 9, c: '#06b6d4', s: 7 },
    { r: 110, sp: 16, c: '#7c3aed', s: 12 },
    { r: 88, sp: 11, c: '#00ff88', s: 9 },
    { r: 102, sp: 13, c: '#ec4899', s: 8 },
  ];

  return (
    <div className="ds-ai-core" onClick={onClick}
      title="Clique pra atualizar todos os status (mesmo efeito do Refresh)"
      style={{ position: 'relative', width: 260, height: 260, flexShrink: 0, margin: '0 auto', cursor: refreshing ? 'wait' : 'pointer' }}>

      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} viewBox="0 0 260 260">
        <defs>
          <linearGradient id="synapse-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.8" />
          </linearGradient>
        </defs>
        {[
          'M 60 80 Q 130 130 200 70',
          'M 50 150 Q 130 100 210 160',
          'M 80 200 Q 130 130 180 200',
          'M 70 60 Q 130 130 190 200',
          'M 200 80 Q 130 130 60 180',
        ].map((d, i) => (
          <path key={i} d={d} stroke="url(#synapse-grad)" strokeWidth="1.5" fill="none"
            strokeDasharray="4 4"
            style={{ animation: `ai-synapse ${(3 + i * 0.4) * mult}s linear infinite`, opacity: 0.8 }} />
        ))}
      </svg>

      <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px dashed rgba(124,58,237,.35)', animation: `ai-spin ${22 * mult}s linear infinite` }} />
      <div style={{ position: 'absolute', inset: 22, borderRadius: '50%', border: '1.5px dotted rgba(6,182,212,.45)', animation: `ai-spin-rev ${16 * mult}s linear infinite` }} />
      <div style={{ position: 'absolute', inset: 46, borderRadius: '50%', border: '1px solid rgba(0,255,136,.2)', animation: `ai-spin ${10 * mult}s linear infinite` }} />

      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        width: 110, height: 110, borderRadius: '50%',
        background: 'radial-gradient(circle at 35% 35%, #a78bfa 0%, #7c3aed 35%, #06b6d4 75%, transparent 100%)',
        animation: `ai-orb-pulse ${2.5 * mult}s ease-in-out infinite`,
        filter: 'blur(.5px)',
      }} />

      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 52, animation: `ai-float ${3.5 * mult}s ease-in-out infinite`,
        pointerEvents: 'none', filter: 'drop-shadow(0 0 12px rgba(0,255,136,.5))',
      }}>🧠</div>

      {particles.map((p, i) => (
        <div key={i} style={{
          position: 'absolute', inset: 0,
          animation: `ai-spin ${p.sp * mult}s linear infinite`,
          animationDelay: `-${(p.sp * mult) * (i / particles.length)}s`,
        }}>
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            width: p.s, height: p.s, borderRadius: '50%',
            background: p.c,
            boxShadow: `0 0 14px ${p.c}, 0 0 4px ${p.c}`,
            marginLeft: -p.s / 2, marginTop: -p.s / 2 - p.r,
            animation: `ai-twinkle ${(1.8 + i * 0.2) * mult}s ease-in-out infinite`,
          }} />
        </div>
      ))}

      {refreshing && (
        <div style={{
          position: 'absolute', bottom: -8, left: 0, right: 0, textAlign: 'center',
          color: '#00ff88', fontSize: 11, fontWeight: 800,
          textTransform: 'uppercase' as const, letterSpacing: '0.15em',
          textShadow: '0 0 12px rgba(0,255,136,.8)',
        }}>⟳ Atualizando…</div>
      )}
      {!refreshing && (
        <div style={{
          position: 'absolute', bottom: -8, left: 0, right: 0, textAlign: 'center',
          color: '#06b6d4', fontSize: 10, fontWeight: 700,
          textTransform: 'uppercase' as const, letterSpacing: '0.12em',
          opacity: 0.7,
        }}>👆 Clique pra atualizar</div>
      )}
    </div>
  );
}

// Unified AI Monitor Panel — usar nos 3 disparadores.
// Recebe getSnapshot(): Promise<{instances/channels, active_dispatches}>
// e instances (array já carregada da página).
export function AIMonitorPanel({
  instances,
  getSnapshot,
  onRefresh,
  refreshing = false,
  totalSentLabel = 'mensagens enviadas em tempo real',
  campaignsLabel = 'campanha em monitoramento',
  campaignsLabelPlural = 'campanhas em monitoramento',
}: {
  instances: any[];
  getSnapshot: () => Promise<{ instances?: any[]; channels?: any[]; active_dispatches: any[] }>;
  onRefresh?: () => Promise<void> | void;
  refreshing?: boolean;
  totalSentLabel?: string;
  campaignsLabel?: string;
  campaignsLabelPlural?: string;
}) {
  const [snapshot, setSnapshot] = useState<any>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const load = () => getSnapshot().then(setSnapshot).catch(() => { });
    load();
    const timer = setInterval(() => { load(); setTick(t => t + 1); }, 15000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const triggerRefresh = async () => {
    if (refreshing || !onRefresh) return;
    await onRefresh();
  };

  const active = snapshot?.active_dispatches || [];
  const totalSent = active.reduce((s: number, d: any) => {
    const asns = d.broadcast_dispatch_assignments || [];
    return s + asns.reduce((ss: number, a: any) => ss + (a.sent_count || 0), 0);
  }, 0);

  const qBreak = { GREEN: 0, YELLOW: 0, RED: 0, UNKNOWN: 0 };
  instances.forEach(i => {
    const eq = effectiveQuality(i);
    if (eq in qBreak) qBreak[eq as keyof typeof qBreak]++;
  });

  const statusMessages = [
    'Analisando taxa de entrega…',
    'Monitorando qualidade dos números…',
    'Verificando templates aprovados pela Meta…',
    'Pronta para pausar números RED automaticamente.',
    'Tudo sob controle. IA vigilante.',
  ];
  const statusText = statusMessages[tick % statusMessages.length];

  const STATUS_GRAD: Record<string, string> = {
    running: G.yellow, done: G.green, paused: G.purple, cancelled: G.red, error: G.red,
  };
  const STATUS_COLOR: Record<string, string> = {
    running: '#f59e0b', done: '#10b981', paused: '#7c3aed', cancelled: '#ef4444', error: '#f87171',
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 40, alignItems: 'center' }}>
      <AICore refreshing={refreshing} onClick={triggerRefresh} />

      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <PulseDot color="#00ff88" />
          <span style={{ color: '#00ff88', fontSize: 13, fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: '0.12em' }}>
            IA Ativa · Monitorando 24/7
          </span>
        </div>

        <div style={{ marginBottom: 24 }}>
          <div style={{
            fontSize: 64, fontWeight: 800, lineHeight: 1,
            background: G.neon, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>{totalSent.toLocaleString('pt-BR')}</div>
          <div style={{ color: C.sec, fontSize: 14, marginTop: 8 }}>{totalSentLabel}</div>
        </div>

        <div style={{
          padding: '12px 16px', background: 'rgba(124,58,237,.06)',
          border: '1px solid rgba(124,58,237,.18)', borderRadius: 10,
          marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 16 }}>🤖</span>
          <span style={{ color: C.text, fontSize: 14, fontWeight: 500, animation: 'ai-text-pulse 2.5s ease-in-out infinite' }}>
            {statusText}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          {[
            { k: 'GREEN', label: 'Verde', col: '#10b981', n: qBreak.GREEN },
            { k: 'YELLOW', label: 'Amarelo', col: '#f59e0b', n: qBreak.YELLOW },
            { k: 'RED', label: 'Vermelho', col: '#ef4444', n: qBreak.RED },
          ].map(({ k, label, col, n }) => (
            <div key={k} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: `${col}12`, border: `1px solid ${col}33`,
              borderRadius: 10, padding: '8px 14px',
            }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: col, boxShadow: `0 0 8px ${col}` }} />
              <span style={{ color: col, fontSize: 13, fontWeight: 700 }}>{n}</span>
              <span style={{ color: C.sec, fontSize: 13 }}>{label}</span>
            </div>
          ))}
        </div>

        {active.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>
              {active.length} {active.length === 1 ? campaignsLabel : campaignsLabelPlural}
            </div>
            {active.slice(0, 4).map((d: any) => {
              const asns = d.broadcast_dispatch_assignments || [];
              const sent = asns.reduce((s: number, a: any) => s + (a.sent_count || 0), 0);
              const planned = asns.reduce((s: number, a: any) => s + (a.planned_count || 0), 0);
              const pct = planned > 0 ? Math.round(sent * 100 / planned) : 0;
              return (
                <div key={d.id} style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.05)',
                  borderRadius: 10, padding: '12px 16px',
                }}>
                  <span style={{ color: C.text, fontSize: 14, fontWeight: 600, minWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.campaign_name || d.id.slice(0, 8)}
                  </span>
                  <div style={{ flex: 1 }}>
                    <GradientBar pct={pct} gradient={STATUS_GRAD[d.status] || G.primary} height={6} />
                  </div>
                  <span style={{ color: C.sec, fontSize: 13, minWidth: 90, textAlign: 'right' }}>{sent}/{planned}</span>
                  <span style={{ color: STATUS_COLOR[d.status] || C.sec, fontSize: 16, fontWeight: 800, minWidth: 56, textAlign: 'right' }}>{pct}%</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{
            color: C.sec, fontSize: 14, padding: '14px 18px',
            background: 'rgba(255,255,255,.02)', borderRadius: 10,
            border: '1px dashed rgba(255,255,255,.08)',
          }}>
            Nenhum disparo ativo. IA em standby — pronta para vigiar quando você disparar.
          </div>
        )}

        {/* Capacidade Hoje — barras por número */}
        {instances.length > 0 && <CapacityBlock instances={instances} />}

        <div style={{
          marginTop: 20, padding: '14px 18px',
          background: 'rgba(0,255,136,.05)', border: '1px solid rgba(0,255,136,.18)',
          borderRadius: 10, fontSize: 14, color: C.sec, lineHeight: 1.5,
        }}>
          <strong style={{ color: '#00ff88' }}>🛡️ Auto-proteção:</strong> a IA pausa automaticamente números com qualidade RED para evitar bloqueios da Meta. <span style={{ color: C.muted }}>Clique no cérebro pra forçar atualização agora.</span>
        </div>
      </div>
    </div>
  );
}

// Bloco "Capacidade Hoje" — barras por número mostrando enviado/limite.
function CapacityBlock({ instances }: { instances: any[] }) {
  const s = bmSummary(instances);
  const totalSentToday = instances.reduce((acc, i) => acc + (Number(i.sent_today) || 0), 0);
  const pctTotal = s.capacityActive > 0 ? Math.round((totalSentToday / s.capacityActive) * 100) : 0;

  // Ordenar: maior uso primeiro
  const sorted = [...instances].sort((a, b) => {
    const pa = (Number(a.daily_limit) || 1) > 0 ? (Number(a.sent_today) || 0) / (Number(a.daily_limit) || 1) : 0;
    const pb = (Number(b.daily_limit) || 1) > 0 ? (Number(b.sent_today) || 0) / (Number(b.daily_limit) || 1) : 0;
    return pb - pa;
  });

  return (
    <div style={{
      marginTop: 20, padding: '16px 18px',
      background: 'rgba(124,58,237,.05)', border: '1px solid rgba(124,58,237,.2)',
      borderRadius: 12,
    }}>
      {/* Header c/ total geral */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{
          color: '#a78bfa', fontSize: 11, fontWeight: 800,
          textTransform: 'uppercase' as const, letterSpacing: '0.1em',
        }}>⚡ Capacidade Hoje</span>
        <span style={{ color: C.sec, fontSize: 13 }}>
          <strong style={{ color: C.text }}>{totalSentToday.toLocaleString('pt-BR')}</strong>
          {' / '}
          <span style={{ color: C.muted }}>{s.capacityActive.toLocaleString('pt-BR')}</span>
          <span style={{ color: '#a78bfa', fontWeight: 700, marginLeft: 8 }}>{pctTotal}%</span>
        </span>
      </div>

      {/* Barra total */}
      <div style={{ marginBottom: 16 }}>
        <GradientBar pct={pctTotal} gradient={G.primary} height={8} />
      </div>

      {/* Lista por número */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        maxHeight: 260, overflowY: 'auto', paddingRight: 4,
      }}>
        {sorted.map((inst, i) => {
          const eq = effectiveQuality(inst);
          const limit = Number(inst.daily_limit) || 0;
          const sent = Number(inst.sent_today) || 0;
          const pct = limit > 0 ? Math.min(100, Math.round((sent / limit) * 100)) : 0;
          const phone = inst.display_phone || inst.phone || inst.title || inst.name || `#${i}`;
          const paused = !!inst.is_paused;
          return (
            <div key={inst.phone_id || inst.instance_id || inst.channel_id || i}
              style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{
                color: paused ? C.muted : C.text, fontSize: 12, fontWeight: 600,
                minWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                flexShrink: 0,
                textDecoration: paused ? 'line-through' : 'none',
              }} title={phone}>{phone}</span>
              <div style={{ flex: 1 }}>
                <GradientBar pct={pct} gradient={QUALITY_GRAD[eq]} height={6} />
              </div>
              <span style={{
                color: C.sec, fontSize: 11, minWidth: 90, textAlign: 'right',
                flexShrink: 0, fontFamily: 'monospace',
              }}>
                {sent}/{limit}
              </span>
              <span style={{
                color: pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#10b981',
                fontSize: 11, fontWeight: 800, minWidth: 36, textAlign: 'right',
                flexShrink: 0,
              }}>{pct}%</span>
            </div>
          );
        })}
      </div>

      {/* Legenda Verde/Amarelo/Vermelho */}
      <div style={{
        display: 'flex', gap: 14, marginTop: 14, paddingTop: 12,
        borderTop: '1px solid rgba(255,255,255,.05)',
        fontSize: 11, color: C.muted,
      }}>
        <span><span style={{ color: '#10b981', fontWeight: 700 }}>● </span>até 70%</span>
        <span><span style={{ color: '#f59e0b', fontWeight: 700 }}>● </span>70–90% (atenção)</span>
        <span><span style={{ color: '#ef4444', fontWeight: 700 }}>● </span>+90% (perto do limite)</span>
      </div>
    </div>
  );
}
