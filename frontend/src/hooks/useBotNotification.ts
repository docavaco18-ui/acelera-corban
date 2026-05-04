import { useEffect, useRef } from "react";

export function useBotNotification(botStatus: string) {
  const prevRef = useRef<string>(botStatus);
  const permissionRef = useRef<NotificationPermission>("default");

  useEffect(() => {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().then((p) => {
        permissionRef.current = p;
      });
    } else {
      permissionRef.current = Notification.permission;
    }
  }, []);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = botStatus;

    const wasRunning = prev === "running";
    const stoppedNow = botStatus === "idle" || botStatus === "stopped";
    if (!wasRunning || !stoppedNow) return;

    // toast visual sempre
    showToast("🤖 Bot finalizou o processamento!");

    // browser notification se permitida
    if (Notification.permission === "granted") {
      new Notification("Acelera Corban", {
        body: "✅ Bot finalizou! Verifique os resultados.",
        icon: "/favicon.ico",
        tag: "bot-done",
      });
    }
  }, [botStatus]);
}

function showToast(msg: string) {
  const el = document.createElement("div");
  el.textContent = msg;
  Object.assign(el.style, {
    position: "fixed",
    bottom: "28px",
    right: "28px",
    background: "rgba(0,255,136,.15)",
    border: "1px solid rgba(0,255,136,.4)",
    color: "#00ff88",
    padding: "14px 22px",
    borderRadius: "14px",
    fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    fontWeight: "700",
    fontSize: "0.9rem",
    zIndex: "99999",
    backdropFilter: "blur(8px)",
    boxShadow: "0 4px 24px rgba(0,255,136,.15)",
    transition: "opacity .4s",
    opacity: "1",
  });
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 400);
  }, 5000);
}
