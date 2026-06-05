import { glassCard, sectionTitle, G } from './tokens';

export function Section({ title, gradient, icon, children }: {
  title: string;
  gradient?: string;
  icon: string;
  children: React.ReactNode;
}) {
  const g = gradient || G.primary;
  return (
    <div style={glassCard(g, 28)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12, background: g,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22, flexShrink: 0, boxShadow: '0 4px 16px rgba(0,0,0,.3)',
        }}>{icon}</div>
        <h2 style={{ ...sectionTitle(g), marginBottom: 0 }}>{title}</h2>
      </div>
      {children}
    </div>
  );
}

export function PulseDot({ color = '#10b981' }: { color?: string }) {
  return (
    <span style={{
      width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block',
      animation: 'pulse-dot 2s ease-in-out infinite',
      boxShadow: `0 0 6px ${color}99`,
    }} />
  );
}

export function GradientBar({ pct, gradient = G.primary as string, height = 6 }: {
  pct: number; gradient?: string; height?: number;
}) {
  return (
    <div style={{ background: 'rgba(255,255,255,.06)', borderRadius: height, height, overflow: 'hidden' }}>
      <div style={{
        background: gradient, height, borderRadius: height,
        width: `${Math.min(100, Math.max(0, pct))}%`, transition: 'width .6s ease-out',
      }} />
    </div>
  );
}
