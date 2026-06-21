import { useState } from "react";
import {
  C, G, glassCard, sectionTitle, SHARED_CSS,
  PulseDot, GradientBar, Section,
} from "../components/disparo-shared";

// ── Constantes ────────────────────────────────────────────────────────────────

const WA_NUMBER = "5561920045744";

const PLANS = [
  {
    id: "minimo",
    name: "Mínimo",
    icon: "🎯",
    priceBase: 1200,
    investRange: "R$ 100 – 300/dia",
    kicker: "Começa simples, entrega resultado",
    gradient: G.purple,
    accent: "#a78bfa",
    items: [
      "Gestão completa de campanhas Meta Ads",
      "Criação de criativos e copy",
      "Segmentação e otimização",
      "Leads direto no seu WhatsApp e CRM",
    ],
    notIncluded: ["Página ou site", "Dashboard", "Agentes de I.A", "Traqueamento avançado"],
  },
  {
    id: "medio",
    name: "Médio",
    icon: "⚡",
    priceBase: 2000,
    investRange: "R$ 300 – 500/dia",
    kicker: "Tráfego + estrutura + I.A",
    gradient: G.primary,
    accent: "#06b6d4",
    popular: true,
    bonus: "🎁 Bônus: 1 Agente de I.A (SDR ou Closer)",
    items: [
      "Tudo do plano Mínimo",
      "Página ou site de captação",
      "Dashboard de desempenho em tempo real",
      "Implementado no seu CRM (ou montamos um)",
      "1 Agente de I.A que atende leads automaticamente",
    ],
    notIncluded: ["Traqueamento avançado", "3 Agentes de I.A"],
  },
  {
    id: "maximo",
    name: "Máximo",
    icon: "🚀",
    priceBase: 3500,
    investRange: "R$ 500 – 1.000/dia",
    kicker: "Operação completa com I.A que escala",
    gradient: G.green,
    accent: "#10b981",
    highlight: "⚡ I.A escala a campanha que está vendendo de fato — não a mais barata.",
    items: [
      "Tudo do plano Médio",
      "Traqueamento avançado com I.A",
      "3 Agentes de I.A (SDR + Closer + Suporte)",
      "I.A realoca verba pra onde converte de verdade",
      "Relatório por criativo, conjunto e campanha",
    ],
  },
] as const;

const FLOW_STEPS = [
  "Criamos os criativos",
  "Campanha no ar",
  "I.A atende o lead",
  "Lead cai no CRM",
  "I.A escala o que vende",
];

const FLOW_BODIES = [
  "Copy, arte e segmentação feitos por nós. Você só aprova.",
  "Anúncios na Meta capturam leads novos todo dia, no piloto automático.",
  "Agente SDR qualifica na hora. Ninguém espera. Closer puxa pra venda.",
  "Lead qualificado vai pro seu WhatsApp e CRM. Foco só em fechar.",
  "Traqueamento lê quem converteu de verdade e joga mais verba pra esse criativo.",
];

const TABELA_ROWS = [
  { item: "Gestão de tráfego + criativos", min: true,   med: true,  max: true  },
  { item: "Leads no WhatsApp e CRM",        min: true,   med: true,  max: true  },
  { item: "Página ou site de captação",     min: false,  med: true,  max: true  },
  { item: "Dashboard de desempenho",        min: false,  med: true,  max: true  },
  { item: "Implementado no seu CRM",        min: false,  med: true,  max: true  },
  { item: "Agentes de I.A",                min: false,  med: "1",   max: "3"   },
  { item: "Traqueamento avançado",          min: false,  med: false, max: true  },
];

const FAQ_ITEMS = [
  {
    q: "Preciso pagar a verba de anúncio além da mensalidade?",
    a: "Sim. A mensalidade é gestão + I.A. A verba vai pra Meta na sua própria conta, sob seu controle — a partir de R$100/dia.",
  },
  {
    q: "Quem faz os criativos?",
    a: "A gente. Copy, arte e segmentação estão inclusos em todos os planos.",
  },
  {
    q: "Funciona pro meu produto?",
    a: "Sim, qualquer segmento. Implementamos desde o tráfego até a I.A que atende seus clientes — SDR ou Closer.",
  },
  {
    q: "O que é traqueamento avançado?",
    a: "Uma I.A que lê dados reais de conversão e escala onde tem resultado de verdade. Ex: cliente com margem veio da Campanha 1 / Conjunto 2 / Criativo 4 → +10% de verba ali.",
  },
  {
    q: "Os Agentes de I.A atendem sozinhos?",
    a: "Sim. SDR qualifica o lead imediatamente após o cadastro. Closer entra pra puxar pra venda. Tudo no seu WhatsApp e CRM.",
  },
  {
    q: "Posso trocar de plano depois?",
    a: "Sim. Sobe ou desce quando quiser. Sem fidelidade.",
  },
];

// ── Utilitários ───────────────────────────────────────────────────────────────

function fmtBRL(v: number) {
  return "R$ " + v.toLocaleString("pt-BR") + ",00";
}

function waLink(planName: string, contrato: "mensal" | "cinco") {
  const tipo = contrato === "cinco" ? "5 meses (-30%)" : "mês a mês";
  const text = encodeURIComponent(
    `Olá! Quero contratar o plano ${planName} (${tipo}) de Tráfego Pago da Acelera Corban.`
  );
  return `https://wa.me/${WA_NUMBER}?text=${text}`;
}

// ── Componentes compartilhados ────────────────────────────────────────────────

function BrainBadge({ color, gradient, size = 88 }: { color: string; gradient: string; size?: number }) {
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <div style={{
        position: "absolute", inset: 0, borderRadius: "50%",
        border: `2px dashed ${color}55`, animation: "ai-spin 16s linear infinite",
      }} />
      <div style={{
        position: "absolute", inset: 12, borderRadius: "50%",
        border: `1.5px dotted ${color}88`, animation: "ai-spin-rev 11s linear infinite",
      }} />
      <div style={{
        position: "absolute", top: "50%", left: "50%",
        width: size * 0.48, height: size * 0.48, borderRadius: "50%",
        background: gradient,
        transform: "translate(-50%, -50%)",
        animation: "ai-orb-pulse 2.6s ease-in-out infinite",
        filter: "blur(.4px)",
      }} />
    </div>
  );
}

function FlowCard({
  step, idx, color, body,
}: { step: string; idx: number; color: string; body: string }) {
  return (
    <div className="spot-card" style={{
      minHeight: 120,
      background: "rgba(255,255,255,.02)",
      border: "1px solid rgba(255,255,255,.07)",
      borderRadius: 12,
      padding: 16,
      position: "relative",
      overflow: "hidden",
      "--spot-color": color,
    } as React.CSSProperties}>
      <div className="spot-glow" />
      <div className="spot-shine" />
      <div style={{
        position: "absolute", inset: 0, opacity: idx === 0 ? 0.18 : 0.06,
        pointerEvents: "none",
        background: `radial-gradient(circle at top left, ${color} 0%, transparent 65%)`,
      }} />
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{
          color: "#fff", fontSize: 11, fontWeight: 900, letterSpacing: ".1em",
          background: color, padding: "3px 8px", borderRadius: 6,
          boxShadow: `0 2px 6px ${color}55`,
        }}>
          {String(idx + 1).padStart(2, "0")}
        </span>
        {idx === 0 && <PulseDot color={color} />}
      </div>
      <div style={{ position: "relative", color: C.text, fontSize: 13, fontWeight: 800, lineHeight: 1.25, marginBottom: 6 }}>
        {step}
      </div>
      <div style={{ position: "relative", color: C.sec, fontSize: 12, lineHeight: 1.5 }}>
        {body}
      </div>
    </div>
  );
}


function WaButton({
  href, label, gradient, color, large,
}: { href: string; label: string; gradient: string; color: string; large?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: large ? "16px 40px" : "12px 22px",
        borderRadius: 12,
        background: gradient,
        color: "#fff",
        textDecoration: "none",
        fontSize: large ? 16 : 14,
        fontWeight: 900,
        letterSpacing: ".03em",
        boxShadow: `0 4px 20px ${color}55`,
        transition: "opacity .2s, transform .2s",
        whiteSpace: "nowrap",
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.opacity = "0.88";
        (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.opacity = "1";
        (e.currentTarget as HTMLElement).style.transform = "none";
      }}
    >
      💬 {label}
    </a>
  );
}

function TableCheck({ ok }: { ok: boolean | string }) {
  if (ok === false) return <span style={{ color: "#1e293b", fontSize: 16 }}>—</span>;
  if (ok === true) return <span style={{ color: "#10b981", fontSize: 16, fontWeight: 900 }}>✓</span>;
  return <span style={{ color: "#06b6d4", fontSize: 12, fontWeight: 800 }}>{ok} ag.</span>;
}

// ── Página ────────────────────────────────────────────────────────────────────

export default function TrafegoPago() {
  const [contrato, setContrato] = useState<"mensal" | "cinco">("mensal");
  const [faqOpen, setFaqOpen] = useState<number | null>(null);

  const priceOf = (base: number) => contrato === "cinco" ? Math.round(base * 0.7) : base;
  const saving = (base: number) => contrato === "cinco" ? base - Math.round(base * 0.7) : 0;

  return (
    <div style={{
      minHeight: "100vh",
      background: C.bg,
      color: C.text,
      fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      padding: "28px 28px 80px",
    }}>
      <style>{SHARED_CSS}{TP_CSS}</style>

      <div style={{ maxWidth: 1040, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* ── HERO ── */}
        <section style={{ ...glassCard(G.primary, 36) }}>
          <div className="tp-hero" style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: 24,
            alignItems: "flex-start",
            marginBottom: 20,
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "rgba(124,58,237,.12)",
                border: "1px solid rgba(124,58,237,.3)",
                borderRadius: 100,
                padding: "5px 14px",
                fontSize: 10,
                fontWeight: 900,
                letterSpacing: ".14em",
                color: "#a78bfa",
                textTransform: "uppercase",
                marginBottom: 14,
              }}>
                <PulseDot color="#a78bfa" />
                Tráfego Pago + Inteligência Artificial
              </div>

              <h1 style={{
                fontSize: "clamp(26px, 3.8vw, 46px)",
                fontWeight: 900,
                lineHeight: 1.08,
                margin: "0 0 16px",
                background: G.primary,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                letterSpacing: "-.01em",
              }}>
                Sua base de leads vai acabar.<br />A torneira de leads novos, não.
              </h1>

              <p style={{ color: C.sec, fontSize: 15, lineHeight: 1.7, margin: "0 0 24px", maxWidth: 580 }}>
                Implementamos desde o tráfego pago até a I.A que atende seus clientes —
                SDR ou Closer, qualquer segmento. Leads novos todo dia, atendidos sozinhos,
                direto no seu WhatsApp e CRM.
              </p>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <WaButton
                  href={waLink("Médio", contrato)}
                  label="QUERO LIGAR A TORNEIRA"
                  gradient={G.primary}
                  color="#7c3aed"
                  large
                />
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  color: C.muted,
                  fontSize: 12,
                  fontWeight: 600,
                }}>
                  <span style={{
                    background: "rgba(16,185,129,.12)",
                    border: "1px solid rgba(16,185,129,.3)",
                    color: "#10b981",
                    borderRadius: 100,
                    padding: "2px 10px",
                    fontSize: 11,
                    fontWeight: 800,
                  }}>SEM FIDELIDADE</span>
                  Cancela quando quiser
                </div>
              </div>
            </div>

            <BrainBadge color="#7c3aed" gradient={G.primary} size={104} />
          </div>

          {/* KPIs rápidos */}
          <div className="tp-kpis" style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 12,
            borderTop: "1px solid rgba(255,255,255,.07)",
            paddingTop: 20,
            marginTop: 4,
          }}>
            {[
              { label: "Investimento mín.", value: "R$100/dia", color: "#a78bfa" },
              { label: "Qualquer segmento", value: "100%", color: "#06b6d4" },
              { label: "Agentes de I.A",  value: "Até 3",   color: "#10b981" },
              { label: "Fidelidade",      value: "Zero",    color: "#f59e0b" },
            ].map((k) => (
              <div key={k.label} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 900, color: k.color, letterSpacing: "-.01em" }}>{k.value}</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 3, fontWeight: 600 }}>{k.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── A DOR ── */}
        <section style={{ ...glassCard(G.red, 28) }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10, background: G.red,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 18, flexShrink: 0, boxShadow: "0 4px 12px rgba(239,68,68,.4)",
            }}>⚠️</div>
            <h2 style={{ ...sectionTitle(G.red), marginBottom: 0 }}>O PROBLEMA</h2>
          </div>

          <div className="tp-dor" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {[
              { title: "Sua base vai secar", body: "Você higieniza, dispara, converte — mas todo mês a base acaba. Sem fonte nova, você volta pro zero e recomeça." },
              { title: "Lead que espera, perde", body: "Lead pediu crédito agora. Se alguém não atende em 5 minutos, ele vai pro concorrente. Humano não consegue ser tão rápido." },
              { title: "Tráfego jogado fora", body: "A maioria roda anúncio no escuro. Mais verba no criativo errado = mais dinheiro no ralo. Sem dado, sem escala." },
              { title: "CRM deserto", body: "Sem lead novo entrando todo dia, o CRM fica parado e o time comercial perde ritmo." },
            ].map((card) => (
              <article key={card.title} className="spot-card" style={{
                background: "rgba(255,255,255,.02)",
                border: "1px solid rgba(255,255,255,.07)",
                borderRadius: 12,
                padding: 18,
                position: "relative",
                overflow: "hidden",
                "--spot-color": "#ef4444",
              } as React.CSSProperties}>
                <div className="spot-glow" />
                <div style={{
                  position: "absolute", inset: 0, opacity: 0.07, pointerEvents: "none",
                  background: "radial-gradient(circle at top right, #ef4444 0%, transparent 60%)",
                }} />
                <div style={{ position: "relative", color: "#f87171", fontSize: 13, fontWeight: 900, marginBottom: 8 }}>
                  {card.title}
                </div>
                <div style={{ position: "relative", color: C.sec, fontSize: 13, lineHeight: 1.6 }}>
                  {card.body}
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ── COMO FUNCIONA ── */}
        <section style={{ ...glassCard(G.primary, 24) }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 10, background: G.primary,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16, flexShrink: 0, boxShadow: "0 4px 12px rgba(124,58,237,.45)",
            }}>🗺</div>
            <h2 style={{ margin: 0, color: "#fff", fontSize: 14, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".14em" }}>
              Como funciona
            </h2>
          </div>

          <div className="tp-flow spot-grid" style={{
            display: "grid",
            gridTemplateColumns: `repeat(${FLOW_STEPS.length}, minmax(0, 1fr))`,
            gap: 10,
          }}>
            {FLOW_STEPS.map((step, i) => (
              <FlowCard key={step} step={step} idx={i} color="#7c3aed" body={FLOW_BODIES[i]} />
            ))}
          </div>
        </section>

        {/* ── PLANOS ── */}
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
            <div>
              <h2 style={{ ...sectionTitle(G.primary), marginBottom: 4 }}>Planos</h2>
              <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>
                * Mensalidade = gestão. Verba de anúncio à parte (na sua conta Meta)
              </p>
            </div>

            {/* Toggle */}
            <div style={{
              display: "flex",
              background: "rgba(255,255,255,.04)",
              border: "1px solid rgba(255,255,255,.08)",
              borderRadius: 12,
              padding: 4,
              gap: 4,
            }}>
              {(["mensal", "cinco"] as const).map((opt) => (
                <button
                  key={opt}
                  onClick={() => setContrato(opt)}
                  style={{
                    padding: "9px 18px",
                    borderRadius: 9,
                    border: "none",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 700,
                    background: contrato === opt
                      ? (opt === "cinco" ? G.green : G.primary)
                      : "transparent",
                    color: contrato === opt ? "#fff" : C.sec,
                    transition: "all .2s",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {opt === "mensal" ? "Mês a mês" : "5 meses"}
                  {opt === "cinco" && (
                    <span style={{
                      background: contrato === "cinco" ? "rgba(255,255,255,.2)" : "rgba(16,185,129,.2)",
                      border: contrato === "cinco" ? "none" : "1px solid rgba(16,185,129,.4)",
                      color: contrato === "cinco" ? "#fff" : "#10b981",
                      borderRadius: 100,
                      fontSize: 10,
                      fontWeight: 900,
                      padding: "1px 7px",
                    }}>-30%</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="tp-plans spot-grid" style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 16,
            alignItems: "start",
          }}>
            {PLANS.map((p) => (
              <div
                key={p.id}
                className="spot-card"
                style={{
                  ...glassCard(p.gradient, 28),
                  position: "relative",
                  "--spot-color": p.accent,
                  ...(("popular" in p && p.popular) ? { transform: "scale(1.02)" } : {}),
                } as React.CSSProperties}
              >
                <div className="spot-glow" />

                {"popular" in p && p.popular && (
                  <div style={{
                    position: "absolute",
                    top: -14,
                    left: "50%",
                    transform: "translateX(-50%)",
                    background: G.primary,
                    color: "#fff",
                    borderRadius: 100,
                    fontSize: 10,
                    fontWeight: 900,
                    padding: "4px 16px",
                    letterSpacing: ".08em",
                    whiteSpace: "nowrap",
                    boxShadow: "0 4px 16px rgba(124,58,237,.55)",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                  }}>
                    <PulseDot color="#fff" />
                    MAIS POPULAR
                  </div>
                )}

                {/* Header */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: p.gradient,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 18, flexShrink: 0,
                    boxShadow: `0 4px 12px ${p.accent}55`,
                  }}>{p.icon}</div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 800, color: p.accent, letterSpacing: ".12em", textTransform: "uppercase" }}>
                      Plano
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: C.text }}>{p.name}</div>
                  </div>
                </div>

                {/* Preço */}
                <div style={{ marginBottom: 4 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span style={{
                      fontSize: 38, fontWeight: 900, color: C.text,
                      background: p.gradient,
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                      backgroundClip: "text",
                    }}>
                      {fmtBRL(priceOf(p.priceBase))}
                    </span>
                    <span style={{ fontSize: 12, color: C.muted }}>/mês</span>
                  </div>

                  {contrato === "cinco" && (
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                      <span style={{ textDecoration: "line-through" }}>{fmtBRL(p.priceBase)}</span>
                      <span style={{ color: "#10b981", fontWeight: 700, marginLeft: 8 }}>
                        Economia {fmtBRL(saving(p.priceBase))}/mês
                      </span>
                    </div>
                  )}
                </div>

                {/* Verba */}
                <div style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: "rgba(255,255,255,.05)",
                  border: "1px solid rgba(255,255,255,.09)",
                  borderRadius: 8,
                  padding: "4px 11px",
                  fontSize: 11,
                  color: C.sec,
                  marginBottom: 14,
                }}>
                  📊 Verba: {p.investRange}/dia (à parte)
                </div>

                {/* Barra progresso visual */}
                <div style={{ marginBottom: 16 }}>
                  <GradientBar
                    pct={p.id === "minimo" ? 33 : p.id === "medio" ? 66 : 100}
                    gradient={p.gradient}
                    height={4}
                  />
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>{p.kicker}</div>
                </div>

                {"bonus" in p && p.bonus && (
                  <div style={{
                    background: "rgba(6,182,212,.1)",
                    border: "1px solid rgba(6,182,212,.25)",
                    borderRadius: 9,
                    padding: "9px 13px",
                    fontSize: 12,
                    color: "#06b6d4",
                    fontWeight: 700,
                    marginBottom: 14,
                  }}>
                    {p.bonus}
                  </div>
                )}

                {"highlight" in p && p.highlight && (
                  <div style={{
                    background: "rgba(16,185,129,.08)",
                    border: "1px solid rgba(16,185,129,.2)",
                    borderRadius: 9,
                    padding: "9px 13px",
                    fontSize: 12,
                    color: "#10b981",
                    fontWeight: 600,
                    lineHeight: 1.5,
                    marginBottom: 14,
                  }}>
                    {p.highlight}
                  </div>
                )}

                {/* Items */}
                <div className="spot-list" style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
                  {p.items.map((item, i) => (
                    <div key={i} className="spot-row" style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                      background: "rgba(255,255,255,.02)",
                      border: "1px solid rgba(255,255,255,.05)",
                      borderRadius: 8,
                      padding: "8px 10px",
                      fontSize: 12,
                      color: C.sec,
                      lineHeight: 1.4,
                      position: "relative",
                      "--spot-color": p.accent,
                    } as React.CSSProperties}>
                      <div className="spot-glow" />
                      <span style={{ color: p.accent, flexShrink: 0, fontWeight: 900, fontSize: 14 }}>✓</span>
                      <span style={{ position: "relative" }}>{item}</span>
                    </div>
                  ))}
                  {("notIncluded" in p ? p.notIncluded : []).map((item, i) => (
                    <div key={"no-" + i} style={{
                      display: "flex",
                      gap: 8,
                      padding: "4px 10px",
                      fontSize: 12,
                      color: "#334155",
                      lineHeight: 1.4,
                      opacity: 0.5,
                    }}>
                      <span>—</span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>

                <WaButton
                  href={waLink(p.name, contrato)}
                  label={`Quero o plano ${p.name}`}
                  gradient={p.gradient}
                  color={p.accent}
                />
              </div>
            ))}
          </div>
        </section>

        {/* ── TABELA COMPARATIVA ── */}
        <Section title="O QUE ESTÁ INCLUÍDO" icon="📋" gradient={G.primary}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "10px 14px", color: C.muted, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", borderBottom: "1px solid rgba(255,255,255,.07)" }}>
                    Item
                  </th>
                  {(["Mínimo", "Médio", "Máximo"] as const).map((n, i) => (
                    <th key={n} style={{
                      textAlign: "center", padding: "10px 14px",
                      color: [PLANS[0].accent, PLANS[1].accent, PLANS[2].accent][i],
                      fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".08em",
                      borderBottom: "1px solid rgba(255,255,255,.07)",
                    }}>{n}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TABELA_ROWS.map((row, i) => (
                  <tr key={i} className="tp-tr" style={{ borderBottom: i < TABELA_ROWS.length - 1 ? "1px solid rgba(255,255,255,.04)" : "none" }}>
                    <td style={{ padding: "12px 14px", fontSize: 13, color: C.sec }}>{row.item}</td>
                    <td style={{ textAlign: "center", padding: "12px 14px" }}><TableCheck ok={row.min} /></td>
                    <td style={{ textAlign: "center", padding: "12px 14px" }}><TableCheck ok={row.med} /></td>
                    <td style={{ textAlign: "center", padding: "12px 14px" }}><TableCheck ok={row.max} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ── GARANTIAS ── */}
        <div className="tp-garantias" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ ...glassCard(G.purple, 28) }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <BrainBadge color="#a78bfa" gradient={G.purple} size={52} />
              <div>
                <div style={{ ...sectionTitle(G.purple), marginBottom: 4, fontSize: 10 }}>Contrato</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: C.text }}>Sem Fidelidade</div>
              </div>
            </div>
            <p style={{ color: C.sec, fontSize: 13, margin: 0, lineHeight: 1.7 }}>
              Não amarra. Mês a mês, no seu ritmo. Não curtiu — cancela. Sem multa, sem burocracia.
            </p>
          </div>

          <div style={{ ...glassCard(G.green, 28) }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <BrainBadge color="#10b981" gradient={G.green} size={52} />
              <div>
                <div style={{ ...sectionTitle(G.green), marginBottom: 4, fontSize: 10 }}>Desconto</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: C.text }}>30% em 5 meses</div>
              </div>
            </div>
            <p style={{ color: C.sec, fontSize: 13, margin: 0, lineHeight: 1.7 }}>
              Feche 5 meses e economize 30% no total. Compromisso que vale a pena quando os resultados chegam.
            </p>
            {contrato === "mensal" && (
              <button
                onClick={() => setContrato("cinco")}
                style={{
                  marginTop: 14,
                  background: G.green,
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 16px",
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Ver preços com -30% ↑
              </button>
            )}
          </div>
        </div>

        {/* ── FAQ ── */}
        <Section title="PERGUNTAS FREQUENTES" icon="❓" gradient={G.purple}>
          <div className="spot-list" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {FAQ_ITEMS.map((faq, i) => (
              <div
                key={i}
                className="spot-row"
                onClick={() => setFaqOpen(faqOpen === i ? null : i)}
                style={{
                  background: "rgba(255,255,255,.025)",
                  border: "1px solid rgba(255,255,255,.06)",
                  borderRadius: 10,
                  padding: "14px 16px",
                  cursor: "pointer",
                  position: "relative",
                  "--spot-color": "#7c3aed",
                } as React.CSSProperties}
              >
                <div className="spot-glow" />
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 16,
                  position: "relative",
                }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.text, lineHeight: 1.4 }}>{faq.q}</span>
                  <span style={{
                    color: "#a78bfa", fontSize: 18, flexShrink: 0,
                    transition: "transform .2s",
                    transform: faqOpen === i ? "rotate(45deg)" : "none",
                  }}>+</span>
                </div>
                {faqOpen === i && (
                  <p style={{ fontSize: 13, color: C.sec, margin: "10px 0 0", lineHeight: 1.7, position: "relative" }}>
                    {faq.a}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Section>

        {/* ── CTA FINAL ── */}
        <section style={{ ...glassCard(G.primary, 48), textAlign: "center" }}>
          <BrainBadge color="#7c3aed" gradient={G.primary} size={80} />
          <div style={{ marginTop: 20 }} />

          <h2 style={{
            fontSize: 32,
            fontWeight: 900,
            margin: "0 0 12px",
            background: G.primary,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}>
            Pronto pra ligar a torneira?
          </h2>
          <p style={{ color: C.sec, fontSize: 15, margin: "0 0 28px", lineHeight: 1.7 }}>
            Fala com a gente no WhatsApp. Em até 24h montamos o plano certo pro seu segmento.
          </p>

          <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
            {PLANS.map((p) => (
              <WaButton
                key={p.id}
                href={waLink(p.name, contrato)}
                label={`Plano ${p.name}`}
                gradient={p.gradient}
                color={p.accent}
              />
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "center", gap: 20, flexWrap: "wrap" }}>
            {["Sem fidelidade", "Qualquer segmento", "I.A que atende por você"].map((tag) => (
              <span key={tag} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: C.muted }}>
                <PulseDot color="#7c3aed" />
                {tag}
              </span>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}

const TP_CSS = `
  .tp-tr:hover { background: rgba(255,255,255,.03); }
  @media (max-width: 900px) {
    .tp-hero { grid-template-columns: 1fr !important; }
    .tp-kpis { grid-template-columns: repeat(2, 1fr) !important; }
    .tp-plans { grid-template-columns: 1fr !important; }
    .tp-flow { grid-template-columns: repeat(2, 1fr) !important; }
    .tp-dor  { grid-template-columns: 1fr !important; }
    .tp-garantias { grid-template-columns: 1fr !important; }
  }
  @media (max-width: 560px) {
    .tp-kpis { grid-template-columns: repeat(2, 1fr) !important; }
    .tp-flow { grid-template-columns: 1fr !important; }
  }
`;
