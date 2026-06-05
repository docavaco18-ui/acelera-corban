import { useEffect, useRef, useState } from 'react';
import { aesirApi } from '../lib/api';
import { CollapsedChip as SharedChip } from '../components/disparo-shared/CollapsedChip';
import { BMSummary } from '../components/disparo-shared/BMSummary';
import { AIMonitorPanel as SharedAIMonitor } from '../components/disparo-shared/AICore';
import { CampaignHistoryList } from '../components/disparo/CampaignHistoryList';

// ── Global CSS (animations + focus rings) ─────────────────────────────────────
const CSS = `
  @keyframes pulse-dot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.85)}}
  @keyframes fade-up{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
  @keyframes progress-fill{from{width:0}to{width:var(--pct)}}
  @keyframes ai-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
  @keyframes ai-spin-rev{from{transform:rotate(0deg)}to{transform:rotate(-360deg)}}
  @keyframes ai-orb-pulse{0%,100%{transform:translate(-50%,-50%) scale(1);box-shadow:0 0 60px rgba(124,58,237,.6),inset 0 0 30px rgba(6,182,212,.4)}50%{transform:translate(-50%,-50%) scale(1.08);box-shadow:0 0 90px rgba(6,182,212,.8),inset 0 0 40px rgba(124,58,237,.5)}}
  @keyframes ai-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
  @keyframes ai-twinkle{0%,100%{opacity:1}50%{opacity:.35}}
  @keyframes ai-synapse{0%,100%{stroke-dashoffset:0;opacity:.6}50%{stroke-dashoffset:-20;opacity:1}}
  @keyframes ai-text-pulse{0%,100%{opacity:.7}50%{opacity:1}}
  @keyframes ai-scan{0%{transform:translateY(-100%);opacity:0}50%{opacity:1}100%{transform:translateY(100%);opacity:0}}
  .aesir-input:focus{border-color:rgba(124,58,237,.65)!important;box-shadow:0 0 0 3px rgba(124,58,237,.12)!important;outline:none!important}
  .aesir-btn:hover:not(:disabled){opacity:.88;transform:translateY(-1px);transition:all .15s}
  .aesir-btn:active:not(:disabled){transform:none}
  .aesir-row:hover{background:rgba(255,255,255,.04)!important;transition:background .15s}
  .aesir-chip:hover{opacity:.75;cursor:pointer}
  .aesir-select:focus{border-color:rgba(124,58,237,.65)!important;box-shadow:0 0 0 3px rgba(124,58,237,.12)!important;outline:none!important}
  .ai-core{cursor:pointer;transition:transform .3s}
  .ai-core:hover{transform:scale(1.04)}
  .ai-core:active{transform:scale(.97)}
`;

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg: '#060612',
  surface: 'rgba(15,15,35,.9)',
  surfaceDeep: 'rgba(8,8,20,.95)',
  border: 'rgba(255,255,255,.07)',
  text: '#f1f5f9',
  sec: '#94a3b8',
  muted: '#475569',
  green: '#10b981',
  yellow: '#f59e0b',
  red: '#ef4444',
} as const;

const G = {
  primary: 'linear-gradient(135deg,#7c3aed 0%,#06b6d4 100%)',
  green: 'linear-gradient(135deg,#10b981 0%,#06b6d4 100%)',
  purple: 'linear-gradient(135deg,#6d28d9 0%,#7c3aed 100%)',
  pink: 'linear-gradient(135deg,#ec4899 0%,#7c3aed 100%)',
  red: 'linear-gradient(135deg,#ef4444 0%,#ec4899 100%)',
  yellow: 'linear-gradient(135deg,#f59e0b 0%,#ef8c3b 100%)',
  cyan: 'linear-gradient(135deg,#06b6d4 0%,#0891b2 100%)',
  neon: 'linear-gradient(135deg,#00ff88 0%,#06b6d4 100%)',
} as const;

// Glassmorphism card with gradient border
const glassCard = (grad: string = G.primary, pad = 24) => ({
  background: `linear-gradient(rgba(15,15,35,.92),rgba(15,15,35,.92)) padding-box, ${grad} border-box`,
  border: '1px solid transparent',
  borderRadius: 16,
  padding: pad,
  boxShadow: '0 8px 40px rgba(0,0,0,.55)',
  backdropFilter: 'blur(12px)',
  position: 'relative' as const,
  overflow: 'hidden' as const,
  animation: 'fade-up .35s ease-out',
});

// Section title with gradient text
const sectionTitle = (grad: string = G.primary) => ({
  fontSize: 16,
  fontWeight: 800,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.12em',
  background: grad,
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
  margin: 0,
  marginBottom: 20,
});

const INPUT_STYLE = {
  width: '100%',
  background: 'rgba(255,255,255,.04)',
  border: '1px solid rgba(255,255,255,.1)',
  color: C.text,
  borderRadius: 10,
  padding: '12px 16px',
  fontSize: 15,
  boxSizing: 'border-box' as const,
};

const btnStyle = (grad: string, disabled = false) => ({
  background: disabled ? 'rgba(255,255,255,.04)' : grad,
  color: disabled ? C.muted : '#fff',
  border: disabled ? '1px solid rgba(255,255,255,.06)' : 'none',
  borderRadius: 10,
  padding: '12px 24px',
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontSize: 15,
  fontWeight: 600,
  boxShadow: disabled ? 'none' : '0 4px 14px rgba(0,0,0,.35)',
});

const QUALITY_GRAD: Record<string, string> = {
  GREEN: G.green as string, YELLOW: G.yellow as string, RED: G.red as string, UNKNOWN: 'linear-gradient(90deg,#334155,#475569)',
};
const QUALITY_COLOR: Record<string, string> = { GREEN: '#10b981', YELLOW: '#f59e0b', RED: '#ef4444', UNKNOWN: '#475569' };

// ── Sub-components ────────────────────────────────────────────────────────────

function PulseDot({ color = '#10b981' }: { color?: string }) {
  return (
    <span style={{
      width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block',
      animation: 'pulse-dot 2s ease-in-out infinite',
      boxShadow: `0 0 6px ${color}99`,
    }} />
  );
}

function QualityBadge({ rating }: { rating?: string }) {
  const r = rating || 'UNKNOWN';
  return (
    <span style={{
      background: `${QUALITY_COLOR[r]}18`, color: QUALITY_COLOR[r],
      border: `1px solid ${QUALITY_COLOR[r]}44`, borderRadius: 6,
      padding: '2px 8px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
    }}>{r}</span>
  );
}

function GradientBar({ pct, gradient = G.primary as string, height = 6 }: { pct: number; gradient?: string; height?: number }) {
  return (
    <div style={{ background: 'rgba(255,255,255,.06)', borderRadius: height, height, overflow: 'hidden' }}>
      <div style={{
        background: gradient, height, borderRadius: height,
        width: `${Math.min(100, Math.max(0, pct))}%`, transition: 'width .6s ease-out',
      }} />
    </div>
  );
}

function CredentialsPanel({ onSaved }: { onSaved: () => void }) {
  const [configured, setConfigured] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [acc, setAcc] = useState(''); const [tok, setTok] = useState('');
  const [saving, setSaving] = useState(false); const [msg, setMsg] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    aesirApi.getCredentials().then(d => {
      setConfigured(d.configured);
      if (d.account_id) { setAccountId(d.account_id); setAcc(d.account_id); }
      setExpanded(!d.configured);
      setLoaded(true);
    }).catch(() => { setExpanded(true); setLoaded(true); });
  }, []);

  const save = async () => {
    if (!configured && (!tok.trim() || !acc.trim())) { setMsg('Primeira gravação exige token + account_id'); return; }
    if (!tok.trim() && !acc.trim()) { setMsg('Preencha pelo menos um campo'); return; }
    setSaving(true);
    try {
      await aesirApi.saveCredentials(tok.trim() || '', acc.trim());
      setConfigured(true); setAccountId(acc.trim()); setTok(''); setMsg('Salvo!'); onSaved();
      setTimeout(() => { setExpanded(false); setMsg(''); }, 800);
    } catch (e: any) { setMsg('Erro: ' + (e?.response?.data?.detail || e?.message)); }
    finally { setSaving(false); }
  };

  if (!loaded) return null;

  if (!expanded) {
    return (
      <SharedChip
        icon="🔐" gradient={G.neon}
        title="Credenciais Aesir OK"
        detail={accountId ? `Account ${accountId}` : 'configurado'}
        onEdit={() => setExpanded(true)}
      />
    );
  }

  return (
    <div style={glassCard(G.neon)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, background: G.neon,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
            boxShadow: '0 4px 16px rgba(0,0,0,.3)',
          }}>🔐</div>
          <div>
            <h2 style={{ ...sectionTitle(G.neon), marginBottom: 0 }}>Credenciais Aesir ERP</h2>
            {configured && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <PulseDot color="#10b981" />
                <span style={{ color: '#10b981', fontSize: 13 }}>Editando configuração existente</span>
              </div>
            )}
          </div>
        </div>
        {configured && (
          <button onClick={() => { setExpanded(false); setMsg(''); setTok(''); }}
            style={{
              background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)',
              color: C.sec, borderRadius: 8, padding: '6px 14px',
              cursor: 'pointer', fontSize: 12, fontWeight: 600,
            }}>✕ Ocultar</button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={{ color: C.sec, fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Account ID</label>
          <input className="aesir-input" style={INPUT_STYLE} placeholder="532" value={acc} onChange={e => setAcc(e.target.value)} />
        </div>
        <div>
          <label style={{ color: C.sec, fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>API Token Aesir</label>
          <input className="aesir-input" style={INPUT_STYLE} type="password" placeholder="aesir_v1_..." value={tok} onChange={e => setTok(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
          <button className="aesir-btn" style={btnStyle(G.neon, saving)} onClick={save} disabled={saving}>
            {saving ? '⟳ Salvando...' : '💾 Salvar e Ocultar'}
          </button>
          {msg && <span style={{ color: msg.startsWith('Erro') ? C.red : '#10b981', fontSize: 12 }}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}

function MetaPanel({ onSaved }: { onSaved: () => void }) {
  const [metaOk, setMetaOk] = useState(false);
  const [savedWabaIds, setSavedWabaIds] = useState<string[]>([]);
  const [tok, setTok] = useState('');
  const [wabaText, setWabaText] = useState('');
  const [saving, setSaving] = useState(false); const [msg, setMsg] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    aesirApi.getCredentials().then(d => {
      if (d.configured) {
        setMetaOk(d.meta_configured || false);
        if (d.waba_ids?.length) setSavedWabaIds(d.waba_ids);
      }
      setExpanded(!(d.meta_configured));
      setLoaded(true);
    }).catch(() => { setExpanded(true); setLoaded(true); });
  }, []);

  const save = async () => {
    if (!tok.trim() && !wabaText.trim()) { setMsg('Informe o token ou WABA IDs'); return; }
    if (!metaOk && !tok.trim()) { setMsg('Primeira gravação exige o token'); return; }
    const waba_ids = wabaText.split('\n').map(s => s.trim()).filter(Boolean);
    setSaving(true);
    try {
      await aesirApi.saveMetaCredentials(tok.trim(), waba_ids);
      setMetaOk(true);
      if (waba_ids.length) setSavedWabaIds(waba_ids);
      setTok(''); setWabaText('');
      setMsg('Salvo!');
      onSaved();
      setTimeout(() => { setExpanded(false); setMsg(''); }, 800);
    } catch (e: any) { setMsg('Erro: ' + (e?.response?.data?.detail || e?.message)); }
    finally { setSaving(false); }
  };

  if (!loaded) return null;

  if (!expanded) {
    const detail = savedWabaIds.length ? `${savedWabaIds.length} WABA(s)` : 'auto-descoberta ativa';
    return (
      <SharedChip
        icon="📡" gradient={G.cyan} dotColor="#06b6d4"
        title="Meta BM OK"
        detail={detail}
        onEdit={() => setExpanded(true)}
      />
    );
  }

  return (
    <div style={glassCard(G.cyan)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, background: G.cyan,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
            boxShadow: '0 4px 16px rgba(0,0,0,.3)',
          }}>📡</div>
          <div>
            <h2 style={{ ...sectionTitle(G.cyan), marginBottom: 0 }}>Meta Business Manager</h2>
            {metaOk && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <PulseDot color="#06b6d4" />
                <span style={{ color: '#06b6d4', fontSize: 13 }}>Editando configuração existente</span>
              </div>
            )}
          </div>
        </div>
        {metaOk && (
          <button onClick={() => { setExpanded(false); setMsg(''); setTok(''); setWabaText(''); }}
            style={{
              background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)',
              color: C.sec, borderRadius: 8, padding: '6px 14px',
              cursor: 'pointer', fontSize: 12, fontWeight: 600,
            }}>✕ Ocultar</button>
        )}
      </div>

      <p style={{ color: C.sec, fontSize: 14, marginBottom: 16, lineHeight: 1.6 }}>
        Token permanente do System User BM.{' '}
        <span style={{ color: C.text, fontWeight: 600 }}>WABA IDs são opcionais</span> — o token auto-descobre todos os WABAs da BM ao Refresh Números.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={{ color: C.sec, fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>System User Token</label>
          <input className="aesir-input" style={INPUT_STYLE} type="password" placeholder="EAAOKxO1..." value={tok} onChange={e => setTok(e.target.value)} />
        </div>
        <div>
          <label style={{ color: C.sec, fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            WABA IDs
            <span style={{ color: '#7c3aed', marginLeft: 8, fontWeight: 400, textTransform: 'none', fontSize: 11 }}>opcional — deixe vazio para auto-descoberta</span>
          </label>
          <textarea className="aesir-input" style={{ ...INPUT_STYLE, height: 72, resize: 'vertical', fontFamily: 'monospace' }}
            placeholder={'Opcional — token auto-descobre WABAs da BM\n123456789\n987654321'}
            value={wabaText} onChange={e => setWabaText(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
          <button className="aesir-btn" style={btnStyle(G.cyan, saving)} onClick={save} disabled={saving}>
            {saving ? '⟳ Salvando...' : '💾 Salvar e Ocultar'}
          </button>
          {msg && <span style={{ color: msg.startsWith('Erro') ? C.red : '#10b981', fontSize: 12 }}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}

interface Restriction { code: number; label: string; entity?: string; }

/** Computes the **effective** quality state. A number is only GREEN if
 *  there are zero restrictions, payment is fine, can_send=AVAILABLE,
 *  display name is approved AND quality_rating=GREEN.
 *  Anything that limits/blocks sending → YELLOW or RED. */
function effectiveQuality(inst: any): 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN' {
  const r = (inst.quality_rating || 'UNKNOWN').toUpperCase();
  const cs = (inst.can_send || 'UNKNOWN').toUpperCase();
  const restrictions: Restriction[] = inst.restrictions || [];

  if (inst.has_payment_issue) return 'RED';
  if (cs === 'BLOCKED') return 'RED';
  if (r === 'RED') return 'RED';
  if (restrictions.length > 0) return 'YELLOW';
  if (cs === 'LIMITED') return 'YELLOW';
  if (inst.display_name_pending) return 'YELLOW';
  if (r === 'YELLOW') return 'YELLOW';
  if (r === 'GREEN' && cs === 'AVAILABLE') return 'GREEN';
  if (r === 'GREEN') return 'GREEN';
  return 'UNKNOWN';
}

type AlertLevel = 'red' | 'yellow' | 'green' | 'gray';

const ALERT_COLOR: Record<AlertLevel, string> = {
  red: '#ef4444', yellow: '#f59e0b', green: '#10b981', gray: '#64748b',
};

interface StatusCard { label: string; value: string; level: AlertLevel; sub?: string; }

/** Returns 4 main status cards (capacidade, qualidade, pagamento, nome). */
function statusCards(inst: any): StatusCard[] {
  const r = (inst.quality_rating || 'UNKNOWN').toUpperCase();
  const cs = (inst.can_send || 'UNKNOWN').toUpperCase();
  const ns = (inst.name_status || '').toUpperCase();

  // Capacidade
  const tier = inst.messaging_tier || inst.daily_limit || '—';
  const tierNum = typeof tier === 'string' ? tier.replace(/\D/g, '') : tier;
  const sentToday = inst.sent_today || 0;
  let capLevel: AlertLevel = 'green';
  if (cs === 'BLOCKED') capLevel = 'red';
  else if (cs === 'LIMITED') capLevel = 'yellow';

  // Qualidade
  let qText = 'Indisponível', qLevel: AlertLevel = 'gray';
  if (r === 'GREEN') { qText = 'Saudável'; qLevel = 'green'; }
  else if (r === 'YELLOW') { qText = 'Atenção'; qLevel = 'yellow'; }
  else if (r === 'RED') { qText = 'Crítica'; qLevel = 'red'; }

  // Pagamento
  let pText = 'OK', pLevel: AlertLevel = 'green', pSub = 'sem pendências';
  if (inst.has_payment_issue) { pText = 'Pendente'; pLevel = 'red'; pSub = 'conta bloqueada'; }
  else if (cs === 'BLOCKED') { pText = 'Verificar'; pLevel = 'yellow'; pSub = 'pode ser cobrança'; }

  // Nome de exibição
  let nText = '—', nLevel: AlertLevel = 'gray', nSub = '';
  if (ns === 'APPROVED') { nText = 'Aprovado'; nLevel = 'green'; }
  else if (ns === 'AVAILABLE_WITHOUT_REVIEW') { nText = 'Liberado'; nLevel = 'green'; nSub = 'sem necessidade de revisão'; }
  else if (ns === 'PENDING_REVIEW') { nText = 'Em análise'; nLevel = 'yellow'; nSub = 'Meta avaliando'; }
  else if (ns === 'DECLINED') { nText = 'Reprovado'; nLevel = 'red'; nSub = 'submeta novo nome'; }
  else if (ns === 'EXPIRED') { nText = 'Expirado'; nLevel = 'red'; nSub = 'renove'; }

  return [
    { label: 'Capacidade', value: `${tierNum || '—'}/dia`, level: capLevel, sub: `${sentToday} enviadas hoje` },
    { label: 'Qualidade', value: qText, level: qLevel, sub: r === 'UNKNOWN' ? '' : `nível ${r.toLowerCase()}` },
    { label: 'Pagamento', value: pText, level: pLevel, sub: pSub },
    { label: 'Nome exibição', value: nText, level: nLevel, sub: nSub },
  ];
}

/** Avisos extras (badges abaixo dos cards) — só os que não estão cobertos pelos cards. */
function extraWarnings(inst: any): Array<{ level: AlertLevel; text: string }> {
  const out: Array<{ level: AlertLevel; text: string }> = [];
  const ars = (inst.account_review_status || '').toUpperCase();
  const bvs = (inst.business_verification_status || '').toLowerCase();

  if (ars === 'SUSPENDED' || ars === 'DISABLED') out.push({ level: 'red', text: 'Conta suspensa pela Meta' });
  else if (ars === 'PENDING' || ars === 'IN_REVIEW') out.push({ level: 'yellow', text: 'Conta em revisão Meta' });
  else if (ars === 'APPROVED') out.push({ level: 'green', text: 'Conta Meta aprovada' });

  if (bvs === 'expired') out.push({ level: 'red', text: 'BM expirada · renove' });
  else if (bvs === 'failed' || bvs === 'rejected') out.push({ level: 'red', text: 'BM rejeitada' });
  else if (bvs === 'pending' || bvs === 'pending_need_more_info') out.push({ level: 'yellow', text: 'BM em verificação' });
  else if (bvs === 'verified') out.push({ level: 'green', text: 'BM verificada' });

  const restrictions: Restriction[] = inst.restrictions || [];
  restrictions.forEach((rs) => {
    if (!rs || !rs.code) return;
    if ([130472, 131048, 133015].includes(rs.code)) return;
    out.push({ level: 'yellow', text: rs.label });
  });

  return out;
}

function topLevel(inst: any): AlertLevel {
  const cards = statusCards(inst);
  const warns = extraWarnings(inst);
  const all = [...cards, ...warns];
  if (all.some(c => c.level === 'red')) return 'red';
  if (all.some(c => c.level === 'yellow')) return 'yellow';
  if (all.some(c => c.level === 'green')) return 'green';
  return 'gray';
}

function NumberQualityGrid({ instances, onTogglePause }: { instances: any[]; onTogglePause: (iid: string, paused: boolean) => void }) {
  if (!instances.length) return (
    <div>
      <BMSummary instances={instances} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '32px 0', color: C.muted, fontSize: 13 }}>
        <span style={{ fontSize: 28 }}>📱</span>
        Nenhuma instância. Clique em "Refresh Números".
      </div>
    </div>
  );

  // Sort by EFFECTIVE quality (worst first)
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
        const isMetaOnly = String(inst.instance_id || '').startsWith('meta:') || inst.status === 'meta-only';
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
          <div key={inst.instance_id} style={{
            background: isCritical ? 'rgba(239,68,68,.05)' : isWarn ? 'rgba(245,158,11,.04)' : 'rgba(255,255,255,.025)',
            border: `1px solid ${isCritical ? 'rgba(239,68,68,.28)' : isWarn ? 'rgba(245,158,11,.22)' : 'rgba(255,255,255,.07)'}`,
            borderRadius: 14, padding: '16px 20px',
            display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div title={`Status: ${top}`} style={{
                width: 14, height: 14, borderRadius: '50%',
                background: dotColor, flexShrink: 0,
                boxShadow: `0 0 10px ${dotColor}99, 0 0 2px ${dotColor}`,
                animation: isCritical ? 'pulse-dot 1.5s ease-in-out infinite' : undefined,
              }} />

              <div style={{ flex: 1, minWidth: 0 }}>
                {/* IDs em cima */}
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
                {/* Número + nome */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ color: C.text, fontSize: 17, fontWeight: 800, letterSpacing: '-0.01em' }}>
                    {inst.display_phone || inst.phone || inst.name || inst.instance_id}
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
                {/* BM info */}
                {(inst.waba_name || inst.waba_country) && (
                  <div style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>
                    {inst.waba_name && <>BM <strong style={{ color: C.sec }}>{inst.waba_name}</strong></>}
                    {inst.waba_country && <span style={{ marginLeft: 8 }}>· {inst.waba_country}</span>}
                  </div>
                )}
              </div>

              {/* Right side: CRM badge + Pausar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  color: crmConnected ? '#10b981' : '#64748b',
                  fontSize: 10, fontWeight: 800,
                  background: crmConnected ? 'rgba(16,185,129,.08)' : 'rgba(100,116,139,.08)',
                  border: `1px solid ${crmConnected ? 'rgba(16,185,129,.3)' : 'rgba(100,116,139,.25)'}`,
                  borderRadius: 6, padding: '4px 10px', letterSpacing: '0.06em',
                }}>
                  {crmConnected ? '✓ CRM AESIR' : '⚠ SÓ META'}
                </span>
                <button className="aesir-btn"
                  title={paused ? 'Retomar este número nos próximos disparos' : 'Pausar — número fica fora dos próximos disparos. Disparos em andamento continuam.'}
                  style={btnStyle(paused ? G.green : G.red, false)}
                  onClick={() => onTogglePause(inst.instance_id, paused)}>
                  {paused ? '▶ Retomar' : '⏸ Pausar'}
                </button>
              </div>
            </div>

            {/* Status cards row — Capacidade · Qualidade · Pagamento · Nome */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              {cards.map((c, i) => {
                const isCap = i === 0;
                return (
                  <div key={c.label} style={{
                    background: `${ALERT_COLOR[c.level]}0d`,
                    border: `1px solid ${ALERT_COLOR[c.level]}33`,
                    borderRadius: 10, padding: '10px 14px',
                    position: 'relative',
                  }}>
                    <div style={{ color: C.muted, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                      {c.label}
                    </div>
                    <div style={{
                      color: ALERT_COLOR[c.level],
                      fontSize: isCap ? 22 : 16,
                      fontWeight: 800,
                      lineHeight: 1.1,
                    }}>{c.value}</div>
                    {c.sub && (
                      <div style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>{c.sub}</div>
                    )}
                    {/* Capacity progress bar */}
                    {isCap && inst.daily_limit && (
                      <div style={{ marginTop: 8 }}>
                        <GradientBar pct={dailyUsedPct} gradient={QUALITY_GRAD[eq]} height={4} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Avisos extras — só badges curtos, sem texto inglês */}
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

// ── CsvUploadWizard ────────────────────────────────────────────────────────────

type WizardStep = 'upload' | 'assign' | 'template' | 'confirm';
interface Assignment { instance_id: string; name: string; display_phone: string; quality_rating: string; can_send: string; daily_limit: number; planned_count: number; }

const STEP_META: Record<WizardStep, { label: string; icon: string; n: number }> = {
  upload:   { label: 'Upload',       icon: '📂', n: 1 },
  assign:   { label: 'Distribuição', icon: '⚖️',  n: 2 },
  template: { label: 'Mensagem',     icon: '✍️',  n: 3 },
  confirm:  { label: 'Confirmar',    icon: '🚀', n: 4 },
};

function StepIndicator({ current }: { current: WizardStep }) {
  const steps: WizardStep[] = ['upload', 'assign', 'template', 'confirm'];
  const ci = steps.indexOf(current);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 24 }}>
      {steps.map((s, i) => {
        const m = STEP_META[s];
        const active = s === current;
        const done = i < ci;
        return (
          <div key={s} style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 800,
              background: active ? G.primary : done ? G.green : 'rgba(255,255,255,.05)',
              color: active || done ? '#fff' : C.muted,
              boxShadow: active ? '0 0 14px rgba(124,58,237,.5)' : 'none',
              transition: 'all .3s',
            }}>
              {done ? '✓' : m.n}
            </div>
            <span style={{
              marginLeft: 8, fontSize: 12, fontWeight: active ? 700 : 400,
              color: active ? C.text : done ? C.sec : C.muted,
            }}>{m.label}</span>
            {i < steps.length - 1 && (
              <div style={{ width: 40, height: 1, background: i < ci ? 'rgba(16,185,129,.4)' : 'rgba(255,255,255,.06)', margin: '0 12px' }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function CsvUploadWizard({ onDispatched }: { onDispatched: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<WizardStep>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const [dispatchId, setDispatchId] = useState('');
  const [totalLeads, setTotalLeads] = useState(0);
  const [csvColumns, setCsvColumns] = useState<string[]>([]);
  const [justification, setJustification] = useState('');
  const [risks, setRisks] = useState('');

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [phoneCol, setPhoneCol] = useState('telefone');

  const [msgTpl, setMsgTpl] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [cooldown, setCooldown] = useState(5);
  const [previewRow, setPreviewRow] = useState<Record<string, string>>({});

  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');

  const analyze = async () => {
    if (!file) return;
    setAnalyzing(true); setErr('');
    try {
      const res = await aesirApi.analyzeCSV(file);
      setDispatchId(res.dispatch_id);
      setTotalLeads(res.total_leads);
      setCsvColumns(res.csv_columns);
      setJustification(res.split.justification || '');
      setRisks(res.split.risks || '');
      const asns: Assignment[] = (res.split.assignments || []).map((a: any) => ({
        instance_id: a.instance_id,
        name: a.name || a.instance_id,
        display_phone: a.display_phone || '',
        quality_rating: a.quality_rating || 'UNKNOWN',
        can_send: a.can_send || 'UNKNOWN',
        daily_limit: a.daily_limit || 500,
        planned_count: a.planned_count,
      }));
      if (!asns.length) { setErr(res.split.justification || 'Nenhuma instância elegível'); setAnalyzing(false); return; }
      setAssignments(asns);
      const found = res.csv_columns.find((c: string) => /telefone|phone|celular|numero|whatsapp/i.test(c));
      if (found) setPhoneCol(found);
      const preview: Record<string, string> = {};
      res.csv_columns.forEach((c: string) => { preview[c] = `[${c}]`; });
      setPreviewRow(preview);
      setStep('assign');
    } catch (e: any) { setErr(e?.response?.data?.detail || e?.message || 'Erro ao analisar CSV'); }
    finally { setAnalyzing(false); }
  };

  const updatePlanned = (iid: string, val: number) => {
    setAssignments(prev => prev.map(a => a.instance_id === iid ? { ...a, planned_count: Math.max(0, val) } : a));
  };

  const previewMessage = () => {
    let msg = msgTpl;
    for (const [k, v] of Object.entries(previewRow)) {
      msg = msg.split(`{{${k}}}`).join(v);
    }
    return msg;
  };

  const confirm = async () => {
    if (!msgTpl.trim()) { setErr('Mensagem obrigatória'); return; }
    const validAsns = assignments.filter(a => a.planned_count > 0);
    if (!validAsns.length) { setErr('Nenhum lead atribuído'); return; }
    setSending(true); setErr('');
    try {
      await aesirApi.confirmDispatch({
        dispatch_id: dispatchId,
        assignments: validAsns.map(a => ({ instance_id: a.instance_id, planned_count: a.planned_count })),
        message_tpl: msgTpl,
        phone_column: phoneCol,
        campaign_name: campaignName || file?.name?.replace('.csv', '') || '',
        cooldown_seconds: cooldown,
      });
      onDispatched();
      setStep('upload'); setFile(null); setDispatchId(''); setTotalLeads(0);
      setCsvColumns([]); setAssignments([]); setMsgTpl(''); setCampaignName('');
      if (fileRef.current) fileRef.current.value = '';
    } catch (e: any) { setErr(e?.response?.data?.detail || e?.message || 'Erro ao confirmar'); }
    finally { setSending(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <StepIndicator current={step} />

      {err && (
        <div style={{ color: C.red, fontSize: 13, padding: '12px 16px', background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 10, marginBottom: 16 }}>
          ⚠ {err}
        </div>
      )}

      {/* Step 1 — Upload */}
      {step === 'upload' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ color: C.sec, fontSize: 13, margin: 0, lineHeight: 1.6 }}>
            Faça upload do CSV. O sistema vai calcular a distribuição proporcional entre as instâncias disponíveis.
          </p>

          <div style={{
            border: '2px dashed rgba(124,58,237,.3)', borderRadius: 12, padding: 32,
            textAlign: 'center', cursor: 'pointer', transition: 'border-color .2s',
            background: file ? 'rgba(124,58,237,.06)' : 'rgba(255,255,255,.02)',
          }} onClick={() => fileRef.current?.click()}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
            {file ? (
              <div>
                <div style={{ color: '#10b981', fontSize: 14, fontWeight: 600 }}>{file.name}</div>
                <div style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>{(file.size / 1024).toFixed(1)} KB</div>
              </div>
            ) : (
              <div>
                <div style={{ color: C.sec, fontSize: 13 }}>Clique para selecionar arquivo CSV</div>
                <div style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>Suporte a UTF-8 e UTF-8 BOM</div>
              </div>
            )}
            <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={e => setFile(e.target.files?.[0] ?? null)} />
          </div>

          <div>
            <button className="aesir-btn" style={btnStyle(G.primary, !file || analyzing)} onClick={analyze} disabled={!file || analyzing}>
              {analyzing ? '⟳ Analisando...' : 'Analisar CSV →'}
            </button>
          </div>
        </div>
      )}

      {/* Step 2 — Assign */}
      {step === 'assign' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'rgba(124,58,237,.08)', border: '1px solid rgba(124,58,237,.2)', borderRadius: 10 }}>
            <span style={{ fontSize: 20 }}>📊</span>
            <div>
              <div style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{totalLeads.toLocaleString('pt-BR')} leads · {justification}</div>
              {risks && risks !== 'Nenhum risco identificado.' && (
                <div style={{ color: '#f59e0b', fontSize: 12, marginTop: 2 }}>⚠ {risks}</div>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 8, color: C.muted, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', padding: '0 6px' }}>
            <span>Instância</span><span style={{ textAlign: 'center' }}>Leads</span>
          </div>

          {assignments.map(asn => {
            const pct = asn.daily_limit ? Math.min(100, Math.round((asn.planned_count / asn.daily_limit) * 100)) : 0;
            return (
              <div key={asn.instance_id} className="aesir-row" style={{
                display: 'grid', gridTemplateColumns: '1fr 110px', gap: 12, alignItems: 'center',
                background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 10, padding: '12px 16px',
              }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{asn.name}</span>
                    {asn.display_phone && <span style={{ color: C.muted, fontSize: 11 }}>{asn.display_phone}</span>}
                    <QualityBadge rating={asn.quality_rating} />
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <GradientBar pct={pct} gradient={QUALITY_GRAD[asn.quality_rating || 'UNKNOWN']} height={4} />
                  </div>
                  <div style={{ color: C.muted, fontSize: 10, marginTop: 4 }}>{asn.daily_limit}/dia limite</div>
                </div>
                <input type="number" min={0} max={asn.daily_limit}
                  className="aesir-input"
                  style={{ ...INPUT_STYLE, width: 90, textAlign: 'center', fontWeight: 700, fontSize: 15 }}
                  value={asn.planned_count}
                  onChange={e => updatePlanned(asn.instance_id, Number(e.target.value))}
                />
              </div>
            );
          })}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: 1, maxWidth: 220 }}>
              <label style={{ color: C.sec, fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Coluna do Telefone</label>
              <select className="aesir-select" style={{ ...INPUT_STYLE, appearance: 'none' as const }} value={phoneCol} onChange={e => setPhoneCol(e.target.value)}>
                {csvColumns.map(c => <option key={c} value={c} style={{ background: '#0d0d20' }}>{c}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="aesir-btn" style={btnStyle('rgba(255,255,255,.06)')} onClick={() => setStep('upload')}>← Voltar</button>
              <button className="aesir-btn" style={btnStyle(G.primary)} onClick={() => setStep('template')}>Próximo →</button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3 — Template */}
      {step === 'template' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ color: C.sec, fontSize: 13, margin: 0, lineHeight: 1.6 }}>
            Escreva a mensagem. Use <code style={{ color: '#00ff88', background: 'rgba(0,255,136,.08)', padding: '1px 6px', borderRadius: 4, fontSize: 12 }}>{'{{coluna}}'}</code> para inserir variáveis do CSV.
          </p>

          {csvColumns.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {csvColumns.map(c => (
                <button key={c} className="aesir-chip" style={{
                  background: 'rgba(0,255,136,.06)', border: '1px solid rgba(0,255,136,.2)',
                  color: '#00ff88', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600,
                  cursor: 'pointer',
                }} onClick={() => setMsgTpl(prev => prev + `{{${c}}}`)}>{`{{${c}}}`}</button>
              ))}
            </div>
          )}

          <div>
            <label style={{ color: C.sec, fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>Mensagem</label>
            <textarea className="aesir-input"
              style={{ ...INPUT_STYLE, height: 120, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
              placeholder={'Olá {{nome}}, temos uma proposta para você!\nValor disponível: R$ {{valor}}'}
              value={msgTpl}
              onChange={e => setMsgTpl(e.target.value)}
            />
          </div>

          {msgTpl && (
            <div style={{ background: 'rgba(124,58,237,.06)', border: '1px solid rgba(124,58,237,.2)', borderRadius: 10, padding: 16 }}>
              <div style={{ color: '#7c3aed', fontSize: 10, marginBottom: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>📱 Prévia da Mensagem</div>
              <div style={{ color: C.text, fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{previewMessage()}</div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ color: C.sec, fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>Nome da Campanha</label>
              <input className="aesir-input" style={INPUT_STYLE} placeholder={file?.name?.replace('.csv', '') || 'Campanha Junho'} value={campaignName} onChange={e => setCampaignName(e.target.value)} />
            </div>
            <div>
              <label style={{ color: C.sec, fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>Cooldown entre envios (seg)</label>
              <input className="aesir-input" style={INPUT_STYLE} type="number" min={1} max={60} value={cooldown} onChange={e => setCooldown(Number(e.target.value))} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="aesir-btn" style={btnStyle('rgba(255,255,255,.06)')} onClick={() => setStep('assign')}>← Voltar</button>
            <button className="aesir-btn" style={btnStyle(G.primary, !msgTpl.trim())} disabled={!msgTpl.trim()} onClick={() => setStep('confirm')}>Próximo →</button>
          </div>
        </div>
      )}

      {/* Step 4 — Confirm */}
      {step === 'confirm' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{
            background: 'rgba(16,185,129,.05)', border: '1px solid rgba(16,185,129,.2)',
            borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <div style={{ color: '#10b981', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em' }}>🚀 Resumo do Disparo</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ background: 'rgba(255,255,255,.03)', borderRadius: 8, padding: 12 }}>
                <div style={{ color: C.muted, fontSize: 10, marginBottom: 4 }}>CAMPANHA</div>
                <div style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{campaignName || file?.name}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,.03)', borderRadius: 8, padding: 12 }}>
                <div style={{ color: C.muted, fontSize: 10, marginBottom: 4 }}>TOTAL DE LEADS</div>
                <div style={{ color: C.text, fontSize: 20, fontWeight: 800 }}>{totalLeads.toLocaleString('pt-BR')}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,.03)', borderRadius: 8, padding: 12 }}>
                <div style={{ color: C.muted, fontSize: 10, marginBottom: 4 }}>COLUNA TELEFONE</div>
                <div style={{ color: '#06b6d4', fontSize: 13, fontWeight: 600 }}>{phoneCol}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,.03)', borderRadius: 8, padding: 12 }}>
                <div style={{ color: C.muted, fontSize: 10, marginBottom: 4 }}>COOLDOWN</div>
                <div style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{cooldown}s entre envios</div>
              </div>
            </div>

            <div>
              <div style={{ color: C.muted, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>DISTRIBUIÇÃO</div>
              {assignments.filter(a => a.planned_count > 0).map(a => (
                <div key={a.instance_id} style={{ display: 'flex', justifyContent: 'space-between', color: C.sec, fontSize: 12, padding: '4px 0' }}>
                  <span>{a.name} {a.display_phone && <span style={{ color: C.muted }}>({a.display_phone})</span>}</span>
                  <span style={{ color: C.text, fontWeight: 700 }}>{a.planned_count.toLocaleString('pt-BR')} leads</span>
                </div>
              ))}
            </div>

            <div>
              <div style={{ color: C.muted, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>MENSAGEM</div>
              <div style={{ color: C.sec, fontSize: 12, whiteSpace: 'pre-wrap', fontFamily: 'inherit', lineHeight: 1.6, background: 'rgba(255,255,255,.02)', padding: 10, borderRadius: 8 }}>{msgTpl}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="aesir-btn" style={btnStyle('rgba(255,255,255,.06)')} onClick={() => setStep('template')}>← Voltar</button>
            <button className="aesir-btn" style={btnStyle(G.green, sending)} disabled={sending} onClick={confirm}>
              {sending ? '⟳ Iniciando...' : '🚀 Confirmar e Disparar'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Analytics ─────────────────────────────────────────────────────────────────

function AnalyticsPanel() {
  const [data, setData] = useState<{ total_sent: number; total_errors: number; total_campaigns: number } | null>(null);
  useEffect(() => { aesirApi.getAnalytics().then(setData).catch(() => {}); }, []);
  if (!data) return null;

  const stats = [
    { label: 'Total Enviados', value: data.total_sent, icon: '📤', grad: G.green, glow: 'rgba(16,185,129,.2)' },
    { label: 'Total Erros', value: data.total_errors, icon: '⚠️', grad: G.red, glow: 'rgba(239,68,68,.2)' },
    { label: 'Campanhas', value: data.total_campaigns, icon: '📣', grad: G.primary, glow: 'rgba(124,58,237,.2)' },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
      {stats.map(({ label, value, icon, grad, glow }) => (
        <div key={label} style={{
          background: `linear-gradient(rgba(15,15,35,.95),rgba(15,15,35,.95)) padding-box, ${grad} border-box`,
          border: '1px solid transparent', borderRadius: 16, padding: '28px 32px',
          boxShadow: `0 4px 24px ${glow}`, textAlign: 'center',
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>{icon}</div>
          <div style={{
            fontSize: 48, fontWeight: 800, lineHeight: 1,
            background: grad, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>{value.toLocaleString('pt-BR')}</div>
          <div style={{ color: C.sec, fontSize: 13, marginTop: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
        </div>
      ))}
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, gradient, icon, children }: { title: string; gradient: string; icon: string; children: React.ReactNode }) {
  return (
    <div style={glassCard(gradient, 28)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12, background: gradient,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0,
          boxShadow: '0 4px 16px rgba(0,0,0,.3)',
        }}>{icon}</div>
        <h2 style={{ ...sectionTitle(gradient), marginBottom: 0 }}>{title}</h2>
      </div>
      {children}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DisparoAesir() {
  const [instances, setInstances] = useState<any[]>([]);
  const [refreshingInst, setRefreshingInst] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState('');

  const loadInstances = async () => {
    try { const d = await aesirApi.listInstances(); setInstances(d || []); } catch { }
  };

  const togglePause = async (iid: string, paused: boolean) => {
    try {
      if (paused) await aesirApi.resumeInstance(iid);
      else await aesirApi.pauseInstance(iid);
      loadInstances();
    } catch { }
  };

  const refreshNumbers = async () => {
    setRefreshingInst(true); setRefreshMsg('');
    try {
      const res = await aesirApi.refreshNumbers();
      setInstances(res.instances || []);
      const parts: string[] = [];
      parts.push(`✅ ${res.instances.length} números`);
      if (res.meta_total) parts.push(`${res.meta_total} da BM Meta`);
      if (res.meta_matched) parts.push(`${res.meta_matched} cruzados c/ Aesir`);
      if (res.aesir_error) parts.push(`⚠ Aesir: ${String(res.aesir_error).slice(0, 80)}`);
      if (res.meta_error) parts.push(`⚠ Meta: ${String(res.meta_error).slice(0, 80)}`);
      setRefreshMsg(parts.join(' · '));
    } catch (e: any) { setRefreshMsg('Erro: ' + (e?.response?.data?.detail || e?.message)); }
    finally { setRefreshingInst(false); }
  };

  useEffect(() => { loadInstances(); }, []);

  return (
    <div style={{ padding: '32px 40px 64px', display: 'flex', flexDirection: 'column', gap: 24, width: '100%', background: C.bg, minHeight: '100vh' }}>
      <style>{CSS}</style>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, background: G.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, boxShadow: '0 4px 20px rgba(124,58,237,.5)' }}>
              📨
            </div>
            <div>
              <h1 style={{
                margin: 0, fontSize: 34, fontWeight: 800, lineHeight: 1.1,
                background: G.primary, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
              }}>Disparo Aesir ERP</h1>
              <div style={{ color: C.sec, fontSize: 14, marginTop: 4 }}>WhatsApp Business API — disparo em massa</div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {refreshMsg && (
            <span style={{
              color: refreshMsg.startsWith('Erro') ? C.red : '#10b981', fontSize: 12,
              padding: '6px 12px', background: refreshMsg.startsWith('Erro') ? 'rgba(239,68,68,.08)' : 'rgba(16,185,129,.08)',
              border: `1px solid ${refreshMsg.startsWith('Erro') ? 'rgba(239,68,68,.2)' : 'rgba(16,185,129,.2)'}`,
              borderRadius: 8,
            }}>{refreshMsg}</span>
          )}
          <button className="aesir-btn" onClick={refreshNumbers} disabled={refreshingInst}
            title="Bate no token Meta + Aesir, puxa qualidade, restrições, pagamento, nome de exibição, verificação BM, todos os status de cada número. Use sempre que quiser atualizar."
            style={{
              background: refreshingInst ? 'rgba(255,255,255,.04)' : G.primary,
              border: refreshingInst ? '1px solid rgba(255,255,255,.1)' : 'none',
              color: refreshingInst ? C.muted : '#fff', borderRadius: 12, padding: '14px 24px',
              cursor: refreshingInst ? 'not-allowed' : 'pointer', fontSize: 15, fontWeight: 700,
              boxShadow: refreshingInst ? 'none' : '0 4px 16px rgba(124,58,237,.4)',
            }}>
            {refreshingInst ? '⟳ Sincronizando todos os status...' : '⟳ Atualizar Status (Refresh)'}
          </button>
        </div>
      </div>

      {/* Credentials */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <CredentialsPanel onSaved={loadInstances} />
        <MetaPanel onSaved={() => {}} />
      </div>

      {/* Analytics strip */}
      <AnalyticsPanel />

      {/* AI Monitor — animated brain */}
      <Section title="Inteligência Artificial · Monitora Disparo e Qualidade" gradient={G.neon} icon="🧠">
        <SharedAIMonitor
          instances={instances}
          getSnapshot={async () => {
            const r: any = await aesirApi.getSnapshot();
            return r.data || r;
          }}
          onRefresh={refreshNumbers}
          refreshing={refreshingInst}
        />
      </Section>

      {/* Wizard */}
      <Section title="Novo Disparo" gradient={G.primary} icon="🚀">
        <CsvUploadWizard onDispatched={loadInstances} />
      </Section>

      {/* Quality grid */}
      <Section title="Qualidade dos Números da sua BM" gradient={G.cyan} icon="📱">
        <NumberQualityGrid instances={instances} onTogglePause={togglePause} />
      </Section>

      {/* History — sempre por último */}
      <Section title="Histórico de Disparos" gradient={G.purple} icon="📋">
        <CampaignHistoryList onRefresh={loadInstances} />
      </Section>
    </div>
  );
}
