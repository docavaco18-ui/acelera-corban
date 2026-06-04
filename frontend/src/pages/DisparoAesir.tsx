import { useEffect, useRef, useState } from 'react';
import { aesirApi } from '../lib/api';

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
const QUALITY_COLOR: Record<string, string> = { GREEN: '#22c55e', YELLOW: '#f59e0b', RED: '#ef4444', UNKNOWN: '#64748b' };

// ── Sub-components ────────────────────────────────────────────────────────────

function QualityBadge({ rating }: { rating?: string }) {
  const r = rating || 'UNKNOWN';
  return <span style={{
    background: QUALITY_COLOR[r] + '22', color: QUALITY_COLOR[r],
    border: `1px solid ${QUALITY_COLOR[r]}55`, borderRadius: 4,
    padding: '2px 8px', fontSize: 11, fontWeight: 700,
  }}>{r}</span>;
}

function CredentialsPanel({ onSaved }: { onSaved: () => void }) {
  const [configured, setConfigured] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [acc, setAcc] = useState(''); const [tok, setTok] = useState('');
  const [saving, setSaving] = useState(false); const [msg, setMsg] = useState('');

  useEffect(() => {
    aesirApi.getCredentials().then(d => { setConfigured(d.configured); if (d.account_id) setAccountId(d.account_id); }).catch(() => {});
  }, []);

  const save = async () => {
    if (!tok.trim() || !acc.trim()) { setMsg('Preencha token e account_id'); return; }
    setSaving(true);
    try {
      await aesirApi.saveCredentials(tok.trim(), acc.trim());
      setConfigured(true); setAccountId(acc.trim()); setTok(''); setMsg('Salvo!'); onSaved();
    } catch (e: any) { setMsg('Erro: ' + (e?.response?.data?.detail || e?.message)); }
    finally { setSaving(false); }
  };

  return (
    <div style={CARD}>
      <h2 style={H2('#00ff88')}>Credenciais Aesir ERP</h2>
      {configured && <p style={{ color: '#22c55e', fontSize: 13, marginBottom: 12 }}>✅ Account ID: <strong>{accountId}</strong></p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 480 }}>
        <div><label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Account ID</label>
          <input style={INPUT} placeholder="532" value={acc} onChange={e => setAcc(e.target.value)} /></div>
        <div><label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>API Token Aesir</label>
          <input style={INPUT} type="password" placeholder="aesir_v1_..." value={tok} onChange={e => setTok(e.target.value)} /></div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button style={BTN('#6366f1', saving)} onClick={save} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</button>
          {msg && <span style={{ color: msg.startsWith('Erro') ? '#f87171' : '#22c55e', fontSize: 12 }}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}

function MetaPanel({ onSaved }: { onSaved: () => void }) {
  const [metaOk, setMetaOk] = useState(false);
  const [tok, setTok] = useState('');
  const [saving, setSaving] = useState(false); const [msg, setMsg] = useState('');

  useEffect(() => {
    aesirApi.getCredentials().then(d => {
      if (d.configured) setMetaOk(d.meta_configured || false);
    }).catch(() => {});
  }, []);

  const save = async () => {
    if (!tok.trim()) { setMsg('Informe o Meta System User Token'); return; }
    setSaving(true);
    try {
      await aesirApi.saveMetaCredentials(tok.trim(), []);
      setMetaOk(true); setTok(''); setMsg('Meta configurado! WABAs descobertos automaticamente no Refresh.'); onSaved();
    } catch (e: any) { setMsg('Erro: ' + (e?.response?.data?.detail || e?.message)); }
    finally { setSaving(false); }
  };

  return (
    <div style={CARD}>
      <h2 style={H2('#1d9bf0')}>Meta Business Manager</h2>
      {metaOk && <p style={{ color: '#22c55e', fontSize: 13, marginBottom: 8 }}>✅ Meta token configurado</p>}
      <p style={{ color: '#64748b', fontSize: 12, marginBottom: 12 }}>
        Token permanente System User BM. WABAs e números são descobertos automaticamente ao clicar em "Refresh Números".
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 480 }}>
        <div><label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>System User Token</label>
          <input style={INPUT} type="password" placeholder="EAAOKxO1..." value={tok} onChange={e => setTok(e.target.value)} /></div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button style={BTN('#1d9bf0', saving)} onClick={save} disabled={saving}>{saving ? 'Salvando...' : 'Salvar Meta'}</button>
          {msg && <span style={{ color: msg.startsWith('Erro') ? '#f87171' : '#22c55e', fontSize: 12 }}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}

function NumberQualityGrid({ instances, onTogglePause }: { instances: any[]; onTogglePause: (iid: string, paused: boolean) => void }) {
  if (!instances.length) return <div style={{ color: '#64748b', fontSize: 13 }}>Nenhuma instância. Clique em "Refresh Números".</div>;
  const hasQuality = instances.some(i => i.quality_rating && i.quality_rating !== 'UNKNOWN');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {instances.map(inst => {
        const paused = !!inst.is_paused;
        const statusColor = ['open', 'CONNECTED', 'connected'].includes(inst.status) ? '#22c55e' : '#f87171';
        return (
          <div key={inst.instance_id} style={{
            display: 'grid',
            gridTemplateColumns: hasQuality ? '1fr 70px 120px 110px 80px 80px' : '1fr 70px 120px 80px',
            gap: 12, alignItems: 'center',
            background: '#0a0a18', border: '1px solid #1e1e3a', borderRadius: 8, padding: '10px 16px',
          }}>
            <div>
              <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{inst.name || inst.instance_id}</span>
              {(inst.display_phone || inst.phone) && <span style={{ color: '#64748b', fontSize: 12, marginLeft: 8 }}>{inst.display_phone || inst.phone}</span>}
              {paused && <span style={{ color: '#f59e0b', fontSize: 11, marginLeft: 8 }}>PAUSADA</span>}
            </div>
            <span style={{ color: statusColor, fontSize: 12, fontWeight: 600 }}>{inst.status}</span>
            <span style={{ color: '#94a3b8', fontSize: 12 }}>{inst.messaging_tier || `${inst.daily_limit ?? 500}/dia`}</span>
            {hasQuality && <QualityBadge rating={inst.quality_rating} />}
            {hasQuality && <span style={{ color: inst.can_send === 'ENABLED' ? '#22c55e' : '#f87171', fontSize: 11, fontWeight: 600 }}>
              {inst.can_send === 'ENABLED' ? '✓ Pode enviar' : '✗ Bloqueado'}
            </span>}
            <button style={BTN(paused ? '#22c55e' : '#ef4444')} onClick={() => onTogglePause(inst.instance_id, paused)}>
              {paused ? 'Retomar' : 'Pausar'}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── CsvUploadWizard (3 steps) ─────────────────────────────────────────────────

type WizardStep = 'upload' | 'assign' | 'template' | 'confirm';

interface Assignment { instance_id: string; name: string; display_phone: string; quality_rating: string; can_send: string; daily_limit: number; planned_count: number; }

function CsvUploadWizard({ onDispatched }: { onDispatched: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<WizardStep>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Step 1 result
  const [dispatchId, setDispatchId] = useState('');
  const [totalLeads, setTotalLeads] = useState(0);
  const [csvColumns, setCsvColumns] = useState<string[]>([]);
  const [justification, setJustification] = useState('');
  const [risks, setRisks] = useState('');

  // Step 2
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [phoneCol, setPhoneCol] = useState('telefone');

  // Step 3 — template
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
      // default phone column detection
      const found = res.csv_columns.find((c: string) => /telefone|phone|celular|numero|whatsapp/i.test(c));
      if (found) setPhoneCol(found);
      // build preview row from columns
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
      // reset
      setStep('upload'); setFile(null); setDispatchId(''); setTotalLeads(0);
      setCsvColumns([]); setAssignments([]); setMsgTpl(''); setCampaignName('');
      if (fileRef.current) fileRef.current.value = '';
    } catch (e: any) { setErr(e?.response?.data?.detail || e?.message || 'Erro ao confirmar'); }
    finally { setSending(false); }
  };

  const STEP_LABELS: Record<WizardStep, string> = { upload: '1. Upload', assign: '2. Distribuição', template: '3. Mensagem', confirm: '4. Confirmar' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Step indicator */}
      <div style={{ display: 'flex', gap: 8 }}>
        {(['upload', 'assign', 'template', 'confirm'] as WizardStep[]).map(s => (
          <span key={s} style={{
            padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
            background: step === s ? '#6366f1' : '#1e1e3a',
            color: step === s ? '#fff' : '#64748b',
          }}>{STEP_LABELS[s]}</span>
        ))}
      </div>

      {err && <div style={{ color: '#f87171', fontSize: 13, padding: '10px 14px', background: '#1e0a0a', borderRadius: 8 }}>{err}</div>}

      {/* Step 1 — Upload */}
      {step === 'upload' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>
            Faça upload do CSV. O sistema vai calcular a distribuição entre as instâncias disponíveis.
          </p>
          <div>
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Arquivo CSV</label>
            <input ref={fileRef} type="file" accept=".csv"
              style={{ color: '#94a3b8', fontSize: 13 }}
              onChange={e => setFile(e.target.files?.[0] ?? null)} />
            {file && <span style={{ color: '#22c55e', fontSize: 12, marginLeft: 8 }}>{file.name}</span>}
          </div>
          <div>
            <button style={BTN('#6366f1', !file || analyzing)} onClick={analyze} disabled={!file || analyzing}>
              {analyzing ? 'Analisando...' : 'Analisar CSV →'}
            </button>
          </div>
        </div>
      )}

      {/* Step 2 — Assign */}
      {step === 'assign' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>{totalLeads} leads · {justification}</p>
              {risks && risks !== 'Nenhum risco identificado.' && (
                <p style={{ color: '#f59e0b', fontSize: 12, margin: '4px 0 0' }}>⚠ {risks}</p>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 8, color: '#64748b', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', padding: '0 4px' }}>
            <span>Instância</span><span>Leads</span>
          </div>
          {assignments.map(asn => (
            <div key={asn.instance_id} style={{
              display: 'grid', gridTemplateColumns: '1fr 100px', gap: 8, alignItems: 'center',
              background: '#0a0a18', border: '1px solid #1e1e3a', borderRadius: 8, padding: '10px 14px',
            }}>
              <div>
                <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{asn.name}</span>
                {asn.display_phone && <span style={{ color: '#64748b', fontSize: 12, marginLeft: 8 }}>{asn.display_phone}</span>}
                <QualityBadge rating={asn.quality_rating} />
                <span style={{ color: '#64748b', fontSize: 11, marginLeft: 6 }}>{asn.daily_limit}/dia</span>
              </div>
              <input
                type="number" min={0} max={asn.daily_limit} style={{ ...INPUT, width: 80, textAlign: 'center' }}
                value={asn.planned_count}
                onChange={e => updatePlanned(asn.instance_id, Number(e.target.value))}
              />
            </div>
          ))}

          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Coluna do Telefone</label>
              <select style={{ ...INPUT, maxWidth: 220 }} value={phoneCol} onChange={e => setPhoneCol(e.target.value)}>
                {csvColumns.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, alignSelf: 'flex-end' }}>
              <button style={BTN('#334155')} onClick={() => setStep('upload')}>← Voltar</button>
              <button style={BTN('#6366f1')} onClick={() => setStep('template')}>Próximo →</button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3 — Template / Mensagem */}
      {step === 'template' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>
            Escreva a mensagem. Use <code style={{ color: '#00ff88', background: '#0d2010', padding: '1px 4px', borderRadius: 4 }}>{'{{coluna}}'}</code> para inserir variáveis do CSV.
          </p>

          {csvColumns.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {csvColumns.map(c => (
                <button key={c} style={{
                  background: '#0d2010', border: '1px solid #1e3a2a', color: '#00ff88',
                  borderRadius: 4, padding: '3px 8px', fontSize: 11, cursor: 'pointer',
                }} onClick={() => setMsgTpl(prev => prev + `{{${c}}}`)}>{`{{${c}}}`}</button>
              ))}
            </div>
          )}

          <div>
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Mensagem</label>
            <textarea
              style={{ ...INPUT, height: 120, resize: 'vertical', fontFamily: 'inherit' }}
              placeholder={'Olá {{nome}}, temos uma proposta para você!\nValor disponível: R$ {{valor}}'}
              value={msgTpl}
              onChange={e => setMsgTpl(e.target.value)}
            />
          </div>

          {msgTpl && (
            <div style={{ background: '#0a0a18', border: '1px solid #1e1e3a', borderRadius: 8, padding: 12 }}>
              <div style={{ color: '#64748b', fontSize: 11, marginBottom: 6, fontWeight: 700 }}>PRÉVIA</div>
              <div style={{ color: '#e2e8f0', fontSize: 13, whiteSpace: 'pre-wrap' }}>{previewMessage()}</div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Nome da Campanha</label>
              <input style={INPUT} placeholder={file?.name?.replace('.csv', '') || 'Campanha Junho'} value={campaignName} onChange={e => setCampaignName(e.target.value)} />
            </div>
            <div>
              <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Cooldown entre envios (seg)</label>
              <input style={INPUT} type="number" min={1} max={60} value={cooldown} onChange={e => setCooldown(Number(e.target.value))} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button style={BTN('#334155')} onClick={() => setStep('assign')}>← Voltar</button>
            <button style={BTN('#6366f1', !msgTpl.trim())} disabled={!msgTpl.trim()} onClick={() => setStep('confirm')}>Próximo →</button>
          </div>
        </div>
      )}

      {/* Step 4 — Confirm */}
      {step === 'confirm' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: '#0a0a18', border: '1px solid #1e1e3a', borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ color: '#64748b', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Resumo do Disparo</div>
            <div style={{ color: '#e2e8f0', fontSize: 13 }}><strong>Campanha:</strong> {campaignName || file?.name}</div>
            <div style={{ color: '#e2e8f0', fontSize: 13 }}><strong>Total de leads:</strong> {totalLeads}</div>
            <div style={{ color: '#e2e8f0', fontSize: 13 }}><strong>Coluna telefone:</strong> {phoneCol}</div>
            <div style={{ color: '#e2e8f0', fontSize: 13 }}><strong>Cooldown:</strong> {cooldown}s entre envios</div>
            <div style={{ marginTop: 8 }}>
              <div style={{ color: '#64748b', fontSize: 11, fontWeight: 700, marginBottom: 4 }}>INSTÂNCIAS</div>
              {assignments.filter(a => a.planned_count > 0).map(a => (
                <div key={a.instance_id} style={{ color: '#94a3b8', fontSize: 12 }}>
                  {a.name} ({a.display_phone}) — <strong style={{ color: '#e2e8f0' }}>{a.planned_count} leads</strong>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8 }}>
              <div style={{ color: '#64748b', fontSize: 11, fontWeight: 700, marginBottom: 4 }}>MENSAGEM</div>
              <div style={{ color: '#94a3b8', fontSize: 12, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{msgTpl}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button style={BTN('#334155')} onClick={() => setStep('template')}>← Voltar</button>
            <button style={BTN('#22c55e', sending)} disabled={sending} onClick={confirm}>
              {sending ? 'Iniciando...' : '🚀 Confirmar e Disparar'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Monitor Panel ─────────────────────────────────────────────────────────────

function MonitorPanel() {
  const [snapshot, setSnapshot] = useState<{ instances: any[]; active_dispatches: any[] } | null>(null);

  useEffect(() => {
    const load = () => aesirApi.getSnapshot().then(setSnapshot).catch(() => {});
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);

  if (!snapshot || !snapshot.active_dispatches.length) {
    return <div style={{ color: '#64748b', fontSize: 13 }}>Nenhum disparo ativo no momento.</div>;
  }

  const STATUS_COLOR: Record<string, string> = { running: '#f59e0b', paused: '#6366f1', done: '#22c55e', cancelled: '#ef4444', error: '#f87171' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {snapshot.active_dispatches.map(d => {
        const asns: any[] = d.assignments_json || [];
        const totalSent = asns.reduce((s, a) => s + (a.sent || 0), 0);
        const totalPlanned = asns.reduce((s, a) => s + (a.planned || 0), 0);
        const pct = totalPlanned > 0 ? Math.round(totalSent * 100 / totalPlanned) : 0;
        return (
          <div key={d.id} style={{ background: '#0a0a18', border: '1px solid #1e1e3a', borderRadius: 8, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 700 }}>{d.campaign_name || d.id.slice(0, 8)}</span>
              <span style={{ color: STATUS_COLOR[d.status] || '#94a3b8', fontSize: 12, fontWeight: 700 }}>{d.status}</span>
            </div>
            <div style={{ background: '#1e1e3a', borderRadius: 4, height: 6, marginBottom: 8 }}>
              <div style={{ background: '#22c55e', height: 6, borderRadius: 4, width: `${pct}%`, transition: 'width 0.5s' }} />
            </div>
            <div style={{ color: '#64748b', fontSize: 11 }}>{totalSent}/{totalPlanned} enviados ({pct}%)</div>
            {asns.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {asns.map((a: any) => {
                  const apct = (a.planned || 0) > 0 ? Math.round((a.sent || 0) * 100 / a.planned) : 0;
                  return (
                    <div key={a.instance_id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: '#64748b', fontSize: 11, width: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.instance_id}</span>
                      <div style={{ flex: 1, background: '#1e1e3a', borderRadius: 3, height: 4 }}>
                        <div style={{ background: STATUS_COLOR[a.status] || '#6366f1', height: 4, borderRadius: 3, width: `${apct}%` }} />
                      </div>
                      <span style={{ color: '#94a3b8', fontSize: 11 }}>{a.sent || 0}/{a.planned || 0}</span>
                      <span style={{ color: STATUS_COLOR[a.status] || '#64748b', fontSize: 10 }}>{a.status}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Campaign History ──────────────────────────────────────────────────────────

function CampaignHistoryList({ onRefresh }: { onRefresh: () => void }) {
  const [dispatches, setDispatches] = useState<any[]>([]);
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  const load = () => aesirApi.listDispatches().then(setDispatches).catch(() => {});
  useEffect(() => { load(); }, []);

  const pause = async (id: string) => {
    setLoading(p => ({ ...p, [id]: true }));
    try { await aesirApi.pauseDispatch(id); load(); onRefresh(); } catch { }
    finally { setLoading(p => ({ ...p, [id]: false })); }
  };
  const cancel = async (id: string) => {
    setLoading(p => ({ ...p, [id]: true }));
    try { await aesirApi.cancelDispatch(id); load(); onRefresh(); } catch { }
    finally { setLoading(p => ({ ...p, [id]: false })); }
  };

  if (!dispatches.length) return <div style={{ color: '#64748b', fontSize: 13 }}>Nenhum disparo ainda.</div>;

  const STATUS_COLOR: Record<string, string> = { running: '#f59e0b', done: '#22c55e', paused: '#6366f1', cancelled: '#ef4444', error: '#f87171' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {dispatches.map(d => {
        const asns: any[] = d.assignments_json || [];
        const totalSent = asns.length > 0 ? asns.reduce((s, a) => s + (a.sent || 0), 0) : (d.sent || 0);
        const totalErrors = asns.length > 0 ? asns.reduce((s, a) => s + (a.errors || 0), 0) : (d.errors || 0);
        const totalLeads = d.total_leads || d.total_contacts || 0;
        return (
          <div key={d.id} style={{
            background: '#0a0a18', border: '1px solid #1e1e3a', borderRadius: 8, padding: '10px 16px',
            display: 'grid', gridTemplateColumns: '1fr auto auto auto auto auto auto', gap: 12, alignItems: 'center',
          }}>
            <div>
              <div style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 600 }}>{d.campaign_name || d.csv_filename || d.id.slice(0, 8)}</div>
              <div style={{ color: '#64748b', fontSize: 11 }}>{new Date(d.created_at).toLocaleString('pt-BR')}</div>
            </div>
            <span style={{ color: STATUS_COLOR[d.status] ?? '#94a3b8', fontSize: 12, fontWeight: 700 }}>{d.status}</span>
            <span style={{ color: '#22c55e', fontSize: 12 }}>✓ {totalSent}</span>
            <span style={{ color: '#f87171', fontSize: 12 }}>✗ {totalErrors}</span>
            <span style={{ color: '#94a3b8', fontSize: 12 }}>/{totalLeads}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {d.status === 'running' && (
                <button style={{ ...BTN('#f59e0b', loading[d.id]), fontSize: 11, padding: '4px 10px' }}
                  disabled={loading[d.id]} onClick={() => pause(d.id)}>Pausar</button>
              )}
              {['running', 'paused'].includes(d.status) && (
                <button style={{ ...BTN('#ef4444', loading[d.id]), fontSize: 11, padding: '4px 10px' }}
                  disabled={loading[d.id]} onClick={() => cancel(d.id)}>Cancelar</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Analytics ─────────────────────────────────────────────────────────────────

function AnalyticsPanel() {
  const [data, setData] = useState<{ total_sent: number; total_errors: number; total_campaigns: number } | null>(null);
  useEffect(() => { aesirApi.getAnalytics().then(setData).catch(() => {}); }, []);
  if (!data) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
      {[
        { label: 'Total Enviados', value: data.total_sent, color: '#22c55e' },
        { label: 'Total Erros', value: data.total_errors, color: '#f87171' },
        { label: 'Campanhas', value: data.total_campaigns, color: '#6366f1' },
      ].map(({ label, value, color }) => (
        <div key={label} style={{ background: '#0a0a18', border: '1px solid #1e1e3a', borderRadius: 8, padding: 16, textAlign: 'center' }}>
          <div style={{ color, fontSize: 28, fontWeight: 700 }}>{value.toLocaleString('pt-BR')}</div>
          <div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>{label}</div>
        </div>
      ))}
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
      setRefreshMsg(res.meta_matched > 0
        ? `✅ ${res.instances.length} instâncias · ${res.meta_matched} cruzadas com Meta BM`
        : `✅ ${res.instances.length} instâncias (Meta BM: sem match)`);
    } catch (e: any) { setRefreshMsg('Erro: ' + (e?.response?.data?.detail || e?.message)); }
    finally { setRefreshingInst(false); }
  };

  useEffect(() => { loadInstances(); }, []);

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1200 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ color: '#e2e8f0', fontSize: 22, fontWeight: 700, margin: 0 }}>Disparo WhatsApp — Aesir ERP</h1>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {refreshMsg && <span style={{ color: refreshMsg.startsWith('Erro') ? '#f87171' : '#22c55e', fontSize: 12 }}>{refreshMsg}</span>}
          <button onClick={refreshNumbers} disabled={refreshingInst}
            style={{ background: '#0d0d1f', border: '1px solid #1e1e3a', color: '#94a3b8', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13 }}>
            {refreshingInst ? 'Sincronizando...' : '⟳ Refresh Números'}
          </button>
        </div>
      </div>

      {/* Credentials */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <CredentialsPanel onSaved={loadInstances} />
        <MetaPanel onSaved={() => {}} />
      </div>

      {/* Monitor */}
      <div style={CARD}>
        <h2 style={H2('#00ff88')}>Monitoramento</h2>
        <MonitorPanel />
      </div>

      {/* History */}
      <div style={CARD}>
        <h2 style={H2('#6366f1')}>Histórico de Disparos</h2>
        <CampaignHistoryList onRefresh={loadInstances} />
      </div>

      {/* Wizard */}
      <div style={CARD}>
        <h2 style={H2('#6366f1')}>Novo Disparo</h2>
        <CsvUploadWizard onDispatched={loadInstances} />
      </div>

      {/* Quality grid */}
      <div style={CARD}>
        <h2 style={H2('#6366f1')}>Qualidade dos Números</h2>
        <NumberQualityGrid instances={instances} onTogglePause={togglePause} />
      </div>

      {/* Analytics */}
      <div style={CARD}>
        <h2 style={H2('#6366f1')}>Métricas</h2>
        <AnalyticsPanel />
      </div>
    </div>
  );
}
