import { useEffect, useState } from 'react';
import { CampaignHistoryList } from '../components/disparo/CampaignHistoryList';
import { CsvUploadWizard } from '../components/disparo/CsvUploadWizard';
import { useBroadcastWebSocket } from '../hooks/useBroadcastWebSocket';
import { broadcastApi } from '../lib/api';
import {
  C, G, glassCard, sectionTitle, btnStyle, INPUT_STYLE, SHARED_CSS,
  Section, PulseDot, NumberQualityGrid, AIMonitorPanel, CollapsedChip,
} from '../components/disparo-shared';

const WS_URL = (import.meta.env.VITE_WS_URL as string) ?? 'ws://localhost:8002/ws';

// ── Credenciais VendeAI ─────────────────────────────────────────────────────

function CredentialsPanel({ onSaved }: { onSaved: () => void }) {
  const [configured, setConfigured] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [crmTokenConfigured, setCrmTokenConfigured] = useState(false);
  const [email, setEmail] = useState('');
  const [savedEmail, setSavedEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accountIdInput, setAccountIdInput] = useState('');
  const [crmToken, setCrmToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    broadcastApi.getCredentialsStatus().then((r: any) => {
      const d = r.data ?? r;
      setConfigured(d.configured);
      if (d.account_id) { setAccountId(d.account_id); setAccountIdInput(d.account_id); }
      if (d.email) { setEmail(d.email); setSavedEmail(d.email); }
      setCrmTokenConfigured(!!d.crm_token_configured);
      setExpanded(!d.configured);
      setLoaded(true);
    }).catch(() => { setExpanded(true); setLoaded(true); });
  }, []);

  const save = async () => {
    if (!email.trim() && !password.trim() && !accountIdInput.trim() && !crmToken.trim()) {
      setMsg('Preencha pelo menos um campo'); return;
    }
    if (!configured && (!email.trim() || !password.trim())) {
      setMsg('Primeira gravação exige email + senha'); return;
    }
    setSaving(true);
    try {
      await broadcastApi.saveCredentials({
        email: email.trim() || undefined,
        password: password.trim() || undefined,
        account_id: accountIdInput.trim() || undefined,
        crm_token: crmToken.trim() || undefined,
      });
      setConfigured(true);
      if (email.trim()) setSavedEmail(email.trim());
      if (accountIdInput.trim()) setAccountId(accountIdInput.trim());
      if (crmToken.trim()) setCrmTokenConfigured(true);
      setPassword(''); setCrmToken('');
      setMsg('Salvo!'); onSaved();
      setTimeout(() => { setExpanded(false); setMsg(''); }, 800);
    } catch (e: any) { setMsg('Erro: ' + (e?.response?.data?.detail || e?.message)); }
    finally { setSaving(false); }
  };

  if (!loaded) return null;

  if (!expanded) {
    const detail = [
      savedEmail || 'sem email',
      accountId ? `Account ${accountId}` : null,
      crmTokenConfigured ? 'CRM token OK' : null,
    ].filter(Boolean).join(' · ');
    return (
      <CollapsedChip
        icon="🔐" gradient={G.neon}
        title="Credenciais VendeAI OK"
        detail={detail}
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
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, boxShadow: '0 4px 16px rgba(0,0,0,.3)',
          }}>🔐</div>
          <div>
            <h2 style={{ ...sectionTitle(G.neon), marginBottom: 0 }}>Credenciais VendeAI / Chatwoot</h2>
            {configured && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <PulseDot color="#10b981" />
                <span style={{ color: '#10b981', fontSize: 13 }}>Editando configuração existente</span>
              </div>
            )}
          </div>
        </div>
        {configured && (
          <button onClick={() => { setExpanded(false); setMsg(''); setPassword(''); setCrmToken(''); }}
            style={{
              background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)',
              color: C.sec, borderRadius: 8, padding: '6px 14px',
              cursor: 'pointer', fontSize: 12, fontWeight: 600,
            }}>
            ✕ Ocultar
          </button>
        )}
      </div>

      <p style={{ color: C.sec, fontSize: 14, marginBottom: 16, lineHeight: 1.6 }}>
        {configured ? (
          <>
            <strong style={{ color: '#10b981' }}>✓ Suas credenciais já estão salvas neste navegador (e sincronizadas na sua conta).</strong>{' '}
            <span style={{ color: C.muted, fontSize: 13 }}>
              Você não precisa preencher de novo. Só edite os campos abaixo se quiser <strong style={{ color: C.sec }}>trocar</strong> algum valor — campos em branco mantêm o atual.
            </span>
          </>
        ) : (
          <>
            Login VendeAI (CRM) + Account ID + CRM Token Chatwoot. Necessário pra mapear inboxes → números WhatsApp.
            <span style={{ color: C.muted, fontSize: 12, display: 'block', marginTop: 4 }}>
              Senhas e tokens nunca são exibidos depois de salvos por segurança.
            </span>
          </>
        )}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={{ color: C.sec, fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            E-mail VendeAI
          </label>
          <input className="ds-input" style={INPUT_STYLE} type="email" placeholder="usuario@email.com"
            value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div>
          <label style={{ color: C.sec, fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Senha VendeAI
          </label>
          <input className="ds-input" style={INPUT_STYLE} type="password"
            placeholder={configured ? '••••••••  (salva — em branco = manter)' : '••••••••'}
            value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        <div>
          <label style={{ color: C.sec, fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Account ID Chatwoot
          </label>
          <input className="ds-input" style={INPUT_STYLE} placeholder="6927"
            value={accountIdInput} onChange={e => setAccountIdInput(e.target.value)} />
        </div>
        <div>
          <label style={{ color: C.sec, fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            CRM Token (Chatwoot)
          </label>
          <input className="ds-input" style={INPUT_STYLE} type="password"
            placeholder={crmTokenConfigured ? '••••••••  (salvo — em branco = manter)' : 'tfccqbSp...'}
            value={crmToken} onChange={e => setCrmToken(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
          <button className="ds-btn" style={btnStyle(G.neon, saving)} onClick={save} disabled={saving}>
            {saving ? '⟳ Salvando...' : '💾 Salvar e Ocultar'}
          </button>
          {msg && <span style={{ color: msg.startsWith('Erro') ? C.red : '#10b981', fontSize: 12 }}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}

// ── Meta Panel ──────────────────────────────────────────────────────────────

function MetaPanel({ onSaved }: { onSaved: () => void }) {
  const [metaOk, setMetaOk] = useState(false);
  const [savedWabaIds, setSavedWabaIds] = useState<string[]>([]);
  const [tok, setTok] = useState('');
  const [wabaText, setWabaText] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    broadcastApi.getCredentialsStatus().then((r: any) => {
      const d = r.data ?? r;
      setMetaOk(d.meta_configured || false);
      if (d.waba_ids?.length) setSavedWabaIds(d.waba_ids);
      setExpanded(!d.meta_configured);
      setLoaded(true);
    }).catch(() => { setExpanded(true); setLoaded(true); });
  }, []);

  const save = async () => {
    if (!tok.trim() && !wabaText.trim()) { setMsg('Informe o token ou WABA IDs'); return; }
    if (!metaOk && !tok.trim()) { setMsg('Primeira gravação exige o token'); return; }
    setSaving(true);
    try {
      if (tok.trim()) await broadcastApi.saveCredentials({ meta_token: tok.trim() });
      const waba_ids = wabaText.split('\n').map((s: string) => s.trim()).filter(Boolean);
      if (waba_ids.length) await broadcastApi.saveWabaIds(waba_ids);
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
      <CollapsedChip
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
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, boxShadow: '0 4px 16px rgba(0,0,0,.3)',
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
            }}>
            ✕ Ocultar
          </button>
        )}
      </div>

      <p style={{ color: C.sec, fontSize: 14, marginBottom: 16, lineHeight: 1.6 }}>
        Token permanente do System User BM.{' '}
        <span style={{ color: C.text, fontWeight: 600 }}>WABA IDs são opcionais</span> — o token auto-descobre todos os WABAs da BM ao Refresh.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={{ color: C.sec, fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            System User Token
          </label>
          <input className="ds-input" style={INPUT_STYLE} type="password"
            placeholder={metaOk ? '••••••••  (salvo — em branco = manter)' : 'EAAOKxO1...'}
            value={tok} onChange={e => setTok(e.target.value)} />
        </div>
        <div>
          <label style={{ color: C.sec, fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            WABA IDs
            <span style={{ color: '#7c3aed', marginLeft: 8, fontWeight: 400, textTransform: 'none', fontSize: 11 }}>opcional — deixe vazio para auto-descoberta</span>
          </label>
          <textarea className="ds-input" style={{ ...INPUT_STYLE, height: 72, resize: 'vertical', fontFamily: 'monospace' }}
            placeholder={'Opcional — token auto-descobre\n123456789\n987654321'}
            value={wabaText} onChange={e => setWabaText(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
          <button className="ds-btn" style={btnStyle(G.cyan, saving)} onClick={save} disabled={saving}>
            {saving ? '⟳ Salvando...' : '💾 Salvar e Ocultar'}
          </button>
          {msg && <span style={{ color: msg.startsWith('Erro') ? C.red : '#10b981', fontSize: 12 }}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}

// ── Analytics Panel ─────────────────────────────────────────────────────────

function AnalyticsStrip({ data }: { data: any[] }) {
  // VendeAI analytics is array; aggregate totals
  const totalSent = data.reduce((s, d) => s + (d.sent || 0), 0);
  const totalErrors = data.reduce((s, d) => s + (d.errors || 0), 0);
  const totalCampaigns = data.length;

  const stats = [
    { label: 'Total Enviadas', value: totalSent, icon: '📤', grad: G.green, glow: 'rgba(16,185,129,.2)' },
    { label: 'Total Erros', value: totalErrors, icon: '⚠️', grad: G.red, glow: 'rgba(239,68,68,.2)' },
    { label: 'Campanhas', value: totalCampaigns, icon: '📣', grad: G.primary, glow: 'rgba(124,58,237,.2)' },
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

// ── Main page ─────────────────────────────────────────────────────────────

export default function Disparo() {
  const { snapshot } = useBroadcastWebSocket(WS_URL);
  const [numbers, setNumbers] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState('');
  const [loadErr, setLoadErr] = useState('');

  const loadData = async () => {
    let numbersOk = false;
    try {
      const numsResp = await broadcastApi.listNumbers();
      setNumbers((numsResp as any).data || []);
      numbersOk = true;
    } catch (e: any) {
      console.error('[Disparo] listNumbers falhou:', e);
      const detail = e?.response?.data?.detail || e?.message || String(e);
      setLoadErr('Não foi possível carregar números: ' + detail);
    }
    try {
      const analyticsResp = await broadcastApi.getAnalytics();
      setAnalytics(analyticsResp.data || []);
      if (numbersOk) setLoadErr('');
    } catch (e: any) {
      /* analytics não bloqueia render */
      console.error('[Disparo] getAnalytics falhou:', e);
      const detail = e?.response?.data?.detail || e?.message || String(e);
      setLoadErr('Aviso: analytics indisponível — ' + detail);
    }
  };

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (!snapshot) return;
    if (snapshot.numbers.length) setNumbers(snapshot.numbers);
  }, [snapshot]);

  const handleRefreshNumbers = async () => {
    setRefreshing(true); setRefreshMsg('');
    try {
      const res = await broadcastApi.refreshNumbers();
      const d: any = (res as any).data || res;
      const parts: string[] = [];
      parts.push(`✅ ${d.total ?? 0} números`);
      if (d.meta_total) parts.push(`${d.meta_total} da BM Meta`);
      if (d.chatwoot_matched != null) parts.push(`${d.chatwoot_matched} cruzados c/ VendeAI`);
      if (d.meta_error) parts.push(`⚠ Meta: ${String(d.meta_error).slice(0, 80)}`);
      if (d.chatwoot_error) parts.push(`⚠ VendeAI: ${String(d.chatwoot_error).slice(0, 80)}`);
      setRefreshMsg(parts.join(' · '));
      await loadData();
    } catch (e: any) {
      setRefreshMsg('Erro: ' + (e?.response?.data?.detail || e?.message));
    } finally {
      setRefreshing(false);
    }
  };

  const handleTogglePause = async (phoneId: string, paused: boolean) => {
    try {
      if (paused) await broadcastApi.resumeNumber(phoneId);
      // VendeAI não tem pauseNumber explícito — só resume
      await loadData();
    } catch (e: any) {
      console.error('[Disparo] togglePause falhou:', e);
      const detail = e?.response?.data?.detail || e?.message || String(e);
      setLoadErr('Não foi possível atualizar status do número: ' + detail);
    }
  };

  return (
    <div style={{ padding: '32px 40px 64px', display: 'flex', flexDirection: 'column', gap: 24, width: '100%', background: C.bg, minHeight: '100vh' }}>
      <style>{SHARED_CSS}</style>

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
              }}>Disparo VendeAI</h1>
              <div style={{ color: C.sec, fontSize: 14, marginTop: 4 }}>WhatsApp Business API via Chatwoot · disparo em massa</div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {refreshMsg && (
            <span style={{
              color: refreshMsg.startsWith('Erro') ? C.red : '#10b981', fontSize: 12,
              padding: '6px 12px', background: refreshMsg.startsWith('Erro') ? 'rgba(239,68,68,.08)' : 'rgba(16,185,129,.08)',
              border: `1px solid ${refreshMsg.startsWith('Erro') ? 'rgba(239,68,68,.2)' : 'rgba(16,185,129,.2)'}`,
              borderRadius: 8, maxWidth: 480,
            }}>{refreshMsg}</span>
          )}
          <button className="ds-btn" onClick={handleRefreshNumbers} disabled={refreshing}
            title="Bate no token Meta + VendeAI, puxa qualidade, restrições, pagamento, nome de exibição de cada número."
            style={{
              background: refreshing ? 'rgba(255,255,255,.04)' : G.primary,
              border: refreshing ? '1px solid rgba(255,255,255,.1)' : 'none',
              color: refreshing ? C.muted : '#fff', borderRadius: 12, padding: '14px 24px',
              cursor: refreshing ? 'not-allowed' : 'pointer', fontSize: 15, fontWeight: 700,
              boxShadow: refreshing ? 'none' : '0 4px 16px rgba(124,58,237,.4)',
            }}>
            {refreshing ? '⟳ Sincronizando todos os status...' : '⟳ Atualizar Status (Refresh)'}
          </button>
        </div>
      </div>

      {loadErr && (
        <div style={{
          border: '1px solid rgba(239,68,68,.4)', background: 'rgba(239,68,68,.08)',
          padding: 12, borderRadius: 8, color: C.red, fontSize: 13,
        }}>{loadErr}</div>
      )}

      {/* Credentials 2-col */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <CredentialsPanel onSaved={loadData} />
        <MetaPanel onSaved={loadData} />
      </div>

      {/* Analytics strip */}
      {analytics.length > 0 && <AnalyticsStrip data={analytics} />}

      {/* IA Monitor */}
      <Section title="Inteligência Artificial · Monitora Disparo e Qualidade" gradient={G.neon} icon="🧠">
        <AIMonitorPanel
          instances={numbers}
          getSnapshot={async () => {
            const r: any = await broadcastApi.getSnapshot();
            return r.data || r;
          }}
          onRefresh={handleRefreshNumbers}
          refreshing={refreshing}
        />
      </Section>

      {/* Novo disparo */}
      <Section title="Novo Disparo" gradient={G.primary} icon="🚀">
        <CsvUploadWizard onDispatched={loadData} />
      </Section>

      {/* Qualidade dos números */}
      <Section title="Qualidade dos Números da sua BM" gradient={G.cyan} icon="📱">
        <NumberQualityGrid
          instances={numbers}
          onTogglePause={handleTogglePause}
          crmLabel="CRM VENDEAI"
          metaOnlyLabel="SÓ META"
          emptyHint='Nenhum número. Salve o token Meta e clique em "Atualizar Status".'
        />
      </Section>

      {/* Histórico — sempre por último */}
      <Section title="Histórico de Disparos" gradient={G.purple} icon="📋">
        <CampaignHistoryList onRefresh={loadData} />
      </Section>
    </div>
  );
}
