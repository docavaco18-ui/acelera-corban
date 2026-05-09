import { useCallback, useState, DragEvent, ChangeEvent } from 'react';
import { broadcastApi } from '../../lib/api';

type WizardState = 'idle' | 'uploading' | 'analyzing' | 'confirming' | 'dispatching';

interface SplitAssignment {
  phone_id: string;
  planned_count: number;
  reason: string;
  inbox_id?: string;
  template_id?: string;
}

interface AnalyzeResult {
  dispatch_id: string;
  total_leads: number;
  split: {
    assignments: SplitAssignment[];
    justification: string;
    risks: string;
  };
}

interface Props {
  onDispatched?: () => void;
}

export function CsvUploadWizard({ onDispatched }: Props) {
  const [state, setState] = useState<WizardState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResult | null>(null);
  const [editableAssignments, setEditableAssignments] = useState<SplitAssignment[]>([]);

  const uploadAndAnalyze = useCallback(async (file: File) => {
    setError(null);
    setState('uploading');
    try {
      setState('analyzing');
      const resp = await broadcastApi.analyzeCSV(file);
      const result: AnalyzeResult = resp.data;
      setAnalyzeResult(result);
      setEditableAssignments(result.split.assignments.map(a => ({ ...a })));
      setState('confirming');
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Erro ao analisar CSV');
      setState('idle');
    }
  }, []);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file?.name.endsWith('.csv')) {
      setError('Apenas arquivos .csv são aceitos');
      return;
    }
    uploadAndAnalyze(file);
  }, [uploadAndAnalyze]);

  const handleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadAndAnalyze(file);
  };

  const handleDispatch = async () => {
    if (!analyzeResult) return;
    setState('dispatching');
    setError(null);
    try {
      await broadcastApi.confirmDispatch({
        dispatch_id: analyzeResult.dispatch_id,
        assignments: editableAssignments,
      });
      onDispatched?.();
      setState('idle');
      setAnalyzeResult(null);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Erro ao disparar');
      setState('confirming');
    }
  };

  const updateCount = (phoneId: string, value: number) => {
    setEditableAssignments(prev =>
      prev.map(a => a.phone_id === phoneId ? { ...a, planned_count: value } : a)
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {state === 'idle' && (
        <div
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          style={{
            border: '2px dashed #1e1e3a',
            borderRadius: 12,
            padding: 40,
            textAlign: 'center',
            cursor: 'pointer',
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
          <div style={{ color: '#94a3b8', fontSize: 14, marginBottom: 12 }}>
            Arraste um CSV aqui ou clique para selecionar
          </div>
          <label style={{
            background: '#6366f1', color: '#fff', borderRadius: 8,
            padding: '8px 20px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
          }}>
            Selecionar arquivo
            <input type="file" accept=".csv" onChange={handleFileInput} style={{ display: 'none' }} />
          </label>
        </div>
      )}

      {(state === 'uploading' || state === 'analyzing') && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚡</div>
          <div style={{ color: '#6366f1', fontSize: 15, fontWeight: 600 }}>
            {state === 'uploading' ? 'Enviando CSV...' : 'Claude está analisando o disparo...'}
          </div>
        </div>
      )}

      {state === 'confirming' && analyzeResult && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{
            background: '#6366f111', border: '1px solid #6366f133',
            borderRadius: 10, padding: 14,
          }}>
            <div style={{ color: '#6366f1', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
              JUSTIFICATIVA CLAUDE
            </div>
            <div style={{ color: '#94a3b8', fontSize: 13 }}>
              {analyzeResult.split.justification}
            </div>
            {analyzeResult.split.risks && (
              <div style={{ color: '#ffd700', fontSize: 12, marginTop: 8 }}>
                ⚠ {analyzeResult.split.risks}
              </div>
            )}
          </div>

          <div style={{ color: '#94a3b8', fontSize: 13 }}>
            Total de leads: <strong style={{ color: '#e2e8f0' }}>{analyzeResult.total_leads}</strong>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e1e3a' }}>
                <th style={{ textAlign: 'left', color: '#475569', padding: '6px 8px' }}>Número</th>
                <th style={{ textAlign: 'left', color: '#475569', padding: '6px 8px' }}>Leads</th>
                <th style={{ textAlign: 'left', color: '#475569', padding: '6px 8px' }}>Motivo</th>
                <th style={{ textAlign: 'left', color: '#475569', padding: '6px 8px' }}>Inbox ID</th>
                <th style={{ textAlign: 'left', color: '#475569', padding: '6px 8px' }}>Template ID</th>
              </tr>
            </thead>
            <tbody>
              {editableAssignments.map(a => (
                <tr key={a.phone_id} style={{ borderBottom: '1px solid #1e1e3a11' }}>
                  <td style={{ color: '#e2e8f0', padding: '6px 8px' }}>{a.phone_id.slice(-10)}</td>
                  <td style={{ padding: '6px 8px' }}>
                    <input
                      type="number"
                      value={a.planned_count}
                      onChange={e => updateCount(a.phone_id, Number(e.target.value))}
                      style={{
                        background: '#080818', border: '1px solid #1e1e3a',
                        borderRadius: 6, padding: '4px 8px', color: '#e2e8f0',
                        width: 80, fontSize: 13,
                      }}
                    />
                  </td>
                  <td style={{ color: '#475569', padding: '6px 8px', fontSize: 12 }}>
                    {a.reason}
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <input
                      type="text"
                      value={a.inbox_id ?? ''}
                      onChange={e => setEditableAssignments(prev =>
                        prev.map(x => x.phone_id === a.phone_id ? { ...x, inbox_id: e.target.value } : x)
                      )}
                      placeholder="inbox_id"
                      style={{
                        background: '#080818', border: '1px solid #1e1e3a',
                        borderRadius: 6, padding: '4px 8px', color: '#e2e8f0',
                        width: 100, fontSize: 12,
                      }}
                    />
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <input
                      type="text"
                      value={a.template_id ?? ''}
                      onChange={e => setEditableAssignments(prev =>
                        prev.map(x => x.phone_id === a.phone_id ? { ...x, template_id: e.target.value } : x)
                      )}
                      placeholder="template_id"
                      style={{
                        background: '#080818', border: '1px solid #1e1e3a',
                        borderRadius: 6, padding: '4px 8px', color: '#e2e8f0',
                        width: 120, fontSize: 12,
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={handleDispatch}
              style={{
                background: '#00ff88', color: '#080818', border: 'none',
                borderRadius: 8, padding: '10px 24px', cursor: 'pointer',
                fontWeight: 700, fontSize: 14,
              }}
            >
              Confirmar e Disparar
            </button>
            <button
              onClick={() => { setState('idle'); setAnalyzeResult(null); }}
              style={{
                background: 'transparent', color: '#475569', border: '1px solid #1e1e3a',
                borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontSize: 14,
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {state === 'dispatching' && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🚀</div>
          <div style={{ color: '#00ff88', fontSize: 15, fontWeight: 600 }}>
            Enviando para VendeAI...
          </div>
        </div>
      )}

      {error && (
        <div style={{
          background: '#ff2d7811', border: '1px solid #ff2d7844',
          borderRadius: 8, padding: '10px 14px', color: '#ff2d78', fontSize: 13,
        }}>
          {error}
        </div>
      )}
    </div>
  );
}
