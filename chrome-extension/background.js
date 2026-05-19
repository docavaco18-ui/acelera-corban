// Service worker — manages alarms, badge, notifications

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("checkExpiry", { periodInMinutes: 10 });
  setBadge("?", "#94a3b8");
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "checkExpiry") {
    checkExpiryViaContentScript();
  }
});

function setBadge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

async function checkExpiryViaContentScript() {
  const tabs = await chrome.tabs.query({ url: "https://meu.bancomercantil.com.br/*" });
  if (tabs.length === 0) {
    setBadge("OFF", "#94a3b8");
    return;
  }
  try {
    const response = await chrome.tabs.sendMessage(tabs[0].id, { type: "GET_STATUS" });
    handleStatus(response);
  } catch {
    setBadge("?", "#94a3b8");
  }
}

function handleStatus(status) {
  if (!status || !status.hasPcbAuth) {
    setBadge("!", "#ef4444");
    return;
  }
  if (status.expired) {
    setBadge("EXP", "#ef4444");
    chrome.notifications.create("session_expired", {
      type: "basic",
      iconUrl: "icon.png",
      title: "Sessão Mercantil expirou",
      message: "Acesse meu.bancomercantil.com.br e faça login para renovar automaticamente.",
      priority: 2,
    });
    return;
  }
  if (status.expiresIn && status.expiresIn < 7200) {
    const mins = Math.floor(status.expiresIn / 60);
    setBadge(`${mins}m`, "#f59e0b");
    if (status.expiresIn < 3600) {
      chrome.notifications.create("session_expiring", {
        type: "basic",
        iconUrl: "icon.png",
        title: "Sessão Mercantil expirando",
        message: `Sessão expira em ${mins} minutos. Mantenha o banco aberto no Chrome.`,
        priority: 1,
      });
    }
    return;
  }
  setBadge("✓", "#22c55e");
}

// React to messages from content script
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "SESSION_PUSHED") {
    setBadge("✓", "#22c55e");
  } else if (msg.type === "SESSION_ERROR") {
    setBadge("ERR", "#ef4444");
  } else if (msg.type === "JWT_EXPIRED") {
    setBadge("EXP", "#ef4444");
  } else if (msg.type === "JWT_EXPIRING_SOON") {
    const mins = Math.floor((msg.expiresIn || 0) / 60);
    setBadge(`${mins}m`, "#f59e0b");
  }
});
