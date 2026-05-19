const $ = (id) => document.getElementById(id);

function showMsg(text, ok) {
  const el = $("msg");
  el.textContent = text;
  el.className = "msg " + (ok ? "ok" : "err");
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, 4000);
}

function setStatus(text, color) {
  $("statusDot").style.background = color;
  $("statusText").textContent = text;
}

async function loadConfig() {
  const cfg = await chrome.storage.local.get(["backendUrl", "extensionToken"]);
  if (cfg.backendUrl) $("backendUrl").value = cfg.backendUrl;
  if (cfg.extensionToken) $("extensionToken").value = cfg.extensionToken;
  return cfg;
}

async function checkStatus() {
  const tabs = await chrome.tabs.query({ url: "https://meu.bancomercantil.com.br/*" });
  if (tabs.length === 0) {
    setStatus("Banco não aberto no Chrome", "#94a3b8");
    $("btnPush").disabled = true;
    return;
  }

  $("btnPush").disabled = false;

  try {
    const status = await chrome.tabs.sendMessage(tabs[0].id, { type: "GET_STATUS" });
    if (!status || !status.hasPcbAuth) {
      setStatus("Banco aberto — aguardando login", "#f59e0b");
      return;
    }
    if (status.expired) {
      setStatus("Sessão expirada — faça login no banco", "#ef4444");
      return;
    }
    if (status.expiresIn) {
      const h = Math.floor(status.expiresIn / 3600);
      const m = Math.floor((status.expiresIn % 3600) / 60);
      const label = h > 0 ? `${h}h ${m}m` : `${m}m`;
      const color = status.expiresIn < 3600 ? "#f59e0b" : "#22c55e";
      setStatus(`✅ Sessão válida — expira em ${label}`, color);
    } else {
      setStatus("✅ Sessão válida", "#22c55e");
    }
  } catch {
    setStatus("Extensão carregando na aba…", "#94a3b8");
  }
}

$("btnSave").addEventListener("click", async () => {
  const backendUrl = $("backendUrl").value.trim();
  const extensionToken = $("extensionToken").value.trim();
  if (!backendUrl || !extensionToken) {
    showMsg("Preencha URL do backend e token", false);
    return;
  }
  await chrome.storage.local.set({ backendUrl, extensionToken });
  showMsg("Configuração salva!", true);
});

$("btnPush").addEventListener("click", async () => {
  const tabs = await chrome.tabs.query({ url: "https://meu.bancomercantil.com.br/*" });
  if (tabs.length === 0) {
    showMsg("Abra o banco no Chrome primeiro", false);
    return;
  }
  $("btnPush").disabled = true;
  $("btnPush").textContent = "Enviando…";
  try {
    const result = await chrome.tabs.sendMessage(tabs[0].id, { type: "FORCE_PUSH" });
    if (result && result.ok) {
      showMsg(`✅ Sessão enviada! PCB_AUTH presente.`, true);
      checkStatus();
    } else {
      showMsg("Erro: " + (result?.err || "desconhecido"), false);
    }
  } catch (e) {
    showMsg("Erro: " + e.message, false);
  } finally {
    $("btnPush").disabled = false;
    $("btnPush").textContent = "Enviar sessão agora";
  }
});

// Init
loadConfig();
checkStatus();
