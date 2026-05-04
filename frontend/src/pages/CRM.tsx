import { useEffect, useState, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { crmApi } from "../lib/api";
import type { CrmProposta, CrmStats } from "../lib/types";

// ─── Paleta ───────────────────────────────────────────────────────────────────
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
  { key: "propostas",  label: "📋 PROPOSTAS",  cor: C.blue   },
  { key: "importante", label: "⭐ IMPORTANTE",  cor: C.gold   },
  { key: "pendentes",  label: "⏳ PENDENTES",   cor: C.orange },
  { key: "leilao",     label: "🔨 LEILÃO",      cor: C.purple },
  { key: "fgts",       label: "💚 FGTS",        cor: C.green  },
];

const BANCOS = ["V8", "Zilli", "Novo Saque", "VCTex", "Pan", "Facta", "C6", "Mercantil", "2S", "Soma"];

const fmtMoeda = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtCpf = (s: string) =>
  s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");

const fmtData = (s: string) => {
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
};

// ─── Modal de cadastro ────────────────────────────────────────────────────────
interface ModalProps {
  onClose: () => void;
  onSaved: (p: CrmProposta) => void;
  editing?: CrmProposta | null;
}

function PropostaModal({ onClose, onSaved, editing }: ModalProps) {
  const [form, setForm] = useState({
    nome_vendedor: editing?.nome_vendedor ?? "",
    banco: editing?.banco ?? BANCOS[0],
    cliente_cpf: editing?.cliente_cpf ?? "",
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

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.nome_vendedor.trim()) { setErr("Nome do vendedor obrigatório"); return; }
    if (!form.cliente_cpf.trim()) { setErr("CPF obrigatório"); return; }
    if (!form.valor || isNaN(+form.valor)) { setErr("Valor inválido"); return; }
    if (!form.prazo || isNaN(+form.prazo)) { setErr("Prazo inválido"); return; }
    if (!form.parcela || isNaN(+form.parcela)) { setErr("Parcela inválida"); return; }
    setBusy(true);
    setErr(null);
    try {
      const bancoFinal = bancoCustom ? form.banco_custom.trim() : form.banco;
      if (!bancoFinal) { setErr("Banco obrigatório"); setBusy(false); return; }
      const payload = {
        nome_vendedor: form.nome_vendedor.trim(),
        banco: bancoFinal,
        cliente_cpf: form.cliente_cpf,
        data_venda: form.data_venda,
        valor: parseFloat(form.valor),
        prazo: parseInt(form.prazo),
        parcela: parseFloat(form.parcela),
        codigo_proposta: form.codigo_proposta.trim(),
        status: form.status as CrmProposta["status"],
      };
      let result: CrmProposta;
      if (editing) {
        result = await crmApi.atualizar(editing.id, payload);
      } else {
        result = await crmApi.criar(payload);
      }
      onSaved(result);
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? "Erro ao salvar");
    } finally { setBusy(false); }
  };

  const inp: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "9px 12px",
    background: "#0a0a1e", border: `1px solid ${C.border}`, borderRadius: 8,
    color: C.text, fontSize: ".85rem",
  };
  const label: React.CSSProperties = { fontSize: ".7rem", color: C.muted, display: "block", marginBottom: 4 };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#0d0d1f", border: `1px solid ${C.border}`, borderRadius: 16, padding: 28, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ fontSize: "1rem", fontWeight: 800, color: C.text, marginBottom: 20 }}>
          {editing ? "✏️ Editar Proposta" : "➕ Nova Proposta"}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Nome vendedor */}
          <div>
            <label style={label}>Nome do Vendedor *</label>
            <input style={inp} value={form.nome_vendedor} onChange={e => set("nome_vendedor", e.target.value)} placeholder="Ex: João Silva" />
          </div>

          {/* Banco */}
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

          {/* CPF */}
          <div>
            <label style={label}>CPF do Cliente *</label>
            <input style={inp} value={form.cliente_cpf} onChange={e => set("cliente_cpf", e.target.value)} placeholder="000.000.000-00" maxLength={14} />
          </div>

          {/* Data */}
          <div>
            <label style={label}>Data da Venda *</label>
            <input type="date" style={inp} value={form.data_venda} onChange={e => set("data_venda", e.target.value)} />
          </div>

          {/* Valor + Prazo + Parcela */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div>
              <label style={label}>Valor (R$) *</label>
              <input style={inp} type="number" min="0" step="0.01" value={form.valor} onChange={e => set("valor", e.target.value)} placeholder="0,00" />
            </div>
            <div>
              <label style={label}>Prazo (meses) *</label>
              <input style={inp} type="number" min="1" value={form.prazo} onChange={e => set("prazo", e.target.value)} placeholder="84" />
            </div>
            <div>
              <label style={label}>Parcela (R$) *</label>
              <input style={inp} type="number" min="0" step="0.01" value={form.parcela} onChange={e => set("parcela", e.target.value)} placeholder="0,00" />
            </div>
          </div>

          {/* Código */}
          <div>
            <label style={label}>Código da Proposta</label>
            <input style={inp} value={form.codigo_proposta} onChange={e => set("codigo_proposta", e.target.value)} placeholder="Opcional" />
          </div>

          {/* Status inicial */}
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
  );
}

// ─── Card de proposta ─────────────────────────────────────────────────────────
interface CardProps {
  proposta: CrmProposta;
  onEdit: (p: CrmProposta) => void;
  onDelete: (id: string) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
}

function PropostaCard({ proposta: p, onEdit, onDelete, onDragStart }: CardProps) {
  const cor = COLUNAS.find(c => c.key === p.status)?.cor ?? C.blue;
  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, p.id)}
      style={{
        background: C.bg2, border: `1px solid ${C.border}`,
        borderLeft: `3px solid ${cor}`, borderRadius: 10,
        padding: "12px 14px", marginBottom: 8, cursor: "grab",
        transition: "opacity .15s",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ fontSize: ".8rem", fontWeight: 700, color: C.text, marginBottom: 4 }}>
          {p.nome_vendedor}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => onEdit(p)} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontSize: ".8rem" }}>✏️</button>
          <button onClick={() => onDelete(p.id)} style={{ background: "transparent", border: "none", color: C.red, cursor: "pointer", fontSize: ".8rem" }}>🗑</button>
        </div>
      </div>
      <div style={{ fontSize: ".72rem", color: cor, fontWeight: 700, marginBottom: 6 }}>{p.banco}</div>
      <div style={{ fontSize: ".75rem", color: C.muted }}>{fmtCpf(p.cliente_cpf)}</div>
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
function StatsSidebar({ stats }: { stats: CrmStats | null }) {
  if (!stats) return null;
  const barData = stats.ranking.map(r => ({ name: r.nome.split(" ")[0], valor: r.total }));

  return (
    <div style={{ width: 260, flexShrink: 0, display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Totais */}
      <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px" }}>
        <div style={{ fontSize: ".65rem", color: C.muted, textTransform: "uppercase", letterSpacing: ".8px", fontWeight: 700, marginBottom: 10 }}>Resumo</div>
        <div style={{ fontSize: "1.4rem", fontWeight: 800, color: C.green }}>{fmtMoeda(stats.total_valor)}</div>
        <div style={{ fontSize: ".75rem", color: C.muted, marginTop: 2 }}>{stats.total} propostas · ticket médio {fmtMoeda(stats.ticket_medio)}</div>
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 5 }}>
          {COLUNAS.map(c => (
            <div key={c.key} style={{ display: "flex", justifyContent: "space-between", fontSize: ".75rem" }}>
              <span style={{ color: c.cor }}>{c.label.split(" ").slice(1).join(" ")}</span>
              <span style={{ color: C.text, fontWeight: 700 }}>{stats.by_status[c.key] ?? 0}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Ranking vendedores */}
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

      {/* Gráfico por vendedor */}
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

      {/* Por banco */}
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
  const [propostas, setPropostas] = useState<CrmProposta[]>([]);
  const [stats, setStats] = useState<CrmStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<CrmProposta | null>(null);
  const [bancFiltro, setBancFiltro] = useState<string>("todos");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (bancFiltro !== "todos") params.banco = bancFiltro;
      if (dataInicio) params.data_inicio = dataInicio;
      if (dataFim) params.data_fim = dataFim;
      const [data, s] = await Promise.all([crmApi.listar(params), crmApi.stats()]);
      setPropostas(data);
      setStats(s);
      setErr(null);
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? "Erro ao carregar propostas");
    } finally { setLoading(false); }
  }, [bancFiltro, dataInicio, dataFim]);

  useEffect(() => { refresh(); }, [refresh]);

  // Drag & Drop handlers
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

    // Atualização otimista
    setPropostas(prev => prev.map(p => p.id === dragId ? { ...p, status: targetStatus } : p));
    setDragId(null);

    try {
      await crmApi.moverStatus(dragId, targetStatus);
      refresh();
    } catch {
      setPropostas(prev => prev.map(p => p.id === dragId ? { ...p, status: proposta.status } : p));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Apagar proposta?")) return;
    setPropostas(prev => prev.filter(p => p.id !== id));
    try { await crmApi.deletar(id); refresh(); } catch { refresh(); }
  };

  const handleSaved = (p: CrmProposta) => {
    if (editing) {
      setPropostas(prev => prev.map(x => x.id === p.id ? p : x));
    } else {
      setPropostas(prev => [p, ...prev]);
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

      {/* Filtros */}
      <div style={{ ...card, padding: "14px 18px", marginBottom: 18 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: ".7rem", color: C.muted, textTransform: "uppercase", letterSpacing: ".8px", fontWeight: 700 }}>Banco:</span>
          {["todos", ...BANCOS, "+Personalizado"].map(b => (
            <button key={b} onClick={() => setBancFiltro(b === "+Personalizado" ? bancFiltro : b)}
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

      {/* Layout: Kanban + Sidebar */}
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        {/* Kanban */}
        <div style={{ flex: 1, display: "flex", gap: 12, overflowX: "auto", minWidth: 0 }}>
          {COLUNAS.map(col => (
            <div
              key={col.key}
              onDragOver={handleDragOver}
              onDrop={e => handleDrop(e, col.key)}
              style={{ minWidth: 220, flex: 1, background: "rgba(255,255,255,.02)", border: `1px solid ${C.border}`, borderRadius: 12, padding: 12 }}
            >
              {/* Header da coluna */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, paddingBottom: 10, borderBottom: `1px solid ${C.border}` }}>
                <span style={{ fontSize: ".78rem", fontWeight: 800, color: col.cor }}>{col.label}</span>
                <span style={{ fontSize: ".7rem", background: `${col.cor}22`, color: col.cor, padding: "2px 8px", borderRadius: 10, fontWeight: 700 }}>
                  {colunasPropostas(col.key).length}
                </span>
              </div>

              {/* Cards */}
              {loading ? (
                <div style={{ color: C.muted, fontSize: ".8rem", textAlign: "center", padding: 20 }}>Carregando…</div>
              ) : colunasPropostas(col.key).length === 0 ? (
                <div style={{ color: C.muted, fontSize: ".75rem", textAlign: "center", padding: "24px 0", borderRadius: 8, border: `2px dashed ${C.border}` }}>
                  Arraste aqui
                </div>
              ) : (
                colunasPropostas(col.key).map(p => (
                  <PropostaCard
                    key={p.id}
                    proposta={p}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onDragStart={handleDragStart}
                  />
                ))
              )}
            </div>
          ))}
        </div>

        {/* Sidebar */}
        <StatsSidebar stats={stats} />
      </div>

      {/* Modal */}
      {showModal && (
        <PropostaModal
          onClose={() => { setShowModal(false); setEditing(null); }}
          onSaved={handleSaved}
          editing={editing}
        />
      )}
    </div>
  );
}
