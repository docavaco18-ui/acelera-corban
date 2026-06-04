import { useEffect, useState } from 'react';
import { AlertFeed } from '../components/disparo/AlertFeed';
import { CampaignHistoryList } from '../components/disparo/CampaignHistoryList';
import { CsvUploadWizard } from '../components/disparo/CsvUploadWizard';
import { DispatchMetrics } from '../components/disparo/DispatchMetrics';
import { MonitorPanel } from '../components/disparo/MonitorPanel';
import { NumberQualityGrid } from '../components/disparo/NumberQualityGrid';
import { useBroadcastWebSocket } from '../hooks/useBroadcastWebSocket';
import { broadcastApi } from '../lib/api';

const WS_URL = (import.meta.env.VITE_WS_URL as string) ?? 'ws://localhost:8002/ws';

const CARD = { background: '#0d0d1f', border: '1px solid #1e1e3a', borderRadius: 12, padding: 24 } as const;
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

function CredentialsPanel({ onSaved }: { onSaved: () => void }) {
  const [configured, setConfigured] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    broadcastApi.getCredentialsStatus().then((r: any) => {
      const d = r.data ?? r;
      setConfigured(d.configured);
    }).catch(() => {});
  }, []);

  const save = async () => {
    if (!email.trim() || !password.trim()) { setMsg('Email e senha obrigatórios'); return; }
    setSaving(true);
    try {
      await broadcastApi.saveCredentials({ email: email.trim(), password: password.trim() });
      setConfigured(true); setEmail(''); setPassword('');
      setMsg('Salvo!'); onSaved();
    } catch (e: any) { setMsg('Erro: ' + (e?.response?.data?.detail || e?.message)); }
    finally { setSaving(false); }
  };

  return (
    <div style={CARD}>
      <h2 style={{ color: '#00ff88', fontSize: 15, fontWeight: 700, marginBottom: 16, marginTop: 0 }}>Credenciais VendeAI</h2>
      {configured && <p style={{ color: '#22c55e', fontSize: 13, marginBottom: 12 }}>✅ Credenciais VendeAI configuradas</p>}
      <p style={{ color: '#64748b', fontSize: 12, marginBottom: 12 }}>
        Login VendeAI (CRM). Necessário para mapear inboxes → números WhatsApp.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 480 }}>
        <div>
          <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>E-mail VendeAI</label>
          <input style={INPUT} type="email" placeholder="usuario@email.com" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div>
          <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Senha VendeAI</label>
          <input style={INPUT} type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} />
        </div>
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
  const [savedWabaIds, setSavedWabaIds] = useState<string[]>([]);
  const [tok, setTok] = useState('');
  const [wabaText, setWabaText] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    broadcastApi.getCredentialsStatus().then((r: any) => {
      const d = r.data ?? r;
      setMetaOk(d.meta_configured || false);
      if (d.waba_ids?.length) setSavedWabaIds(d.waba_ids);
    }).catch(() => {});
  }, []);

  const save = async () => {
    if (!tok.trim()) { setMsg('Informe o token permanente'); return; }
    setSaving(true);
    try {
      await broadcastApi.saveCredentials({ meta_token: tok.trim() });
      const waba_ids = wabaText.split('\n').map((s: string) => s.trim()).filter(Boolean);
      if (waba_ids.length) await broadcastApi.saveWabaIds(waba_ids);
      setMetaOk(true);
      if (waba_ids.length) setSavedWabaIds(waba_ids);
      setTok(''); setWabaText('');
      setMsg(waba_ids.length ? `Meta configurado! ${waba_ids.length} WABA(s) salvo(s).` : 'Meta token salvo. Auto-descoberta ativa ao Refresh.');
      onSaved();
    } catch (e: any) { setMsg('Erro: ' + (e?.response?.data?.detail || e?.message)); }
    finally { setSaving(false); }
  };

  return (
    <div style={CARD}>
      <h2 style={{ color: '#1d9bf0', fontSize: 15, fontWeight: 700, marginBottom: 16, marginTop: 0 }}>Meta Business Manager</h2>
      {metaOk && (
        <p style={{ color: '#22c55e', fontSize: 13, marginBottom: 8 }}>
          ✅ Token configurado{savedWabaIds.length ? ` · ${savedWabaIds.length} WABA(s)` : ' · auto-descoberta ativa'}
        </p>
      )}
      <p style={{ color: '#64748b', fontSize: 12, marginBottom: 12 }}>
        Token permanente do System User BM. <strong style={{ color: '#94a3b8' }}>WABA IDs são opcionais</strong> — o token auto-descobre todos os WABAs da BM ao Refresh Números.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 480 }}>
        <div>
          <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>System User Token (permanente)</label>
          <input style={INPUT} type="password" placeholder="EAAOKxO1..." value={tok} onChange={e => setTok(e.target.value)} />
        </div>
        <div>
          <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>
            WABA IDs (opcional — um por linha)
            <span style={{ color: '#6366f1', marginLeft: 6, fontSize: 11 }}>deixe vazio para auto-descoberta</span>
          </label>
          <textarea style={{ ...INPUT, height: 80, resize: 'vertical', fontFamily: 'monospace' }}
            placeholder={'Opcional — token auto-descobre\n123456789\n987654321'}
            value={wabaText} onChange={e => setWabaText(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button style={BTN('#1d9bf0', saving)} onClick={save} disabled={saving}>{saving ? 'Salvando...' : 'Salvar Meta'}</button>
          {msg && <span style={{ color: msg.startsWith('Erro') ? '#f87171' : '#22c55e', fontSize: 12 }}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}

export default function Disparo() {
  const { snapshot } = useBroadcastWebSocket(WS_URL);
  const [numbers, setNumbers] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    try {
      const numsResp = await broadcastApi.listNumbers();
      setNumbers(numsResp.data || []);
    } catch (e) {
      console.error('[Disparo] listNumbers falhou:', e);
    }
    try {
      const analyticsResp = await broadcastApi.getAnalytics();
      setAnalytics(analyticsResp.data || []);
    } catch { /* analytics não bloqueia */ }
    try {
      const alertsResp = await broadcastApi.getAlerts();
      setAlerts(alertsResp.data || []);
    } catch { /* alerts não bloqueia */ }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    if (snapshot.numbers.length) setNumbers(snapshot.numbers);
    if (snapshot.alerts.length) setAlerts(snapshot.alerts);
  }, [snapshot]);

  const handleRefreshNumbers = async () => {
    setRefreshing(true);
    try {
      await broadcastApi.refreshNumbers();
      await loadData();
    } catch {
      // ignore
    } finally {
      setRefreshing(false);
    }
  };

  const handleResumeNumber = async (phoneId: string) => {
    try {
      await broadcastApi.resumeNumber(phoneId);
      await loadData();
    } catch (e) {
      console.error('[Disparo] resumeNumber falhou:', e);
    }
  };

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1200 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ color: '#e2e8f0', fontSize: 22, fontWeight: 700, margin: 0 }}>
          Disparo VendeAI
        </h1>
        <button
          onClick={handleRefreshNumbers}
          disabled={refreshing}
          style={{
            background: '#0d0d1f', border: '1px solid #1e1e3a',
            color: '#94a3b8', borderRadius: 8, padding: '8px 16px',
            cursor: 'pointer', fontSize: 13,
          }}
        >
          {refreshing ? 'Atualizando...' : '⟳ Refresh Números'}
        </button>
      </div>

      {/* Credentials */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <CredentialsPanel onSaved={loadData} />
        <MetaPanel onSaved={loadData} />
      </div>

      {/* Panel 1 — Monitoramento em tempo real */}
      <div style={{
        background: '#0d0d1f', border: '1px solid #1e1e3a',
        borderRadius: 12, padding: 24,
      }}>
        <h2 style={{ color: '#00ff88', fontSize: 15, fontWeight: 700, marginBottom: 16, marginTop: 0 }}>
          Monitoramento
        </h2>
        <MonitorPanel />
      </div>

      {/* Panel 2 — Histórico de campanhas */}
      <div style={{
        background: '#0d0d1f', border: '1px solid #1e1e3a',
        borderRadius: 12, padding: 24,
      }}>
        <h2 style={{ color: '#6366f1', fontSize: 15, fontWeight: 700, marginBottom: 16, marginTop: 0 }}>
          Histórico de Disparos
        </h2>
        <CampaignHistoryList onRefresh={loadData} />
      </div>

      {/* Panel 3 — Novo disparo */}
      <div style={{
        background: '#0d0d1f', border: '1px solid #1e1e3a',
        borderRadius: 12, padding: 24,
      }}>
        <h2 style={{ color: '#6366f1', fontSize: 15, fontWeight: 700, marginBottom: 16, marginTop: 0 }}>
          Novo Disparo
        </h2>
        <CsvUploadWizard onDispatched={loadData} />
      </div>

      {/* Panel 4 — Number Quality */}
      <div style={{
        background: '#0d0d1f', border: '1px solid #1e1e3a',
        borderRadius: 12, padding: 24,
      }}>
        <h2 style={{ color: '#6366f1', fontSize: 15, fontWeight: 700, marginBottom: 16, marginTop: 0 }}>
          Qualidade dos Números
        </h2>
        <NumberQualityGrid numbers={numbers} onResume={handleResumeNumber} />
      </div>

      {/* Panel 5 — Metrics + Alerts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div style={{
          background: '#0d0d1f', border: '1px solid #1e1e3a',
          borderRadius: 12, padding: 24,
        }}>
          <h2 style={{ color: '#6366f1', fontSize: 15, fontWeight: 700, marginBottom: 16, marginTop: 0 }}>
            Métricas de Disparo
          </h2>
          <DispatchMetrics metrics={analytics} />
        </div>

        <div style={{
          background: '#0d0d1f', border: '1px solid #1e1e3a',
          borderRadius: 12, padding: 24,
        }}>
          <h2 style={{ color: '#ff2d78', fontSize: 15, fontWeight: 700, marginBottom: 16, marginTop: 0 }}>
            Alertas
          </h2>
          <AlertFeed alerts={alerts} />
        </div>
      </div>
    </div>
  );
}
