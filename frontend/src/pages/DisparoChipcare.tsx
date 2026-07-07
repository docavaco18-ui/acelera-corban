import { useEffect, useRef, useState } from 'react';
import { chipcareApi } from '../lib/api';
import {
  C, G, glassCard, sectionTitle, btnStyle, INPUT_STYLE, SHARED_CSS,
  Section, PulseDot, NumberQualityGrid, AIMonitorPanel, CollapsedChip,
} from '../components/disparo-shared';

// ── Shared styles ─────────────────────────────────────────────────────────────

// Local styles ainda usados pelo CsvUploadWizard inline (Chipcare-específico: templates HSM, aggression).
const INPUT = {
  width: '100%', background: '#0d0d1f', border: '1px solid #334155',
  color: '#e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 13,
  boxSizing: 'border-box' as const,
};
const BTN = (bg: string, disabled = false) => ({
  background: disabled ? '#334155' : bg, color: disabled ? '#64748b' : '#fff',
  border: 'none', borderRadius: 8, padding: '8px 16px',
  cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600,
});

const STATUS_COLOR: Record<string, string> = {
  CONNECTED: '#22c55e', Online: '#22c55e', ONLINE: '#22c55e', online: '#22c55e',
  CLOSED: '#ef4444', offline: '#ef4444', OFFLINE: '#ef4444',
};

// ── Credentials ───────────────────────────────────────────────────────────────

function ChipcareCredsPanel({ onSaved }: { onSaved: () => void }) {
  const [configured, setConfigured] = useState(false);
  const [tenantId, setTenantId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenant, setTenant] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    chipcareApi.getCredentials().then(d => {
      setConfigured(d.configured);
      if (d.tenant_id) { setTenantId(d.tenant_id); setTenant(d.tenant_id); }
      setExpanded(!d.configured);
      setLoaded(true);
    }).catch(() => { setExpanded(true); setLoaded(true); });
  }, []);

  const save = async () => {
    if (!configured && (!email.trim() || !password.trim())) { setMsg('Primeira gravação exige email + senha'); return; }
    if (!email.trim() && !password.trim() && !tenant.trim()) { setMsg('Preencha pelo menos um campo'); return; }
    setSaving(true);
    try {
      await chipcareApi.saveCredentials(email.trim(), password.trim(), tenant.trim());
      setConfigured(true); setTenantId(tenant.trim());
      setEmail(''); setPassword('');
      setMsg('Salvo!'); onSaved();
      setTimeout(() => { setExpanded(false); setMsg(''); }, 800);
    } catch (e: any) { setMsg('Erro: ' + (e?.response?.data?.detail || e?.message)); }
    finally { setSaving(false); }
  };

  if (!loaded) return null;

  if (!expanded) {
    const detail = tenantId ? `Tenant ${tenantId}` : 'configurado';
    return (
      <CollapsedChip
        icon="🔐" gradient={G.neon}
        title="Credenciais Chipcare OK"
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
            <h2 style={{ ...sectionTitle(G.neon), marginBottom: 0 }}>Credenciais Chipcare</h2>
            {configured && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <PulseDot color="#10b981" />
                <span style={{ color: '#10b981', fontSize: 13 }}>Editando configuração existente</span>
              </div>
            )}
          </div>
        </div>
        {configured && (
          <button onClick={() => { setExpanded(false); setMsg(''); setEmail(''); setPassword(''); }}
            style={{
              background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)',
              color: C.sec, borderRadius: 8, padding: '6px 14px',
              cursor: 'pointer', fontSize: 12, fontWeight: 600,
            }}>✕ Ocultar</button>
        )}
      </div>

      <p style={{ color: C.sec, fontSize: 14, marginBottom: 16, lineHeight: 1.6 }}>
        Login Chipcare (chipcare.miwteam.com.br). Tenant = nome do ambiente (ex: Sarah ou Arthur).
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={{ color: C.sec, fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>E-mail Chipcare</label>
          <input className="ds-input" style={INPUT_STYLE} type="email" placeholder="usuario@email.com" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div>
          <label style={{ color: C.sec, fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Senha</label>
          <input className="ds-input" style={INPUT_STYLE} type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        <div>
          <label style={{ color: C.sec, fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Tenant (ambiente)</label>
          <input className="ds-input" style={INPUT_STYLE} placeholder="Sarah" value={tenant} onChange={e => setTenant(e.target.value)} />
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
    chipcareApi.getCredentials().then(d => {
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
      const waba_ids = wabaText.split('\n').map(s => s.trim()).filter(Boolean);
      await chipcareApi.saveMetaCredentials(tok.trim(), waba_ids);
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
            }}>✕ Ocultar</button>
        )}
      </div>

      <p style={{ color: C.sec, fontSize: 14, marginBottom: 16, lineHeight: 1.6 }}>
        Token permanente do System User BM.{' '}
        <span style={{ color: C.text, fontWeight: 600 }}>WABA IDs são opcionais</span> — o token auto-descobre WABAs ao Refresh.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={{ color: C.sec, fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>System User Token</label>
          <input className="ds-input" style={INPUT_STYLE} type="password" placeholder="EAAOKxO1..." value={tok} onChange={e => setTok(e.target.value)} />
        </div>
        <div>
          <label style={{ color: C.sec, fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            WABA IDs
            <span style={{ color: '#7c3aed', marginLeft: 8, fontWeight: 400, textTransform: 'none', fontSize: 11 }}>opcional — vazio = auto-descoberta</span>
          </label>
          <textarea className="ds-input" style={{ ...INPUT_STYLE, height: 72, resize: 'vertical', fontFamily: 'monospace' }}
            placeholder={'Opcional — token auto-descobre\n123456789'}
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

// ── Channel Grid ──────────────────────────────────────────────────────────────

// ── Template Selector ─────────────────────────────────────────────────────────

function TemplateSelector({
  templates, selected, onSelect,
}: { templates: any[]; selected: any | null; onSelect: (t: any) => void }) {
  const [search, setSearch] = useState('');

  const filtered = templates.filter(t => {
    const name = (t.name || t.templateName || '').toLowerCase();
    return !search || name.includes(search.toLowerCase());
  });

  if (!templates.length) return (
    <div style={{ color: '#64748b', fontSize: 13 }}>
      Nenhum template disponível. Verifique a conexão Chipcare.
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <input
        style={{ ...INPUT, maxWidth: 320 }}
        placeholder="Buscar template..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
        {filtered.map((t, i) => {
          const name = t.name || t.templateName || `template_${i}`;
          const tid = t.id || t.templateId || '';
          const lang = t.language || t.languageCode || 'pt_BR';
          const status = t.status || 'APPROVED';
          const category = t.category || 'MARKETING';
          const isSelected = selected?.name === name || selected?.templateName === name;
          return (
            <div
              key={tid || name}
              onClick={() => onSelect(t)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                background: isSelected ? '#0a1628' : '#0a0a18',
                border: `1px solid ${isSelected ? '#00ccff' : '#1e1e3a'}`,
                borderRadius: 8, padding: '10px 14px', cursor: 'pointer',
              }}
            >
              <div style={{ flex: 1 }}>
                <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{name}</span>
                <span style={{ color: '#64748b', fontSize: 11, marginLeft: 8 }}>{lang}</span>
              </div>
              <span style={{
                background: '#22c55e22', color: '#22c55e',
                border: '1px solid #22c55e55', borderRadius: 4,
                padding: '2px 8px', fontSize: 10, fontWeight: 700,
              }}>{status}</span>
              <span style={{ color: '#94a3b8', fontSize: 11 }}>{category}</span>
              {isSelected && <span style={{ color: '#00ccff', fontSize: 12 }}>✓</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Wizard ────────────────────────────────────────────────────────────────────

type WizardStep = 'upload' | 'assign' | 'template' | 'confirm';

interface ChannelAssignment {
  channel_id: number;
  title: string;
  status: string;
  daily_limit: number;
  planned_count: number;
}

const AGGRESSION_OPTS = [
  { value: 'SEGURO', label: 'Seguro', sub: '~17 msgs/h · 2–5min entre envios' },
  { value: 'MEDIUM', label: 'Moderado', sub: '~30 msgs/h · 1–3min entre envios' },
  { value: 'AGRESSIVO', label: 'Agressivo', sub: '~96 msgs/h · 15–60s' },
  { value: 'MAXIMO', label: 'Máximo', sub: '~3600 msgs/h · 0.5–1.5s' },
];

function CsvUploadWizard({ templates, onDispatched }: { templates: any[]; onDispatched: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<WizardStep>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const [dispatchId, setDispatchId] = useState('');
  const [totalLeads, setTotalLeads] = useState(0);
  const [justification, setJustification] = useState('');
  const [risks, setRisks] = useState('');

  const [assignments, setAssignments] = useState<ChannelAssignment[]>([]);

  const [selectedTemplate, setSelectedTemplate] = useState<any | null>(null);
  const [campaignName, setCampaignName] = useState('');
  const [aggression, setAggression] = useState('MEDIUM');
  const [activateNow, setActivateNow] = useState(false);

  const [dryRunResult, setDryRunResult] = useState<any | null>(null);
  const [sending, setSending] = useState(false);
  const [allowPartial, setAllowPartial] = useState(false);
  const [err, setErr] = useState('');

  const analyze = async () => {
    if (!file) return;
    setAnalyzing(true); setErr('');
    try {
      const res = await chipcareApi.analyzeCSV(file);
      setDispatchId(res.dispatch_id);
      setTotalLeads(res.total_leads);
      setJustification(res.split.justification || '');
      setRisks(res.split.risks || '');
      const asns: ChannelAssignment[] = (res.split.assignments || []).map((a: any) => ({
        channel_id: a.channel_id,
        title: a.title || String(a.channel_id),
        status: a.status || 'UNKNOWN',
        daily_limit: a.daily_limit || 500,
        planned_count: a.planned_count,
      }));
      if (!asns.length) { setErr(res.split.justification || 'Nenhum canal elegível'); setAnalyzing(false); return; }
      setAssignments(asns);
      setStep('assign');
    } catch (e: any) { setErr(e?.response?.data?.detail || e?.message || 'Erro ao analisar CSV'); }
    finally { setAnalyzing(false); }
  };

  const updatePlanned = (cid: number, val: number) => {
    setAssignments(prev => prev.map(a => a.channel_id === cid ? { ...a, planned_count: Math.max(0, val) } : a));
  };

  const dryRun = async () => {
    if (!selectedTemplate) { setErr('Selecione um template'); return; }
    const validAsns = assignments.filter(a => a.planned_count > 0);
    if (!validAsns.length) { setErr('Nenhum lead atribuído'); return; }
    setSending(true); setErr('');
    try {
      const res = await chipcareApi.dispatch({
        dispatch_id: dispatchId,
        assignments: validAsns.map(a => ({ channel_id: a.channel_id, planned_count: a.planned_count })),
        template: {
          template_name: selectedTemplate.name || selectedTemplate.templateName,
          template_id: String(selectedTemplate.id || selectedTemplate.templateId || ''),
          language_code: selectedTemplate.language || selectedTemplate.languageCode || 'pt_BR',
          components: selectedTemplate.components || [],
        },
        campaign_name: campaignName || file?.name?.replace('.csv', '') || '',
        aggression_level: aggression,
        activate_immediately: false,
        dry_run: true,
        allow_partial: allowPartial,
      });
      if (!res) { setErr('Dry-run retornou resposta vazia'); return; }
      setDryRunResult(res);
      setStep('confirm');
    } catch (e: any) { setErr(e?.response?.data?.detail || e?.message || 'Erro no dry-run'); }
    finally { setSending(false); }
  };

  const confirm = async () => {
    if (!selectedTemplate) return;
    const validAsns = assignments.filter(a => a.planned_count > 0);
    setSending(true); setErr('');
    try {
      await chipcareApi.dispatch({
        dispatch_id: dispatchId,
        assignments: validAsns.map(a => ({ channel_id: a.channel_id, planned_count: a.planned_count })),
        template: {
          template_name: selectedTemplate.name || selectedTemplate.templateName,
          template_id: String(selectedTemplate.id || selectedTemplate.templateId || ''),
          language_code: selectedTemplate.language || selectedTemplate.languageCode || 'pt_BR',
          components: selectedTemplate.components || [],
        },
        campaign_name: campaignName || file?.name?.replace('.csv', '') || '',
        aggression_level: aggression,
        activate_immediately: activateNow,
        dry_run: false,
        confirm_real_dispatch: true,
        allow_partial: allowPartial,
      });
      onDispatched();
      setStep('upload'); setFile(null); setDispatchId(''); setTotalLeads(0);
      setAssignments([]); setSelectedTemplate(null); setCampaignName('');
      setDryRunResult(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (e: any) { setErr(e?.response?.data?.detail || e?.message || 'Erro ao confirmar'); }
    finally { setSending(false); }
  };

  const STEP_LABELS: Record<WizardStep, string> = {
    upload: '1. Upload', assign: '2. Distribuição', template: '3. Template', confirm: '4. Confirmar',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Steps indicator */}
      <div style={{ display: 'flex', gap: 8 }}>
        {(['upload', 'assign', 'template', 'confirm'] as WizardStep[]).map(s => (
          <span key={s} style={{
            padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
            background: step === s ? '#00ccff' : '#1e1e3a',
            color: step === s ? '#000' : '#64748b',
          }}>{STEP_LABELS[s]}</span>
        ))}
      </div>

      {err && <div style={{ color: '#f87171', fontSize: 13, padding: '10px 14px', background: '#1e0a0a', borderRadius: 8 }}>{err}</div>}

      {/* Step 1 — Upload */}
      {step === 'upload' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>
            Faça upload do CSV. O sistema distribui leads entre os canais Chipcare disponíveis.
          </p>
          <div>
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Arquivo CSV</label>
            <input ref={fileRef} type="file" accept=".csv,.xlsx"
              style={{ color: '#94a3b8', fontSize: 13 }}
              onChange={e => setFile(e.target.files?.[0] ?? null)} />
            {file && <span style={{ color: '#22c55e', fontSize: 12, marginLeft: 8 }}>{file.name}</span>}
          </div>
          <button style={BTN('#00ccff', !file || analyzing)} onClick={analyze} disabled={!file || analyzing}>
            {analyzing ? 'Analisando...' : 'Analisar CSV →'}
          </button>
        </div>
      )}

      {/* Step 2 — Assign */}
      {step === 'assign' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>
              <strong style={{ color: '#e2e8f0' }}>{totalLeads} leads</strong> — edite a distribuição por canal.
            </p>
            <span style={{ color: '#64748b', fontSize: 12 }}>
              Total atribuído: {assignments.reduce((s, a) => s + a.planned_count, 0)}
            </span>
          </div>
          {justification && <p style={{ color: '#6366f1', fontSize: 12, margin: 0 }}>{justification}</p>}
          {risks && risks !== 'Nenhum risco identificado.' && (
            <p style={{ color: '#f59e0b', fontSize: 12, margin: 0 }}>⚠ {risks}</p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {assignments.map(a => {
              const sc = STATUS_COLOR[a.status] || '#64748b';
              return (
                <div key={a.channel_id} style={{
                  display: 'grid', gridTemplateColumns: '1fr 80px 80px 100px',
                  gap: 12, alignItems: 'center',
                  background: '#0a0a18', border: '1px solid #1e1e3a', borderRadius: 8, padding: '10px 16px',
                }}>
                  <span style={{ color: '#e2e8f0', fontSize: 13 }}>
                    {a.title}
                    <span style={{ color: sc, fontSize: 11, marginLeft: 8 }}>{a.status}</span>
                  </span>
                  <span style={{ color: '#94a3b8', fontSize: 12 }}>{a.daily_limit}/dia</span>
                  <input
                    type="number" min={0} max={a.daily_limit}
                    value={a.planned_count}
                    onChange={e => updatePlanned(a.channel_id, parseInt(e.target.value) || 0)}
                    style={{ ...INPUT, width: 80, textAlign: 'center' }}
                  />
                  <span style={{ color: '#64748b', fontSize: 12 }}>leads</span>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button style={BTN('#334155')} onClick={() => setStep('upload')}>← Voltar</button>
            <button style={BTN('#00ccff')} onClick={() => setStep('template')}>Próximo →</button>
          </div>
        </div>
      )}

      {/* Step 3 — Template */}
      {step === 'template' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>
            Selecione o template HSM aprovado. Será enviado via canais Chipcare Oficial.
          </p>
          <div>
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 8 }}>Nome da Campanha</label>
            <input style={{ ...INPUT, maxWidth: 360 }} placeholder="Ex: CLT Junho 2026"
              value={campaignName} onChange={e => setCampaignName(e.target.value)} />
          </div>
          <div>
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 8 }}>Velocidade</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {AGGRESSION_OPTS.map(opt => (
                <div key={opt.value} onClick={() => setAggression(opt.value)} style={{
                  padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
                  background: aggression === opt.value ? '#00ccff22' : '#0a0a18',
                  border: `1px solid ${aggression === opt.value ? '#00ccff' : '#1e1e3a'}`,
                  minWidth: 140,
                }}>
                  <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{opt.label}</div>
                  <div style={{ color: '#64748b', fontSize: 11 }}>{opt.sub}</div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 8 }}>Templates disponíveis</label>
            <TemplateSelector templates={templates} selected={selectedTemplate} onSelect={setSelectedTemplate} />
          </div>
          {selectedTemplate && (
            <div style={{ background: '#0a1628', border: '1px solid #00ccff55', borderRadius: 8, padding: 12 }}>
              <p style={{ color: '#00ccff', fontSize: 12, fontWeight: 700, margin: '0 0 4px 0' }}>
                Template selecionado: {selectedTemplate.name || selectedTemplate.templateName}
              </p>
              <p style={{ color: '#64748b', fontSize: 11, margin: 0 }}>
                ID: {selectedTemplate.id || selectedTemplate.templateId} · {selectedTemplate.language || selectedTemplate.languageCode || 'pt_BR'}
              </p>
            </div>
          )}
          {(() => {
            const assignedSum = assignments.reduce((s, a) => s + (Number(a.planned_count) || 0), 0);
            const diff = totalLeads - assignedSum;
            const isExact = diff === 0;
            const overflow = diff < 0;
            const canConfirm = !!selectedTemplate && !sending && (isExact || (diff > 0 && allowPartial));
            return (
              <>
                {!isExact && (
                  <div style={{
                    background: overflow ? 'rgba(239,68,68,.08)' : 'rgba(234,179,8,.08)',
                    border: `1px solid ${overflow ? 'rgba(239,68,68,.3)' : 'rgba(234,179,8,.3)'}`,
                    borderRadius: 10, padding: 12,
                  }}>
                    <div style={{ color: overflow ? '#ef4444' : '#eab308', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                      {overflow
                        ? `❌ EXCESSO — soma ${assignedSum.toLocaleString('pt-BR')} > total ${totalLeads.toLocaleString('pt-BR')}.`
                        : `⚠ PARCIAL — ${assignedSum.toLocaleString('pt-BR')} de ${totalLeads.toLocaleString('pt-BR')} atribuídos (${diff.toLocaleString('pt-BR')} sobrando)`}
                    </div>
                    {diff > 0 && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: '#e2e8f0', fontSize: 11 }}>
                        <input type="checkbox" checked={allowPartial} onChange={e => setAllowPartial(e.target.checked)} style={{ accentColor: '#eab308' }} />
                        Eu entendo: disparar {assignedSum.toLocaleString('pt-BR')} leads, descartar {diff.toLocaleString('pt-BR')}.
                      </label>
                    )}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 10 }}>
                  <button style={BTN('#334155')} onClick={() => setStep('assign')}>← Voltar</button>
                  <button style={BTN('#00ccff', !canConfirm)} onClick={dryRun} disabled={!canConfirm}>
                    {sending ? 'Validando...' : 'Validar e Confirmar →'}
                  </button>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Step 4 — Confirm */}
      {step === 'confirm' && dryRunResult && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: '#0a1a0a', border: '1px solid #22c55e55', borderRadius: 10, padding: 16 }}>
            <p style={{ color: '#22c55e', fontWeight: 700, fontSize: 14, margin: '0 0 12px 0' }}>✅ Validação OK — Resumo</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                ['Campanha', dryRunResult.campaign_name],
                ['Leads', String(dryRunResult.total_leads || totalLeads)],
                ['Canais', dryRunResult.channel_ids?.join(', ')],
                ['Template', dryRunResult.template],
                ['Velocidade', dryRunResult.aggression_level || aggression],
              ].map(([label, value]) => value && (
                <div key={label}>
                  <span style={{ color: '#64748b', fontSize: 12 }}>{label}</span>
                  <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{value}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="checkbox" id="activateNow" checked={activateNow} onChange={e => setActivateNow(e.target.checked)} />
            <label htmlFor="activateNow" style={{ color: '#94a3b8', fontSize: 13, cursor: 'pointer' }}>
              Ativar campanha imediatamente após criar
              {!activateNow && <span style={{ color: '#f59e0b', fontSize: 11, marginLeft: 6 }}>
                (não marcado = cria pausada, ativa manualmente depois)
              </span>}
            </label>
          </div>

          <div style={{
            background: '#1a0a0a', border: '1px solid #ef444455',
            borderRadius: 8, padding: '10px 14px',
            color: '#f87171', fontSize: 12,
          }}>
            ⚠ Esta ação cria uma campanha real no Chipcare. Confirme antes de prosseguir.
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button style={BTN('#334155')} onClick={() => setStep('template')}>← Voltar</button>
            <button style={BTN('#ef4444', sending)} onClick={confirm} disabled={sending}>
              {sending ? 'Criando campanha...' : activateNow ? '🚀 Criar e Ativar' : '📋 Criar Pausada'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── History ───────────────────────────────────────────────────────────────────

function CampaignHistory({ dispatches }: { dispatches: any[] }) {
  if (!dispatches.length) return <div style={{ color: '#64748b', fontSize: 13 }}>Nenhum histórico.</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {dispatches.map(d => (
        <div key={d.id} style={{
          display: 'grid', gridTemplateColumns: '1fr 80px 100px 120px',
          gap: 12, alignItems: 'center',
          background: '#0a0a18', border: '1px solid #1e1e3a', borderRadius: 8, padding: '10px 16px',
        }}>
          <div>
            <span style={{ color: '#e2e8f0', fontSize: 13 }}>{d.campaign_name || d.id.slice(0, 8)}</span>
            {d.template_name && <span style={{ color: '#64748b', fontSize: 11, marginLeft: 8 }}>tpl: {d.template_name}</span>}
          </div>
          <span style={{ color: '#94a3b8', fontSize: 12 }}>{d.total_leads ?? 0} leads</span>
          <span style={{
            padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, textAlign: 'center',
            background: d.status === 'running' ? '#22c55e22' : d.status === 'cancelled' ? '#ef444422' : '#64748b22',
            color: d.status === 'running' ? '#22c55e' : d.status === 'cancelled' ? '#ef4444' : '#94a3b8',
          }}>{d.status.toUpperCase()}</span>
          <span style={{ color: '#64748b', fontSize: 11 }}>
            {d.created_at ? new Date(d.created_at).toLocaleDateString('pt-BR') : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DisparoChipcare() {
  const [channels, setChannels] = useState<any[]>([]);
  const [histDispatches, setHistDispatches] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState('');
  const [loadingTpls, setLoadingTpls] = useState(false);
  const [loadErr, setLoadErr] = useState('');

  const loadChannels = () => {
    chipcareApi.listChannels().then(setChannels)
      .catch((e: any) => setLoadErr(`Falha ao carregar canais: ${e?.response?.data?.detail || e?.message || 'erro desconhecido'}`));
  };

  const loadHistory = () => {
    chipcareApi.listDispatches().then(setHistDispatches)
      .catch((e: any) => setLoadErr(`Falha ao carregar histórico: ${e?.response?.data?.detail || e?.message || 'erro desconhecido'}`));
  };

  const loadTemplates = async () => {
    setLoadingTpls(true);
    try {
      const res = await chipcareApi.listTemplates();
      const tpls = Array.isArray(res) ? res : ((res as any).templates ?? []);
      setTemplates(tpls);
    } catch (e: any) {
      setLoadErr(`Falha ao carregar templates: ${e?.response?.data?.detail || e?.message || 'erro desconhecido'}`);
    }
    finally { setLoadingTpls(false); }
  };

  useEffect(() => {
    loadChannels();
    loadHistory();
    loadTemplates();
  }, []);

  const handleRefreshChannels = async () => {
    setRefreshing(true); setRefreshMsg('');
    try {
      const res = await chipcareApi.refreshChannels();
      const parts: string[] = [];
      parts.push(`✅ ${(res.channels || []).length} números`);
      if (res.meta_total) parts.push(`${res.meta_total} da BM Meta`);
      if (res.meta_matched != null) parts.push(`${res.meta_matched} cruzados c/ Chipcare`);
      if (res.chipcare_error) parts.push(`⚠ Chipcare: ${String(res.chipcare_error).slice(0, 80)}`);
      if (res.meta_error) parts.push(`⚠ Meta: ${String(res.meta_error).slice(0, 80)}`);
      setRefreshMsg(parts.join(' · '));
      setChannels(res.channels || []);
    } catch (e: any) {
      setRefreshMsg('Erro: ' + (e?.response?.data?.detail || e?.message));
    } finally { setRefreshing(false); }
  };

  const handleTogglePause = async (iidStr: string, paused: boolean) => {
    const cid = Number(iidStr);
    if (Number.isNaN(cid) || cid < 0) return; // meta-only não pode pausar
    try {
      if (paused) await chipcareApi.resumeChannel(cid);
      else await chipcareApi.pauseChannel(cid);
      loadChannels();
    } catch (e: any) {
      console.error('[DisparoChipcare] togglePause falhou:', e);
      setLoadErr(`Falha ao ${paused ? 'retomar' : 'pausar'} canal: ` + (e?.response?.data?.detail || e?.message || 'erro desconhecido'));
    }
  };

  return (
    <div style={{ padding: '32px 40px 64px', display: 'flex', flexDirection: 'column', gap: 24, width: '100%', background: C.bg, minHeight: '100vh' }}>
      <style>{SHARED_CSS}</style>

      {loadErr && (
        <div style={{
          color: C.red, fontSize: 13, padding: 12,
          background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.4)',
          borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
        }}>
          <span>⚠ {loadErr}</span>
          <button onClick={() => setLoadErr('')} style={{
            background: 'transparent', border: '1px solid rgba(239,68,68,.4)', color: C.red,
            borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 600,
          }}>✕</button>
        </div>
      )}

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
              }}>Disparo Chipcare</h1>
              <div style={{ color: C.sec, fontSize: 14, marginTop: 4 }}>WhatsApp Oficial · Templates HSM</div>
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
          <button className="ds-btn" onClick={loadTemplates} disabled={loadingTpls}
            title="Recarrega lista de templates HSM aprovados no Chipcare"
            style={{
              background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)',
              color: loadingTpls ? C.muted : C.text, borderRadius: 12, padding: '14px 20px',
              cursor: loadingTpls ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600,
            }}>
            {loadingTpls ? '⟳ Templates...' : '📋 Templates'}
          </button>
          <button className="ds-btn" onClick={handleRefreshChannels} disabled={refreshing}
            title="Bate no token Meta + Chipcare, puxa qualidade, restrições, pagamento, nome de exibição."
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

      {/* Credentials 2-col */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <ChipcareCredsPanel onSaved={loadChannels} />
        <MetaPanel onSaved={loadChannels} />
      </div>

      {/* IA Monitor */}
      <Section title="Inteligência Artificial · Monitora Disparo e Qualidade" gradient={G.neon} icon="🧠">
        <AIMonitorPanel
          instances={channels}
          getSnapshot={async () => {
            const r = await chipcareApi.getSnapshot();
            return { instances: r.channels, active_dispatches: r.active_dispatches };
          }}
          onRefresh={handleRefreshChannels}
          refreshing={refreshing}
        />
      </Section>

      {/* Novo disparo (CsvUploadWizard chipcare-específico, templates HSM) */}
      <Section title="Novo Disparo" gradient={G.primary} icon="🚀">
        <CsvUploadWizard
          templates={templates}
          onDispatched={() => { loadChannels(); loadHistory(); }}
        />
      </Section>

      {/* Qualidade dos números (canais Chipcare + Meta-only enriquecidos) */}
      <Section title="Qualidade dos Números da sua BM" gradient={G.cyan} icon="📱">
        <NumberQualityGrid
          instances={channels}
          onTogglePause={handleTogglePause}
          crmLabel="CRM CHIPCARE"
          metaOnlyLabel="SÓ META"
          emptyHint='Nenhum número. Salve credenciais Chipcare + token Meta e clique em "Atualizar Status".'
        />
      </Section>

      {/* Histórico — sempre por último */}
      <Section title="Histórico de Disparos" gradient={G.purple} icon="📋">
        <CampaignHistory dispatches={histDispatches} />
      </Section>
    </div>
  );
}
