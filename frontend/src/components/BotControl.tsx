import { useRef, useState } from "react";
import { botApi, leadsApi } from "../lib/api";
import type { BotStatus } from "../lib/types";

interface Props {
  status: BotStatus;
  onRefresh: () => void;
}

export default function BotControl({ status, onRefresh }: Props) {
  const [workers, setWorkers] = useState(6);
  const [loading, setLoading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ processed: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const exec = async (fn: () => Promise<unknown>) => {
    setLoading(true);
    await fn().catch(console.error);
    onRefresh();
    setLoading(false);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploadMsg("Enviando arquivo…");
    setUploadProgress(null);
    let jobId: string;
    try {
      const r = await leadsApi.uploadCsv(file);
      jobId = r.job_id;
    } catch {
      setUploadMsg("Erro ao enviar o CSV");
      setTimeout(() => setUploadMsg(null), 5000);
      return;
    }
    setUploadMsg("Processando…");
    while (true) {
      await new Promise((res) => setTimeout(res, 1000));
      try {
        const s = await leadsApi.uploadStatus(jobId);
        if (s.total > 0) setUploadProgress({ processed: s.processed, total: s.total });
        if (s.status === "done") {
          setUploadMsg(`✓ ${s.inserted} de ${s.total} leads inseridos`);
          onRefresh();
          break;
        }
        if (s.status === "error") {
          setUploadMsg(`Erro: ${s.error ?? "desconhecido"}`);
          break;
        }
      } catch {
        setUploadMsg("Erro ao consultar progresso");
        break;
      }
    }
    setTimeout(() => { setUploadMsg(null); setUploadProgress(null); }, 6000);
  };

  const running = status.status === "running";

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", padding: "12px 0" }}>
      <span>
        Bot:{" "}
        <strong style={{ color: running ? "#22c55e" : "#94a3b8" }}>
          {status.status}
        </strong>
      </span>
      <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#94a3b8" }}>
        Workers:
        <input
          type="number"
          min={1}
          max={20}
          value={workers}
          onChange={(e) => setWorkers(Number(e.target.value))}
          style={{ width: 50, padding: "4px 8px", borderRadius: 6, background: "#1a1f2e", border: "1px solid #334155", color: "#fff" }}
        />
      </label>
      <button
        onClick={() => exec(() => botApi.start(workers))}
        disabled={loading || running}
        style={{
          padding: "8px 16px",
          background: running || loading ? "#94a3b8" : "#22c55e",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          cursor: running || loading ? "not-allowed" : "pointer",
        }}
      >
        Iniciar
      </button>
      <button
        onClick={() => exec(() => botApi.stop())}
        disabled={loading || !running}
        style={{
          padding: "8px 16px",
          background: !running || loading ? "#94a3b8" : "#ef4444",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          cursor: !running || loading ? "not-allowed" : "pointer",
        }}
      >
        Parar
      </button>

      <input ref={fileInputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleUpload} />
      <button
        onClick={() => fileInputRef.current?.click()}
        style={{
          padding: "8px 16px",
          background: "#6366f1",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        ↑ Carregar CSV
      </button>
      <button
        onClick={() => leadsApi.exportCsv()}
        style={{
          padding: "8px 16px",
          background: "#3b82f6",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        ⬇ Exportar Elegíveis
      </button>
      {uploadMsg && (
        <span style={{ fontSize: 13, color: uploadMsg.startsWith("✓") ? "#22c55e" : uploadMsg.startsWith("Erro") ? "#ef4444" : "#94a3b8" }}>
          {uploadMsg}
        </span>
      )}
      {uploadProgress && uploadProgress.total > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 180 }}>
          <div style={{ flex: 1, height: 8, background: "#1a1f2e", borderRadius: 4, overflow: "hidden" }}>
            <div style={{
              width: `${Math.min(100, (uploadProgress.processed / uploadProgress.total) * 100)}%`,
              height: "100%", background: "#6366f1", transition: "width .3s",
            }} />
          </div>
          <span style={{ fontSize: 12, color: "#94a3b8" }}>
            {uploadProgress.processed}/{uploadProgress.total}
          </span>
        </div>
      )}
    </div>
  );
}
