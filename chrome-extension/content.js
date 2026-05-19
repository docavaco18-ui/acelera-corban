// Runs on meu.bancomercantil.com.br — monitors PCB_AUTH and pushes session to backend

const POLL_INTERVAL_MS = 30_000;
const EXPIRY_WARN_SECS = 7200; // 2h before expiry

let lastSentHash = null;

function getJwtExp(jwt) {
  try {
    const payload = JSON.parse(atob(jwt.split(".")[1]));
    return payload.exp || null;
  } catch {
    return null;
  }
}

function extractPcbAuth() {
  try {
    const raw = localStorage.getItem("PCB_AUTH");
    if (!raw) return null;
    const obj = JSON.parse(raw);
    // Handle both {access_token: "..."} and raw JWT string
    const jwt = obj.access_token || obj.token || obj.accessToken || (typeof obj === "string" ? obj : null);
    return { raw, obj, jwt };
  } catch {
    return null;
  }
}

function buildPayload() {
  const all = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    all[k] = localStorage.getItem(k);
  }
  return {
    url: location.href,
    cookies: document.cookie,
    localStorage: all,
    sessionStorage: (() => {
      const s = {};
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        s[k] = sessionStorage.getItem(k);
      }
      return s;
    })(),
  };
}

async function pushSession(config, reason) {
  if (!config.backendUrl || !config.extensionToken) return { ok: false, err: "not_configured" };

  const payload = buildPayload();
  const hash = JSON.stringify(payload.localStorage?.PCB_AUTH || "");
  if (hash === lastSentHash && reason !== "force") return { ok: false, err: "no_change" };

  try {
    const res = await fetch(`${config.backendUrl.replace(/\/$/, "")}/api/mercantil/bot/import-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Acelera-Token": config.extensionToken,
      },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      lastSentHash = hash;
      const data = await res.json();
      chrome.runtime.sendMessage({ type: "SESSION_PUSHED", data });
      return { ok: true, data };
    } else {
      const err = await res.text();
      chrome.runtime.sendMessage({ type: "SESSION_ERROR", err });
      return { ok: false, err };
    }
  } catch (e) {
    chrome.runtime.sendMessage({ type: "SESSION_ERROR", err: e.message });
    return { ok: false, err: e.message };
  }
}

async function checkAndPush(reason = "poll") {
  const config = await chrome.storage.local.get(["backendUrl", "extensionToken"]);
  if (!config.backendUrl || !config.extensionToken) return;

  const pcb = extractPcbAuth();
  if (!pcb) return;

  const exp = getJwtExp(pcb.jwt);
  const now = Math.floor(Date.now() / 1000);

  if (exp && exp < now) {
    // Already expired — notify background
    chrome.runtime.sendMessage({ type: "JWT_EXPIRED" });
    return;
  }

  if (exp && (exp - now) < EXPIRY_WARN_SECS) {
    chrome.runtime.sendMessage({ type: "JWT_EXPIRING_SOON", expiresIn: exp - now });
  }

  await pushSession(config, reason);
}

// Initial push on page load
checkAndPush("initial");

// Poll every 30s for silent refresh (Angular may update PCB_AUTH automatically)
setInterval(() => checkAndPush("poll"), POLL_INTERVAL_MS);

// Also listen for localStorage changes (catches Angular silent refresh immediately)
window.addEventListener("storage", (e) => {
  if (e.key === "PCB_AUTH" && e.newValue) {
    checkAndPush("storage_event");
  }
});

// Listen for force-push from popup
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "FORCE_PUSH") {
    chrome.storage.local.get(["backendUrl", "extensionToken"]).then((config) => {
      pushSession(config, "force").then(sendResponse);
    });
    return true; // async response
  }
  if (msg.type === "GET_STATUS") {
    const pcb = extractPcbAuth();
    const exp = pcb ? getJwtExp(pcb.jwt) : null;
    const now = Math.floor(Date.now() / 1000);
    sendResponse({
      hasPcbAuth: !!pcb,
      exp,
      expiresIn: exp ? exp - now : null,
      expired: exp ? exp < now : false,
      url: location.href,
    });
  }
});
