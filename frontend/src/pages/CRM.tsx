import { useEffect, useState, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { crmApi, crmSettingsApi } from "../lib/api";
import { useSession } from "../hooks/useSession";
import type { CrmProposta, CrmStats } from "../lib/types";

const C = {
  bg: "#080818",
  bg2: "rgba(255,255,255,.04)",
  border: "rgba(255,255,255,.07)",
  green: "#00ff88",
  purple: "#b44aff",
  red: "#ff2d78",
  gold: "#ffd700",
  blue: "#00bfff",
  orange: "#ff8c00",
  text: "#e0e0f0",
  muted: "#64748b",
};

const COLUNAS: { key: CrmProposta["status"]; label: string; cor: string }[] = [
  { key: "propostas",  label: "💰 PAGOS",       cor: C.blue   },
  { key: "importante", label: "⭐ IMPORTANTE",  cor: C.gold   },
  { key: "pendentes",  label: "⏳ PENDENTES",   cor: C.orange },
  { key: "leilao",     label: "🔨 LEILÃO",      cor: C.purple },
  { key: "fgts",       label: "💚 FGTS",        cor: C.green  },
];

const BANCOS = ["V8", "Zilli", "Novo Saque", "VCTex", "Pan", "Facta", "C6", "Mercantil", "2S", "Soma"];

const fmtMoeda = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Remove pontos de milhar e converte vírgula decimal → ponto antes de parsear
const parseMoney = (v: string): number => {
  const clean = v.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : n;
};

const fmtCpf = (s: string) =>
  s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");

const fmtData = (s: string) => {
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
};

// ─── Modal de senha CRM ───────────────────────────────────────────────────────
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
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.8)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#0d0d1f", border: `1px solid ${C.border}`, borderRadius: 16, padding: 28, width: 340 }}>
        <div style={{ fontSize: "1rem", fontWeight: 800, color: C.text, marginBottom: 6 }}>
          🔒 Senha CRM
        </div>
        <p style={{ fontSize: ".82rem", color: C.muted, marginBottom: 18 }}>
          Para {action === "criar" ? "adicionar" : "apagar"} esta proposta, insira a senha de segurança configurada pelo admin.
        </p>
        <input
          autoFocus
          type="password"
          value={pwd}
          onChange={e => setPwd(e.target.value)}
          onKeyDown={e => e.key === "Enter" && confirm()}
          placeholder="Senha CRM…"
          style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", background: "#0a0a1e", border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: ".9rem", outline: "none" }}
        />
        {err && <div style={{ color: C.red, fontSize: ".78rem", marginTop: 6 }}>{err}</div>}
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button onClick={confirm}
            style={{ flex: 1, padding: "9px 0", background: `${C.gold}22`, color: C.gold, border: `1px solid ${C.gold}44`, borderRadius: 10, fontWeight: 700, cursor: "pointer" }}>
            Confirmar
          </button>
          <button onClick={onCancel}
            style={{ flex: 1, padding: "9px 0", background: C.bg2, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 10, cursor: "pointer" }}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de cadastro ────────────────────────────────────────────────────────
interface ModalProps {
  onClose: () => void;
  onSaved: (p: CrmProposta) => void;
  editing?: CrmProposta | null;
  hasCrmPassword: boolean;
}

function PropostaModal({ onClose, onSaved, editing, hasCrmPassword }: ModalProps) {
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
    status: editing?.status ?? "propostas",
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
      .then(result => { onSaved(result); })
      .catch(e => { setErr(e?.response?.data?.detail ?? "Erro ao salvar"); setBusy(false); });
  };

  const save = () => {
    if (!form.nome_vendedor.trim()) { setErr("Nome do vendedor obrigatório"); return; }
    if (!form.cliente_cpf.trim()) { setErr("CPF obrigatório"); return; }
    if (!form.valor || parseMoney(form.valor) <= 0) { setErr("Valor inválido"); return; }
    if (!form.prazo || isNaN(parseInt(form.prazo))) { setErr("Prazo inválido"); return; }
    if (!form.parcela || parseMoney(form.parcela) <= 0) { setErr("Parcela inválida"); return; }

    // Senha CRM só é pedida na criação (não em edições)
    if (!editing && hasCrmPassword) {
      setShowPwdModal(true);
    } else {
      submit();
    }
  };

  const inp: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "9px 12px",
    background: "#0a0a1e", border: `1px solid ${C.border}`, borderRadius: 8,
    color: C.text, fontSize: ".85rem",
  };
  const label: React.CSSProperties = { fontSize: ".7rem", color: C.muted, display: "block", marginBottom: 4 };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div onClick={e => e.stopPropagation()} style={{ background: "#0d0d1f", border: `1px solid ${C.border}`, borderRadius: 16, padding: 28, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto" }}>
          <div style={{ fontSize: "1rem", fontWeight: 800, color: C.text, marginBottom: 20 }}>
            {editing ? "✏️ Editar Proposta" : "➕ Nova Proposta"}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={label}>Nome do Vendedor *</label>
              <input style={inp} value={form.nome_vendedor} onChange={e => set("nome_vendedor", e.target.value)} placeholder="Ex: João Silva" />
            </div>

            <div>
              <label style={label}>Banco *</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                {BANCOS.map(b => (
                  <button key={b} onClick={() => { setBancoCustom(false); set("banco", b); }}
                    style={{ padding: "4px 10px", borderRadius: 10, border: `1px solid ${(!bancoCustom && form.banco === b) ? C.purple : C.border}`, background: (!bancoCustom && form.banco === b) ? `${C.purple}22` : "transparent", color: (!bancoCustom && form.banco === b) ? C.purple : C.muted, fontSize: ".75rem", cursor: "pointer" }}>
                    {b}
                  </button>
                ))}
                <button onClick={() => setBancoCustom(true)}
                  style={{ padding: "4px 10px", borderRadius: 10, border: `1px solid ${bancoCustom ? C.blue : C.border}`, background: bancoCustom ? `${C.blue}22` : "transparent", color: bancoCustom ? C.blue : C.muted, fontSize: ".75rem", cursor: "pointer" }}>
                  +Personalizado
                </button>
              </div>
              {bancoCustom && (
                <input style={inp} value={form.banco_custom} onChange={e => set("banco_custom", e.target.value)} placeholder="Nome do banco..." />
              )}
            </div>

            <div>
              <label style={label}>Nome do Cliente</label>
              <input style={inp} value={form.cliente_nome} onChange={e => set("cliente_nome", e.target.value)} placeholder="Ex: Maria Santos" />
            </div>

            <div>
              <label style={label}>CPF do Cliente *</label>
              <input style={inp} value={form.cliente_cpf} onChange={e => set("cliente_cpf", e.target.value)} placeholder="000.000.000-00" maxLength={14} />
            </div>

            <div>
              <label style={label}>Data da Venda *</label>
              <input type="date" style={inp} value={form.data_venda} onChange={e => set("data_venda", e.target.value)} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <div>
                <label style={label}>Valor (R$) *</label>
                <input style={inp} type="text" inputMode="decimal" value={form.valor} onChange={e => set("valor", e.target.value)} placeholder="4.780,00" />
              </div>
              <div>
                <label style={label}>Prazo (meses) *</label>
                <input style={inp} type="number" min="1" value={form.prazo} onChange={e => set("prazo", e.target.value)} placeholder="84" />
              </div>
              <div>
                <label style={label}>Parcela (R$) *</label>
                <input style={inp} type="text" inputMode="decimal" value={form.parcela} onChange={e => set("parcela", e.target.value)} placeholder="450,00" />
              </div>
            </div>

            <div>
              <label style={label}>Código da Proposta</label>
              <input style={inp} value={form.codigo_proposta} onChange={e => set("codigo_proposta", e.target.value)} placeholder="Opcional" />
            </div>

            <div>
              <label style={label}>Coluna inicial</label>
              <select style={inp} value={form.status} onChange={e => set("status", e.target.value)}>
                {COLUNAS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
          </div>

          {err && <div style={{ marginTop: 12, color: C.red, fontSize: ".8rem" }}>{err}</div>}

          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button onClick={save} disabled={busy}
              style={{ flex: 1, padding: "10px 0", background: `${C.green}22`, color: C.green, border: `1px solid ${C.green}44`, borderRadius: 10, fontWeight: 700, cursor: busy ? "not-allowed" : "pointer" }}>
              {busy ? "Salvando…" : "Salvar"}
            </button>
            <button onClick={onClose}
              style={{ flex: 1, padding: "10px 0", background: C.bg2, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 10, cursor: "pointer" }}>
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

// ─── Card de proposta ─────────────────────────────────────────────────────────
interface CardProps {
  proposta: CrmProposta;
  isAdmin: boolean;
  onEdit: (p: CrmProposta) => void;
  onDelete: (id: string) => void;
  onApprove?: (id: string) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
}

function PropostaCard({ proposta: p, isAdmin, onEdit, onDelete, onApprove, onDragStart }: CardProps) {
  const cor = COLUNAS.find(c => c.key === p.status)?.cor ?? C.blue;
  const isPending = !p.approved;

  return (
    <div
      draggable={p.approved}
      onDragStart={e => p.approved && onDragStart(e, p.id)}
      style={{
        background: isPending ? "rgba(255,215,0,.04)" : C.bg2,
        border: `1px solid ${isPending ? "rgba(255,215,0,.25)" : C.border}`,
        borderLeft: `3px solid ${isPending ? C.gold : cor}`,
        borderRadius: 10, padding: "12px 14px", marginBottom: 8,
        cursor: p.approved ? "grab" : "default",
        opacity: isPending ? 0.85 : 1,
      }}
    >
      {isPending && (
        <div style={{ fontSize: ".65rem", fontWeight: 700, color: C.gold, background: "rgba(255,215,0,.12)", border: "1px solid rgba(255,215,0,.25)", borderRadius: 6, padding: "2px 8px", display: "inline-block", marginBottom: 6 }}>
          ⏳ Aguardando Aprovação
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ fontSize: ".8rem", fontWeight: 700, color: C.text, marginBottom: 4 }}>
          {p.nome_vendedor}
        </div>
        <div style={{ display: "flex", gap: 5 }}>
          {isAdmin && isPending && onApprove && (
            <button onClick={() => onApprove(p.id)}
              title="Aprovar proposta"
              style={{ background: "rgba(0,255,136,.12)", border: "1px solid rgba(0,255,136,.3)", color: C.green, cursor: "pointer", fontSize: ".72rem", borderRadius: 6, padding: "3px 8px", fontWeight: 700 }}>
              ✓ Aprovar
            </button>
          )}
          <button onClick={() => onEdit(p)}
            style={{ background: "rgba(255,255,255,.06)", border: `1px solid ${C.border}`, color: C.muted, cursor: "pointer", fontSize: ".78rem", borderRadius: 6, padding: "4px 10px" }}>
            ✏️ Editar
          </button>
          {isAdmin && (
            <button onClick={() => onDelete(p.id)}
              style={{ background: "rgba(255,45,120,.08)", border: "1px solid rgba(255,45,120,.2)", color: C.red, cursor: "pointer", fontSize: ".78rem", borderRadius: 6, padding: "4px 8px" }}>
              🗑
            </button>
          )}
        </div>
      </div>
      <div style={{ fontSize: ".72rem", color: isPending ? C.gold : cor, fontWeight: 700, marginBottom: 4 }}>{p.banco}</div>
      {p.cliente_nome && (
        <div style={{ fontSize: ".78rem", color: C.text, fontWeight: 600, marginBottom: 2 }}>{p.cliente_nome}</div>
      )}
      <div style={{ fontSize: ".72rem", color: C.muted }}>{fmtCpf(p.cliente_cpf)}</div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
        <span style={{ fontSize: ".78rem", color: C.green, fontWeight: 700 }}>{fmtMoeda(p.valor)}</span>
        <span style={{ fontSize: ".72rem", color: C.muted }}>{p.prazo}x {fmtMoeda(p.parcela)}</span>
      </div>
      {p.codigo_proposta && (
        <div style={{ fontSize: ".68rem", color: C.muted, marginTop: 4 }}>#{p.codigo_proposta}</div>
      )}
      <div style={{ fontSize: ".68rem", color: C.muted, marginTop: 2 }}>{fmtData(p.data_venda)}</div>
    </div>
  );
}

// ─── Sidebar de stats ─────────────────────────────────────────────────────────
function StatsSidebar({ stats, isAdmin }: { stats: CrmStats | null; isAdmin: boolean }) {
  if (!stats) return null;
  const barData = stats.ranking.map(r => ({ name: r.nome.split(" ")[0], valor: r.total }));

  return (
    <div style={{ width: 260, flexShrink: 0, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px" }}>
        <div style={{ fontSize: ".65rem", color: C.muted, textTransform: "uppercase", letterSpacing: ".8px", fontWeight: 700, marginBottom: 10 }}>Resumo</div>
        <div style={{ fontSize: "1.4rem", fontWeight: 800, color: C.green }}>{fmtMoeda(stats.total_valor)}</div>
        <div style={{ fontSize: ".75rem", color: C.muted, marginTop: 2 }}>{stats.total} propostas · ticket médio {fmtMoeda(stats.ticket_medio)}</div>
        {isAdmin && (stats.pending_count ?? 0) > 0 && (
          <div style={{ marginTop: 10, padding: "6px 10px", background: "rgba(255,215,0,.1)", border: "1px solid rgba(255,215,0,.25)", borderRadius: 8, fontSize: ".75rem", color: C.gold, fontWeight: 700 }}>
            ⏳ {stats.pending_count} aguardando aprovação
          </div>
        )}
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 5 }}>
          {COLUNAS.map(c => (
            <div key={c.key} style={{ display: "flex", justifyContent: "space-between", fontSize: ".75rem" }}>
              <span style={{ color: c.cor }}>{c.label.split(" ").slice(1).join(" ")}</span>
              <span style={{ color: C.text, fontWeight: 700 }}>{stats.by_status[c.key] ?? 0}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px" }}>
        <div style={{ fontSize: ".65rem", color: C.muted, textTransform: "uppercase", letterSpacing: ".8px", fontWeight: 700, marginBottom: 12 }}>🏆 Ranking Vendedores</div>
        {stats.ranking.slice(0, 5).map((r, i) => (
          <div key={r.nome} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: ".75rem", color: [C.gold, "#c0c0c0", "#cd7f32"][i] ?? C.muted, fontWeight: 700, width: 16, textAlign: "center" }}>
              {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: ".75rem", color: C.text }}>{r.nome}</div>
              <div style={{ fontSize: ".68rem", color: C.green }}>{fmtMoeda(r.total)}</div>
            </div>
          </div>
        ))}
      </div>

      {barData.length > 0 && (
        <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px" }}>
          <div style={{ fontSize: ".65rem", color: C.muted, textTransform: "uppercase", letterSpacing: ".8px", fontWeight: 700, marginBottom: 10 }}>Contratos por Vendedor</div>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={barData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ background: "#0d0d1f", border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: ".75rem" }}
                formatter={(v: number) => fmtMoeda(v)}
              />
              <Bar dataKey="valor" fill={C.purple} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px" }}>
        <div style={{ fontSize: ".65rem", color: C.muted, textTransform: "uppercase", letterSpacing: ".8px", fontWeight: 700, marginBottom: 10 }}>Por Banco</div>
        {Object.entries(stats.by_banco).sort((a, b) => b[1] - a[1]).map(([banco, n]) => (
          <div key={banco} style={{ display: "flex", justifyContent: "space-between", fontSize: ".75rem", marginBottom: 5 }}>
            <span style={{ color: C.muted }}>{banco}</span>
            <span style={{ color: C.text, fontWeight: 700 }}>{n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function CRM() {
  const { isAdmin } = useSession();
  const [propostas, setPropostas] = useState<CrmProposta[]>([]);
  const [pendentes, setPendentes] = useState<CrmProposta[]>([]);
  const [stats, setStats] = useState<CrmStats | null>(null);
  const [hasCrmPassword, setHasCrmPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<CrmProposta | null>(null);
  const [bancFiltro, setBancFiltro] = useState<string>("todos");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [showTab, setShowTab] = useState<"kanban" | "pendentes">("kanban");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (bancFiltro !== "todos") params.banco = bancFiltro;
      if (dataInicio) params.data_inicio = dataInicio;
      if (dataFim) params.data_fim = dataFim;
      const [data, s, cfg] = await Promise.all([
        crmApi.listar(params),
        crmApi.stats(),
        crmSettingsApi.get(),
      ]);
      // Aprovadas vão pro kanban; pendentes ficam separadas (admin vê tudo)
      setPropostas(data.filter(p => p.approved));
      setPendentes(data.filter(p => !p.approved));
      setStats(s);
      setHasCrmPassword(cfg.has_crm_password);
      setErr(null);
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? "Erro ao carregar propostas");
    } finally { setLoading(false); }
  }, [bancFiltro, dataInicio, dataFim]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };

  const handleDrop = async (e: React.DragEvent, targetStatus: CrmProposta["status"]) => {
    e.preventDefault();
    if (!dragId) return;
    const proposta = propostas.find(p => p.id === dragId);
    if (!proposta || proposta.status === targetStatus) { setDragId(null); return; }
    setPropostas(prev => prev.map(p => p.id === dragId ? { ...p, status: targetStatus } : p));
    setDragId(null);
    try {
      await crmApi.moverStatus(dragId, targetStatus);
      refresh();
    } catch {
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
    refresh();
  };

  const handleEdit = (p: CrmProposta) => { setEditing(p); setShowModal(true); };

  const colunasPropostas = (status: CrmProposta["status"]) =>
    propostas.filter(p => p.status === status);

  const card: React.CSSProperties = {
    background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 12,
  };

  const pendentesCount = pendentes.length;

  return (
    <div style={{ padding: 20, color: C.text, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", minHeight: "100vh", background: C.bg }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 800, margin: 0 }}>📊 Acompanhamento de Propostas</h1>
        <button
          onClick={() => { setEditing(null); setShowModal(true); }}
          style={{ padding: "8px 18px", borderRadius: 20, background: `${C.green}22`, color: C.green, border: `1px solid ${C.green}44`, fontWeight: 700, fontSize: ".85rem", cursor: "pointer" }}>
          ➕ Nova Proposta
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          onClick={() => setShowTab("kanban")}
          style={{ padding: "6px 18px", borderRadius: 12, border: `1px solid ${showTab === "kanban" ? C.blue : C.border}`, background: showTab === "kanban" ? `${C.blue}22` : "transparent", color: showTab === "kanban" ? C.blue : C.muted, fontWeight: 700, fontSize: ".8rem", cursor: "pointer" }}>
          📋 Kanban
        </button>
        {isAdmin && (
          <button
            onClick={() => setShowTab("pendentes")}
            style={{ padding: "6px 18px", borderRadius: 12, border: `1px solid ${showTab === "pendentes" ? C.gold : C.border}`, background: showTab === "pendentes" ? `${C.gold}22` : "transparent", color: showTab === "pendentes" ? C.gold : C.muted, fontWeight: 700, fontSize: ".8rem", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            ⏳ Aguardando Aprovação
            {pendentesCount > 0 && (
              <span style={{ background: C.gold, color: "#000", borderRadius: "50%", width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", fontSize: ".65rem", fontWeight: 800 }}>
                {pendentesCount}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Filtros */}
      <div style={{ ...card, padding: "14px 18px", marginBottom: 18 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: ".7rem", color: C.muted, textTransform: "uppercase", letterSpacing: ".8px", fontWeight: 700 }}>Banco:</span>
          {["todos", ...BANCOS].map(b => (
            <button key={b} onClick={() => setBancFiltro(b)}
              style={{ padding: "4px 12px", borderRadius: 12, border: `1px solid ${bancFiltro === b ? C.purple : C.border}`, background: bancFiltro === b ? `${C.purple}22` : "transparent", color: bancFiltro === b ? C.purple : C.muted, fontSize: ".75rem", cursor: "pointer" }}>
              {b === "todos" ? "Todos" : b}
            </button>
          ))}
          <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ fontSize: ".7rem", color: C.muted }}>De:</span>
            <input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)}
              style={{ padding: "5px 8px", background: "#0a0a1e", border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontSize: ".8rem" }} />
            <span style={{ fontSize: ".7rem", color: C.muted }}>Até:</span>
            <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)}
              style={{ padding: "5px 8px", background: "#0a0a1e", border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontSize: ".8rem" }} />
            {(dataInicio || dataFim || bancFiltro !== "todos") && (
              <button onClick={() => { setBancFiltro("todos"); setDataInicio(""); setDataFim(""); }}
                style={{ padding: "4px 10px", borderRadius: 10, background: `${C.red}22`, color: C.red, border: `1px solid ${C.red}44`, fontSize: ".75rem", cursor: "pointer" }}>
                ✕ Limpar
              </button>
            )}
          </div>
        </div>
      </div>

      {err && <div style={{ color: C.red, marginBottom: 14, fontSize: ".85rem" }}>{err}</div>}

      {/* Layout: conteúdo + Sidebar */}
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {showTab === "kanban" && (
            <div style={{ display: "flex", gap: 12, overflowX: "auto" }}>
              {COLUNAS.map(col => (
                <div
                  key={col.key}
                  onDragOver={handleDragOver}
                  onDrop={e => handleDrop(e, col.key)}
                  style={{ minWidth: 220, flex: 1, background: "rgba(255,255,255,.02)", border: `1px solid ${C.border}`, borderRadius: 12, padding: 12 }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, paddingBottom: 10, borderBottom: `1px solid ${C.border}` }}>
                    <span style={{ fontSize: ".78rem", fontWeight: 800, color: col.cor }}>{col.label}</span>
                    <span style={{ fontSize: ".7rem", background: `${col.cor}22`, color: col.cor, padding: "2px 8px", borderRadius: 10, fontWeight: 700 }}>
                      {colunasPropostas(col.key).length}
                    </span>
                  </div>
                  {loading ? (
                    <div style={{ color: C.muted, fontSize: ".8rem", textAlign: "center", padding: 20 }}>Carregando…</div>
                  ) : colunasPropostas(col.key).length === 0 ? (
                    <div style={{ color: C.muted, fontSize: ".75rem", textAlign: "center", padding: "24px 0", borderRadius: 8, border: `2px dashed ${C.border}` }}>
                      Arraste aqui
                    </div>
                  ) : (
                    colunasPropostas(col.key).map(p => (
                      <PropostaCard
                        key={p.id} proposta={p} isAdmin={isAdmin}
                        onEdit={handleEdit}
                        onDelete={requestDelete}
                        onDragStart={handleDragStart}
                      />
                    ))
                  )}
                </div>
              ))}
            </div>
          )}

          {showTab === "pendentes" && isAdmin && (
            <div>
              {pendentes.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: C.muted, fontSize: ".9rem" }}>
                  Nenhuma proposta aguardando aprovação.
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                  {pendentes.map(p => (
                    <PropostaCard
                      key={p.id} proposta={p} isAdmin={isAdmin}
                      onEdit={handleEdit}
                      onDelete={requestDelete}
                      onApprove={handleApprove}
                      onDragStart={() => {}}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <StatsSidebar stats={stats} isAdmin={isAdmin} />
      </div>

      {/* Modal cadastro */}
      {showModal && (
        <PropostaModal
          onClose={() => { setShowModal(false); setEditing(null); }}
          onSaved={handleSaved}
          editing={editing}
          hasCrmPassword={hasCrmPassword}
        />
      )}

      {/* Modal senha para apagar */}
      {deleteTarget && (
        <CrmPasswordModal
          action="apagar"
          onConfirm={pwd => { const id = deleteTarget; setDeleteTarget(null); executeDelete(id, pwd); }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
