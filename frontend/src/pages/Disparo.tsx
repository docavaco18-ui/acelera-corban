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
          Disparo WhatsApp
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
