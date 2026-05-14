/**
 * Hook do modal SMS Mercantil.
 *
 * Abre sua própria conexão WebSocket pra /ws/events e escuta SOMENTE eventos
 * com bank='mercantil'. Eventos relevantes:
 *
 *   {type:'sms_required', run_id, reason, attempt, phone_hint}
 *     → mostra modal (pending=true)
 *   {type:'sms_accepted', run_id}
 *     → dismiss modal
 *   {type:'sms_timeout'|'sms_max_attempts', run_id}
 *     → dismiss modal e mostra error
 *   {type:'bot_status', status:'idle', run_id}
 *     → se modal estava aberto pro mesmo run, dismiss
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getAccessToken } from "../lib/supabase";
import { mercantilApi } from "../lib/api";
import axios from "axios";
import { supabase } from "../lib/supabase";

const BASE_URL = import.meta.env.VITE_API_URL || "";

async function fetchActiveRun(): Promise<{ run_id: string } | null> {
  // Consulta o run ativo do user (caso a aba foi recarregada e perdemos o sms_required)
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  try {
    const res = await axios.get(`${BASE_URL}/api/mercantil/bot/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.data?.status === "running" && res.data?.run_id) {
      return { run_id: res.data.run_id };
    }
  } catch {
    // ignore
  }
  return null;
}

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

export type SmsReason =
  | "initial"
  | "wrong_code"
  | "timeout"
  | "max_attempts"
  | null;

export type SmsBridgeState = {
  pending: boolean;
  runId: string | null;
  reason: SmsReason;
  attempt: number;
  phoneHint: string | null;
  errorMessage: string | null;
  submitting: boolean;
  connected: boolean;
};

export type SmsBridgeApi = SmsBridgeState & {
  submit: (code: string) => Promise<void>;
  dismiss: () => void;
};

export function useMercantilSmsBridge(): SmsBridgeApi {
  const [state, setState] = useState<SmsBridgeState>({
    pending: false,
    runId: null,
    reason: null,
    attempt: 0,
    phoneHint: null,
    errorMessage: null,
    submitting: false,
    connected: false,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const connect = useCallback(async () => {
    if (!mountedRef.current) return;
    const url = await buildWsUrl();
    if (!mountedRef.current) return;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) { ws.close(); return; }
      setState((s) => ({ ...s, connected: true }));
      if (retryRef.current) clearTimeout(retryRef.current);
    };
    ws.onclose = () => {
      setState((s) => ({ ...s, connected: false }));
      if (!mountedRef.current) return;
      retryRef.current = setTimeout(connect, 3000);
    };
    ws.onerror = () => ws.close();

    ws.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.bank !== "mercantil") return;

        if (ev.type === "sms_required") {
          setState({
            pending: true,
            runId: ev.run_id ?? null,
            reason: (ev.reason as SmsReason) ?? "initial",
            attempt: ev.attempt ?? 1,
            phoneHint: ev.phone_hint ?? null,
            errorMessage: null,
            submitting: false,
            connected: true,
          });
          return;
        }

        if (ev.type === "sms_accepted") {
          setState((s) =>
            s.runId === ev.run_id || s.pending
              ? { ...s, pending: false, errorMessage: null, submitting: false }
              : s
          );
          return;
        }

        if (ev.type === "sms_wrong_code") {
          setState((s) => ({
            ...s,
            submitting: false,
            errorMessage: "Código incorreto. Tente novamente.",
          }));
          return;
        }

        if (ev.type === "sms_timeout") {
          setState((s) => ({
            ...s,
            submitting: false,
            errorMessage: "Tempo esgotado (SMS não chegou). O bot tentou novamente automaticamente.",
          }));
          return;
        }

        if (ev.type === "sms_max_attempts") {
          setState((s) => ({
            ...s,
            pending: false,
            submitting: false,
            errorMessage: "Limite de tentativas excedido. Inicie o bot novamente.",
          }));
          return;
        }

        if (ev.type === "bot_status" && ev.status === "idle") {
          setState((s) =>
            s.pending && s.runId === ev.run_id
              ? { ...s, pending: false, submitting: false }
              : s
          );
        }
      } catch {
        // ignore
      }
    };
  }, []);

  // Recovery: ao montar, se há bot rodando + state=waiting, mostra modal de novo
  // (resolve o caso "user recarregou a aba enquanto SMS estava esperando").
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const active = await fetchActiveRun();
      if (cancelled || !active) return;
      try {
        const state = await mercantilApi.smsState(active.run_id);
        if (state?.status === "waiting") {
          setState((s) => ({
            ...s,
            pending: true,
            runId: active.run_id,
            reason: "initial",
            attempt: 1,
            phoneHint: "-5744",
          }));
        }
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

  const submit = useCallback(async (code: string) => {
    if (!state.runId) {
      setState((s) => ({ ...s, errorMessage: "Run não identificado" }));
      return;
    }
    setState((s) => ({ ...s, submitting: true, errorMessage: null }));
    try {
      await mercantilApi.submitSms(state.runId, code);
      // Não dismissa o modal imediatamente; espera evento sms_accepted ou sms_wrong_code
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.message || "Falha ao enviar código";
      setState((s) => ({ ...s, submitting: false, errorMessage: String(msg) }));
    }
  }, [state.runId]);

  const dismiss = useCallback(() => {
    setState((s) => ({ ...s, pending: false, errorMessage: null }));
  }, []);

  return { ...state, submit, dismiss };
}
