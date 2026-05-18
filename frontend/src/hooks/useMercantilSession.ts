import { useCallback, useEffect, useRef, useState } from "react";
import { mercantilApi } from "../lib/api";
import { getAccessToken } from "../lib/supabase";

export type SessionStatus = "valid" | "none" | "logging_in" | "loading";

export type MercantilSessionState = {
  status: SessionStatus;
  savedAt: string | null;
  isStartingLogin: boolean;
  error: string | null;
};

const WS_BASE = (() => {
  const envBase = import.meta.env.VITE_API_URL;
  if (envBase) return envBase.replace(/^http/, "ws") + "/ws/events";
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws/events`;
})();

export function useMercantilSession() {
  const [state, setState] = useState<MercantilSessionState>({
    status: "loading",
    savedAt: null,
    isStartingLogin: false,
    error: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const r = await mercantilApi.sessionStatus();
      if (!mountedRef.current) return;
      setState((s) => ({
        ...s,
        status: r.status,
        savedAt: r.saved_at,
        error: null,
      }));
    } catch {
      if (!mountedRef.current) return;
      setState((s) => ({ ...s, status: "none", error: null }));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    const t = setInterval(refresh, 15000);

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connectWs = async () => {
      if (!mountedRef.current) return;
      const token = await getAccessToken();
      if (!mountedRef.current) return;
      const ws = new WebSocket(`${WS_BASE}?token=${encodeURIComponent(token ?? "")}`);
      wsRef.current = ws;
      ws.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data);
          if (ev.bank !== "mercantil") return;
          if (ev.type === "session_saved") {
            setState((s) => ({ ...s, status: "valid", isStartingLogin: false }));
            refresh();
          }
          if (ev.type === "session_failed") {
            setState((s) => ({
              ...s,
              status: "none",
              isStartingLogin: false,
              error: "Login falhou. Tente novamente.",
            }));
          }
        } catch {}
      };
      ws.onclose = () => {
        if (mountedRef.current) {
          reconnectTimer = setTimeout(connectWs, 3000);
        }
      };
      ws.onerror = () => ws.close();
    };
    connectWs();

    return () => {
      mountedRef.current = false;
      clearInterval(t);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [refresh]);

  const startLoginVisual = useCallback(async (opts?: { manual?: boolean }) => {
    setState((s) => ({ ...s, isStartingLogin: true, error: null }));
    try {
      await mercantilApi.loginVisual(opts);
      setState((s) => ({ ...s, status: "logging_in" }));
    } catch (e: any) {
      const msg = e?.response?.data?.detail || "Erro ao iniciar login visual";
      setState((s) => ({ ...s, isStartingLogin: false, error: String(msg) }));
    }
  }, []);

  return { ...state, startLoginVisual, refresh };
}
