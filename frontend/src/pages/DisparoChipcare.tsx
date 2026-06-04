import { useEffect, useRef, useState } from 'react';
import { chipcareApi } from '../lib/api';

// ── Shared styles ─────────────────────────────────────────────────────────────

const CARD = { background: '#0d0d1f', border: '1px solid #1e1e3a', borderRadius: 12, padding: 24 } as const;
const H2 = (color: string) => ({ color, fontSize: 15, fontWeight: 700, marginBottom: 16, marginTop: 0 });
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

function CredentialsPanel({ onSaved }: { onSaved: () => void }) {
  const [configured, setConfigured] = useState(false);
  const [tenantId, setTenantId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenant, setTenant] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    chipcareApi.getCredentials().then(d => {
      setConfigured(d.configured);
      if (d.tenant_id) { setTenantId(d.tenant_id); setTenant(d.tenant_id); }
    }).catch(() => {});
  }, []);

  const save = async () => {
    if (!email.trim() || !password.trim()) { setMsg('Email e senha obrigatórios'); return; }
    setSaving(true);
    try {
      await chipcareApi.saveCredentials(email.trim(), password.trim(), tenant.trim());
      setConfigured(true); setTenantId(tenant.trim());
      setEmail(''); setPassword('');
      setMsg('Salvo! Agora clique em "Refresh Canais".');
      onSaved();
    } catch (e: any) { setMsg('Erro: ' + (e?.response?.data?.detail || e?.message)); }
    finally { setSaving(false); }
  };

  return (
    <div style={CARD}>
      <h2 style={H2('#00ccff')}>Credenciais Chipcare</h2>
      {configured && (
        <p style={{ color: '#22c55e', fontSize: 13, marginBottom: 12 }}>
          ✅ Configurado{tenantId ? ` · Tenant: ${tenantId}` : ''}
        </p>
      )}
      <p style={{ color: '#64748b', fontSize: 12, marginBottom: 12 }}>
        Login Chipcare (chipcare.miwteam.com.br). Tenant = nome do ambiente (ex: Sarah ou Arthur).
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 480 }}>
        <div>
          <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>E-mail</label>
          <input style={INPUT} type="email" placeholder="usuario@email.com" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div>
          <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Senha</label>
          <input style={INPUT} type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        <div>
          <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Tenant (ambiente)</label>
          <input style={INPUT} placeholder="Sarah" value={tenant} onChange={e => setTenant(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button style={BTN('#00ccff', saving)} onClick={save} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</button>
          {msg && <span style={{ color: msg.startsWith('Erro') ? '#f87171' : '#22c55e', fontSize: 12 }}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}

// ── Channel Grid ──────────────────────────────────────────────────────────────

function ChannelGrid({ channels, onTogglePause }: { channels: any[]; onTogglePause: (id: number, paused: boolean) => void }) {
  if (!channels.length) return (
    <div style={{ color: '#64748b', fontSize: 13 }}>
      Nenhum canal. Clique em "Refresh Canais".
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {channels.map(ch => {
        const paused = !!ch.is_paused;
        const status = ch.status || 'CLOSED';
        const color = STATUS_COLOR[status] || '#64748b';
        return (
          <div key={ch.channel_id} style={{
            display: 'grid', gridTemplateColumns: '1fr 100px 120px 80px',
            gap: 12, alignItems: 'center',
            background: '#0a0a18', border: '1px solid #1e1e3a', borderRadius: 8, padding: '10px 16px',
          }}>
            <div>
              <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>
                {ch.title || ch.channel_id}
              </span>
              {ch.description && (
                <span style={{ color: '#64748b', fontSize: 11, marginLeft: 8 }}>{ch.description}</span>
              )}
              {paused && <span style={{ color: '#f59e0b', fontSize: 11, marginLeft: 8 }}>PAUSADO</span>}
            </div>
            <span style={{ color, fontSize: 12, fontWeight: 600 }}>{status}</span>
            <span style={{ color: '#94a3b8', fontSize: 12 }}>{ch.daily_limit ?? 500}/dia</span>
            <button style={BTN(paused ? '#22c55e' : '#ef4444')} onClick={() => onTogglePause(ch.channel_id, paused)}>
              {paused ? 'Retomar' : 'Pausar'}
            </button>
          </div>
        );
      })}
    </div>
  );
}

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
          templateName: selectedTemplate.name || selectedTemplate.templateName,
          templateId: String(selectedTemplate.id || selectedTemplate.templateId || ''),
          languageCode: selectedTemplate.language || selectedTemplate.languageCode || 'pt_BR',
          components: selectedTemplate.components || [],
        },
        campaign_name: campaignName || file?.name?.replace('.csv', '') || '',
        aggression_level: aggression,
        activate_immediately: false,
        dry_run: true,
      });
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
          templateName: selectedTemplate.name || selectedTemplate.templateName,
          templateId: String(selectedTemplate.id || selectedTemplate.templateId || ''),
          languageCode: selectedTemplate.language || selectedTemplate.languageCode || 'pt_BR',
          components: selectedTemplate.components || [],
        },
        campaign_name: campaignName || file?.name?.replace('.csv', '') || '',
        aggression_level: aggression,
        activate_immediately: activateNow,
        dry_run: false,
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
          <div style={{ display: 'flex', gap: 10 }}>
            <button style={BTN('#334155')} onClick={() => setStep('assign')}>← Voltar</button>
            <button style={BTN('#00ccff', !selectedTemplate || sending)} onClick={dryRun} disabled={!selectedTemplate || sending}>
              {sending ? 'Validando...' : 'Validar e Confirmar →'}
            </button>
          </div>
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

// ── Monitor ───────────────────────────────────────────────────────────────────

function MonitorPanel({ dispatches, onActivate, onCancel }: {
  dispatches: any[];
  onActivate: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  if (!dispatches.length) return (
    <div style={{ color: '#64748b', fontSize: 13 }}>Nenhum disparo ativo.</div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {dispatches.map(d => {
        const channels = d.channel_ids || [];
        return (
          <div key={d.id} style={{
            background: '#0a0a18', border: '1px solid #1e1e3a', borderRadius: 8, padding: '12px 16px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div>
                <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 700 }}>{d.campaign_name || d.id.slice(0, 8)}</span>
                {d.chipcare_campaign_id && (
                  <span style={{ color: '#64748b', fontSize: 11, marginLeft: 8 }}>Chipcare #{d.chipcare_campaign_id}</span>
                )}
                <span style={{ marginLeft: 10, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                  background: d.status === 'running' ? '#22c55e22' : '#f59e0b22',
                  color: d.status === 'running' ? '#22c55e' : '#f59e0b',
                }}>{d.status.toUpperCase()}</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {d.status === 'paused' && d.chipcare_campaign_id && (
                  <button style={BTN('#22c55e')} onClick={() => onActivate(d.id)}>▶ Ativar</button>
                )}
                <button style={BTN('#ef4444')} onClick={() => onCancel(d.id)}>✕ Cancelar</button>
              </div>
            </div>
            <div style={{ color: '#64748b', fontSize: 12 }}>
              Template: {d.template_name || '—'} · Canais: {Array.isArray(channels) ? channels.join(', ') : '—'} · Total: {d.total_leads ?? '—'} leads
            </div>
          </div>
        );
      })}
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
  const [activeDispatches, setActiveDispatches] = useState<any[]>([]);
  const [histDispatches, setHistDispatches] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingTpls, setLoadingTpls] = useState(false);
  const [msg, setMsg] = useState('');

  const loadChannels = () => {
    chipcareApi.listChannels().then(setChannels).catch(() => {});
  };

  const loadSnapshot = () => {
    chipcareApi.getSnapshot().then(d => {
      setChannels(d.channels || []);
      setActiveDispatches(d.active_dispatches || []);
    }).catch(() => {});
  };

  const loadHistory = () => {
    chipcareApi.listDispatches().then(setHistDispatches).catch(() => {});
  };

  const loadTemplates = async () => {
    setLoadingTpls(true);
    try {
      const res = await chipcareApi.listTemplates();
      const tpls = Array.isArray(res) ? res : ((res as any).templates ?? []);
      setTemplates(tpls);
    } catch (e: any) {
      setMsg('Erro ao carregar templates: ' + (e?.response?.data?.detail || e?.message));
    } finally { setLoadingTpls(false); }
  };

  useEffect(() => {
    loadSnapshot();
    loadHistory();
    loadTemplates();
    const iv = setInterval(loadSnapshot, 15000);
    return () => clearInterval(iv);
  }, []);

  const handleRefreshChannels = async () => {
    setRefreshing(true); setMsg('');
    try {
      const res = await chipcareApi.refreshChannels();
      setMsg(`✅ ${res.channels.length} canal(is) sincronizado(s)`);
      loadChannels();
    } catch (e: any) {
      setMsg('Erro: ' + (e?.response?.data?.detail || e?.message));
    } finally { setRefreshing(false); }
  };

  const handleTogglePause = async (channelId: number, paused: boolean) => {
    if (paused) await chipcareApi.resumeChannel(channelId);
    else await chipcareApi.pauseChannel(channelId);
    loadChannels();
  };

  const handleActivate = async (dispatchId: string) => {
    await chipcareApi.activateDispatch(dispatchId).catch(() => {});
    loadSnapshot();
  };

  const handleCancel = async (dispatchId: string) => {
    await chipcareApi.cancelDispatch(dispatchId).catch(() => {});
    loadSnapshot(); loadHistory();
  };

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ color: '#00ccff', margin: 0, fontSize: 22, fontWeight: 700 }}>
        Disparo Chipcare <span style={{ color: '#334155', fontSize: 14, fontWeight: 400 }}>WhatsApp Oficial · Templates HSM</span>
      </h1>

      {msg && (
        <div style={{
          color: msg.startsWith('Erro') ? '#f87171' : '#22c55e',
          fontSize: 13, padding: '10px 14px',
          background: msg.startsWith('Erro') ? '#1e0a0a' : '#0a1a0a', borderRadius: 8,
        }}>{msg}</div>
      )}

      {/* Credentials */}
      <CredentialsPanel onSaved={loadChannels} />

      {/* Channels */}
      <div style={CARD}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ ...H2('#00ccff'), marginBottom: 0 }}>Canais WA Oficial</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={BTN('#00ccff', refreshing)} onClick={handleRefreshChannels} disabled={refreshing}>
              {refreshing ? 'Atualizando...' : '🔄 Refresh Canais'}
            </button>
            <button style={BTN('#6366f1', loadingTpls)} onClick={loadTemplates} disabled={loadingTpls}>
              {loadingTpls ? 'Carregando...' : '📋 Atualizar Templates'}
            </button>
          </div>
        </div>
        <ChannelGrid channels={channels} onTogglePause={handleTogglePause} />
      </div>

      {/* Wizard */}
      <div style={CARD}>
        <h2 style={H2('#00ccff')}>Novo Disparo</h2>
        <CsvUploadWizard
          templates={templates}
          onDispatched={() => { loadSnapshot(); loadHistory(); }}
        />
      </div>

      {/* Monitor */}
      <div style={CARD}>
        <h2 style={H2('#f59e0b')}>Monitor Ativo <span style={{ color: '#334155', fontSize: 12, fontWeight: 400 }}>· atualiza a cada 15s</span></h2>
        <MonitorPanel
          dispatches={activeDispatches}
          onActivate={handleActivate}
          onCancel={handleCancel}
        />
      </div>

      {/* History */}
      <div style={CARD}>
        <h2 style={H2('#94a3b8')}>Histórico de Campanhas</h2>
        <CampaignHistory dispatches={histDispatches} />
      </div>
    </div>
  );
}
