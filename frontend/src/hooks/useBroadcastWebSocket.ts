import { useEffect, useRef, useState } from 'react';

export interface BroadcastSnapshot {
  numbers: any[];
  dispatches: any[];
  alerts: any[];
}

export interface BroadcastAlert {
  alert_type: string;
  phone_id: string;
  severity: string;
  message: string;
}

interface UseBroadcastWebSocketResult {
  snapshot: BroadcastSnapshot | null;
  latestAlert: BroadcastAlert | null;
}

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

export function useBroadcastWebSocket(wsUrl: string): UseBroadcastWebSocketResult {
  const [snapshot, setSnapshot] = useState<BroadcastSnapshot | null>(null);
  const [latestAlert, setLatestAlert] = useState<BroadcastAlert | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const destroyedRef = useRef(false);

  useEffect(() => {
    destroyedRef.current = false;

    function connect() {
      if (destroyedRef.current) return;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        retryCountRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (!msg.type?.startsWith('broadcast.')) return;

          if (msg.type === 'broadcast.snapshot') {
            setSnapshot({
              numbers: msg.numbers ?? [],
              dispatches: msg.dispatches ?? [],
              alerts: msg.alerts ?? [],
            });
          } else if (msg.type === 'broadcast.alert') {
            setLatestAlert({
              alert_type: msg.alert_type,
              phone_id: msg.phone_id,
              severity: msg.severity,
              message: msg.message,
            });
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        if (destroyedRef.current) return;
        const delay = Math.min(BACKOFF_BASE_MS * 2 ** retryCountRef.current, BACKOFF_MAX_MS);
        retryCountRef.current += 1;
        retryTimerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      destroyedRef.current = true;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      wsRef.current?.close();
    };
  }, [wsUrl]);

  return { snapshot, latestAlert };
}
