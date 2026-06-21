import { useEffect, useState } from "react";
import { commandCenterApi } from "../lib/api";
import { C, glassCard, sectionTitle, btnStyle, G, SHARED_CSS } from "../components/disparo-shared";
import OverviewDashboard, { type Overview } from "../components/OverviewDashboard";

export default function CentralControle() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async (liveMeta = false) => {
    setLoading(true); setError("");
    try {
      setData(await commandCenterApi.overview({ live_meta: liveMeta }));
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Falha ao carregar Central de Controle");
    } finally { setLoading(false); }
  };
  useEffect(() => { load(false); }, []);

  if (loading && !data) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, color: C.muted, padding: 32 }}>
        <style>{SHARED_CSS}</style>
        <div style={glassCard(G.primary, 32)}>
          <div style={{ ...sectionTitle(G.primary), marginBottom: 4, fontSize: 12 }}>Central de Controle</div>
          <div style={{ color: C.text, fontSize: 18, fontWeight: 700 }}>Carregando diagnóstico…</div>
        </div>
      </div>
    );
  }
  if (error && !data) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, color: C.text, padding: 32 }}>
        <style>{SHARED_CSS}</style>
        <div style={glassCard(G.red, 28)}>
          <div style={{ ...sectionTitle(G.red), marginBottom: 6 }}>Central de Controle indisponível</div>
          <p style={{ color: C.sec, margin: '0 0 16px', fontSize: 14 }}>{error}</p>
          <button onClick={() => load(false)} className="ds-btn" style={btnStyle(G.red)}>Tentar novamente</button>
        </div>
      </div>
    );
  }
  if (!data) return null;
  return <OverviewDashboard data={data} loading={loading} error={error} onRefresh={() => load(false)} onLiveAudit={() => load(true)} />;
}
