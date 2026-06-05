import { C, G, QUALITY_COLOR, QUALITY_GRAD, btnStyle } from './tokens';
import { effectiveQuality, statusCards, extraWarnings, topLevel, ALERT_COLOR } from './quality';
import { GradientBar } from './Section';
import { BMSummary } from './BMSummary';

interface Props {
  instances: any[];
  onTogglePause: (iid: string, paused: boolean) => void;
  crmLabel?: string;        // ex: "CRM AESIR" / "CRM VENDEAI" / "CRM CHIPCARE"
  metaOnlyLabel?: string;   // ex: "SÓ META"
  emptyHint?: string;
}

// Shared NumberQualityGrid — usado em DisparoAesir + Disparo (VendeAI) + DisparoChipcare.
// Renderiza cards 4-col (Capacidade · Qualidade · Pagamento · Nome) + warnings + IDs Meta.
export function NumberQualityGrid({
  instances,
  onTogglePause,
  crmLabel = 'CRM',
  metaOnlyLabel = 'SÓ META',
  emptyHint = 'Nenhum número. Clique em Refresh.',
}: Props) {
  if (!instances.length) {
    return (
      <div>
        <BMSummary instances={instances} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '32px 0', color: C.muted, fontSize: 13 }}>
          <span style={{ fontSize: 28 }}>📱</span>
          {emptyHint}
        </div>
      </div>
    );
  }

  // Ordem: GREEN → YELLOW → RED → UNKNOWN (saudáveis primeiro)
  const rank: Record<string, number> = { GREEN: 0, YELLOW: 1, RED: 2, UNKNOWN: 3 };
  const sorted = [...instances].sort((a, b) => rank[effectiveQuality(a)] - rank[effectiveQuality(b)]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <BMSummary instances={instances} />
      {sorted.map(inst => {
        const paused = !!inst.is_paused;
        const eq = effectiveQuality(inst);
        const dotColor = QUALITY_COLOR[eq] || '#475569';
        const iid = String(inst.instance_id || inst.channel_id || inst.phone_id || '');
        const isMetaOnly = iid.startsWith('meta:') || inst.status === 'meta-only';
        const crmConnected = !isMetaOnly;
        const cards = statusCards(inst);
        const warnings = extraWarnings(inst);
        const top = topLevel(inst);
        const wabaId = inst.waba_id || '';
        const phoneId = inst.phone_id || '';
        const isCritical = top === 'red';
        const isWarn = top === 'yellow';
        const dailyUsedPct = inst.daily_limit ? Math.min(100, Math.round(((inst.sent_today || 0) / inst.daily_limit) * 100)) : 0;

        return (
          <div key={iid} style={{
            background: isCritical ? 'rgba(239,68,68,.05)' : isWarn ? 'rgba(245,158,11,.04)' : 'rgba(255,255,255,.025)',
            border: `1px solid ${isCritical ? 'rgba(239,68,68,.28)' : isWarn ? 'rgba(245,158,11,.22)' : 'rgba(255,255,255,.07)'}`,
            borderRadius: 14, padding: '16px 20px',
            display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div title={`Status: ${top}`} style={{
                width: 14, height: 14, borderRadius: '50%', background: dotColor, flexShrink: 0,
                boxShadow: `0 0 10px ${dotColor}99, 0 0 2px ${dotColor}`,
                animation: isCritical ? 'pulse-dot 1.5s ease-in-out infinite' : undefined,
              }} />

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 14, marginBottom: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  {phoneId && (
                    <span title="Phone Number ID — busque por este ID na BM"
                      style={{ color: '#06b6d4', fontSize: 10, fontFamily: 'monospace', fontWeight: 600 }}>
                      📞 {phoneId}
                    </span>
                  )}
                  {wabaId && (
                    <span title="WABA ID"
                      style={{ color: '#7c3aed', fontSize: 10, fontFamily: 'monospace', fontWeight: 600 }}>
                      🏢 {wabaId}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ color: C.text, fontSize: 17, fontWeight: 800, letterSpacing: '-0.01em' }}>
                    {inst.display_phone || inst.phone || inst.title || inst.name || iid}
                  </span>
                  {inst.verified_name && (
                    <span style={{ color: C.sec, fontSize: 13 }}>· {inst.verified_name}</span>
                  )}
                  {inst.is_official_business_account && (
                    <span title="Conta oficial verificada" style={{ color: '#06b6d4', fontSize: 14 }}>✔</span>
                  )}
                  {paused && (
                    <span style={{ color: '#f59e0b', fontSize: 10, background: '#f59e0b18', border: '1px solid #f59e0b44', borderRadius: 4, padding: '2px 8px', fontWeight: 800, letterSpacing: '0.06em' }}>PAUSADA</span>
                  )}
                </div>
                {(inst.waba_name || inst.waba_country) && (
                  <div style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>
                    {inst.waba_name && <>BM <strong style={{ color: C.sec }}>{inst.waba_name}</strong></>}
                    {inst.waba_country && <span style={{ marginLeft: 8 }}>· {inst.waba_country}</span>}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  color: crmConnected ? '#10b981' : '#64748b',
                  fontSize: 10, fontWeight: 800,
                  background: crmConnected ? 'rgba(16,185,129,.08)' : 'rgba(100,116,139,.08)',
                  border: `1px solid ${crmConnected ? 'rgba(16,185,129,.3)' : 'rgba(100,116,139,.25)'}`,
                  borderRadius: 6, padding: '4px 10px', letterSpacing: '0.06em',
                }}>
                  {crmConnected ? `✓ ${crmLabel}` : `⚠ ${metaOnlyLabel}`}
                </span>
                <button className="ds-btn"
                  title={paused ? 'Retomar nos próximos disparos' : 'Pausar — número fica fora dos próximos disparos.'}
                  style={btnStyle(paused ? G.green : G.red, false)}
                  onClick={() => onTogglePause(iid, paused)}>
                  {paused ? '▶ Retomar' : '⏸ Pausar'}
                </button>
              </div>
            </div>

            {/* Status cards 4-col */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              {cards.map((c, i) => {
                const isCap = i === 0;
                return (
                  <div key={c.label} style={{
                    background: `${ALERT_COLOR[c.level]}0d`,
                    border: `1px solid ${ALERT_COLOR[c.level]}33`,
                    borderRadius: 10, padding: '10px 14px',
                  }}>
                    <div style={{ color: C.muted, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                      {c.label}
                    </div>
                    <div style={{
                      color: ALERT_COLOR[c.level],
                      fontSize: isCap ? 22 : 16, fontWeight: 800, lineHeight: 1.1,
                    }}>{c.value}</div>
                    {c.sub && (
                      <div style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>{c.sub}</div>
                    )}
                    {isCap && inst.daily_limit && (
                      <div style={{ marginTop: 8 }}>
                        <GradientBar pct={dailyUsedPct} gradient={QUALITY_GRAD[eq]} height={4} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {warnings.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {warnings.map((w, i) => (
                  <span key={i} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    color: ALERT_COLOR[w.level], fontSize: 11, fontWeight: 600,
                    background: `${ALERT_COLOR[w.level]}10`,
                    border: `1px solid ${ALERT_COLOR[w.level]}33`,
                    borderRadius: 6, padding: '4px 10px',
                  }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: ALERT_COLOR[w.level] }} />
                    {w.text}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
