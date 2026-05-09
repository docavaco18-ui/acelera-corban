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

export function useBroadcastWebSocket(wsUrl: string): UseBroadcastWebSocketResult {
  const [snapshot, setSnapshot] = useState<BroadcastSnapshot | null>(null);
  const [latestAlert, setLatestAlert] = useState<BroadcastAlert | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

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

    return () => {
      ws.close();
    };
  }, [wsUrl]);

  return { snapshot, latestAlert };
}
