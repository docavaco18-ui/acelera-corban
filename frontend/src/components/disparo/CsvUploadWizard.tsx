import { useCallback, useEffect, useState, DragEvent, ChangeEvent } from 'react';
import { broadcastApi } from '../../lib/api';

type WizardState = 'idle' | 'uploading' | 'analyzing' | 'confirming' | 'dispatching';

interface SplitAssignment {
  phone_id: string;
  planned_count: number;
  reason: string;
  display_phone?: string;
  inbox_id?: string;
  template_id?: string;
  can_send?: string;
  waba_id?: string;
  variable_mappings?: Record<string, string>;
}

interface AnalyzeResult {
  dispatch_id: string;
  total_leads: number;
  csv_columns: string[];
  split: {
    assignments: SplitAssignment[];
    justification: string;
    risks: string;
  };
}

interface Template {
  id: string;
  name: string;
  language?: string;
  category?: string;
  variables?: string[];
  body?: string;
}

type TemplatesMap = Record<string, Template[]>;

interface DispatchConfig {
  phone_column: string;
  campaign_name: string;
  cooldown_seconds: number;
  skip_weekends: boolean;
  skip_night: boolean;
  dedup_window_hours: number;
}

interface Props {
  onDispatched?: () => void;
}

export function CsvUploadWizard({ onDispatched }: Props) {
  const [state, setState] = useState<WizardState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResult | null>(null);
  const [editableAssignments, setEditableAssignments] = useState<SplitAssignment[]>([]);
  const [allowPartial, setAllowPartial] = useState(false);
  const [templatesMap, setTemplatesMap] = useState<TemplatesMap>({});
  const [config, setConfig] = useState<DispatchConfig>({
    phone_column: 'telefone',
    campaign_name: '',
    cooldown_seconds: 5,
    skip_weekends: true,
    skip_night: true,
    dedup_window_hours: 24,
  });

  useEffect(() => {
    broadcastApi.getTemplates()
      .then(r => setTemplatesMap(r.data || {}))
      .catch(() => {});
  }, []);

  const getTemplatesForNumber = (wabaId?: string): Template[] =>
    wabaId ? (templatesMap[wabaId] || []) : [];

  const getSelectedTemplate = (a: SplitAssignment): Template | undefined =>
    getTemplatesForNumber(a.waba_id).find(t => t.id === a.template_id);

  const applyTemplateToAll = (templateName: string) => {
    setEditableAssignments(prev => prev.map(a => {
      const match = getTemplatesForNumber(a.waba_id).find(t => t.name === templateName);
      if (match) return { ...a, template_id: match.id, variable_mappings: {} };
      return a;
    }));
  };

  const uploadAndAnalyze = useCallback(async (file: File) => {
    setError(null);
    setState('uploading');
    try {
      setState('analyzing');
      const resp = await broadcastApi.analyzeCSV(file);
      const result: AnalyzeResult = resp.data;
      setAnalyzeResult(result);
      setEditableAssignments(result.split.assignments.map(a => ({
        ...a, template_id: '', variable_mappings: {},
      })));
      // Auto-detecta coluna de telefone pelo nome da coluna (case-insensitive).
      // Evita que o default "telefone" (minúsculo) fique ativo quando o CSV
      // tem "Telefone", "CELULAR", "phone", etc. — o mismatch fazia VendeAI
      // receber phone_column errada e não enviar nenhuma mensagem.
      const phoneKeywords = ['telefone', 'phone', 'celular', 'numero', 'tel', 'mobile', 'whatsapp'];
      const detectedPhone = result.csv_columns.find(col =>
        phoneKeywords.some(kw => col.toLowerCase().includes(kw))
      );
      if (detectedPhone) {
        setConfig(c => ({ ...c, phone_column: detectedPhone }));
      }
      setState('confirming');
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Erro ao analisar CSV');
      setState('idle');
    }
  }, []);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file?.name.endsWith('.csv')) { setError('Apenas arquivos .csv são aceitos'); return; }
    uploadAndAnalyze(file);
  }, [uploadAndAnalyze]);

  const handleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadAndAnalyze(file);
  };

  const handleDispatch = async () => {
    if (!analyzeResult) return;
    const missing = editableAssignments.filter(a => !a.inbox_id || !a.template_id);
    if (missing.length) {
      setError(`Preencha Inbox ID e Template para: ${missing.map(a => a.display_phone || a.phone_id).join(', ')}`);
      return;
    }
    // Check variable mappings completeness
    for (const a of editableAssignments) {
      const tpl = getSelectedTemplate(a);
      if (tpl?.variables?.length) {
        const missing_vars = tpl.variables.filter(v => !a.variable_mappings?.[v]);
        if (missing_vars.length) {
          setError(`Mapeie as variáveis {{${missing_vars.join('}}, {{{')}}} do template "${tpl.name}" para ${a.display_phone}`);
          return;
        }
      }
    }
    setState('dispatching');
    setError(null);
    try {
      await broadcastApi.confirmDispatch({ dispatch_id: analyzeResult.dispatch_id, assignments: editableAssignments, allow_partial: allowPartial, ...config });
      onDispatched?.();
      setState('idle');
      setAnalyzeResult(null);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Erro ao disparar');
      setState('confirming');
    }
  };

  const updateField = (phoneId: string, field: keyof SplitAssignment, value: any) =>
    setEditableAssignments(prev => prev.map(a => a.phone_id === phoneId ? { ...a, [field]: value } : a));

  const updateVarMapping = (phoneId: string, varKey: string, colValue: string) =>
    setEditableAssignments(prev => prev.map(a =>
      a.phone_id === phoneId
        ? { ...a, variable_mappings: { ...a.variable_mappings, [varKey]: colValue } }
        : a
    ));

  // Apply same column to varKey for ALL numbers that have that variable
  const applyVarToAll = (varKey: string, colValue: string) =>
    setEditableAssignments(prev => prev.map(a => {
      const tpl = getTemplatesForNumber(a.waba_id).find(t => t.id === a.template_id);
      if (tpl?.variables?.includes(varKey)) {
        return { ...a, variable_mappings: { ...a.variable_mappings, [varKey]: colValue } };
      }
      return a;
    }));

  // Render template body with {{N}} highlighted
  const renderTemplatePreview = (body: string) => {
    const parts = body.split(/(\{\{\d+\}\})/g);
    return parts.map((part, i) =>
      /^\{\{\d+\}\}$/.test(part)
        ? <mark key={i} style={{ background: '#ffd70033', color: '#ffd700', borderRadius: 3, padding: '0 3px' }}>{part}</mark>
        : <span key={i}>{part}</span>
    );
  };

  const canSendColor = (cs?: string) => {
    if (cs === 'AVAILABLE') return '#00ff88';
    if (cs === 'LIMITED') return '#ffd700';
    return '#475569';
  };

  const allTemplateNames = Array.from(
    new Set(Object.values(templatesMap).flat().map(t => t.name))
  ).sort();
  const hasTemplatesMap = Object.keys(templatesMap).length > 0;
  const csvCols = analyzeResult?.csv_columns || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {state === 'idle' && (
        <div
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          style={{ border: '2px dashed #1e1e3a', borderRadius: 12, padding: 40, textAlign: 'center', cursor: 'pointer' }}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
          <div style={{ color: '#94a3b8', fontSize: 14, marginBottom: 12 }}>
            Arraste um CSV aqui ou clique para selecionar
          </div>
          <label style={{ background: '#6366f1', color: '#fff', borderRadius: 8, padding: '8px 20px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            Selecionar arquivo
            <input type="file" accept=".csv" onChange={handleFileInput} style={{ display: 'none' }} />
          </label>
        </div>
      )}

      {(state === 'uploading' || state === 'analyzing') && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚡</div>
          <div style={{ color: '#6366f1', fontSize: 15, fontWeight: 600 }}>
            {state === 'uploading' ? 'Enviando CSV...' : 'Calculando distribuição...'}
          </div>
        </div>
      )}

      {state === 'confirming' && analyzeResult && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div style={{ background: '#6366f111', border: '1px solid #6366f133', borderRadius: 10, padding: 14 }}>
            <div style={{ color: '#6366f1', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>DISTRIBUIÇÃO</div>
            <div style={{ color: '#94a3b8', fontSize: 13 }}>{analyzeResult.split.justification}</div>
            {analyzeResult.split.risks && analyzeResult.split.risks !== 'Nenhum risco identificado.' && (
              <div style={{ color: '#ffd700', fontSize: 12, marginTop: 8 }}>⚠ {analyzeResult.split.risks}</div>
            )}
          </div>

          <div style={{ color: '#94a3b8', fontSize: 13 }}>
            Total: <strong style={{ color: '#e2e8f0' }}>{analyzeResult.total_leads.toLocaleString('pt-BR')}</strong> leads
            {csvCols.length > 0 && (
              <span style={{ marginLeft: 12, color: '#475569' }}>
                Colunas: {csvCols.map(c => <code key={c} style={{ background: '#1e1e3a', padding: '1px 5px', borderRadius: 4, marginLeft: 4, fontSize: 11 }}>{c}</code>)}
              </span>
            )}
          </div>

          {/* ── Configurações do disparo ── */}
          <div style={{ background: '#080818', border: '1px solid #1e1e3a', borderRadius: 10, padding: 16 }}>
            <div style={{ color: '#6366f1', fontSize: 12, fontWeight: 700, marginBottom: 12 }}>CONFIGURAÇÕES DO DISPARO</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>

              {/* Nome da campanha */}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ color: '#475569', fontSize: 11 }}>Nome da campanha</span>
                <input
                  type="text"
                  value={config.campaign_name}
                  onChange={e => setConfig(c => ({ ...c, campaign_name: e.target.value }))}
                  placeholder="ex: CLT Maio 2026"
                  style={{ background: '#0d0d1f', border: '1px solid #1e1e3a', borderRadius: 6, padding: '6px 10px', color: '#e2e8f0', fontSize: 13 }}
                />
              </label>

              {/* Coluna do telefone */}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ color: '#475569', fontSize: 11 }}>Coluna do telefone</span>
                {csvCols.length > 0 ? (
                  <select
                    value={config.phone_column}
                    onChange={e => setConfig(c => ({ ...c, phone_column: e.target.value }))}
                    style={{ background: '#0d0d1f', border: '1px solid #1e1e3a', borderRadius: 6, padding: '6px 10px', color: '#e2e8f0', fontSize: 13, cursor: 'pointer' }}
                  >
                    {csvCols.map(col => <option key={col} value={col}>{col}</option>)}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={config.phone_column}
                    onChange={e => setConfig(c => ({ ...c, phone_column: e.target.value }))}
                    style={{ background: '#0d0d1f', border: '1px solid #1e1e3a', borderRadius: 6, padding: '6px 10px', color: '#e2e8f0', fontSize: 13 }}
                  />
                )}
              </label>

              {/* Intervalo entre msgs */}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ color: '#475569', fontSize: 11 }}>Intervalo entre mensagens (seg)</span>
                <input
                  type="number"
                  min={1}
                  max={300}
                  value={config.cooldown_seconds}
                  onChange={e => setConfig(c => ({ ...c, cooldown_seconds: Number(e.target.value) }))}
                  style={{ background: '#0d0d1f', border: '1px solid #1e1e3a', borderRadius: 6, padding: '6px 10px', color: '#e2e8f0', fontSize: 13 }}
                />
              </label>

              {/* Janela dedup */}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ color: '#475569', fontSize: 11 }}>Deduplicação (horas)</span>
                <input
                  type="number"
                  min={0}
                  max={720}
                  value={config.dedup_window_hours}
                  onChange={e => setConfig(c => ({ ...c, dedup_window_hours: Number(e.target.value) }))}
                  style={{ background: '#0d0d1f', border: '1px solid #1e1e3a', borderRadius: 6, padding: '6px 10px', color: '#e2e8f0', fontSize: 13 }}
                />
              </label>

              {/* Toggles */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'flex-end' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={config.skip_weekends}
                    onChange={e => setConfig(c => ({ ...c, skip_weekends: e.target.checked }))}
                    style={{ accentColor: '#6366f1', width: 15, height: 15 }}
                  />
                  <span style={{ color: '#94a3b8', fontSize: 13 }}>Pular fins de semana</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={config.skip_night}
                    onChange={e => setConfig(c => ({ ...c, skip_night: e.target.checked }))}
                    style={{ accentColor: '#6366f1', width: 15, height: 15 }}
                  />
                  <span style={{ color: '#94a3b8', fontSize: 13 }}>Pular horário noturno</span>
                </label>
              </div>

            </div>
          </div>

          {/* Apply to all */}
          {hasTemplatesMap && allTemplateNames.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#1e1e3a44', borderRadius: 8, border: '1px solid #1e1e3a' }}>
              <span style={{ color: '#475569', fontSize: 13, whiteSpace: 'nowrap' }}>Aplicar para todos:</span>
              <select
                defaultValue=""
                onChange={e => { const n = e.target.value; if (n) applyTemplateToAll(n); e.target.value = ''; }}
                style={{ background: '#080818', border: '1px solid #6366f144', borderRadius: 6, padding: '6px 10px', color: '#e2e8f0', fontSize: 13, cursor: 'pointer', flex: 1 }}
              >
                <option value="">— escolha template para aplicar em todos —</option>
                {allTemplateNames.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
              <span style={{ color: '#475569', fontSize: 11, whiteSpace: 'nowrap' }}>(só onde disponível)</span>
            </div>
          )}

          {/* Per-number rows */}
          {editableAssignments.map(a => {
            const tpls = getTemplatesForNumber(a.waba_id);
            const selectedTpl = getSelectedTemplate(a);
            const vars = selectedTpl?.variables || [];
            return (
              <div key={a.phone_id} style={{ background: '#0d0d1f', border: '1px solid #1e1e3a', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Row header */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 160 }}>
                    <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 14 }}>{a.display_phone || a.phone_id.slice(-10)}</div>
                    <div style={{ fontSize: 11, color: canSendColor(a.can_send), marginTop: 2 }}>{a.reason}</div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: '#475569', fontSize: 12 }}>Leads:</span>
                    <input
                      type="number"
                      value={a.planned_count}
                      onChange={e => updateField(a.phone_id, 'planned_count', Number(e.target.value))}
                      style={{ background: '#080818', border: '1px solid #1e1e3a', borderRadius: 6, padding: '4px 8px', color: '#e2e8f0', width: 72, fontSize: 13 }}
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: '#475569', fontSize: 12 }}>Template:</span>
                    {tpls.length > 0 ? (
                      <select
                        value={a.template_id ?? ''}
                        onChange={e => updateField(a.phone_id, 'template_id', e.target.value)}
                        style={{ background: '#080818', border: `1px solid ${a.template_id ? '#1e1e3a' : '#ff2d7866'}`, borderRadius: 6, padding: '4px 8px', color: '#e2e8f0', fontSize: 12, cursor: 'pointer', minWidth: 180 }}
                      >
                        <option value="">— selecionar —</option>
                        {tpls.map(t => (
                          <option key={t.id} value={t.id}>{t.name}{t.language ? ` (${t.language})` : ''}{t.variables?.length ? ` [${t.variables.length} var]` : ''}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={a.template_id ?? ''}
                        onChange={e => updateField(a.phone_id, 'template_id', e.target.value)}
                        placeholder="template_id"
                        style={{ background: '#080818', border: `1px solid ${a.template_id ? '#1e1e3a' : '#ff2d7866'}`, borderRadius: 6, padding: '4px 8px', color: '#e2e8f0', width: 130, fontSize: 12 }}
                      />
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: '#475569', fontSize: 12 }}>Inbox ID:</span>
                    <input
                      type="text"
                      value={a.inbox_id ?? ''}
                      onChange={e => updateField(a.phone_id, 'inbox_id', e.target.value)}
                      placeholder="inbox_id"
                      style={{ background: '#080818', border: `1px solid ${a.inbox_id ? '#1e1e3a' : '#ff2d7866'}`, borderRadius: 6, padding: '4px 8px', color: '#e2e8f0', width: 90, fontSize: 12 }}
                    />
                  </div>
                </div>

                {/* Template preview */}
                {selectedTpl?.body && (
                  <div style={{ paddingTop: 6, borderTop: '1px solid #1e1e3a' }}>
                    <div style={{ color: '#475569', fontSize: 10, fontWeight: 700, marginBottom: 4 }}>PRÉVIA DO TEMPLATE</div>
                    <div style={{ background: '#1e1e3a55', borderRadius: 6, padding: '8px 12px', color: '#94a3b8', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                      {renderTemplatePreview(selectedTpl.body)}
                    </div>
                  </div>
                )}

                {/* Variable mappings */}
                {vars.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 6, borderTop: '1px solid #1e1e3a' }}>
                    <span style={{ color: '#6366f1', fontSize: 11, fontWeight: 700 }}>VARIÁVEIS</span>
                    {vars.map(v => (
                      <div key={v} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <code style={{ color: '#ffd700', fontSize: 11, background: '#ffd70011', padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap' }}>{`{{${v}}}`}</code>
                        <span style={{ color: '#475569', fontSize: 11 }}>→</span>
                        {csvCols.length > 0 ? (
                          <select
                            value={a.variable_mappings?.[v] || ''}
                            onChange={e => updateVarMapping(a.phone_id, v, e.target.value)}
                            style={{ background: '#080818', border: `1px solid ${a.variable_mappings?.[v] ? '#6366f144' : '#ff2d7866'}`, borderRadius: 6, padding: '3px 8px', color: '#e2e8f0', fontSize: 12, cursor: 'pointer' }}
                          >
                            <option value="">— coluna CSV —</option>
                            {csvCols.map(col => <option key={col} value={col}>{col}</option>)}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={a.variable_mappings?.[v] || ''}
                            onChange={e => updateVarMapping(a.phone_id, v, e.target.value)}
                            placeholder="nome da coluna"
                            style={{ background: '#080818', border: `1px solid ${a.variable_mappings?.[v] ? '#6366f144' : '#ff2d7866'}`, borderRadius: 6, padding: '3px 8px', color: '#e2e8f0', width: 130, fontSize: 12 }}
                          />
                        )}
                        {/* Apply this var mapping to all numbers */}
                        {a.variable_mappings?.[v] && (
                          <button
                            onClick={() => applyVarToAll(v, a.variable_mappings![v])}
                            title="Aplicar esta coluna para todos os números"
                            style={{ background: '#6366f122', border: '1px solid #6366f144', color: '#6366f1', borderRadius: 5, padding: '2px 8px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}
                          >
                            ↗ Todos
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* ── Assignment count vs total — blocks confirm if partial without explicit OK ── */}
          {(() => {
            const totalLeads = analyzeResult.total_leads;
            const assignedSum = editableAssignments.reduce((s, a) => s + (Number(a.planned_count) || 0), 0);
            const diff = totalLeads - assignedSum;
            const isExact = diff === 0;
            const canConfirm = isExact || (diff > 0 && allowPartial);
            return (
              <>
                {!isExact && (
                  <div style={{
                    background: diff > 0 ? '#ffd70015' : '#ff2d7815',
                    border: `1px solid ${diff > 0 ? '#ffd70055' : '#ff2d7855'}`,
                    borderRadius: 10, padding: 14,
                  }}>
                    <div style={{ color: diff > 0 ? '#ffd700' : '#ff2d78', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                      {diff > 0
                        ? `⚠ DISTRIBUIÇÃO PARCIAL — ${assignedSum.toLocaleString('pt-BR')} de ${totalLeads.toLocaleString('pt-BR')} leads atribuídos (${diff.toLocaleString('pt-BR')} sobrando)`
                        : `❌ EXCESSO DE LEADS — soma ${assignedSum.toLocaleString('pt-BR')} maior que total ${totalLeads.toLocaleString('pt-BR')}. Reduza distribuição.`}
                    </div>
                    {diff > 0 && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 4 }}>
                        <input
                          type="checkbox"
                          checked={allowPartial}
                          onChange={e => setAllowPartial(e.target.checked)}
                          style={{ accentColor: '#ffd700', width: 15, height: 15 }}
                        />
                        <span style={{ color: '#e2e8f0', fontSize: 12 }}>
                          Eu entendo: disparar apenas {assignedSum.toLocaleString('pt-BR')} leads, descartar {diff.toLocaleString('pt-BR')} restantes.
                        </span>
                      </label>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    onClick={handleDispatch}
                    disabled={!canConfirm}
                    style={{
                      background: canConfirm ? '#00ff88' : '#1e1e3a',
                      color: canConfirm ? '#080818' : '#475569',
                      border: 'none', borderRadius: 8, padding: '10px 24px',
                      cursor: canConfirm ? 'pointer' : 'not-allowed',
                      fontWeight: 700, fontSize: 14,
                    }}
                  >
                    Confirmar e Disparar
                  </button>
                  <button
                    onClick={() => { setState('idle'); setAnalyzeResult(null); setError(null); setAllowPartial(false); }}
                    style={{ background: 'transparent', color: '#475569', border: '1px solid #1e1e3a', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontSize: 14 }}
                  >
                    Cancelar
                  </button>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {state === 'dispatching' && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🚀</div>
          <div style={{ color: '#00ff88', fontSize: 15, fontWeight: 600 }}>Enviando para VendeAI...</div>
        </div>
      )}

      {error && (
        <div style={{ background: '#ff2d7811', border: '1px solid #ff2d7844', borderRadius: 8, padding: '10px 14px', color: '#ff2d78', fontSize: 13 }}>
          {error}
        </div>
      )}
    </div>
  );
}
