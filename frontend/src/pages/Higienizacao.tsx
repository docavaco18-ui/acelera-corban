import { useCallback, useEffect, useRef, useState } from "react";
import { Dashboard } from "./Dashboard";
import { batchesApi } from "../lib/api";
import type { Batch } from "../lib/types";

export default function Higienizacao() {
  const [batch, setBatch] = useState<Batch | null | undefined>(undefined); // undefined = loading
  const [batchErr, setBatchErr] = useState<string | null>(null);
  const aliveRef = useRef(true);

  const fetchCurrent = useCallback(() => {
    batchesApi.current()
      .then(b => {
        if (aliveRef.current) { setBatch(b); setBatchErr(null); }
      })
      .catch((e: any) => {
        if (aliveRef.current) {
          setBatch(null);
          setBatchErr(e?.response?.data?.detail || e?.message || "Falha ao carregar base atual");
        }
      });
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    fetchCurrent();
    const t = setInterval(fetchCurrent, 30000);
    return () => { aliveRef.current = false; clearInterval(t); };
  }, [fetchCurrent]);

  if (batch === undefined && batchErr === null) {
    return <div style={{ padding: 40, color: "#94a3b8" }}>Carregando base atual…</div>;
  }

  if (batchErr) {
    return (
      <div style={{ padding: 40, color: "#94a3b8", textAlign: "center" }}>
        <h2 style={{ color: "#fff", marginBottom: 12 }}>⚠️ Erro ao carregar base atual</h2>
        <p style={{ color: "#ff2d78", fontSize: ".88rem", marginBottom: 16 }}>{batchErr}</p>
        <button
          onClick={() => { setBatchErr(null); setBatch(undefined); fetchCurrent(); }}
          style={{
            padding: "9px 20px", background: "rgba(0,191,255,.15)", color: "#00bfff",
            border: "1px solid rgba(0,191,255,.4)", borderRadius: 18, cursor: "pointer",
            fontSize: ".82rem", fontWeight: 700,
          }}
        >
          🔄 Tentar novamente
        </button>
      </div>
    );
  }

  if (!batch) {
    return (
      <div style={{ padding: 40, color: "#94a3b8", textAlign: "center" }}>
        <h2 style={{ color: "#fff", marginBottom: 12 }}>📭 Nenhuma base ativa</h2>
        <p>Faça upload de um CSV pra começar a higienizar.</p>
        <Dashboard onSessionChanged={fetchCurrent} />
      </div>
    );
  }

  return (
    <Dashboard
      batchId={batch.id}
      batchName={batch.name}
      key={batch.id}
      onSessionChanged={fetchCurrent}
    />
  );
}
