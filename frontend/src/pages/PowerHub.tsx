import { useState, useEffect, useRef } from "react";
import { powerhubApi } from "../lib/api";

const C = {
  bg: "#080818", card: "#0d0d1f", border: "#1e2040",
  text: "#e0e0f0", muted: "#666", accent: "#6366f1",
  green: "#22c55e", red: "#ef4444", orange: "#f97316", blue: "#38bdf8",
  purple: "#a855f7",
};

type Stats = {
  total: number; pending: number; processing: number;
  found: number; not_found: number; error: number; total_phones: number;
};

type Batch = { id: string; file_name: string; total_leads: number; status: string; created_at: string };
type BotStatus = { status: string; run_id: string | null };
type Event = { type: string; cpf?: string; fase?: string; message?: string; worker_name?: string };

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px", minWidth: 100, flex: 1 }}>
      <div style={{ fontSize: ".7rem", color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: "1.6rem", fontWeight: 800, color }}>{value.toLocaleString("pt-BR")}</div>
    </div>
  );
}

export default function PowerHub() {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [botStatus, setBotStatus] = useState<BotStatus>({ status: "idle", run_id: null });
  const [events, setEvents] = useState<Event[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
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

  const running = botStatus.status === "running";
  const progress = stats && stats.total > 0
    ? Math.round(((stats.found + stats.not_found + stats.error) / stats.total) * 100)
    : 0;

  const eventColor = (e: Event) => {
    if (e.fase === "found") return C.green;
    if (e.fase === "not_found") return C.muted;
    if (e.fase === "error" || e.type === "worker_stopped") return C.red;
    if (e.type === "worker_started") return C.blue;
    return C.text;
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", padding: "24px 28px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
        <div style={{ fontSize: "1.4rem", fontWeight: 900, color: C.accent }}>POWER</div>
        <div style={{ fontSize: "1.4rem", fontWeight: 900, color: C.red }}>HUB</div>
        <div style={{ fontSize: ".75rem", color: C.muted, marginLeft: 4, marginTop: 2 }}>Enriquecimento de Telefone via CPF</div>
      </div>

      {/* Stats */}
      {stats && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
          <StatCard label="Total" value={stats.total} color={C.text} />
          <StatCard label="Pendentes" value={stats.pending} color={C.orange} />
          <StatCard label="Encontrados" value={stats.found} color={C.green} />
          <StatCard label="Sem telefone" value={stats.not_found} color={C.muted} />
          <StatCard label="Erros" value={stats.error} color={C.red} />
          <StatCard label="Telefones" value={stats.total_phones} color={C.purple} />
        </div>
      )}

      {/* Progress bar */}
      {stats && stats.total > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".75rem", color: C.muted, marginBottom: 4 }}>
            <span>Progresso</span>
            <span>{progress}%</span>
          </div>
          <div style={{ height: 6, background: C.border, borderRadius: 4, overflow: "hidden" }}>
            <div style={{ width: `${progress}%`, height: "100%", background: C.green, borderRadius: 4, transition: "width .5s" }} />
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {/* Upload + Controles */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
          <div style={{ fontSize: ".8rem", fontWeight: 700, color: C.muted, textTransform: "uppercase", marginBottom: 14, letterSpacing: ".5px" }}>
            CSV de CPFs
          </div>

          {batch && (
            <div style={{ fontSize: ".8rem", color: C.text, marginBottom: 12, padding: "8px 12px", background: "#0a0a1e", borderRadius: 8, border: `1px solid ${C.border}` }}>
              <span style={{ color: C.muted }}>Batch ativo: </span>
              <span style={{ color: C.blue }}>{batch.file_name || "sem nome"}</span>
              <span style={{ color: C.muted }}> — {batch.total_leads.toLocaleString("pt-BR")} CPFs</span>
            </div>
          )}

          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            style={{
              width: "100%", padding: "10px 16px", borderRadius: 10,
              background: "rgba(99,102,241,.15)", color: C.accent,
              border: `1px solid rgba(99,102,241,.4)`,
              fontWeight: 700, fontSize: ".82rem", cursor: uploading ? "wait" : "pointer",
              marginBottom: 10,
            }}
          >
            {uploading ? "Enviando..." : "📂 Upload CSV de CPFs"}
          </button>
          <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleUpload} style={{ display: "none" }} />

          {uploadMsg && (
            <div style={{ fontSize: ".78rem", color: uploadMsg.startsWith("✅") ? C.green : uploadMsg.startsWith("❌") ? C.red : C.muted, marginBottom: 10 }}>
              {uploadMsg}
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: ".75rem", color: C.muted }}>Workers:</span>
            {[1, 2, 3, 5].map(n => (
              <button
                key={n}
                onClick={() => setNumWorkers(n)}
                style={{
                  padding: "3px 10px", borderRadius: 6, fontSize: ".75rem", fontWeight: 700,
                  background: numWorkers === n ? C.accent : "transparent",
                  color: numWorkers === n ? "#fff" : C.muted,
                  border: `1px solid ${numWorkers === n ? C.accent : C.border}`,
                  cursor: "pointer",
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
              style={{
                flex: 1, padding: "10px 0", borderRadius: 10, fontWeight: 700, fontSize: ".82rem",
                background: running || !batch ? "transparent" : "rgba(34,197,94,.15)",
                color: running || !batch ? C.muted : C.green,
                border: `1px solid ${running || !batch ? C.border : "rgba(34,197,94,.4)"}`,
                cursor: running || !batch ? "not-allowed" : "pointer",
              }}
            >
              {running ? "▶ Rodando..." : "▶ Iniciar Enriquecimento"}
            </button>
            <button
              onClick={handleStop}
              disabled={!running}
              style={{
                padding: "10px 16px", borderRadius: 10, fontWeight: 700, fontSize: ".82rem",
                background: !running ? "transparent" : "rgba(239,68,68,.15)",
                color: !running ? C.muted : C.red,
                border: `1px solid ${!running ? C.border : "rgba(239,68,68,.4)"}`,
                cursor: !running ? "not-allowed" : "pointer",
              }}
            >
              ■ Parar
            </button>
          </div>

          <div style={{ marginTop: 12 }}>
            <a
              href={batch ? powerhubApi.exportCsvUrl(batch.id) : powerhubApi.exportCsvUrl()}
              style={{
                display: "block", textAlign: "center", padding: "9px 0", borderRadius: 10,
                background: "rgba(168,85,247,.1)", color: C.purple,
                border: "1px solid rgba(168,85,247,.3)",
                fontWeight: 700, fontSize: ".78rem", textDecoration: "none",
              }}
            >
              ⬇ Exportar CSV (CPF × Telefone)
            </a>
            <div style={{ fontSize: ".68rem", color: C.muted, textAlign: "center", marginTop: 4 }}>
              1 linha por telefone — até 4 por CPF
            </div>
          </div>
        </div>

        {/* Log de eventos */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: ".8rem", fontWeight: 700, color: C.muted, textTransform: "uppercase", marginBottom: 14, letterSpacing: ".5px" }}>
            Log em tempo real
          </div>
          <div style={{ flex: 1, overflowY: "auto", maxHeight: 320, fontFamily: "monospace", fontSize: ".72rem", display: "flex", flexDirection: "column", gap: 2 }}>
            {events.length === 0 && (
              <div style={{ color: C.muted, fontStyle: "italic" }}>Aguardando eventos...</div>
            )}
            {events.map((ev, i) => (
              <div key={i} style={{ color: eventColor(ev), lineHeight: 1.5 }}>
                <span style={{ color: C.muted, marginRight: 6 }}>
                  [{ev.worker_name?.replace("PowerHub Worker ", "W") ?? "—"}]
                </span>
                {ev.cpf && <span style={{ color: C.blue, marginRight: 6 }}>{ev.cpf}</span>}
                <span>{ev.fase ?? ev.type}</span>
                {ev.message && <span style={{ color: C.muted }}> — {ev.message}</span>}
              </div>
            ))}
            <div ref={eventsEndRef} />
          </div>
        </div>
      </div>

      {/* Info */}
      <div style={{ fontSize: ".72rem", color: C.muted, lineHeight: 1.6 }}>
        Fonte: <span style={{ color: C.blue }}>novapowerhub.com.br</span> — Consulta Telefonia.
        Credenciais configuradas em <span style={{ color: C.accent }}>Configurações → PowerHub</span>.
        Export gera 1 linha por telefone (CPF duplicado para cada número encontrado).
      </div>
    </div>
  );
}
