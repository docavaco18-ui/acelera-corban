import { useCallback, useEffect, useRef, useState } from "react";
import { Dashboard } from "./Dashboard";
import { batchesApi } from "../lib/api";
import type { Batch } from "../lib/types";

export default function Higienizacao() {
  const [batch, setBatch] = useState<Batch | null | undefined>(undefined); // undefined = loading
  const aliveRef = useRef(true);

  const fetchCurrent = useCallback(() => {
    batchesApi.current()
      .then(b => { if (aliveRef.current) setBatch(b); })
      .catch(() => { if (aliveRef.current) setBatch(null); });
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    fetchCurrent();
    const t = setInterval(fetchCurrent, 30000);
    return () => { aliveRef.current = false; clearInterval(t); };
  }, [fetchCurrent]);

  if (batch === undefined) {
    return <div style={{ padding: 40, color: "#94a3b8" }}>Carregando base atual…</div>;
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
