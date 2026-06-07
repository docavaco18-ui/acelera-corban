import { useState, useEffect, useRef } from "react";
import { powerhubApi } from "../lib/api";
import { C, G, glassCard, sectionTitle, SHARED_CSS, PulseDot } from "../components/disparo-shared";

type Stats = {
  total: number; pending: number; processing: number;
  found: number; not_found: number; error: number; total_phones: number;
};

type Batch = { id: string; file_name: string; total_leads: number; status: string; created_at: string };
type BotStatus = { status: string; run_id: string | null };
type Event = { type: string; cpf?: string; fase?: string; message?: string; worker_name?: string };

const STAT_CARDS = [
  { key: "total",        label: "Total",        color: C.text,   icon: "📋", grad: G.primary },
  { key: "pending",      label: "Pendentes",    color: C.yellow, icon: "⏳", grad: G.yellow  },
  { key: "found",        label: "Encontrados",  color: C.green,  icon: "✅", grad: G.green   },
  { key: "not_found",    label: "Sem telefone", color: C.muted,  icon: "❌", grad: G.purple  },
  { key: "error",        label: "Erros",        color: C.red,    icon: "⚠️", grad: G.red     },
  { key: "total_phones", label: "Telefones",    color: "#a78bfa",icon: "📞", grad: G.pink    },
] as const;

function eventColor(e: Event): string {
  if (e.fase === "found")        return C.green;
  if (e.fase === "not_found")    return C.muted;
  if (e.fase === "error" || e.type === "worker_stopped") return C.red;
  if (e.type === "worker_started") return "#06b6d4";
  return C.text;
}

export default function PowerHub() {
  const [batch, setBatch]        = useState<Batch | null>(null);
  const [stats, setStats]        = useState<Stats | null>(null);
  const [botStatus, setBotStatus]= useState<BotStatus>({ status: "idle", run_id: null });
  const [events, setEvents]      = useState<Event[]>([]);
  const [uploading, setUploading]= useState(false);
  const [uploadMsg, setUploadMsg]= useState<string | null>(null);
  const [numWorkers, setNumWorkers] = useState(3);
  const fileRef = useRef<HTMLInputElement>(null);
  const eventsEndRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    const [b, s, bs] = await Promise.all([
      powerhubApi.currentBatch(),
      powerhubApi.stats(),
      powerhubApi.botStatus(),
    ]);
    if (b) setBatch(b as Batch);
    if (s) setStats(s);
    setBotStatus(bs);
  };

  useEffect(() => {
    load();
    const iv = setInterval(async () => {
      await load();
      const evs = await powerhubApi.botEvents();
      setEvents(evs.slice(-80));
    }, 4000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg("Fazendo upload...");
    try {
      const { job_id } = await powerhubApi.uploadCsv(file);
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const s = await powerhubApi.uploadStatus(job_id);
          if (s.status === "done") {
            clearInterval(poll);
            setUploadMsg(`✅ ${s.inserted} CPFs importados`);
            setUploading(false);
            load();
          } else if (s.status === "error") {
            clearInterval(poll);
            setUploadMsg(`❌ Erro: ${s.error}`);
            setUploading(false);
          } else if (attempts > 60) {
            clearInterval(poll);
            setUploadMsg("⚠️ Timeout no upload");
            setUploading(false);
          } else {
            setUploadMsg(`Processando... ${s.inserted ?? 0}/${s.total ?? "?"}`);
          }
        } catch {
          clearInterval(poll);
          setUploadMsg("❌ Falha ao verificar status");
          setUploading(false);
        }
      }, 1000);
    } catch {
      setUploadMsg("❌ Falha no upload");
      setUploading(false);
    }
    e.target.value = "";
  };

  const handleStart = async () => {
    await powerhubApi.botStart(batch?.id, numWorkers);
    await load();
  };

  const handleStop = async () => {
    await powerhubApi.botStop();
    await load();
  };

  const running  = botStatus.status === "running";
  const progress = stats && stats.total > 0
    ? Math.round(((stats.found + stats.not_found + stats.error) / stats.total) * 100)
    : 0;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", padding: "28px 28px" }}>
      <style>{SHARED_CSS}</style>

      {/* Hero header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28 }}>
        <div style={{
          width: 48, height: 48, borderRadius: 14,
          background: "linear-gradient(135deg,rgba(236,72,153,.25),rgba(124,58,237,.25))",
          border: "1.5px solid rgba(236,72,153,.4)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 22, animation: "fade-up .35s ease-out",
        }}>📞</div>
        <div>
          <h1 style={{ ...sectionTitle(G.pink), fontSize: 22, marginBottom: 2 }}>PowerHub</h1>
          <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>Enriquecimento de telefone via CPF · novapowerhub.com.br</p>
        </div>
        {running && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", background: "rgba(16,185,129,.1)", border: "1px solid rgba(16,185,129,.3)", borderRadius: 20, fontSize: 12, fontWeight: 700, color: C.green }}>
            <PulseDot color={C.green} />
            Rodando
          </div>
        )}
      </div>

      {/* Stats grid */}
      {stats && (
        <div className="spot-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10, marginBottom: 20 }}>
          {STAT_CARDS.map(sc => (
            <div key={sc.key} className="spot-card" style={{
              ...glassCard(sc.grad, 16),
              textAlign: "center",
              "--spot-color": sc.color,
            } as React.CSSProperties}>
              <div className="spot-glow" /><div className="spot-shine" />
              <div style={{ fontSize: 18, marginBottom: 4 }}>{sc.icon}</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: sc.color, lineHeight: 1 }}>
                {(stats[sc.key] || 0).toLocaleString("pt-BR")}
              </div>
              <div style={{ fontSize: 10, color: C.sec, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", marginTop: 4 }}>{sc.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Progress bar */}
      {stats && stats.total > 0 && (
        <div style={{ ...glassCard(G.green, 14), marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.sec, marginBottom: 8, fontWeight: 600 }}>
            <span>Progresso geral</span>
            <span style={{ color: C.green, fontWeight: 700 }}>{progress}%</span>
          </div>
          <div style={{ height: 8, background: "rgba(255,255,255,.06)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ width: `${progress}%`, height: "100%", background: G.green, borderRadius: 4, transition: "width .5s" }} />
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 11, color: C.muted }}>
            <span><b style={{ color: C.green }}>{stats.found.toLocaleString("pt-BR")}</b> encontrados</span>
            <span><b style={{ color: C.muted }}>{stats.not_found.toLocaleString("pt-BR")}</b> sem tel.</span>
            <span><b style={{ color: C.red }}>{stats.error.toLocaleString("pt-BR")}</b> erros</span>
            <span><b style={{ color: C.text }}>{stats.pending.toLocaleString("pt-BR")}</b> pendentes</span>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {/* Upload + Controles */}
        <div style={glassCard(G.primary, 22)}>
          <div style={{ ...sectionTitle(G.primary), fontSize: 12, marginBottom: 18 }}>CSV de CPFs</div>

          {batch && (
            <div style={{ fontSize: 12, marginBottom: 14, padding: "10px 14px", background: "rgba(255,255,255,.04)", borderRadius: 8, border: "1px solid rgba(255,255,255,.08)" }}>
              <span style={{ color: C.muted }}>Batch ativo: </span>
              <span style={{ color: "#06b6d4" }}>{batch.file_name || "sem nome"}</span>
              <span style={{ color: C.muted }}> — {batch.total_leads.toLocaleString("pt-BR")} CPFs</span>
            </div>
          )}

          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="ds-btn"
            style={{
              width: "100%", padding: "11px 16px", borderRadius: 10,
              background: uploading ? "rgba(255,255,255,.04)" : G.primary,
              color: uploading ? C.muted : "#fff",
              border: uploading ? "1px solid rgba(255,255,255,.06)" : "none",
              fontWeight: 700, fontSize: 14, cursor: uploading ? "wait" : "pointer",
              marginBottom: 12, boxShadow: uploading ? "none" : "0 4px 14px rgba(0,0,0,.35)",
            }}
          >
            {uploading ? "Enviando..." : "📂 Upload CSV de CPFs"}
          </button>
          <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleUpload} style={{ display: "none" }} />

          {uploadMsg && (
            <div style={{ fontSize: 12, color: uploadMsg.startsWith("✅") ? C.green : uploadMsg.startsWith("❌") ? C.red : C.muted, marginBottom: 12, padding: "8px 12px", background: "rgba(255,255,255,.04)", borderRadius: 8 }}>
              {uploadMsg}
            </div>
          )}

          {/* Worker selector */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>Workers:</span>
            {[1, 2, 3, 5].map(n => (
              <button
                key={n}
                onClick={() => setNumWorkers(n)}
                style={{
                  padding: "4px 12px", borderRadius: 6, fontSize: 12, fontWeight: 700,
                  background: numWorkers === n ? "rgba(124,58,237,.3)" : "transparent",
                  color: numWorkers === n ? "#a78bfa" : C.muted,
                  border: `1px solid ${numWorkers === n ? "rgba(124,58,237,.5)" : "rgba(255,255,255,.1)"}`,
                  cursor: "pointer", transition: "all .15s",
                }}
              >
                {n}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleStart}
              disabled={running || !batch}
              className="ds-btn"
              style={{
                flex: 1, padding: "10px 0", borderRadius: 10, fontWeight: 700, fontSize: 13,
                background: running || !batch ? "rgba(255,255,255,.04)" : G.green,
                color: running || !batch ? C.muted : "#fff",
                border: running || !batch ? "1px solid rgba(255,255,255,.06)" : "none",
                cursor: running || !batch ? "not-allowed" : "pointer",
                boxShadow: running || !batch ? "none" : "0 4px 14px rgba(0,0,0,.35)",
              }}
            >
              {running ? "▶ Rodando..." : "▶ Iniciar Enriquecimento"}
            </button>
            <button
              onClick={handleStop}
              disabled={!running}
              className="ds-btn"
              style={{
                padding: "10px 16px", borderRadius: 10, fontWeight: 700, fontSize: 13,
                background: !running ? "rgba(255,255,255,.04)" : "rgba(239,68,68,.15)",
                color: !running ? C.muted : C.red,
                border: `1px solid ${!running ? "rgba(255,255,255,.06)" : "rgba(239,68,68,.35)"}`,
                cursor: !running ? "not-allowed" : "pointer",
              }}
            >
              ■ Parar
            </button>
          </div>

          <button
            onClick={() => powerhubApi.exportCsv(batch?.id)}
            className="ds-btn"
            style={{
              width: "100%", display: "block", textAlign: "center", padding: "10px 0", borderRadius: 10,
              background: "rgba(168,85,247,.12)", color: "#a78bfa",
              border: "1px solid rgba(168,85,247,.3)",
              fontWeight: 700, fontSize: 13, cursor: "pointer", marginTop: 12,
            }}
          >
            ⬇ Exportar CSV (CPF × Telefone)
          </button>
          <div style={{ fontSize: 11, color: C.muted, textAlign: "center", marginTop: 6 }}>
            1 linha por telefone — até 4 por CPF
          </div>
        </div>

        {/* Log de eventos */}
        <div style={{ ...glassCard(G.cyan, 22), display: "flex", flexDirection: "column" }}>
          <div style={{ ...sectionTitle(G.cyan), fontSize: 12, marginBottom: 18 }}>Log em tempo real</div>
          <div style={{ flex: 1, overflowY: "auto", maxHeight: 320, fontFamily: "'JetBrains Mono',monospace", fontSize: 11, display: "flex", flexDirection: "column", gap: 3 }}>
            {events.length === 0 && (
              <div style={{ color: C.muted, fontStyle: "italic" }}>Aguardando eventos...</div>
            )}
            {events.map((ev, i) => (
              <div key={i} style={{ color: eventColor(ev), lineHeight: 1.6, padding: "1px 0" }}>
                <span style={{ color: C.muted, marginRight: 6 }}>
                  [{ev.worker_name?.replace("PowerHub Worker ", "W") ?? "—"}]
                </span>
                {ev.cpf && <span style={{ color: "#06b6d4", marginRight: 6 }}>{ev.cpf}</span>}
                <span>{ev.fase ?? ev.type}</span>
                {ev.message && <span style={{ color: C.muted }}> — {ev.message}</span>}
              </div>
            ))}
            <div ref={eventsEndRef} />
          </div>
        </div>
      </div>

      {/* Info bar */}
      <div style={{ ...glassCard("linear-gradient(135deg,rgba(6,182,212,.3),rgba(124,58,237,.3))", 14), fontSize: 12, color: C.sec, lineHeight: 1.7 }}>
        Fonte: <span style={{ color: "#06b6d4", fontWeight: 600 }}>novapowerhub.com.br</span> — Consulta Telefonia.
        Credenciais configuradas em <span style={{ color: "#a78bfa" }}>Configurações → PowerHub</span>.
        Export gera 1 linha por telefone (CPF duplicado para cada número encontrado).
      </div>
    </div>
  );
}
