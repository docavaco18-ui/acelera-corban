import { useEffect, useRef, useState } from 'react';
import { aesirApi } from '../lib/api';

const CARD = {
  background: '#0d0d1f',
  border: '1px solid #1e1e3a',
  borderRadius: 12,
  padding: 24,
} as const;

const H2 = (color: string) => ({
  color,
  fontSize: 15,
  fontWeight: 700,
  marginBottom: 16,
  marginTop: 0,
});

const INPUT_STYLE = {
  width: '100%',
  background: '#0d0d1f',
  border: '1px solid #334155',
  color: '#e2e8f0',
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 13,
  boxSizing: 'border-box' as const,
};

const BTN = (bg: string, disabled = false) => ({
  background: disabled ? '#334155' : bg,
  color: disabled ? '#64748b' : '#fff',
  border: 'none',
  borderRadius: 8,
  padding: '8px 16px',
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontSize: 13,
  fontWeight: 600,
});

const QUALITY_COLOR: Record<string, string> = {
  GREEN: '#22c55e',
  YELLOW: '#f59e0b',
  RED: '#ef4444',
  UNKNOWN: '#64748b',
};

function CredentialsPanel({ onSaved }: { onSaved: () => void }) {
  const [configured, setConfigured] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [accInput, setAccInput] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    aesirApi.getCredentials().then((d) => {
      setConfigured(d.configured);
      if (d.account_id) setAccountId(d.account_id);
    }).catch(() => {});
  }, []);

  const save = async () => {
    if (!tokenInput.trim() || !accInput.trim()) { setMsg('Preencha token e account_id'); return; }
    setSaving(true);
    try {
      await aesirApi.saveCredentials(tokenInput.trim(), accInput.trim());
      setConfigured(true);
      setAccountId(accInput.trim());
      setTokenInput('');
      setMsg('Credenciais salvas!');
      onSaved();
    } catch (e: any) {
      setMsg('Erro ao salvar: ' + (e?.response?.data?.detail || e?.message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={CARD}>
      <h2 style={H2('#00ff88')}>Credenciais Aesir ERP</h2>
      {configured && (
        <p style={{ color: '#22c55e', fontSize: 13, marginBottom: 12 }}>
          ✅ Configurado — Account ID: <strong>{accountId}</strong>
        </p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 480 }}>
        <div>
          <label style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4, display: 'block' }}>Account ID</label>
          <input style={INPUT_STYLE} placeholder="532" value={accInput} onChange={(e) => setAccInput(e.target.value)} />
        </div>
        <div>
          <label style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4, display: 'block' }}>API Token Aesir</label>
          <input style={INPUT_STYLE} type="password" placeholder="aesir_v1_..." value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button style={BTN('#6366f1', saving)} onClick={save} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
          {msg && <span style={{ color: msg.startsWith('Erro') ? '#f87171' : '#22c55e', fontSize: 12 }}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}

function MetaPanel({ onSaved }: { onSaved: () => void }) {
  const [metaConfigured, setMetaConfigured] = useState(false);
  const [wabaIds, setWabaIds] = useState<string[]>([]);
  const [tokenInput, setTokenInput] = useState('');
  const [wabaInput, setWabaInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    aesirApi.getCredentials().then((d) => {
      if (d.configured) {
        setMetaConfigured(d.meta_configured || false);
        setWabaIds(d.waba_ids || []);
        setWabaInput((d.waba_ids || []).join('\n'));
      }
    }).catch(() => {});
  }, []);

  const save = async () => {
    if (!tokenInput.trim()) { setMsg('Informe o Meta System User Token'); return; }
    const ids = wabaInput.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    if (!ids.length) { setMsg('Informe ao menos 1 WABA ID'); return; }
    setSaving(true);
    try {
      await aesirApi.saveMetaCredentials(tokenInput.trim(), ids);
      setMetaConfigured(true);
      setWabaIds(ids);
      setTokenInput('');
      setMsg('Meta configurado!');
      onSaved();
    } catch (e: any) {
      setMsg('Erro: ' + (e?.response?.data?.detail || e?.message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={CARD}>
      <h2 style={H2('#1d9bf0')}>Meta Business Manager</h2>
      {metaConfigured && (
        <p style={{ color: '#22c55e', fontSize: 13, marginBottom: 12 }}>
          ✅ Meta configurado — {wabaIds.length} WABA(s)
        </p>
      )}
      <p style={{ color: '#64748b', fontSize: 12, marginBottom: 12 }}>
        Token permanente do System User da BM — mesmo token usado no Disparo VendeAI.
        WABA IDs: um por linha.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 480 }}>
        <div>
          <label style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4, display: 'block' }}>System User Token</label>
          <input
            style={INPUT_STYLE}
            type="password"
            placeholder="EAAOKxO1..."
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
          />
        </div>
        <div>
          <label style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4, display: 'block' }}>WABA IDs (um por linha)</label>
          <textarea
            style={{ ...INPUT_STYLE, height: 80, resize: 'vertical', fontFamily: 'monospace' }}
            placeholder={'123456789\n987654321'}
            value={wabaInput}
            onChange={(e) => setWabaInput(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button style={BTN('#1d9bf0', saving)} onClick={save} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar Meta'}
          </button>
          {msg && <span style={{ color: msg.startsWith('Erro') ? '#f87171' : '#22c55e', fontSize: 12 }}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}

function QualityBadge({ rating }: { rating?: string }) {
  const r = rating || 'UNKNOWN';
  return (
    <span style={{
      background: QUALITY_COLOR[r] + '22',
      color: QUALITY_COLOR[r],
      border: `1px solid ${QUALITY_COLOR[r]}55`,
      borderRadius: 4,
      padding: '2px 8px',
      fontSize: 11,
      fontWeight: 700,
    }}>
      {r}
    </span>
  );
}

function CanSendBadge({ canSend }: { canSend?: string }) {
  const ok = canSend === 'ENABLED';
  return (
    <span style={{
      color: ok ? '#22c55e' : '#f87171',
      fontSize: 11,
      fontWeight: 600,
    }}>
      {ok ? '✓ Pode enviar' : '✗ Bloqueado'}
    </span>
  );
}

function InstancesPanel({ instances, onRefresh }: { instances: any[]; onRefresh: () => void }) {
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState('');

  const toggle = async (iid: string, paused: boolean) => {
    setLoading((p) => ({ ...p, [iid]: true }));
    setErr('');
    try {
      if (paused) await aesirApi.resumeInstance(iid);
      else await aesirApi.pauseInstance(iid);
      onRefresh();
    } catch (e: any) {
      setErr('Erro: ' + (e?.response?.data?.detail || e?.message || 'falha'));
    } finally { setLoading((p) => ({ ...p, [iid]: false })); }
  };

  if (!instances.length) {
    return (
      <div style={{ color: '#94a3b8', fontSize: 13 }}>
        Nenhuma instância. Clique em "Refresh Números" para sincronizar com Aesir ERP e Meta BM.
      </div>
    );
  }

  const errEl = err ? <div style={{ color: '#f87171', fontSize: 12, marginBottom: 8 }}>{err}</div> : null;
  const hasQuality = instances.some(i => i.quality_rating && i.quality_rating !== 'UNKNOWN');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {errEl}
      {/* Header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: hasQuality ? '1fr 80px 100px 120px 90px 80px' : '1fr 80px 100px',
        gap: 12,
        padding: '4px 16px',
        color: '#64748b',
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase' as const,
      }}>
        <span>Nome / Telefone</span>
        <span>Status</span>
        <span>Tier</span>
        {hasQuality && <><span>Qualidade</span><span>Envio</span></>}
        <span></span>
      </div>
      {instances.map((inst) => {
        const paused = !!inst.is_paused;
        const statusColor = inst.status === 'open' || inst.status === 'CONNECTED' ? '#22c55e' : '#f87171';
        return (
          <div key={inst.instance_id} style={{
            display: 'grid',
            gridTemplateColumns: hasQuality ? '1fr 80px 100px 120px 90px 80px' : '1fr 80px 100px',
            gap: 12,
            alignItems: 'center',
            background: '#0a0a18',
            border: '1px solid #1e1e3a',
            borderRadius: 8,
            padding: '10px 16px',
          }}>
            <div>
              <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>
                {inst.name || inst.instance_id}
              </span>
              {(inst.display_phone || inst.phone) && (
                <span style={{ color: '#64748b', fontSize: 12, marginLeft: 8 }}>
                  {inst.display_phone || inst.phone}
                </span>
              )}
              {paused && <span style={{ color: '#f59e0b', fontSize: 11, marginLeft: 8 }}>PAUSADA</span>}
            </div>
            <span style={{ color: statusColor, fontSize: 12, fontWeight: 600 }}>{inst.status}</span>
            <span style={{ color: '#94a3b8', fontSize: 12 }}>{inst.messaging_tier || `${inst.daily_limit ?? 500}/dia`}</span>
            {hasQuality && (
              <>
                <QualityBadge rating={inst.quality_rating} />
                <CanSendBadge canSend={inst.can_send} />
              </>
            )}
            <button
              style={BTN(paused ? '#22c55e' : '#ef4444', loading[inst.instance_id])}
              disabled={loading[inst.instance_id]}
              onClick={() => toggle(inst.instance_id, paused)}
            >
              {paused ? 'Retomar' : 'Pausar'}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function DispatchForm({ instances, onDispatched }: { instances: any[]; onDispatched: () => void }) {
  const [instanceId, setInstanceId] = useState('');
  const [tpl, setTpl] = useState('');
  const [phoneCol, setPhoneCol] = useState('telefone');
  const [cooldown, setCooldown] = useState(5);
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const send = async () => {
    if (!file) { setMsg('Selecione um CSV'); return; }
    if (!instanceId) { setMsg('Selecione uma instância'); return; }
    if (!tpl.trim()) { setMsg('Informe a mensagem'); return; }
    setSending(true);
    setMsg('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('instance_id', instanceId);
      form.append('message_tpl', tpl);
      form.append('phone_column', phoneCol);
      form.append('cooldown_seconds', String(cooldown));
      const result = await aesirApi.startDispatch(form);
      setMsg(`Disparo iniciado! ID: ${result.dispatch_id}`);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      onDispatched();
    } catch (e: any) {
      setMsg('Erro: ' + (e?.response?.data?.detail || e?.message));
    } finally {
      setSending(false);
    }
  };

  const activeInstances = instances.filter((i) => !i.is_paused && i.can_send !== 'DISABLED');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560 }}>
      <div>
        <label style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4, display: 'block' }}>Instância WhatsApp</label>
        <select
          style={{ ...INPUT_STYLE }}
          value={instanceId}
          onChange={(e) => setInstanceId(e.target.value)}
        >
          <option value="">Selecione...</option>
          {activeInstances.map((i) => (
            <option key={i.instance_id} value={i.instance_id}>
              {i.name || i.instance_id} {i.display_phone || i.phone ? `(${i.display_phone || i.phone})` : ''} {i.quality_rating && i.quality_rating !== 'UNKNOWN' ? `— ${i.quality_rating}` : ''}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4, display: 'block' }}>
          Mensagem — use {'{{nome}}'}, {'{{cpf}}'}, etc. para variáveis do CSV
        </label>
        <textarea
          style={{ ...INPUT_STYLE, height: 100, resize: 'vertical', fontFamily: 'inherit' }}
          placeholder={'Olá {{nome}}, temos uma proposta para você!'}
          value={tpl}
          onChange={(e) => setTpl(e.target.value)}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4, display: 'block' }}>Coluna do Telefone</label>
          <input
            style={INPUT_STYLE}
            value={phoneCol}
            onChange={(e) => setPhoneCol(e.target.value)}
            placeholder="telefone"
          />
        </div>
        <div>
          <label style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4, display: 'block' }}>Cooldown entre envios (seg)</label>
          <input
            style={INPUT_STYLE}
            type="number"
            min={1}
            max={60}
            value={cooldown}
            onChange={(e) => setCooldown(Number(e.target.value))}
          />
        </div>
      </div>

      <div>
        <label style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4, display: 'block' }}>Arquivo CSV</label>
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          style={{ color: '#94a3b8', fontSize: 13 }}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        {file && <span style={{ color: '#22c55e', fontSize: 12, marginLeft: 8 }}>{file.name}</span>}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button style={BTN('#6366f1', sending)} onClick={send} disabled={sending}>
          {sending ? 'Enviando...' : '🚀 Iniciar Disparo'}
        </button>
        {msg && (
          <span style={{ color: msg.startsWith('Erro') ? '#f87171' : '#22c55e', fontSize: 12 }}>
            {msg}
          </span>
        )}
      </div>
    </div>
  );
}

function DispatchHistory({ dispatches, onRefresh }: { dispatches: any[]; onRefresh: () => void }) {
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState('');

  const action = async (id: string) => {
    setLoading((p) => ({ ...p, [id]: true }));
    setErr('');
    try {
      await aesirApi.cancelDispatch(id);
      onRefresh();
    } catch (e: any) {
      setErr('Erro: ' + (e?.response?.data?.detail || e?.message || 'falha'));
    } finally { setLoading((p) => ({ ...p, [id]: false })); }
  };

  if (!dispatches.length) {
    return <div style={{ color: '#64748b', fontSize: 13 }}>Nenhum disparo ainda.</div>;
  }

  const errEl = err ? <div style={{ color: '#f87171', fontSize: 12, marginBottom: 8 }}>{err}</div> : null;

  const statusColor: Record<string, string> = {
    running: '#f59e0b',
    done: '#22c55e',
    paused: '#6366f1',
    cancelled: '#ef4444',
    error: '#f87171',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {errEl}
      {dispatches.map((d) => (
        <div key={d.id} style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto auto auto auto auto',
          gap: 12,
          alignItems: 'center',
          background: '#0a0a18',
          border: '1px solid #1e1e3a',
          borderRadius: 8,
          padding: '10px 16px',
        }}>
          <div>
            <div style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 600 }}>
              {d.csv_filename || d.id.slice(0, 8)}
            </div>
            <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>
              {d.instance_id} · {new Date(d.created_at).toLocaleString('pt-BR')}
            </div>
          </div>
          <span style={{ color: statusColor[d.status] ?? '#94a3b8', fontSize: 12, fontWeight: 700 }}>
            {d.status}
          </span>
          <span style={{ color: '#22c55e', fontSize: 12 }}>✓ {d.sent}</span>
          <span style={{ color: '#f87171', fontSize: 12 }}>✗ {d.errors}</span>
          <span style={{ color: '#94a3b8', fontSize: 12 }}>/{d.total_contacts}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {d.status === 'running' && (
              <button
                style={{ ...BTN('#ef4444', loading[d.id]), fontSize: 11, padding: '4px 10px' }}
                disabled={loading[d.id]}
                onClick={() => action(d.id)}
              >
                Cancelar
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function DisparoAesir() {
  const [instances, setInstances] = useState<any[]>([]);
  const [dispatches, setDispatches] = useState<any[]>([]);
  const [refreshingInst, setRefreshingInst] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState('');

  const loadInstances = async () => {
    try {
      const data = await aesirApi.listInstances();
      setInstances(data || []);
    } catch { /* ignore */ }
  };

  const loadDispatches = async () => {
    try {
      const data = await aesirApi.listDispatches();
      setDispatches(data || []);
    } catch { /* ignore */ }
  };

  const refreshNumbers = async () => {
    setRefreshingInst(true);
    setRefreshMsg('');
    try {
      const result = await aesirApi.refreshNumbers();
      setInstances(result.instances || []);
      const matched = result.meta_matched;
      setRefreshMsg(matched > 0
        ? `✅ ${result.instances.length} instâncias · ${matched} cruzadas com Meta BM`
        : `✅ ${result.instances.length} instâncias (Meta BM não configurado ou sem match)`
      );
    } catch (e: any) {
      setRefreshMsg('Erro: ' + (e?.response?.data?.detail || e?.message));
    } finally {
      setRefreshingInst(false);
    }
  };

  useEffect(() => {
    loadInstances();
    loadDispatches();
  }, []);

  // Auto-poll dispatches every 15s while any dispatch is running
  useEffect(() => {
    const hasRunning = dispatches.some((d) => d.status === 'running');
    if (!hasRunning) return;
    const timer = setInterval(loadDispatches, 15000);
    return () => clearInterval(timer);
  }, [dispatches]);

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1200 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ color: '#e2e8f0', fontSize: 22, fontWeight: 700, margin: 0 }}>
          Disparo WhatsApp — Aesir ERP
        </h1>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {refreshMsg && (
            <span style={{ color: refreshMsg.startsWith('Erro') ? '#f87171' : '#22c55e', fontSize: 12 }}>
              {refreshMsg}
            </span>
          )}
          <button
            onClick={refreshNumbers}
            disabled={refreshingInst}
            style={{
              background: '#0d0d1f', border: '1px solid #1e1e3a',
              color: '#94a3b8', borderRadius: 8, padding: '8px 16px',
              cursor: 'pointer', fontSize: 13,
            }}
          >
            {refreshingInst ? 'Sincronizando...' : '⟳ Refresh Números'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <CredentialsPanel onSaved={loadInstances} />
        <MetaPanel onSaved={() => {}} />
      </div>

      <div style={CARD}>
        <h2 style={H2('#00ff88')}>Instâncias WhatsApp</h2>
        <p style={{ color: '#64748b', fontSize: 12, marginTop: -8, marginBottom: 16 }}>
          Clique em "Refresh Números" para sincronizar Aesir ERP + qualidade Meta BM.
        </p>
        <InstancesPanel instances={instances} onRefresh={loadInstances} />
      </div>

      <div style={CARD}>
        <h2 style={H2('#6366f1')}>Novo Disparo</h2>
        <DispatchForm instances={instances} onDispatched={loadDispatches} />
      </div>

      <div style={CARD}>
        <h2 style={H2('#6366f1')}>Histórico de Disparos</h2>
        <DispatchHistory dispatches={dispatches} onRefresh={loadDispatches} />
      </div>
    </div>
  );
}
