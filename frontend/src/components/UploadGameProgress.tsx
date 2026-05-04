import { useEffect, useRef, useState } from "react";

const C = {
  bg: "rgba(8,8,24,.97)",
  border: "rgba(255,255,255,.08)",
  green: "#00ff88",
  purple: "#b44aff",
  blue: "#00bfff",
  gold: "#ffd700",
};

export type UploadPhase = "uploading" | "processing" | "done" | "bot_running";

interface Props {
  phase: UploadPhase;
  inserted?: number;
  total?: number;
  workerStartFired: boolean;
  onClose: () => void;
}

interface Msg {
  text: string;
  color?: string;
  delay: number; // ms after previous message before showing this one
}

function buildMessages(inserted: number, _total: number): Msg[] {
  return [
    { text: "📂 Leads carregados!", color: C.green, delay: 0 },
    { text: "🔍 Verificando CPFs...", color: C.blue, delay: 2500 },
    { text: `✅ ${inserted} CPFs encontrados`, color: C.green, delay: 2500 },
    { text: "⏳ Aguarde enquanto estamos processando seus leads", color: C.gold, delay: 3000 },
    { text: "🤖 Robôs de trabalho sendo acionados", color: C.purple, delay: 3500 },
    { text: "🧠 Cérebro carregando seus dados", color: C.blue, delay: 4000 },
    { text: "☕ Esse processo pode levar até 3 minutos — vai pegar um cafezinho", color: C.gold, delay: 4000 },
    { text: "💪 Está tudo ok, os peões já começaram o trabalho pesado por você", color: C.green, delay: 4500 },
  ];
}

export default function UploadGameProgress({ phase, inserted = 0, total = 0, workerStartFired, onClose }: Props) {
  const [visibleCount, setVisibleCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const msgs = buildMessages(inserted, total);

  // advance to next message
  const scheduleNext = (current: number) => {
    if (current >= msgs.length) {
      // all shown, close after a moment
      timerRef.current = setTimeout(onClose, 5000);
      return;
    }
    const delay = msgs[current].delay;
    timerRef.current = setTimeout(() => {
      setVisibleCount(current + 1);
      scheduleNext(current + 1);
    }, delay);
  };

  useEffect(() => {
    setVisibleCount(1); // show first immediately
    scheduleNext(1);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  // when worker_start fires from WS, jump to msg 5 (index 4) if not there yet
  useEffect(() => {
    if (!workerStartFired) return;
    setVisibleCount(prev => {
      if (prev < 5) return 5;
      return prev;
    });
  }, [workerStartFired]);

  const shown = msgs.slice(0, visibleCount);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,.7)", backdropFilter: "blur(6px)",
    }}>
      <div style={{
        background: C.bg,
        border: `1px solid ${C.border}`,
        borderRadius: 20,
        padding: "36px 40px",
        maxWidth: 520,
        width: "90%",
        boxShadow: "0 0 60px rgba(180,74,255,.15)",
      }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: "2.4rem", marginBottom: 8 }}>
            {phase === "uploading" || phase === "processing" ? "⬆️" : phase === "done" ? "✅" : "🤖"}
          </div>
          <div style={{ fontSize: ".7rem", textTransform: "uppercase", letterSpacing: 1.5, color: "#444", fontWeight: 700 }}>
            {phase === "bot_running" ? "Bot em execução" : "Processando base"}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 160 }}>
          {shown.map((m, i) => (
            <div
              key={i}
              style={{
                display: "flex", alignItems: "flex-start", gap: 12,
                animation: "fadeSlide .4s ease",
                opacity: i === shown.length - 1 ? 1 : 0.55,
              }}
            >
              <div style={{
                width: 6, height: 6, borderRadius: "50%",
                background: m.color ?? "#fff",
                marginTop: 7, flexShrink: 0,
                boxShadow: i === shown.length - 1 ? `0 0 8px ${m.color}` : "none",
              }} />
              <span style={{
                color: i === shown.length - 1 ? m.color ?? "#fff" : "#555",
                fontSize: i === shown.length - 1 ? "1rem" : ".85rem",
                fontWeight: i === shown.length - 1 ? 700 : 400,
                lineHeight: 1.45,
                transition: "all .3s",
              }}>
                {m.text}
              </span>
            </div>
          ))}

          {visibleCount < msgs.length && (
            <div style={{ display: "flex", gap: 5, marginTop: 4, paddingLeft: 18 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 5, height: 5, borderRadius: "50%", background: "#333",
                  animation: `bounce .9s ${i * 0.15}s infinite`,
                }} />
              ))}
            </div>
          )}
        </div>

        {total > 0 && (phase === "uploading" || phase === "processing") && (
          <div style={{ marginTop: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".72rem", color: "#444", marginBottom: 6 }}>
              <span>Progresso</span>
              <span>{inserted}/{total}</span>
            </div>
            <div style={{ height: 4, background: "rgba(255,255,255,.06)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${total > 0 ? Math.min(100, (inserted / total) * 100) : 0}%`,
                background: C.purple,
                borderRadius: 2,
                transition: "width .4s ease",
              }} />
            </div>
          </div>
        )}

        <button
          onClick={onClose}
          style={{
            marginTop: 28, width: "100%", padding: "10px 0",
            background: "rgba(255,255,255,.04)", border: `1px solid ${C.border}`,
            borderRadius: 10, color: "#444", fontSize: ".75rem", cursor: "pointer",
          }}
        >
          fechar
        </button>
      </div>

      <style>{`
        @keyframes fadeSlide {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-5px); }
        }
      `}</style>
    </div>
  );
}
