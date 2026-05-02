import { useEffect, useState } from "react";
import { Dashboard } from "./Dashboard";
import { batchesApi } from "../lib/api";
import type { Batch } from "../lib/types";

export default function Higienizacao() {
  const [batch, setBatch] = useState<Batch | null | undefined>(undefined); // undefined = loading

  useEffect(() => {
    let alive = true;
    const fetchCurrent = () => {
      batchesApi.current()
        .then(b => { if (alive) setBatch(b); })
        .catch(() => { if (alive) setBatch(null); });
    };
    fetchCurrent();
    const t = setInterval(fetchCurrent, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (batch === undefined) {
    return <div style={{ padding: 40, color: "#94a3b8" }}>Carregando base atual…</div>;
  }

  if (!batch) {
    return (
      <div style={{ padding: 40, color: "#94a3b8", textAlign: "center" }}>
        <h2 style={{ color: "#fff", marginBottom: 12 }}>📭 Nenhuma base ativa</h2>
        <p>Faça upload de um CSV pra começar a higienizar.</p>
        <p style={{ marginTop: 24, fontSize: ".85rem", color: "#64748b" }}>
          Vá pra aba <b>HIGIENIZAÇÃO</b> e clique em <b>↑ Carregar CSV</b> (vai aparecer abaixo).
        </p>
        <Dashboard />
      </div>
    );
  }

  return (
    <Dashboard
      batchId={batch.id}
      batchName={batch.name}
      key={batch.id}
    />
  );
}
