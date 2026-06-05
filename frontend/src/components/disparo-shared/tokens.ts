// Design tokens compartilhados pelos 3 disparadores (Aesir, VendeAI, Chipcare).
// Garantia visual: layout idêntico em todos os disparadores.

export const C = {
  bg: '#060612',
  surface: 'rgba(15,15,35,.9)',
  surfaceDeep: 'rgba(8,8,20,.95)',
  border: 'rgba(255,255,255,.07)',
  text: '#f1f5f9',
  sec: '#94a3b8',
  muted: '#475569',
  green: '#10b981',
  yellow: '#f59e0b',
  red: '#ef4444',
} as const;

export const G = {
  primary: 'linear-gradient(135deg,#7c3aed 0%,#06b6d4 100%)',
  green: 'linear-gradient(135deg,#10b981 0%,#06b6d4 100%)',
  purple: 'linear-gradient(135deg,#6d28d9 0%,#7c3aed 100%)',
  pink: 'linear-gradient(135deg,#ec4899 0%,#7c3aed 100%)',
  red: 'linear-gradient(135deg,#ef4444 0%,#ec4899 100%)',
  yellow: 'linear-gradient(135deg,#f59e0b 0%,#ef8c3b 100%)',
  cyan: 'linear-gradient(135deg,#06b6d4 0%,#0891b2 100%)',
  neon: 'linear-gradient(135deg,#00ff88 0%,#06b6d4 100%)',
} as const;

export const QUALITY_COLOR: Record<string, string> = {
  GREEN: '#10b981', YELLOW: '#f59e0b', RED: '#ef4444', UNKNOWN: '#475569',
};

export const QUALITY_GRAD: Record<string, string> = {
  GREEN: G.green as string,
  YELLOW: G.yellow as string,
  RED: G.red as string,
  UNKNOWN: 'linear-gradient(90deg,#334155,#475569)',
};

export const STATUS_GRAD: Record<string, string> = {
  running: G.yellow as string,
  done: G.green as string,
  paused: G.purple as string,
  cancelled: G.red as string,
  error: G.red as string,
};

export const STATUS_COLOR: Record<string, string> = {
  running: '#f59e0b',
  done: '#10b981',
  paused: '#7c3aed',
  cancelled: '#ef4444',
  error: '#f87171',
};

// Glassmorphism card with gradient border
export const glassCard = (grad: string = G.primary, pad = 24) => ({
  background: `linear-gradient(rgba(15,15,35,.92),rgba(15,15,35,.92)) padding-box, ${grad} border-box`,
  border: '1px solid transparent',
  borderRadius: 16,
  padding: pad,
  boxShadow: '0 8px 40px rgba(0,0,0,.55)',
  backdropFilter: 'blur(12px)',
  position: 'relative' as const,
  overflow: 'hidden' as const,
  animation: 'fade-up .35s ease-out',
});

// Section title with gradient text
export const sectionTitle = (grad: string = G.primary) => ({
  fontSize: 16,
  fontWeight: 800,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.12em',
  background: grad,
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
  margin: 0,
  marginBottom: 20,
});

export const INPUT_STYLE = {
  width: '100%',
  background: 'rgba(255,255,255,.04)',
  border: '1px solid rgba(255,255,255,.1)',
  color: C.text,
  borderRadius: 10,
  padding: '12px 16px',
  fontSize: 15,
  boxSizing: 'border-box' as const,
};

export const btnStyle = (grad: string, disabled = false) => ({
  background: disabled ? 'rgba(255,255,255,.04)' : grad,
  color: disabled ? C.muted : '#fff',
  border: disabled ? '1px solid rgba(255,255,255,.06)' : 'none',
  borderRadius: 10,
  padding: '12px 24px',
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontSize: 15,
  fontWeight: 600,
  boxShadow: disabled ? 'none' : '0 4px 14px rgba(0,0,0,.35)',
});

// Global CSS injection (animations + focus rings) — render once per page
export const SHARED_CSS = `
  @keyframes pulse-dot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.85)}}
  @keyframes fade-up{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
  @keyframes ai-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
  @keyframes ai-spin-rev{from{transform:rotate(0deg)}to{transform:rotate(-360deg)}}
  @keyframes ai-orb-pulse{0%,100%{transform:translate(-50%,-50%) scale(1);box-shadow:0 0 60px rgba(124,58,237,.6),inset 0 0 30px rgba(6,182,212,.4)}50%{transform:translate(-50%,-50%) scale(1.08);box-shadow:0 0 90px rgba(6,182,212,.8),inset 0 0 40px rgba(124,58,237,.5)}}
  @keyframes ai-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
  @keyframes ai-twinkle{0%,100%{opacity:1}50%{opacity:.35}}
  @keyframes ai-synapse{0%,100%{stroke-dashoffset:0;opacity:.6}50%{stroke-dashoffset:-20;opacity:1}}
  @keyframes ai-text-pulse{0%,100%{opacity:.7}50%{opacity:1}}
  .ds-input:focus{border-color:rgba(124,58,237,.65)!important;box-shadow:0 0 0 3px rgba(124,58,237,.12)!important;outline:none!important}
  .ds-btn:hover:not(:disabled){opacity:.88;transform:translateY(-1px);transition:all .15s}
  .ds-btn:active:not(:disabled){transform:none}
  .ds-row:hover{background:rgba(255,255,255,.04)!important;transition:background .15s}
  .ds-chip:hover{opacity:.75;cursor:pointer}
  .ds-select:focus{border-color:rgba(124,58,237,.65)!important;box-shadow:0 0 0 3px rgba(124,58,237,.12)!important;outline:none!important}
  .ds-ai-core{cursor:pointer;transition:transform .3s}
  .ds-ai-core:hover{transform:scale(1.04)}
  .ds-ai-core:active{transform:scale(.97)}
`;
