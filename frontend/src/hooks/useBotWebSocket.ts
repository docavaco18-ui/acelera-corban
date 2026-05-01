import { useEffect, useRef, useState, useCallback } from "react";
import type { BotEvent, WorkerState, Badge } from "../lib/types";
import { getAccessToken } from "../lib/supabase";

// V8 backend exposes WS at /ws/events on same host as the page.
const WS_BASE = (() => {
  const envBase = import.meta.env.VITE_API_URL;
  if (envBase) return envBase.replace(/^http/, "ws") + "/ws/events";
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws/events`;
})();

async function buildWsUrl(): Promise<string> {
  const token = await getAccessToken();
  return `${WS_BASE}?token=${encodeURIComponent(token ?? "")}`;
}

const DEBOUNCE_MS = 300;

const WORKER_NAMES = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta"];
const WORKER_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#8b5cf6"];
const XP_THRESHOLDS = [0, 100, 300, 600, 1000];

// Map V8 status (status_update) → VCTex-style "fase" tokens used by canvas/log.
// V8 status enum: pendente | enriquecido | consentido | autorizado | aguardando_resultado | elegivel | inelegivel | erro
function calcLevel(xp: number): number {
  for (let i = XP_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= XP_THRESHOLDS[i]) return i + 1;
  }
  return 1;
}

function calcCpm(timestamps: number[]): number {
  const now = Date.now();
  return timestamps.filter((t) => now - t < 60_000).length;
}

function xpForStatus(status: string | undefined): number {
  // partial XP for intermediate phases reached
  switch (status) {
    case "enriquecido": return 5;
    case "consentido": return 5;
    case "autorizado": return 10;
    default: return 0;
  }
}

function checkBadges(w: WorkerState): Badge[] {
  const badges = [...w.badges];
  const has = (id: string) => badges.some((b) => b.id === id);
  if (!has("cacador") && w.elegiveis >= 5)
    badges.push({ id: "cacador", label: "Caçador de Ouro", icon: "🥇", earnedAt: new Date().toISOString() });
  if (!has("maquina") && w.processed >= 100 && w.erros === 0)
    badges.push({ id: "maquina", label: "Máquina", icon: "🤖", earnedAt: new Date().toISOString() });
  if (!has("chamas") && w.maxStreak >= 20)
    badges.push({ id: "chamas", label: "Em Chamas", icon: "🔥", earnedAt: new Date().toISOString() });
  return badges;
}

function makeWorker(id: number): WorkerState {
  return {
    id,
    name: WORKER_NAMES[id] ?? `W${id}`,
    color: WORKER_COLORS[id] ?? "#6366f1",
    xp: 0,
    level: 1,
    currentPhase: null,
    currentCpf: null,
    currentNome: null,
    startedAt: null,
    streak: 0,
    maxStreak: 0,
    processed: 0,
    elegiveis: 0,
    erros: 0,
    eventTimestamps: [],
    cpm: 0,
    badges: [],
    recentLog: [],
  };
}

interface UseBotWebSocketReturn {
  connected: boolean;
  events: BotEvent[];
  phaseCounts: Record<number, number>;
  botStatus: string;
  workerStates: WorkerState[];
  runStartedAt: number | null;
}

// Map V8 status string to a phase index for BotCanvas.
// Phases: 0=enriquecimento, 1=consentimento, 2=autorização, 3=resultado
const PHASE_INDEX: Record<string, number> = {
  pendente: 0,
  enriquecido: 0,
  consentido: 1,
  autorizado: 2,
  aguardando_resultado: 3,
  elegivel: 3,
  inelegivel: 3,
  erro: 3,
};

export function useBotWebSocket(): UseBotWebSocketReturn {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<BotEvent[]>([]);
  const [phaseCounts, setPhaseCounts] = useState<Record<number, number>>({});
  const [botStatus, setBotStatus] = useState("idle");
  const [workerStates, setWorkerStates] = useState<WorkerState[]>([]);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCountsRef = useRef<Record<number, number>>({});
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workerMapRef = useRef<Map<number, WorkerState>>(new Map());

  const flushCounts = useCallback(() => {
    setPhaseCounts((prev) => ({ ...prev, ...pendingCountsRef.current }));
    pendingCountsRef.current = {};
  }, []);

  const phaseCountsRef = useRef<Record<number, number>>({});
  useEffect(() => { phaseCountsRef.current = phaseCounts; }, [phaseCounts]);

  const bumpPhase = useCallback(
    (status: string | undefined) => {
      if (!status) return;
      const idx = PHASE_INDEX[status];
      if (idx === undefined) return;
      pendingCountsRef.current[idx] =
        (pendingCountsRef.current[idx] ?? phaseCountsRef.current[idx] ?? 0) + 1;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(flushCounts, DEBOUNCE_MS);
    },
    [flushCounts]
  );

  const mountedRef = useRef(true);

  const connect = useCallback(async () => {
    if (!mountedRef.current) return;
    const url = await buildWsUrl();
    if (!mountedRef.current) return;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) { ws.close(); return; }
      setConnected(true);
      if (retryRef.current) clearTimeout(retryRef.current);
    };
    ws.onclose = () => {
      setConnected(false);
      if (!mountedRef.current) return;
      retryRef.current = setTimeout(connect, 3000);
    };
    ws.onerror = () => ws.close();

    ws.onmessage = (e) => {
      try {
        const event: BotEvent = JSON.parse(e.data);

        // Synthesize VCTex-style fase/resultado for downstream components.
        const synthetic: BotEvent = { ...event };
        if (event.type === "lead_result") {
          synthetic.fase = event.status === "elegivel" ? "concluido"
                          : event.status === "inelegivel" ? "concluido"
                          : event.status === "erro" ? "erro"
                          : "concluido";
          synthetic.resultado = event.status === "elegivel" ? "Elegível"
                              : event.status === "inelegivel" ? "Não Elegível"
                              : event.status;
        } else if (event.type === "status_update" || event.type === "worker_start") {
          synthetic.fase = event.status ?? undefined;
        }

        setEvents((prev) => [synthetic, ...prev].slice(0, 200));

        if (event.type === "bot_status" && event.status) {
          setBotStatus(event.status);
          if (event.status === "running") {
            setRunStartedAt(Date.now());
            workerMapRef.current.clear();
            setWorkerStates([]);
            setPhaseCounts({});
          }
          if (event.status === "idle" || event.status === "stopped") {
            setRunStartedAt(null);
          }
          return;
        }

        const wid = event.worker_id;
        if (wid === undefined || wid === null) return;
        const prev = workerMapRef.current.get(wid) ?? makeWorker(wid);
        const now = Date.now();

        if (event.type === "worker_start") {
          const next: WorkerState = {
            ...prev,
            currentCpf: event.cpf ?? null,
            currentNome: event.nome ?? null,
            currentPhase: event.status ?? "iniciando",
            startedAt: event.ts ? new Date(event.ts).getTime() : Date.now(),
            recentLog: [`▶ start ***${event.cpf?.slice(-3) ?? "???"}`, ...prev.recentLog].slice(0, 5),
          };
          workerMapRef.current.set(wid, next);
          setWorkerStates(Array.from(workerMapRef.current.values()).sort((a, b) => a.id - b.id));
          return;
        }

        if (event.type === "worker_idle") {
          const next: WorkerState = {
            ...prev,
            currentCpf: null,
            currentNome: null,
            currentPhase: null,
            startedAt: null,
          };
          workerMapRef.current.set(wid, next);
          setWorkerStates(Array.from(workerMapRef.current.values()).sort((a, b) => a.id - b.id));
          return;
        }

        if (event.type === "status_update") {
          const xpGain = xpForStatus(event.status);
          const newXp = prev.xp + xpGain;
          bumpPhase(event.status);
          const next: WorkerState = {
            ...prev,
            xp: newXp,
            level: calcLevel(newXp),
            currentPhase: event.status ?? prev.currentPhase,
            currentCpf: event.cpf ?? prev.currentCpf,
            currentNome: event.nome ?? prev.currentNome,
            recentLog: [
              `→ ${event.status ?? "?"} ***${event.cpf?.slice(-3) ?? "???"}`,
              ...prev.recentLog,
            ].slice(0, 5),
          };
          workerMapRef.current.set(wid, next);
          setWorkerStates(Array.from(workerMapRef.current.values()).sort((a, b) => a.id - b.id));
          return;
        }

        if (event.type === "lead_result") {
          const newTimestamps = [...prev.eventTimestamps, now].filter((t) => now - t < 120_000);
          const cpm = calcCpm(newTimestamps);
          const isFast = cpm > 3;
          const isElegivel = event.status === "elegivel";
          const isInelegivel = event.status === "inelegivel";
          const isError = event.status === "erro";
          let xpGain = 15; // completed terminal
          if (isElegivel) xpGain += 50;
          if (isError) xpGain = -5;
          if (isFast && xpGain > 0) xpGain = Math.round(xpGain * 1.5);
          const newXp = Math.max(0, prev.xp + xpGain);
          const newStreak = isError ? 0 : prev.streak + 1;
          const newMaxStreak = Math.max(prev.maxStreak, newStreak);
          bumpPhase(event.status);

          const logEntry = isElegivel
            ? `✨ ELEGÍVEL — ***${event.cpf?.slice(-3) ?? "???"}`
            : isError
            ? `✗ erro — ***${event.cpf?.slice(-3) ?? "???"}`
            : isInelegivel
            ? `× inelegível — ***${event.cpf?.slice(-3) ?? "???"}`
            : `→ ${event.status ?? "?"} — ***${event.cpf?.slice(-3) ?? "???"}`;

          const next: WorkerState = {
            ...prev,
            xp: newXp,
            level: calcLevel(newXp),
            currentPhase: event.status ?? null,
            currentCpf: event.cpf ?? null,
            streak: newStreak,
            maxStreak: newMaxStreak,
            processed: prev.processed + 1,
            elegiveis: prev.elegiveis + (isElegivel ? 1 : 0),
            erros: prev.erros + (isError ? 1 : 0),
            eventTimestamps: newTimestamps,
            cpm,
            recentLog: [logEntry, ...prev.recentLog].slice(0, 5),
          };
          next.badges = checkBadges(next);
          workerMapRef.current.set(wid, next);
          setWorkerStates(Array.from(workerMapRef.current.values()).sort((a, b) => a.id - b.id));
        }
      } catch {
        // ignore malformed
      }
    };
  }, [bumpPhase]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
      if (debounceTimerRef.current) { clearTimeout(debounceTimerRef.current); debounceTimerRef.current = null; }
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

  return { connected, events, phaseCounts, botStatus, workerStates, runStartedAt };
}
