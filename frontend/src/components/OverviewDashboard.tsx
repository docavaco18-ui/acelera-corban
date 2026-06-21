import { useMemo, useState } from "react";
import {
  C, G, glassCard, sectionTitle, btnStyle, INPUT_STYLE, SHARED_CSS,
  PulseDot, GradientBar,
} from "../components/disparo-shared";

// ── Tipos ────────────────────────────────────────────────────────────────────

type CheckStatus = "ok" | "warning" | "critical";
type ChecklistStatus = "ok" | "warn" | "block";
type RiskLevel = "ok" | "warning" | "critical";

interface Check {
  id: string;
  group: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

interface Channel {
  source: string;
  source_label: string;
  id: string;
  title: string;
  waba_id?: string;
  phone_id?: string;
  quality_rating: string;
  can_send: string;
  name_status: string;
  daily_limit: number;
  used_today: number;
  remaining_today: number;
  risk: RiskLevel;
  is_healthy: boolean;
  issues: string[];
}

interface MetaAudit {
  source: string;
  source_label: string;
  status: CheckStatus;
  message: string;
  wabas: string[];
  phones: unknown[];
  templates: unknown[];
  live: boolean;
}

interface TemplateRowData {
  source: string;
  source_label: string;
  waba_id: string;
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  variables: string[];
}

interface Incident {
  severity: RiskLevel;
  title: string;
  detail: string;
  source: string;
  created_at: string;
  action: string;
}

interface ChecklistItem {
  id: string;
  label: string;
  status: ChecklistStatus;
  detail: string;
}

interface Reason {
  reason: string;
  count: number;
  examples: string[];
}

export interface Overview {
  generated_at: string;
  score: { score: number; status: RiskLevel; label: string };
  health: Check[];
  deliverability: {
    totals: Record<string, number>;
    channels: Channel[];
  };
  capacity: {
    target: number;
    capacity_today: number;
    healthy_channels: number;
    estimated_days: number | null;
    safe_per_hour: number;
    recommendation: string;
    plan: { day: number; planned: number; remaining_after: number }[];
  };
  meta_audits: MetaAudit[];
  templates: {
    by_category: Record<string, number>;
    by_status: Record<string, number>;
    templates: TemplateRowData[];
  };
  error_radar: { reasons: Reason[] };
  incidents: Incident[];
  checklist: ChecklistItem[];
  live_meta_requested?: boolean;
  live_meta_timed_out?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | undefined | null): string {
  return Number(n || 0).toLocaleString("pt-BR");
}

function gradFor(status: string): string {
  if (status === "ok") return G.green;
  if (status === "warning" || status === "warn") return G.yellow;
  if (status === "critical" || status === "block") return G.red;
  return G.primary;
}

function colorFor(status: string): string {
  if (status === "ok") return C.green;
  if (status === "warning" || status === "warn") return C.yellow;
  if (status === "critical" || status === "block") return C.red;
  return C.sec;
}

function tplColor(status: string): string {
  if (status === "APPROVED") return C.green;
  if (status === "REJECTED") return C.red;
  if (status === "PAUSED" || status === "DISABLED") return C.red;
  return C.yellow;
}

// ── Componentes base ─────────────────────────────────────────────────────────

function PageHeader({
  scoreNum, scoreStatus, scoreLabel, generatedAt, loading, onRefresh, onLiveAudit, liveTimedOut, title,
}: {
  scoreNum: number; scoreStatus: string; scoreLabel: string; generatedAt: string;
  loading: boolean; onRefresh: () => void; onLiveAudit: () => void; liveTimedOut: boolean; title: string;
}) {
  const grad = gradFor(scoreStatus);
  const color = colorFor(scoreStatus);
  return (
    <div style={{ ...glassCard(grad, 28), marginBottom: 22 }}>
      <div style={{
        display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 22, alignItems: 'center',
      }} className="cc-header">
        <BrainBadge color={color} loading={loading} />
        <div style={{ minWidth: 0 }}>
          <div style={{ ...sectionTitle(grad), marginBottom: 6 }}>{title}</div>
          <h1 style={{ margin: 0, color: C.text, fontSize: 34, lineHeight: 1.05, letterSpacing: 0, fontWeight: 800 }}>
            Score Operacional <span style={{ color, fontVariantNumeric: 'tabular-nums' }}>{scoreNum}</span>
            <span style={{ color: C.muted, fontSize: 22, fontWeight: 600 }}>/100</span>
          </h1>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <PulseDot color={color} />
              <span style={{ color: C.text, fontSize: 14, fontWeight: 700 }}>{scoreLabel}</span>
            </span>
            <span style={{ color: C.sec, fontSize: 12 }}>
              Atualizado em {new Date(generatedAt).toLocaleString('pt-BR')}
            </span>
            {liveTimedOut && (
              <span style={{ color: C.yellow, fontSize: 12, fontWeight: 700 }}>
                ⚠ Auditoria ao vivo expirou — exibindo cache
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button
            onClick={onRefresh} disabled={loading}
            className="ds-btn" style={btnStyle(G.primary, loading)}
          >
            {loading ? 'Atualizando…' : '↻ Atualizar diagnóstico'}
          </button>
          <button
            onClick={onLiveAudit} disabled={loading}
            className="ds-btn" style={btnStyle(G.purple, loading)}
          >
            ⚡ Auditar Meta ao vivo
          </button>
        </div>
      </div>
      <div style={{ marginTop: 18 }}>
        <GradientBar pct={scoreNum} gradient={grad} height={8} />
      </div>
    </div>
  );
}

function BrainBadge({ color, loading }: { color: string; loading: boolean }) {
  const mult = loading ? 0.4 : 1;
  return (
    <div style={{
      position: 'relative', width: 92, height: 92, flexShrink: 0,
    }}>
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%',
        border: `2px dashed ${color}55`, animation: `ai-spin ${14 * mult}s linear infinite`,
      }} />
      <div style={{
        position: 'absolute', inset: 12, borderRadius: '50%',
        border: `1.5px dotted ${color}88`, animation: `ai-spin-rev ${10 * mult}s linear infinite`,
      }} />
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        width: 44, height: 44, borderRadius: '50%',
        background: `radial-gradient(circle at 35% 35%, ${color} 0%, ${color}cc 35%, transparent 100%)`,
        transform: 'translate(-50%, -50%)',
        animation: `ai-orb-pulse ${2.4 * mult}s ease-in-out infinite`,
        filter: 'blur(.4px)',
      }} />
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 28, animation: `ai-float ${3.6 * mult}s ease-in-out infinite`,
        filter: `drop-shadow(0 0 8px ${color}aa)`,
      }}>🧠</div>
    </div>
  );
}

function KpiCard({ label, value, color, sub, icon }: {
  label: string; value: number | string; color: string; sub?: string; icon?: string;
}) {
  return (
    <div className="spot-card" style={{
      background: 'rgba(255,255,255,.02)',
      border: '1px solid rgba(255,255,255,.06)',
      borderRadius: 14,
      padding: 18,
      position: 'relative',
      overflow: 'hidden',
      '--spot-color': color,
    } as any}>
      <div className="spot-glow" />
      <div className="spot-shine" />
      <div style={{
        position: 'absolute', inset: 0, opacity: .08, pointerEvents: 'none',
        background: `radial-gradient(circle at top right, ${color} 0%, transparent 60%)`,
      }} />
      <div style={{
        position: 'relative',
        color: C.sec, fontSize: 11, fontWeight: 800, letterSpacing: '.12em',
        textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
      }}>
        {icon && <span style={{ fontSize: 14 }}>{icon}</span>}
        {label}
      </div>
      <div style={{
        color, fontSize: 30, fontWeight: 900, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
        position: 'relative',
      }}>
        {typeof value === 'number' ? fmt(value) : value}
      </div>
      {sub && <div style={{ color: C.sec, fontSize: 11, marginTop: 8, position: 'relative' }}>{sub}</div>}
    </div>
  );
}

function CardShell({ title, gradient, icon, children, action }: {
  title: string; gradient: string; icon: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div style={glassCard(gradient, 24)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 11, background: gradient,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 19, flexShrink: 0, boxShadow: '0 4px 14px rgba(0,0,0,.3)',
        }}>{icon}</div>
        <h2 style={{ ...sectionTitle(gradient), marginBottom: 0, fontSize: 14, flex: 1, minWidth: 0 }}>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function StatusPill({ status, label }: { status: string; label?: string }) {
  const color = colorFor(status);
  const text = label ?? (
    status === "ok" ? "OK"
      : status === "warning" || status === "warn" ? "Atenção"
        : status === "critical" || status === "block" ? "Crítico"
          : status
  );
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', borderRadius: 999,
      color, background: `${color}14`, border: `1px solid ${color}55`,
      fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap',
    }}>
      <PulseDot color={color} />
      {text}
    </span>
  );
}

function RowItem({ left, right, sub, sublineColor, spotColor }: {
  left: React.ReactNode; right?: React.ReactNode; sub?: React.ReactNode; sublineColor?: string; spotColor?: string;
}) {
  return (
    <div className={`ds-row${spotColor ? ' spot-row' : ''}`} style={{
      display: 'grid',
      gridTemplateColumns: right ? '1fr auto' : '1fr',
      gap: 12, alignItems: 'start',
      padding: '12px 8px',
      borderTop: '1px solid rgba(255,255,255,.05)',
      borderRadius: 8,
      position: 'relative',
      ...(spotColor ? { '--spot-color': spotColor } as any : {}),
    }}>
      {spotColor && <div className="spot-glow" />}
      <div style={{ minWidth: 0, position: 'relative' }}>
        <div style={{ color: C.text, fontSize: 13, fontWeight: 700, lineHeight: 1.3 }}>{left}</div>
        {sub && <div style={{ color: sublineColor ?? C.sec, fontSize: 12, lineHeight: 1.45, marginTop: 4 }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

function MiniMetric({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,.03)',
      border: '1px solid rgba(255,255,255,.06)',
      borderRadius: 10, padding: '10px 12px',
    }}>
      <div style={{
        color: C.sec, fontSize: 10, fontWeight: 800, letterSpacing: '.08em',
        textTransform: 'uppercase', marginBottom: 4,
      }}>{label}</div>
      <div style={{ color, fontSize: 20, fontWeight: 900, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
        {typeof value === 'number' ? fmt(value) : value}
      </div>
    </div>
  );
}

function SpotlightMetric({ label, value, color, icon }: { label: string; value: number | string; color: string; icon: string }) {
  return (
    <div className="spot-card" style={{
      background: 'rgba(255,255,255,.03)',
      border: '1px solid rgba(255,255,255,.06)',
      borderRadius: 12,
      padding: '12px 12px 14px',
      '--spot-color': color,
    } as any}>
      <div className="spot-glow" />
      <div className="spot-shine" />
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{
          color: C.sec, fontSize: 10, fontWeight: 800, letterSpacing: '.08em',
          textTransform: 'uppercase',
        }}>{label}</div>
        <span style={{ fontSize: 13, opacity: .7 }}>{icon}</span>
      </div>
      <div style={{
        position: 'relative',
        color, fontSize: 24, fontWeight: 900, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
      }}>
        {typeof value === 'number' ? fmt(value) : value}
      </div>
    </div>
  );
}

function TemplateRow({ tpl }: { tpl: TemplateRowData }) {
  const color = tplColor(tpl.status);
  return (
    <div className="spot-row" style={{
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      gap: 12,
      alignItems: 'start',
      padding: '12px 10px',
      borderTop: '1px solid rgba(255,255,255,.05)',
      borderRadius: 10,
      background: 'transparent',
      position: 'relative',
      '--spot-color': color,
    } as any}>
      <div className="spot-glow" />
      <div style={{ minWidth: 0, position: 'relative' }}>
        <div style={{ color: C.text, fontSize: 13, fontWeight: 700, lineHeight: 1.3 }}>
          {tpl.name} <span style={{ color: C.sec, fontSize: 11, fontWeight: 600 }}>· {tpl.language}</span>
        </div>
        <div style={{ color: C.sec, fontSize: 12, lineHeight: 1.45, marginTop: 4 }}>
          {tpl.source_label} · {tpl.category || 'UNKNOWN'} · WABA {tpl.waba_id}
          {tpl.variables?.length ? ` · ${tpl.variables.length} variáveis` : ''}
        </div>
      </div>
      <span style={{
        color, background: `${color}15`, border: `1px solid ${color}55`,
        padding: '4px 10px', borderRadius: 999, fontWeight: 800, fontSize: 11,
        position: 'relative',
      }}>{tpl.status}</span>
    </div>
  );
}

function ChannelRow({ ch }: { ch: Channel }) {
  const pct = ch.daily_limit > 0 ? (ch.used_today / ch.daily_limit) * 100 : 0;
  return (
    <div className="ds-row spot-row" style={{
      padding: '12px 8px',
      borderTop: '1px solid rgba(255,255,255,.05)',
      borderRadius: 8,
      position: 'relative',
      '--spot-color': colorFor(ch.risk),
    } as any}>
      <div className="spot-glow" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: C.text, fontSize: 13, fontWeight: 700 }}>
            <span style={{ color: C.sec, fontWeight: 600, marginRight: 6 }}>{ch.source_label}</span>
            {ch.title}
          </div>
          <div style={{ color: C.sec, fontSize: 11, marginTop: 4 }}>
            {ch.quality_rating} · {ch.can_send} · limite {fmt(ch.daily_limit)} · restante {fmt(ch.remaining_today)}
            {ch.issues?.length ? ` · ${ch.issues.join(', ')}` : ''}
          </div>
        </div>
        <StatusPill status={ch.risk} />
      </div>
      {ch.daily_limit > 0 && (
        <div style={{ marginTop: 8 }}>
          <GradientBar pct={pct} gradient={gradFor(ch.risk)} height={4} />
        </div>
      )}
    </div>
  );
}

// CSS adicional só pra Central de Controle (responsividade + scrollbar custom + spotlight templates)
const CC_CSS = `
  .cc-scroll::-webkit-scrollbar { width: 6px; }
  .cc-scroll::-webkit-scrollbar-track { background: rgba(255,255,255,.02); border-radius: 3px; }
  .cc-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,.12); border-radius: 3px; }
  .cc-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.22); }

  @media (max-width: 1200px) {
    .cc-three { grid-template-columns: 1fr 1fr !important; }
    .cc-three > :nth-child(3) { grid-column: 1 / -1; }
  }
  @media (max-width: 1024px) {
    .cc-kpis { grid-template-columns: repeat(2, 1fr) !important; }
    .cc-two { grid-template-columns: 1fr !important; }
    .cc-header { grid-template-columns: auto 1fr !important; }
    .cc-header > :last-child { grid-column: 1 / -1; justify-content: flex-start !important; }
  }
  @media (max-width: 640px) {
    .cc-three { grid-template-columns: 1fr !important; }
    .cc-three > :nth-child(3) { grid-column: auto; }
    .cc-kpis { grid-template-columns: 1fr !important; }
  }
`;

// ── Componente principal ─────────────────────────────────────────────────────

export default function OverviewDashboard({
  data, loading, error, onRefresh, onLiveAudit, title = "Central de Controle",
}: {
  data: Overview; loading: boolean; error?: string;
  onRefresh: () => void; onLiveAudit: () => void; title?: string;
}) {
  const [target, setTarget] = useState(10000);

  const simulated = useMemo(() => {
    const cap = Number(data.capacity?.capacity_today || 0);
    const days = cap > 0 ? Math.max(1, Math.ceil(target / cap)) : null;
    const safePerHour = cap > 0 ? Math.max(1, Math.floor(cap / 8)) : 0;
    return { cap, days, safePerHour };
  }, [data, target]);

  const blockRisk = useMemo(() => {
    const totals = data.deliverability.totals || {};
    const channels = data.deliverability.channels || [];
    const reds = channels.filter((c) => c.quality_rating === "RED").length;
    const yellows = channels.filter((c) => c.quality_rating === "YELLOW").length;
    const payment = channels.filter((c) => c.issues?.some((i) => /pagamento/i.test(i))).length;
    const namePending = channels.filter((c) => c.issues?.some((i) => /nome/i.test(i))).length;
    const total = totals.all || 0;
    const critical = totals.critical || 0;
    let level: RiskLevel = "ok";
    if (critical > 0 || reds > 0 || payment > 0) level = "critical";
    else if (yellows > 0 || namePending > 0) level = "warning";
    const summary =
      level === "critical" ? "Bloqueio iminente — pause ou corrija antes de disparar."
        : level === "warning" ? "Atenção: sinais de degradação. Reduza ritmo e monitore."
          : "Sem sinais de risco crítico no momento.";
    return { level, summary, reds, yellows, payment, namePending, total };
  }, [data]);

  const totals = data.deliverability.totals || {};
  const category = data.templates.by_category || {};
  const templateStatus = data.templates.by_status || {};

  return (
    <div style={{
      minHeight: '100vh', background: C.bg, color: C.text,
      fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      padding: '22px 24px 56px',
    }}>
      <style>{SHARED_CSS}{CC_CSS}</style>

      <PageHeader
        scoreNum={data.score.score}
        scoreStatus={data.score.status}
        scoreLabel={data.score.label}
        generatedAt={data.generated_at}
        loading={loading}
        onRefresh={onRefresh}
        onLiveAudit={onLiveAudit}
        liveTimedOut={!!data.live_meta_timed_out}
        title={title}
      />

      {error && (
        <div style={{
          border: `1px solid ${C.red}55`, color: C.red, background: `${C.red}10`,
          borderRadius: 12, padding: 12, marginBottom: 18, fontSize: 13,
        }}>{error}</div>
      )}

      {/* ── Linha de KPIs ── */}
      <section className="cc-grid cc-kpis spot-grid" style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 14, marginBottom: 18,
      }}>
        <KpiCard
          label="Canais saudáveis" icon="✅"
          value={totals.healthy ?? 0} color={C.green}
          sub={`${fmt(totals.all)} canais mapeados`}
        />
        <KpiCard
          label="Em risco crítico" icon="🚨"
          value={totals.critical ?? 0} color={C.red}
          sub="bloqueio, RED ou pagamento"
        />
        <KpiCard
          label="Capacidade hoje" icon="🚀"
          value={totals.capacity_today ?? 0} color={C.yellow}
          sub="envios seguros estimados"
        />
        <KpiCard
          label="Templates aprovados" icon="📑"
          value={templateStatus.APPROVED || 0} color="#7c3aed"
          sub={`${fmt(category.MARKETING)} marketing · ${fmt(category.UTILITY)} utility`}
        />
      </section>

      {/* ── Checklist + Simulador + Risco ── */}
      <section className="cc-grid cc-three" style={{
        display: 'grid', gridTemplateColumns: '1.05fr .95fr .85fr', gap: 16, marginBottom: 18,
      }}>
        <CardShell title="Checklist pré-disparo" gradient={G.green} icon="✓">
          {data.checklist.map((item) => (
            <RowItem
              key={item.id}
              left={item.label}
              sub={item.detail}
              right={<StatusPill status={item.status} label={
                item.status === 'ok' ? 'OK' : item.status === 'warn' ? 'Atenção' : 'Bloqueia'
              } />}
            />
          ))}
        </CardShell>

        <CardShell title="Simulador de capacidade" gradient={G.cyan} icon="🎯">
          <label style={{ display: 'block', color: C.sec, fontSize: 11, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 8 }}>
            Tamanho da campanha
          </label>
          <input
            value={target}
            type="number"
            min={1}
            step={100}
            onChange={(e) => setTarget(Math.max(1, Number(e.target.value || 1)))}
            className="ds-input"
            style={{ ...INPUT_STYLE, fontSize: 18, fontWeight: 800, marginBottom: 14 }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <MiniMetric label="Hoje" value={simulated?.cap ?? 0} color={C.green} />
            <MiniMetric label="Dias est." value={simulated?.days ?? "—"} color={C.yellow} />
            <MiniMetric label="Seguro/h" value={simulated?.safePerHour ?? 0} color="#7c3aed" />
          </div>
          <p style={{ color: C.sec, fontSize: 12, lineHeight: 1.55, margin: '14px 0 0' }}>
            {data.capacity.recommendation}
          </p>
        </CardShell>

        <CardShell title="Alerta de risco de bloqueio" gradient={blockRisk ? gradFor(blockRisk.level) : G.yellow} icon="⚠">
          {blockRisk && (
            <>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16,
              }}>
                <span style={{
                  fontSize: 36, fontWeight: 900, lineHeight: 1, color: colorFor(blockRisk.level),
                }}>
                  {blockRisk.level === 'critical' ? 'Alto' : blockRisk.level === 'warning' ? 'Médio' : 'Baixo'}
                </span>
                <StatusPill status={blockRisk.level} />
              </div>
              <p style={{ color: C.text, fontSize: 13, lineHeight: 1.55, margin: '0 0 14px' }}>
                {blockRisk.summary}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <MiniMetric label="RED" value={blockRisk.reds} color={C.red} />
                <MiniMetric label="YELLOW" value={blockRisk.yellows} color={C.yellow} />
                <MiniMetric label="Pagamento" value={blockRisk.payment} color={C.red} />
                <MiniMetric label="Nome pend." value={blockRisk.namePending} color={C.yellow} />
              </div>
            </>
          )}
        </CardShell>
      </section>

      {/* ── Health + Incidentes ── */}
      <section className="cc-grid cc-two" style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18,
      }}>
        <CardShell title="Health check das integrações" gradient={G.purple} icon="🩺">
          <div style={{ maxHeight: 440, overflow: 'auto', paddingRight: 4 }} className="cc-scroll spot-list">
            {data.health.map((check) => (
              <RowItem
                key={check.id}
                spotColor={colorFor(check.status)}
                left={<><span style={{ color: C.sec, fontWeight: 600, marginRight: 6 }}>{check.group}</span>{check.label}</>}
                sub={check.detail}
                right={<StatusPill status={check.status} />}
              />
            ))}
          </div>
        </CardShell>

        <CardShell title="Central de incidentes" gradient={G.red} icon="🛟"
          action={<span style={{ color: C.sec, fontSize: 12 }}>{fmt(data.incidents.length)} ativos</span>}
        >
          {data.incidents.length === 0 ? (
            <div style={{
              color: C.green, fontSize: 14, fontWeight: 700,
              display: 'flex', alignItems: 'center', gap: 10,
              padding: 18, background: `${C.green}10`, borderRadius: 12, border: `1px solid ${C.green}33`,
            }}>
              <PulseDot color={C.green} /> Nenhum incidente crítico detectado
            </div>
          ) : (
            <div style={{ maxHeight: 440, overflow: 'auto', paddingRight: 4 }} className="cc-scroll spot-list">
              {data.incidents.map((incident, idx) => (
                <RowItem
                  key={`${incident.title}-${idx}`}
                  spotColor={colorFor(incident.severity)}
                  left={incident.title}
                  sub={<>
                    <div>{incident.detail}</div>
                    <div style={{ color: colorFor(incident.severity), fontWeight: 700, marginTop: 4 }}>
                      Ação: {incident.action}
                    </div>
                  </>}
                  right={<StatusPill status={incident.severity} />}
                />
              ))}
            </div>
          )}
        </CardShell>
      </section>

      {/* ── Entregabilidade BM + Radar ── */}
      <section className="cc-grid cc-two" style={{
        display: 'grid', gridTemplateColumns: '1.2fr .8fr', gap: 16, marginBottom: 18,
      }}>
        <CardShell title="Central de entregabilidade BM" gradient={G.cyan} icon="📡"
          action={<span style={{ color: C.sec, fontSize: 12 }}>
            {fmt(data.deliverability.channels.length)} canais
          </span>}
        >
          {data.deliverability.channels.length === 0 ? (
            <div style={{ color: C.sec, fontSize: 13, padding: 12 }}>
              Nenhum canal sincronizado ainda. Salve token Meta e clique em <b>Atualizar Status</b> nos disparadores.
            </div>
          ) : (
            <div style={{ maxHeight: 460, overflow: 'auto', paddingRight: 4 }} className="cc-scroll spot-list">
              {data.deliverability.channels.slice(0, 40).map((ch) => (
                <ChannelRow key={`${ch.source}-${ch.id}`} ch={ch} />
              ))}
              {data.deliverability.channels.length > 40 && (
                <div style={{ color: C.sec, fontSize: 11, padding: '10px 8px 2px', textAlign: 'center' }}>
                  + {fmt(data.deliverability.channels.length - 40)} canais não exibidos
                </div>
              )}
            </div>
          )}
        </CardShell>

        <CardShell title="Radar de erros por motivo" gradient={G.yellow} icon="🎯">
          {data.error_radar.reasons.length === 0 ? (
            <div style={{ color: C.sec, fontSize: 13, padding: 12 }}>
              Nenhum erro recorrente detectado.
            </div>
          ) : (
            <div style={{ maxHeight: 460, overflow: 'auto', paddingRight: 4 }} className="cc-scroll spot-list">
              {data.error_radar.reasons.map((reason) => (
                <RowItem
                  key={reason.reason}
                  spotColor={C.yellow}
                  left={reason.reason}
                  sub={(reason.examples || []).join(' · ') || 'Sem exemplo'}
                  right={
                    <span style={{
                      color: C.yellow, background: `${C.yellow}15`, border: `1px solid ${C.yellow}55`,
                      padding: '4px 10px', borderRadius: 999, fontWeight: 800, fontSize: 11,
                      fontVariantNumeric: 'tabular-nums',
                    }}>{fmt(reason.count)}</span>
                  }
                />
              ))}
            </div>
          )}
        </CardShell>
      </section>

      {/* ── Auditoria Meta + Templates ── */}
      <section className="cc-grid cc-two" style={{
        display: 'grid', gridTemplateColumns: '.9fr 1.1fr', gap: 16,
      }}>
        <CardShell title="Auditoria de token Meta" gradient={G.green} icon="🔐"
          action={
            <span style={{ color: C.sec, fontSize: 11 }}>
              {data.meta_audits.some((a) => a.live) ? 'live' : 'cache'}
            </span>
          }
        >
          <div className="spot-list">
          {data.meta_audits.map((audit) => (
            <RowItem
              key={audit.source}
              spotColor={colorFor(audit.status)}
              left={audit.source_label}
              sub={<>
                <div>{audit.message}</div>
                <div style={{ color: C.sec, fontSize: 11, marginTop: 4 }}>
                  {audit.live ? '⚡ auditoria ao vivo' : '💾 leitura rápida do cache local'}
                  {audit.wabas?.length ? ` · ${fmt(audit.wabas.length)} WABAs` : ''}
                </div>
              </>}
              right={<StatusPill status={audit.status} />}
            />
          ))}
          </div>
        </CardShell>

        <CardShell title="Monitor de templates" gradient={G.pink} icon="📑">
          <div className="spot-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }}>
            <SpotlightMetric label="Marketing" value={category.MARKETING || 0} color={C.red} icon="📢" />
            <SpotlightMetric label="Utility" value={category.UTILITY || 0} color={C.green} icon="🔧" />
            <SpotlightMetric label="Auth" value={category.AUTHENTICATION || 0} color={C.yellow} icon="🔐" />
            <SpotlightMetric label="Rejeitados" value={templateStatus.REJECTED || 0} color={C.red} icon="🚫" />
          </div>
          {data.templates.templates.length === 0 ? (
            <div style={{ color: C.sec, fontSize: 13, padding: 12 }}>
              Nenhum template sincronizado. Rode <b>Auditar Meta ao vivo</b> para carregar.
            </div>
          ) : (
            <div style={{ maxHeight: 340, overflow: 'auto', paddingRight: 4 }} className="cc-scroll spot-list">
              {data.templates.templates.slice(0, 80).map((tpl) => (
                <TemplateRow key={`${tpl.source}-${tpl.waba_id}-${tpl.id}`} tpl={tpl} />
              ))}
            </div>
          )}
        </CardShell>
      </section>
    </div>
  );
}
