import { useEffect, useState, useCallback, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { crmApi, crmSettingsApi, v8ProposalsApi } from "../lib/api";
import { useSession } from "../hooks/useSession";
import type { CrmProposta, CrmStats, CrmStatus } from "../lib/types";
import {
  C, G, glassCard, sectionTitle, btnStyle, INPUT_STYLE, SHARED_CSS,
  PulseDot, GradientBar,
} from "../components/disparo-shared";

// CRM-specific palette (kanban columns, status colors)
const CC = {
  blue:   "#06b6d4",
  green:  "#10b981",
  purple: "#7c3aed",
  red:    "#ef4444",
  gold:   "#f59e0b",
  pink:   "#ec4899",
  orange: "#fb923c",
  cyan:   "#06b6d4",
} as const;

const COLUNAS: { key: CrmStatus; label: string; cor: string; grad: string; icon: string }[] = [
  { key: "propostas",  label: "PAGOS",       cor: CC.blue,   grad: G.cyan,   icon: "💰" },
  { key: "karol",      label: "KAROL",       cor: "#ec4899",  grad: G.pink,   icon: "👤" },
  { key: "giovanna",   label: "GIOVANNA",    cor: "#a855f7",  grad: G.purple, icon: "👤" },
  { key: "gabriel",    label: "GABRIEL/I.A", cor: CC.green,  grad: G.green,  icon: "🤖" },
  { key: "importante", label: "IMPORTANTE",  cor: CC.gold,   grad: G.yellow, icon: "⭐" },
  { key: "pendentes",  label: "PENDENTES",   cor: CC.orange, grad: G.yellow, icon: "⏳" },
  { key: "leilao",     label: "LEILÃO",      cor: CC.purple, grad: G.purple, icon: "🔨" },
  { key: "fgts",       label: "FGTS",        cor: "#00c896",  grad: G.green,  icon: "💚" },
];

const BANCOS = ["V8", "Zilli", "Novo Saque", "VCTex", "Pan", "Facta", "C6", "Mercantil", "2S", "Soma"];

const fmtMoeda = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtMoedaCompacto = (v: number): string => {
  if (v >= 1_000_000) return `R$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `R$${(v / 1_000).toFixed(0)}k`;
  return fmtMoeda(v);
};

const parseMoney = (v: string): number => {
  const clean = v.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : n;
};

const fmtCpf = (s: string) =>
  s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");

const fmtData = (s: string | null | undefined) => {
  if (!s) return "—";
  const parts = s.split("-");
  if (parts.length !== 3) return s;
  const [y, m, d] = parts;
  return `${d}/${m}/${y}`;
};

const diasAtras = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (diff === 0) return "hoje";
  if (diff === 1) return "1d";
  return `${diff}d`;
};

function computeStats(proposals: CrmProposta[], pendingCount: number): CrmStats {
  const by_status: Record<string, number> = {};
  const by_banco: Record<string, number> = {};
  const by_vendedor: Record<string, number> = {};
  let total_valor = 0;
  for (const p of proposals) {
    by_status[p.status] = (by_status[p.status] || 0) + 1;
    by_banco[p.banco] = (by_banco[p.banco] || 0) + 1;
    by_vendedor[p.nome_vendedor] = (by_vendedor[p.nome_vendedor] || 0) + (p.valor || 0);
    total_valor += p.valor || 0;
  }
  const total = proposals.length;
  const ranking = Object.entries(by_vendedor)
    .map(([nome, tot]) => ({ nome, total: Math.round(tot * 100) / 100 }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
  return {
    total,
    total_valor: Math.round(total_valor * 100) / 100,
    ticket_medio: total ? Math.round(total_valor / total * 100) / 100 : 0,
    by_status,
    by_banco,
    ranking,
    pending_count: pendingCount,
  };
}

// ── BrainBadge ───────────────────────────────────────────────────────────────
function BrainBadge({ color, loading }: { color: string; loading?: boolean }) {
  const mult = loading ? 0.4 : 1;
  return (
    <div style={{ position: 'relative', width: 92, height: 92, flexShrink: 0 }}>
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
      }}>📊</div>
    </div>
  );
}

// ── KPI card ─────────────────────────────────────────────────────────────────
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
        color, fontSize: 28, fontWeight: 900, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums',
        position: 'relative',
      }}>
        {value}
      </div>
      {sub && <div style={{ color: C.sec, fontSize: 11, marginTop: 8, position: 'relative' }}>{sub}</div>}
    </div>
  );
}

// ─── Modal de senha CRM ──────────────────────────────────────────────────────
interface CrmPasswordModalProps {
  action: "criar" | "apagar";
  onConfirm: (password: string) => void;
  onCancel: () => void;
}

function CrmPasswordModal({ action, onConfirm, onCancel }: CrmPasswordModalProps) {
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState("");

  const confirm = () => {
    if (!pwd.trim()) { setErr("Digite a senha CRM"); return; }
    onConfirm(pwd);
  };

  return (
    <div onClick={onCancel} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.8)", zIndex: 10000,
      display: "flex", alignItems: "center", justifyContent: "center",
      backdropFilter: 'blur(6px)',
    }}>
      <div onClick={e => e.stopPropagation()} style={{ ...glassCard(G.yellow, 28), width: 360 }}>
        <div style={{ ...sectionTitle(G.yellow), marginBottom: 8, fontSize: 13 }}>Senha CRM</div>
        <div style={{ color: C.text, fontSize: 18, fontWeight: 800, marginBottom: 6 }}>
          🔒 Confirme a ação
        </div>
        <p style={{ fontSize: 13, color: C.sec, marginBottom: 18, lineHeight: 1.5 }}>
          Para {action === "criar" ? "adicionar" : "apagar"} esta proposta, insira a senha de segurança configurada pelo admin.
        </p>
        <input
          autoFocus
          type="password"
          value={pwd}
          onChange={e => setPwd(e.target.value)}
          onKeyDown={e => e.key === "Enter" && confirm()}
          placeholder="Senha CRM…"
          className="ds-input"
          style={INPUT_STYLE}
        />
        {err && <div style={{ color: C.red, fontSize: 12, marginTop: 8 }}>{err}</div>}
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button onClick={confirm} className="ds-btn" style={{ ...btnStyle(G.yellow), flex: 1 }}>
            Confirmar
          </button>
          <button onClick={onCancel} className="ds-btn" style={{
            flex: 1, padding: '12px 24px', borderRadius: 10,
            background: 'rgba(255,255,255,.04)', color: C.sec,
            border: '1px solid rgba(255,255,255,.08)', cursor: 'pointer',
            fontSize: 15, fontWeight: 600,
          }}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de cadastro ───────────────────────────────────────────────────────
interface ModalProps {
  onClose: () => void;
  onSaved: (p: CrmProposta) => void;
  editing?: CrmProposta | null;
  hasCrmPassword: boolean;
  defaultStatus?: CrmStatus;
}

function PropostaModal({ onClose, onSaved, editing, hasCrmPassword, defaultStatus }: ModalProps) {
  const [form, setForm] = useState({
    nome_vendedor: editing?.nome_vendedor ?? "",
    banco: editing?.banco ?? BANCOS[0],
    cliente_cpf: editing?.cliente_cpf ?? "",
    cliente_nome: editing?.cliente_nome ?? "",
    data_venda: editing?.data_venda ?? new Date().toISOString().slice(0, 10),
    valor: editing?.valor?.toString() ?? "",
    prazo: editing?.prazo?.toString() ?? "",
    parcela: editing?.parcela?.toString() ?? "",
    codigo_proposta: editing?.codigo_proposta ?? "",
    status: editing?.status ?? defaultStatus ?? "propostas",
    banco_custom: "",
  });
  const [bancoCustom, setBancoCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showPwdModal, setShowPwdModal] = useState(false);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const submit = (crm_password?: string) => {
    setBusy(true);
    setErr(null);
    const bancoFinal = bancoCustom ? form.banco_custom.trim() : form.banco;
    if (!bancoFinal) { setErr("Banco obrigatório"); setBusy(false); return; }
    const payload = {
      nome_vendedor: form.nome_vendedor.trim(),
      banco: bancoFinal,
      cliente_cpf: form.cliente_cpf,
      cliente_nome: form.cliente_nome.trim(),
      data_venda: form.data_venda,
      valor: parseMoney(form.valor),
      prazo: parseInt(form.prazo),
      parcela: parseMoney(form.parcela),
      codigo_proposta: form.codigo_proposta.trim(),
      status: form.status as CrmProposta["status"],
      ...(crm_password ? { crm_password } : {}),
    };
    const call = editing
      ? crmApi.atualizar(editing.id, payload)
      : crmApi.criar(payload);
    call
      .then(result => { setBusy(false); onSaved(result); })
      .catch(e => { setErr(e?.response?.data?.detail ?? "Erro ao salvar"); setBusy(false); });
  };

  const save = () => {
    if (!form.nome_vendedor.trim()) { setErr("Nome do vendedor obrigatório"); return; }
    if (!form.cliente_cpf.trim()) { setErr("CPF obrigatório"); return; }
    if (!form.valor || parseMoney(form.valor) <= 0) { setErr("Valor inválido"); return; }
    if (!form.prazo || isNaN(parseInt(form.prazo))) { setErr("Prazo inválido"); return; }
    if (!form.parcela || parseMoney(form.parcela) <= 0) { setErr("Parcela inválida"); return; }

    if (!editing && hasCrmPassword) {
      setShowPwdModal(true);
    } else {
      submit();
    }
  };

  const label: React.CSSProperties = {
    fontSize: 11, color: C.sec, fontWeight: 800, letterSpacing: '.08em',
    textTransform: 'uppercase', display: "block", marginBottom: 6,
  };
  const grad = editing ? G.cyan : G.green;

  return (
    <>
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 9999,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        backdropFilter: 'blur(6px)',
      }}>
        <div onClick={e => e.stopPropagation()} style={{
          ...glassCard(grad, 28),
          width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto",
        }}>
          <div style={{ ...sectionTitle(grad), fontSize: 12, marginBottom: 6 }}>
            {editing ? "Editar" : "Cadastro"}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 22, letterSpacing: 0 }}>
            {editing ? "✏️ Editar Proposta" : "➕ Nova Proposta"}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={label}>Nome do Vendedor *</label>
              <input className="ds-input" style={INPUT_STYLE} value={form.nome_vendedor}
                onChange={e => set("nome_vendedor", e.target.value)} placeholder="Ex: João Silva" />
            </div>

            <div>
              <label style={label}>Banco *</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                {BANCOS.map(b => (
                  <button key={b} onClick={() => { setBancoCustom(false); set("banco", b); }}
                    style={{
                      padding: "5px 12px", borderRadius: 12,
                      border: `1px solid ${(!bancoCustom && form.banco === b) ? CC.purple : 'rgba(255,255,255,.08)'}`,
                      background: (!bancoCustom && form.banco === b) ? `${CC.purple}22` : "transparent",
                      color: (!bancoCustom && form.banco === b) ? CC.purple : C.sec,
                      fontSize: 12, fontWeight: 700, cursor: "pointer",
                    }}>
                    {b}
                  </button>
                ))}
                <button onClick={() => setBancoCustom(true)}
                  style={{
                    padding: "5px 12px", borderRadius: 12,
                    border: `1px solid ${bancoCustom ? CC.cyan : 'rgba(255,255,255,.08)'}`,
                    background: bancoCustom ? `${CC.cyan}22` : "transparent",
                    color: bancoCustom ? CC.cyan : C.sec,
                    fontSize: 12, fontWeight: 700, cursor: "pointer",
                  }}>
                  + Personalizado
                </button>
              </div>
              {bancoCustom && (
                <input className="ds-input" style={INPUT_STYLE} value={form.banco_custom}
                  onChange={e => set("banco_custom", e.target.value)} placeholder="Nome do banco..." />
              )}
            </div>

            <div>
              <label style={label}>Nome do Cliente</label>
              <input className="ds-input" style={INPUT_STYLE} value={form.cliente_nome}
                onChange={e => set("cliente_nome", e.target.value)} placeholder="Ex: Maria Santos" />
            </div>

            <div>
              <label style={label}>CPF do Cliente *</label>
              <input className="ds-input" style={INPUT_STYLE} value={form.cliente_cpf}
                onChange={e => set("cliente_cpf", e.target.value)} placeholder="000.000.000-00" maxLength={14} />
            </div>

            <div>
              <label style={label}>Data da Venda *</label>
              <input type="date" className="ds-input" style={INPUT_STYLE} value={form.data_venda}
                onChange={e => set("data_venda", e.target.value)} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <div>
                <label style={label}>Valor (R$) *</label>
                <input className="ds-input" style={INPUT_STYLE} type="text" inputMode="decimal"
                  value={form.valor} onChange={e => set("valor", e.target.value)} placeholder="4.780,00" />
              </div>
              <div>
                <label style={label}>Prazo *</label>
                <input className="ds-input" style={INPUT_STYLE} type="number" min="1"
                  value={form.prazo} onChange={e => set("prazo", e.target.value)} placeholder="84" />
              </div>
              <div>
                <label style={label}>Parcela (R$) *</label>
                <input className="ds-input" style={INPUT_STYLE} type="text" inputMode="decimal"
                  value={form.parcela} onChange={e => set("parcela", e.target.value)} placeholder="450,00" />
              </div>
            </div>

            <div>
              <label style={label}>Código da Proposta</label>
              <input className="ds-input" style={INPUT_STYLE} value={form.codigo_proposta}
                onChange={e => set("codigo_proposta", e.target.value)} placeholder="Opcional" />
            </div>

            <div>
              <label style={label}>Coluna inicial</label>
              <select className="ds-select" value={form.status}
                onChange={e => set("status", e.target.value)}
                style={{ ...INPUT_STYLE, cursor: 'pointer' }}>
                {COLUNAS.map(c => <option key={c.key} value={c.key} style={{ background: '#0d0d1f', color: C.text }}>{c.icon} {c.label}</option>)}
              </select>
            </div>
          </div>

          {err && (
            <div style={{
              marginTop: 14, color: C.red, fontSize: 13,
              background: `${C.red}10`, border: `1px solid ${C.red}33`,
              borderRadius: 8, padding: '8px 12px',
            }}>
              {err}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
            <button onClick={save} disabled={busy} className="ds-btn"
              style={{ ...btnStyle(grad, busy), flex: 1 }}>
              {busy ? "Salvando…" : "Salvar"}
            </button>
            <button onClick={onClose} className="ds-btn" style={{
              flex: 1, padding: '12px 24px', borderRadius: 10,
              background: 'rgba(255,255,255,.04)', color: C.sec,
              border: '1px solid rgba(255,255,255,.08)', cursor: 'pointer',
              fontSize: 15, fontWeight: 600,
            }}>
              Cancelar
            </button>
          </div>
        </div>
      </div>
      {showPwdModal && (
        <CrmPasswordModal
          action="criar"
          onConfirm={pwd => { setShowPwdModal(false); submit(pwd); }}
          onCancel={() => setShowPwdModal(false)}
        />
      )}
    </>
  );
}

// ─── Card de proposta ────────────────────────────────────────────────────────
interface CardProps {
  proposta: CrmProposta;
  isAdmin: boolean;
  isDragging?: boolean;
  onEdit: (p: CrmProposta) => void;
  onDelete: (id: string) => void;
  onApprove?: (id: string) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
}

function PropostaCard({ proposta: p, isAdmin, isDragging, onEdit, onDelete, onApprove, onDragStart, onDragEnd }: CardProps) {
  const cor = COLUNAS.find(c => c.key === p.status)?.cor ?? CC.blue;
  const isPending = !p.approved;
  const idade = diasAtras(p.updated_at);
  const accent = isPending ? CC.gold : cor;

  return (
    <div
      className="spot-card"
      draggable={p.approved}
      onDragStart={e => p.approved && onDragStart(e, p.id)}
      onDragEnd={onDragEnd}
      style={{
        background: isPending ? "rgba(245,158,11,.05)" : 'rgba(255,255,255,.02)',
        border: `1px solid ${isPending ? "rgba(245,158,11,.28)" : 'rgba(255,255,255,.07)'}`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 10, padding: "12px 14px", marginBottom: 8,
        cursor: p.approved ? "grab" : "default",
        opacity: isDragging ? 0.35 : (isPending ? 0.92 : 1),
        transform: isDragging ? "scale(0.97)" : "scale(1)",
        boxShadow: isDragging ? "none" : "0 1px 4px rgba(0,0,0,.4)",
        userSelect: "none",
        WebkitUserSelect: "none",
        position: 'relative',
        '--spot-color': accent,
      } as any}
    >
      <div className="spot-glow" />
      <div style={{ position: 'relative' }}>
        {isPending && (
          <div style={{
            fontSize: 10, fontWeight: 800, color: CC.gold,
            background: "rgba(245,158,11,.12)", border: "1px solid rgba(245,158,11,.28)",
            borderRadius: 6, padding: "2px 8px", display: "inline-block", marginBottom: 6,
            letterSpacing: '.06em', textTransform: 'uppercase',
          }}>
            ⏳ Aguardando Aprovação
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4, flex: 1, marginRight: 6 }}>
            {p.nome_vendedor}
          </div>
          <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
            {isAdmin && isPending && onApprove && (
              <button onClick={() => onApprove(p.id)} title="Aprovar proposta"
                style={{
                  background: "rgba(16,185,129,.14)", border: "1px solid rgba(16,185,129,.4)",
                  color: CC.green, cursor: "pointer", fontSize: 12,
                  borderRadius: 6, padding: "3px 8px", fontWeight: 700,
                }}>
                ✓
              </button>
            )}
            <button onClick={() => onEdit(p)}
              style={{
                background: "rgba(255,255,255,.06)", border: '1px solid rgba(255,255,255,.08)',
                color: C.sec, cursor: "pointer", fontSize: 12,
                borderRadius: 6, padding: "3px 8px",
              }}>
              ✏️
            </button>
            {isAdmin && (
              <button onClick={() => onDelete(p.id)}
                style={{
                  background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.25)",
                  color: CC.red, cursor: "pointer", fontSize: 12,
                  borderRadius: 6, padding: "3px 7px",
                }}>
                🗑
              </button>
            )}
          </div>
        </div>
        <div style={{ fontSize: 11, color: accent, fontWeight: 800, marginBottom: 3, letterSpacing: '.04em' }}>
          {p.banco}
        </div>
        {p.cliente_nome && (
          <div style={{ fontSize: 12, color: C.text, fontWeight: 600, marginBottom: 2 }}>{p.cliente_nome}</div>
        )}
        <div style={{ fontSize: 11, color: C.sec }}>{fmtCpf(p.cliente_cpf)}</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
          <span style={{ fontSize: 13, color: CC.green, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
            {fmtMoeda(p.valor)}
          </span>
          <span style={{ fontSize: 11, color: C.sec }}>{p.prazo}x {fmtMoeda(p.parcela)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}>
          {p.codigo_proposta ? (
            <span style={{ fontSize: 10, color: C.muted }}>#{p.codigo_proposta}</span>
          ) : <span />}
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ fontSize: 10, color: C.muted }}>{fmtData(p.data_venda)}</span>
            {idade && (
              <span style={{
                fontSize: 10, color: C.sec,
                background: "rgba(255,255,255,.06)", borderRadius: 4, padding: "1px 5px",
              }}>
                {idade}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Card glass shell (sidebar/stats) ────────────────────────────────────────
function CardShell({ title, gradient, icon, children, action }: {
  title: string; gradient: string; icon: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div style={glassCard(gradient, 18)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 9, background: gradient,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, flexShrink: 0, boxShadow: '0 4px 12px rgba(0,0,0,.3)',
        }}>{icon}</div>
        <h2 style={{ ...sectionTitle(gradient), marginBottom: 0, fontSize: 12, flex: 1, minWidth: 0 }}>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </div>
  );
}

// ─── Sidebar de stats ────────────────────────────────────────────────────────
function StatsSidebar({ stats, isAdmin }: { stats: CrmStats | null; isAdmin: boolean }) {
  if (!stats) return null;
  const barData = stats.ranking.map(r => ({ name: r.nome.split(" ")[0], valor: r.total }));

  return (
    <div style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: 14 }}>
      <CardShell title="Resumo" gradient={G.green} icon="💰">
        <div style={{ fontSize: 26, fontWeight: 900, color: CC.green, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
          {fmtMoeda(stats.total_valor)}
        </div>
        <div style={{ fontSize: 12, color: C.sec, marginTop: 4 }}>
          {stats.total} propostas · ticket médio {fmtMoeda(stats.ticket_medio)}
        </div>
        {isAdmin && (stats.pending_count ?? 0) > 0 && (
          <div style={{
            marginTop: 12, padding: "8px 12px",
            background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.3)",
            borderRadius: 8, fontSize: 12, color: CC.gold, fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <PulseDot color={CC.gold} />
            {stats.pending_count} aguardando aprovação
          </div>
        )}
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
          {COLUNAS.map(c => (
            <div key={c.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ color: c.cor, fontWeight: 600 }}>{c.icon} {c.label}</span>
              <span style={{ color: C.text, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{stats.by_status[c.key] ?? 0}</span>
            </div>
          ))}
        </div>
      </CardShell>

      <CardShell title="Ranking Vendedores" gradient={G.yellow} icon="🏆">
        {stats.ranking.slice(0, 5).map((r, i) => (
          <div key={r.nome} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{
              fontSize: 13, color: [CC.gold, "#c0c0c0", "#cd7f32"][i] ?? C.muted,
              fontWeight: 800, width: 22, textAlign: "center",
            }}>
              {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: C.text, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.nome}</div>
              <div style={{ fontSize: 11, color: CC.green, fontVariantNumeric: 'tabular-nums' }}>{fmtMoeda(r.total)}</div>
            </div>
          </div>
        ))}
        {stats.ranking.length === 0 && (
          <div style={{ color: C.muted, fontSize: 12, padding: 6 }}>Sem dados ainda.</div>
        )}
      </CardShell>

      {barData.length > 0 && (
        <CardShell title="Contratos por Vendedor" gradient={G.purple} icon="📈">
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={barData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fill: C.sec, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: C.sec, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ background: "#0d0d1f", border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, color: C.text, fontSize: 12 }}
                formatter={(v: number) => fmtMoeda(v)}
              />
              <Bar dataKey="valor" fill={CC.purple} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardShell>
      )}

      <CardShell title="Por Banco" gradient={G.cyan} icon="🏦">
        {Object.entries(stats.by_banco).sort((a, b) => b[1] - a[1]).map(([banco, n]) => {
          const total = Object.values(stats.by_banco).reduce((s, v) => s + v, 0);
          const pct = total > 0 ? (n / total) * 100 : 0;
          return (
            <div key={banco} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                <span style={{ color: C.sec, fontWeight: 600 }}>{banco}</span>
                <span style={{ color: C.text, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{n}</span>
              </div>
              <GradientBar pct={pct} gradient={G.cyan} height={3} />
            </div>
          );
        })}
        {Object.keys(stats.by_banco).length === 0 && (
          <div style={{ color: C.muted, fontSize: 12, padding: 6 }}>Sem dados ainda.</div>
        )}
      </CardShell>
    </div>
  );
}

// ─── Toast ───────────────────────────────────────────────────────────────────
function MoveToast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div style={{
      position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)",
      background: `linear-gradient(rgba(15,15,35,.95), rgba(15,15,35,.95)) padding-box, ${G.primary} border-box`,
      border: '1.5px solid transparent',
      borderRadius: 999,
      padding: "10px 22px", color: C.text, fontSize: 14, fontWeight: 700,
      zIndex: 20000, pointerEvents: "none",
      boxShadow: "0 8px 32px rgba(0,0,0,.6)",
      animation: "fade-up .25s ease",
      display: 'inline-flex', alignItems: 'center', gap: 8,
    }}>
      <PulseDot color="#06b6d4" />
      {msg}
    </div>
  );
}

// ─── Página principal ────────────────────────────────────────────────────────
export default function CRM() {
  const { isAdmin } = useSession();
  const [propostas, setPropostas] = useState<CrmProposta[]>([]);
  const [pendentes, setPendentes] = useState<CrmProposta[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [hasCrmPassword, setHasCrmPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<CrmProposta | null>(null);
  const [addingToCol, setAddingToCol] = useState<CrmStatus | null>(null);
  const [bancFiltro, setBancFiltro] = useState<string>("todos");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [search, setSearch] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [showTab, setShowTab] = useState<"kanban" | "pendentes">("kanban");
  const [syncStatus, setSyncStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [syncResult, setSyncResult] = useState<{ added: number; skipped: number; errors: number } | null>(null);
  const [moveToast, setMoveToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setMoveToast(msg);
    setTimeout(() => setMoveToast(null), 2000);
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (bancFiltro !== "todos") params.banco = bancFiltro;
      if (dataInicio) params.data_inicio = dataInicio;
      if (dataFim) params.data_fim = dataFim;
      const [data, cfg, statsCfg] = await Promise.all([
        crmApi.listar(params),
        crmSettingsApi.get(),
        crmApi.stats(),
      ]);
      setPropostas(data.filter(p => p.approved));
      setPendentes(data.filter(p => !p.approved));
      setPendingCount(statsCfg.pending_count);
      setHasCrmPassword(cfg.has_crm_password);
      setErr(null);
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? "Erro ao carregar propostas");
    } finally { setLoading(false); }
  }, [bancFiltro, dataInicio, dataFim]);

  useEffect(() => { refresh(); }, [refresh]);

  const filteredPropostas = useMemo(() => {
    if (!search.trim()) return propostas;
    const q = search.toLowerCase();
    return propostas.filter(p =>
      p.cliente_nome?.toLowerCase().includes(q) ||
      p.cliente_cpf?.includes(q) ||
      p.nome_vendedor?.toLowerCase().includes(q) ||
      p.codigo_proposta?.toLowerCase().includes(q) ||
      p.banco?.toLowerCase().includes(q)
    );
  }, [propostas, search]);

  const displayStats = useMemo(
    () => computeStats(filteredPropostas, pendingCount),
    [filteredPropostas, pendingCount]
  );

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
    setDragId(id);
  };

  const handleDragEnd = () => { setDragId(null); setDragOverCol(null); };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDragEnterCol = (colKey: string) => setDragOverCol(colKey);

  const handleDragLeaveCol = (e: React.DragEvent) => {
    const related = e.relatedTarget as Node | null;
    if (!related || !e.currentTarget.contains(related)) {
      setDragOverCol(null);
    }
  };

  const VENDOR_NAMES: Partial<Record<CrmStatus, string>> = {
    karol:    "KAROL",
    giovanna: "GIOVANNA",
    gabriel:  "GABRIEL/I.A",
  };

  const handleDrop = async (e: React.DragEvent, targetStatus: CrmStatus) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    setDragId(null);
    setDragOverCol(null);
    if (!id) return;
    const proposta = propostas.find(p => p.id === id);
    if (!proposta || proposta.status === targetStatus) return;

    const updates: Record<string, string> = { status: targetStatus };
    if (VENDOR_NAMES[targetStatus]) updates.nome_vendedor = VENDOR_NAMES[targetStatus]!;

    setPropostas(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));

    const colLabel = COLUNAS.find(c => c.key === targetStatus)?.label ?? targetStatus;
    try {
      await crmApi.atualizar(id, updates);
      showToast(`→ ${colLabel}`);
      refresh();
    } catch (ex: any) {
      setErr(ex?.response?.data?.detail ?? "Erro ao mover proposta");
      refresh();
    }
  };

  const requestDelete = (id: string) => {
    if (hasCrmPassword) {
      setDeleteTarget(id);
    } else {
      if (!confirm("Apagar proposta?")) return;
      executeDelete(id);
    }
  };

  const executeDelete = async (id: string, crm_password?: string) => {
    setPropostas(prev => prev.filter(p => p.id !== id));
    setPendentes(prev => prev.filter(p => p.id !== id));
    try { await crmApi.deletar(id, crm_password); refresh(); } catch { refresh(); }
  };

  const handleApprove = async (id: string) => {
    try {
      await crmApi.aprovar(id);
      refresh();
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? "Erro ao aprovar");
    }
  };

  const handleSaved = (p: CrmProposta) => {
    if (editing) {
      setPropostas(prev => prev.map(x => x.id === p.id ? p : x));
    } else if (p.approved) {
      setPropostas(prev => [p, ...prev]);
    } else {
      setPendentes(prev => [p, ...prev]);
    }
    setShowModal(false);
    setEditing(null);
    setAddingToCol(null);
    refresh();
  };

  const handleEdit = (p: CrmProposta) => { setEditing(p); setAddingToCol(null); setShowModal(true); };

  const openAddInCol = (colKey: CrmStatus) => {
    setEditing(null);
    setAddingToCol(colKey);
    setShowModal(true);
  };

  const handleSyncV8 = async () => {
    setSyncStatus("running");
    setSyncResult(null);
    try {
      await v8ProposalsApi.startSync();
      let cancelled = false;
      const poll = setInterval(async () => {
        if (cancelled) return;
        const s = await v8ProposalsApi.syncStatus();
        if (s.status === "done") {
          clearInterval(poll);
          if (!cancelled) {
            setSyncStatus("done");
            setSyncResult({ added: s.added ?? 0, skipped: s.skipped ?? 0, errors: s.errors ?? 0 });
            refresh();
          }
        } else if (s.status === "error") {
          clearInterval(poll);
          if (!cancelled) setSyncStatus("error");
        }
      }, 4000);
      return () => { cancelled = true; clearInterval(poll); };
    } catch {
      setSyncStatus("error");
    }
  };

  const colunasPropostas = (status: CrmStatus) =>
    propostas.filter(p => p.status === status);

  const isCardDimmed = (p: CrmProposta) => {
    if (!search.trim()) return false;
    const q = search.toLowerCase();
    return !(
      p.cliente_nome?.toLowerCase().includes(q) ||
      p.cliente_cpf?.includes(q) ||
      p.nome_vendedor?.toLowerCase().includes(q) ||
      p.codigo_proposta?.toLowerCase().includes(q) ||
      p.banco?.toLowerCase().includes(q)
    );
  };

  const colTotal = (status: CrmStatus): string | null => {
    const sum = propostas.filter(p => p.status === status).reduce((acc, p) => acc + (p.valor || 0), 0);
    return sum > 0 ? fmtMoedaCompacto(sum) : null;
  };

  const pendentesCount = pendentes.length;

  return (
    <div style={{
      padding: "22px 24px 56px",
      color: C.text,
      fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      minHeight: "100vh", background: C.bg,
    }}>
      <style>{SHARED_CSS}{CRM_CSS}</style>

      {/* ── Hero header ── */}
      <div style={{ ...glassCard(G.primary, 26), marginBottom: 18 }}>
        <div style={{
          display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 22, alignItems: 'center',
        }} className="crm-hero">
          <BrainBadge color={CC.purple} loading={loading} />
          <div style={{ minWidth: 0 }}>
            <div style={{ ...sectionTitle(G.primary), marginBottom: 6 }}>CRM</div>
            <h1 style={{
              margin: 0, color: C.text, fontSize: 32, lineHeight: 1.05,
              letterSpacing: 0, fontWeight: 800,
            }}>
              Acompanhamento de Propostas
            </h1>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <PulseDot color={CC.green} />
                <span style={{ color: C.text, fontSize: 13, fontWeight: 700 }}>
                  {displayStats.total} propostas · {fmtMoeda(displayStats.total_valor)}
                </span>
              </span>
              {isAdmin && pendingCount > 0 && (
                <span style={{ color: CC.gold, fontSize: 12, fontWeight: 700 }}>
                  ⏳ {pendingCount} aguardando aprovação
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {isAdmin && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                <button
                  onClick={handleSyncV8}
                  disabled={syncStatus === "running"}
                  className="ds-btn"
                  style={btnStyle(G.purple, syncStatus === "running")}
                >
                  {syncStatus === "running" ? "⏳ Sincronizando…" : "🔄 Sincronizar V8"}
                </button>
                {syncStatus === "done" && syncResult && (
                  <span style={{ fontSize: 11, color: CC.green }}>
                    ✓ {syncResult.added} novas · {syncResult.skipped} já existiam · {syncResult.errors} erros
                  </span>
                )}
                {syncStatus === "error" && (
                  <span style={{ fontSize: 11, color: CC.red }}>Erro ao sincronizar — verifique credenciais V8</span>
                )}
              </div>
            )}
            <button
              onClick={() => { setEditing(null); setAddingToCol(null); setShowModal(true); }}
              className="ds-btn"
              style={btnStyle(G.green)}>
              ➕ Nova Proposta
            </button>
          </div>
        </div>
      </div>

      {/* ── KPI strip ── */}
      <section className="crm-grid crm-kpis spot-grid" style={{
        display: 'grid', gridTemplateColumns: `repeat(${isAdmin ? 4 : 3}, minmax(0,1fr))`,
        gap: 14, marginBottom: 18,
      }}>
        <KpiCard label="Total Vendido" icon="💰" value={fmtMoeda(displayStats.total_valor)} color={CC.green}
          sub={`${displayStats.total} propostas no período`} />
        <KpiCard label="Ticket Médio" icon="📊" value={fmtMoeda(displayStats.ticket_medio)} color={CC.cyan}
          sub="Por proposta paga" />
        <KpiCard label="Top Vendedor" icon="🏆"
          value={displayStats.ranking[0]?.nome.split(" ")[0] ?? "—"}
          color={CC.gold}
          sub={displayStats.ranking[0] ? fmtMoeda(displayStats.ranking[0].total) : "Sem dados ainda"} />
        {isAdmin && (
          <KpiCard label="Aguardando" icon="⏳" value={pendingCount} color={CC.red}
            sub="Pendentes de aprovação" />
        )}
      </section>

      {/* ── Tabs ── */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          onClick={() => setShowTab("kanban")}
          className="ds-btn"
          style={{
            padding: "8px 18px", borderRadius: 12,
            border: `1.5px solid transparent`,
            backgroundImage: showTab === "kanban"
              ? `linear-gradient(rgba(15,15,35,.92), rgba(15,15,35,.92)) padding-box, ${G.cyan} border-box`
              : 'none',
            background: showTab === "kanban" ? undefined : 'rgba(255,255,255,.03)',
            color: showTab === "kanban" ? C.text : C.sec,
            fontWeight: 700, fontSize: 13, cursor: "pointer",
            display: 'inline-flex', alignItems: 'center', gap: 8,
          }}>
          {showTab === "kanban" && <PulseDot color={CC.cyan} />}
          📋 Kanban
        </button>
        {isAdmin && (
          <button
            onClick={() => setShowTab("pendentes")}
            className="ds-btn"
            style={{
              padding: "8px 18px", borderRadius: 12,
              border: `1.5px solid transparent`,
              backgroundImage: showTab === "pendentes"
                ? `linear-gradient(rgba(15,15,35,.92), rgba(15,15,35,.92)) padding-box, ${G.yellow} border-box`
                : 'none',
              background: showTab === "pendentes" ? undefined : 'rgba(255,255,255,.03)',
              color: showTab === "pendentes" ? C.text : C.sec,
              fontWeight: 700, fontSize: 13, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 8,
            }}>
            {showTab === "pendentes" && <PulseDot color={CC.gold} />}
            ⏳ Aguardando Aprovação
            {pendentesCount > 0 && (
              <span style={{
                background: CC.gold, color: "#000", borderRadius: "50%",
                width: 18, height: 18,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, fontWeight: 900,
              }}>
                {pendentesCount}
              </span>
            )}
          </button>
        )}
      </div>

      {/* ── Filtros + busca ── */}
      <div style={{ ...glassCard(G.cyan, 16), marginBottom: 18 }}>
        <div style={{ ...sectionTitle(G.cyan), fontSize: 11, marginBottom: 12 }}>Filtros</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Buscar por nome, CPF, banco, código…"
            className="ds-input"
            style={{ ...INPUT_STYLE, width: 320, padding: '10px 14px', fontSize: 13 }}
          />
          {search && (
            <button onClick={() => setSearch("")}
              style={{
                padding: "6px 12px", borderRadius: 10,
                background: `${CC.red}15`, color: CC.red,
                border: `1px solid ${CC.red}40`, fontSize: 12, fontWeight: 700, cursor: "pointer",
              }}>
              ✕ Limpar busca
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{
            fontSize: 10, color: C.sec, textTransform: "uppercase",
            letterSpacing: ".1em", fontWeight: 800,
          }}>Banco:</span>
          {["todos", ...BANCOS].map(b => (
            <button key={b} onClick={() => setBancFiltro(b)}
              style={{
                padding: "5px 12px", borderRadius: 12,
                border: `1px solid ${bancFiltro === b ? CC.purple : 'rgba(255,255,255,.08)'}`,
                background: bancFiltro === b ? `${CC.purple}22` : "transparent",
                color: bancFiltro === b ? CC.purple : C.sec,
                fontSize: 12, fontWeight: 700, cursor: "pointer",
              }}>
              {b === "todos" ? "Todos" : b}
            </button>
          ))}
          <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: C.sec }}>De:</span>
            <input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)}
              className="ds-input"
              style={{ ...INPUT_STYLE, padding: '6px 10px', fontSize: 12, width: 'auto' }} />
            <span style={{ fontSize: 11, color: C.sec }}>Até:</span>
            <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)}
              className="ds-input"
              style={{ ...INPUT_STYLE, padding: '6px 10px', fontSize: 12, width: 'auto' }} />
            {(dataInicio || dataFim || bancFiltro !== "todos") && (
              <button onClick={() => { setBancFiltro("todos"); setDataInicio(""); setDataFim(""); }}
                style={{
                  padding: "5px 12px", borderRadius: 10,
                  background: `${CC.red}15`, color: CC.red,
                  border: `1px solid ${CC.red}40`, fontSize: 12, fontWeight: 700, cursor: "pointer",
                }}>
                ✕ Limpar
              </button>
            )}
          </div>
        </div>
      </div>

      {err && (
        <div style={{
          color: CC.red, marginBottom: 14, fontSize: 13,
          background: `${CC.red}10`, border: `1px solid ${CC.red}33`,
          borderRadius: 8, padding: '10px 14px',
        }}>
          {err}
        </div>
      )}

      {/* ── Layout: kanban + sidebar ── */}
      <div className="crm-layout" style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {showTab === "kanban" && (
            <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8 }} className="crm-kanban">
              {COLUNAS.map(col => {
                const cards = colunasPropostas(col.key);
                const total = colTotal(col.key);
                const isOver = dragOverCol === col.key;
                return (
                  <div
                    key={col.key}
                    onDragEnter={() => handleDragEnterCol(col.key)}
                    onDragLeave={handleDragLeaveCol}
                    onDragOver={handleDragOver}
                    onDrop={e => handleDrop(e, col.key)}
                    style={{
                      ...glassCard(col.grad, 14),
                      minWidth: 230, flex: "0 0 230px",
                      transform: isOver ? 'scale(1.01)' : 'scale(1)',
                      boxShadow: isOver
                        ? `0 12px 40px rgba(0,0,0,.55), 0 0 0 2px ${col.cor}66`
                        : '0 8px 40px rgba(0,0,0,.55)',
                      transition: 'transform .15s, box-shadow .15s',
                    }}
                  >
                    {/* Column header */}
                    <div style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      marginBottom: 10, paddingBottom: 10,
                      borderBottom: `1px solid rgba(255,255,255,.06)`,
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 12, fontWeight: 800, color: col.cor,
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                          letterSpacing: '.04em',
                        }}>
                          {col.icon} {col.label}
                        </div>
                        {total && (
                          <div style={{ fontSize: 10, color: C.sec, marginTop: 2, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{total}</div>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                        <span style={{
                          fontSize: 11, background: `${col.cor}22`, color: col.cor,
                          padding: "2px 8px", borderRadius: 10, fontWeight: 800,
                          fontVariantNumeric: 'tabular-nums',
                        }}>
                          {cards.length}
                        </span>
                        <button
                          onClick={() => openAddInCol(col.key)}
                          title={`Adicionar em ${col.label}`}
                          style={{
                            background: `${col.cor}18`, border: `1px solid ${col.cor}44`,
                            color: col.cor, borderRadius: 6,
                            width: 22, height: 22, cursor: "pointer",
                            fontSize: 14,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontWeight: 800, lineHeight: 1,
                          }}>
                          +
                        </button>
                      </div>
                    </div>

                    {/* Cards area */}
                    <div className="cc-scroll spot-list" style={{ maxHeight: 540, overflowY: "auto", overflowX: "hidden", paddingRight: 2 }}>
                      {loading ? (
                        <div style={{ color: C.sec, fontSize: 12, textAlign: "center", padding: 20 }}>Carregando…</div>
                      ) : cards.length === 0 ? (
                        <div style={{
                          color: C.muted, fontSize: 11, textAlign: "center",
                          padding: "20px 0", borderRadius: 8,
                          border: `2px dashed ${isOver ? col.cor + "66" : 'rgba(255,255,255,.08)'}`,
                        }}>
                          {isOver ? "Soltar aqui" : "Arraste aqui"}
                        </div>
                      ) : (
                        cards.map(p => (
                          <div key={p.id} style={{ opacity: isCardDimmed(p) ? 0.3 : 1, transition: "opacity .15s" }}>
                            <PropostaCard
                              proposta={p}
                              isAdmin={isAdmin}
                              isDragging={dragId === p.id}
                              onEdit={handleEdit}
                              onDelete={requestDelete}
                              onDragStart={handleDragStart}
                              onDragEnd={handleDragEnd}
                            />
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {showTab === "pendentes" && isAdmin && (
            <div style={glassCard(G.yellow, 18)}>
              <div style={{ ...sectionTitle(G.yellow), fontSize: 12, marginBottom: 14 }}>
                Aguardando Aprovação
              </div>
              {pendentes.length === 0 ? (
                <div style={{
                  textAlign: "center", padding: "40px 0",
                  color: C.sec, fontSize: 14,
                }}>
                  Nenhuma proposta aguardando aprovação.
                </div>
              ) : (
                <div className="spot-grid" style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: 12,
                }}>
                  {pendentes.map(p => (
                    <PropostaCard
                      key={p.id} proposta={p} isAdmin={isAdmin}
                      onEdit={handleEdit}
                      onDelete={requestDelete}
                      onApprove={handleApprove}
                      onDragStart={() => {}}
                      onDragEnd={() => {}}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <StatsSidebar stats={displayStats} isAdmin={isAdmin} />
      </div>

      {/* Modal cadastro */}
      {showModal && (
        <PropostaModal
          onClose={() => { setShowModal(false); setEditing(null); setAddingToCol(null); }}
          onSaved={handleSaved}
          editing={editing}
          hasCrmPassword={hasCrmPassword}
          defaultStatus={addingToCol ?? undefined}
        />
      )}

      {/* Modal senha apagar */}
      {deleteTarget && (
        <CrmPasswordModal
          action="apagar"
          onConfirm={pwd => { const id = deleteTarget; setDeleteTarget(null); executeDelete(id, pwd); }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      <MoveToast msg={moveToast} />
    </div>
  );
}

const CRM_CSS = `
  .cc-scroll::-webkit-scrollbar { width: 6px; }
  .cc-scroll::-webkit-scrollbar-track { background: rgba(255,255,255,.02); border-radius: 3px; }
  .cc-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,.12); border-radius: 3px; }
  .cc-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.22); }

  .crm-kanban::-webkit-scrollbar { height: 8px; }
  .crm-kanban::-webkit-scrollbar-track { background: rgba(255,255,255,.02); border-radius: 4px; }
  .crm-kanban::-webkit-scrollbar-thumb { background: rgba(255,255,255,.12); border-radius: 4px; }

  @media (max-width: 1280px) {
    .crm-kpis { grid-template-columns: repeat(2, 1fr) !important; }
    .crm-layout { flex-direction: column !important; }
    .crm-layout > :last-child { width: 100% !important; }
  }
  @media (max-width: 760px) {
    .crm-kpis { grid-template-columns: 1fr !important; }
    .crm-hero { grid-template-columns: 1fr !important; }
    .crm-hero > :last-child { justify-content: flex-start !important; }
  }
`;
