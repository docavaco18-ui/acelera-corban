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
    setUploadMsg("Enviando...");
    try {
      const r = await leadsApi.uploadCsv(file);
      setUploadMsg(`✓ ${r.inserted} leads inseridos`);
      onRefresh();
    } catch {
      setUploadMsg("Erro ao enviar o CSV");
    }
    e.target.value = "";
    setTimeout(() => setUploadMsg(null), 5000);
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
        <span style={{ fontSize: 13, color: uploadMsg.startsWith("✓") ? "#22c55e" : "#ef4444" }}>
          {uploadMsg}
        </span>
      )}
    </div>
  );
}
