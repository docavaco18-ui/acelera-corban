import axios from "axios";
import type { Lead, BotRun, BotStatus, DashboardStats, Batch, CrmProposta, CrmStats, CrmSettings } from "./types";
import { supabase } from "./supabase";
import { getBank, bankPrefix } from "../hooks/useBank";

const BASE_URL = import.meta.env.VITE_API_URL || "";
const api = axios.create({ baseURL: BASE_URL });

// Reescreve URL conforme banco selecionado (v8 → original; vctex → /api/vctex/*)
api.interceptors.request.use(async (config) => {
  if (config.url) {
    config.url = bankPrefix(getBank(), config.url);
  }
  return config;
});

api.interceptors.request.use(async (config) => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  async (err) => {
    if (err?.response?.status === 401) {
      await supabase.auth.signOut();
      if (!location.pathname.startsWith("/login")) location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export const adminApi = {
  listUsers: () => api.get<{ users: any[] }>("/api/admin/users").then((r) => r.data.users),
  createUser: (email: string, password: string, role: "user" | "admin" = "user") =>
    api.post("/api/admin/users", { email, password, role }).then((r) => r.data),
  updateUser: (id: string, body: { role?: string; banned?: boolean; password?: string }) =>
    api.patch(`/api/admin/users/${id}`, body).then((r) => r.data),
  deleteUser: (id: string) => api.delete(`/api/admin/users/${id}`).then((r) => r.data),
  runs: (limit = 50) =>
    api.get<{ runs: any[] }>("/api/admin/runs", { params: { limit } }).then((r) => r.data.runs),
  overview: () => api.get<any>("/api/admin/overview").then((r) => r.data),
};

interface LeadListResponse {
  data: Lead[];
  page: number;
}

export const leadsApi = {
  list: (params?: { status?: string; erro_contains?: string; page?: number; limit?: number }) =>
    api
      .get<LeadListResponse>("/api/leads/", { params })
      .then((r) => r.data.data),

  listAll: async (status?: string) => {
    const all: Lead[] = [];
    let page = 1;
    const limit = 200;
    for (let i = 0; i < 50; i++) {
      const batch = await api
        .get<LeadListResponse>("/api/leads/", { params: { status, page, limit } })
        .then((r) => r.data.data);
      all.push(...batch);
      if (batch.length < limit) break;
      page += 1;
    }
    return all;
  },

  uploadCsv: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api
      .post<{ job_id: string; batch_id: string }>("/api/leads/upload", form)
      .then((r) => r.data);
  },

  uploadStatus: (jobId: string) =>
    api
      .get<{
        status: "queued" | "running" | "done" | "error";
        total: number;
        processed: number;
        inserted: number;
        error?: string;
      }>(`/api/leads/upload/${jobId}`)
      .then((r) => r.data),

  retryErrors: (batchId?: string) =>
    api.post<{ resetados: number }>("/api/leads/retry-errors", null, {
      params: batchId ? { batch_id: batchId } : {},
    }).then((r) => r.data),

  exportCsv: async (status: string = "elegivel", batchId?: string, filename?: string) => {
    const params: Record<string, string> = { status };
    if (batchId) params.batch_id = batchId;
    const blob = await api
      .get("/api/leads/export", { params, responseType: "blob" })
      .then((r) => r.data as Blob);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = filename ?? `${getBank()}-${status}-${date}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

export const botApi = {
  status: () => api.get<BotStatus>("/api/bot/status").then((r) => r.data),
  start: (numWorkers = 6, batchId?: string) =>
    api
      .post<BotStatus>("/api/bot/start", null, {
        params: { num_workers: numWorkers, ...(batchId ? { batch_id: batchId } : {}) },
      })
      .then((r) => r.data),
  stop: () => api.post<BotStatus>("/api/bot/stop").then((r) => r.data),
  runs: (limit = 20) => api.get<{ runs: BotRun[] }>("/api/bot/runs", { params: { limit } }).then((r) => r.data.runs),
};

export const statsApi = {
  dashboard: (batchId?: string) =>
    api
      .get<DashboardStats>("/api/stats/dashboard", { params: batchId ? { batch_id: batchId } : {} })
      .then((r) => r.data),
};

interface BankSummary {
  configured: boolean;
  login: string | null;
  has_password: boolean;
  proxies: string[];
}

export const credentialsApi = {
  list: () =>
    api
      .get<Record<"v8" | "vctex" | "mercantil" | "presenca" | "powerhub", BankSummary | null>>("/api/credentials")
      .then((r) => r.data),
  upsert: (bank: "v8" | "vctex" | "mercantil" | "presenca" | "powerhub", body: { login: string; password?: string; proxies: string[] }) =>
    api.put(`/api/credentials/${bank}`, body).then((r) => r.data),
};

export const crmApi = {
  listar: (params?: { status?: string; banco?: string; data_inicio?: string; data_fim?: string; pending_only?: boolean }) =>
    api.get<{ data: CrmProposta[] }>("/api/crm/propostas", { params }).then((r) => r.data.data),

  criar: (body: Omit<CrmProposta, "id" | "owner_id" | "created_at" | "updated_at" | "approved" | "approved_at" | "approved_by"> & { crm_password?: string }) =>
    api.post<CrmProposta>("/api/crm/propostas", body).then((r) => r.data),

  atualizar: (id: string, body: Partial<Omit<CrmProposta, "id" | "owner_id" | "created_at" | "updated_at">>) =>
    api.patch<CrmProposta>(`/api/crm/propostas/${id}`, body).then((r) => r.data),

  moverStatus: (id: string, status: string) =>
    api.patch<CrmProposta>(`/api/crm/propostas/${id}`, { status }).then((r) => r.data),

  deletar: (id: string, crm_password?: string) =>
    api.delete(`/api/crm/propostas/${id}`, { data: { crm_password } }),

  aprovar: (id: string) =>
    api.post<CrmProposta>(`/api/crm/propostas/${id}/approve`).then((r) => r.data),

  stats: () => api.get<CrmStats>("/api/crm/propostas/stats").then((r) => r.data),
};

export const v8ProposalsApi = {
  startSync: (monthsBack = 12) =>
    api.post<{ status: string; job_id: string }>("/api/v8proposals/sync", null, { params: { months_back: monthsBack } }).then((r) => r.data),
  syncStatus: () =>
    api.get<{ status: string; added?: number; skipped?: number; errors?: number; detail?: string }>("/api/v8proposals/sync/status").then((r) => r.data),
};

export const crmSettingsApi = {
  get: () => api.get<CrmSettings>("/api/crm/settings").then((r) => r.data),
  setPassword: (password: string) =>
    api.put("/api/crm/settings/password", { password }).then((r) => r.data),
  removePassword: () => api.delete("/api/crm/settings/password").then((r) => r.data),
};

export const batchesApi = {
  list: () => api.get<{ data: Batch[] }>("/api/batches/").then((r) => r.data.data),
  current: () => api.get<Batch | null>("/api/batches/current").then((r) => r.data),
  get: (id: string) => api.get<Batch>(`/api/batches/${id}`).then((r) => r.data),
  stats: (id: string) =>
    api.get<DashboardStats>(`/api/batches/${id}/stats`).then((r) => r.data),
  rename: (id: string, name: string) =>
    api.patch<Batch>(`/api/batches/${id}`, { name }).then((r) => r.data),
  cancel: (id: string) =>
    api.patch<Batch>(`/api/batches/${id}`, { status: "cancelada" }).then((r) => r.data),
  delete: (id: string) => api.delete(`/api/batches/${id}`),
};

export const chatwootApi = {
  getSettings: () =>
    api.get<{ configured: boolean; chatwoot_url?: string; account_id?: string; inbox_ids?: string; last_sync_at?: string }>(
      "/api/chatwoot/settings"
    ).then((r) => r.data),
  putSettings: (body: { chatwoot_url: string; account_id: string; api_token?: string | null; inbox_ids?: string | null }) =>
    api.put("/api/chatwoot/settings", body).then((r) => r.data),
  startSync: () => api.post<{ run_id: string; status: string }>("/api/chatwoot/sync").then((r) => r.data),
  syncStatus: () => api.get<any>("/api/chatwoot/sync/status").then((r) => r.data),
  syncHistory: (limit = 10) =>
    api.get<{ runs: any[] }>("/api/chatwoot/sync/history", { params: { limit } }).then((r) => r.data.runs),
  metrics: (batchId?: string) =>
    api.get<any>("/api/chatwoot/metrics", { params: batchId ? { batch_id: batchId } : {} }).then((r) => r.data),
  leads: (params?: { bucket?: string; status_v8?: string; batch_id?: string; label?: string; limit?: number; offset?: number }) =>
    api.get<{ leads: any[]; limit: number; offset: number }>("/api/chatwoot/leads", { params }).then((r) => r.data),
  labels: () => api.get<{ labels: { label: string; count: number }[] }>("/api/chatwoot/labels").then((r) => r.data.labels),
};

const broadcastAxios = axios.create({ baseURL: BASE_URL });

// Auth interceptor only — no bankPrefix
broadcastAxios.interceptors.request.use(async (config) => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return config;
});

// Mercantil SMS endpoints — bypass bankPrefix porque já tem /api/mercantil/* no path
const mercantilAxios = axios.create({ baseURL: BASE_URL });
mercantilAxios.interceptors.request.use(async (config) => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return config;
});

export const mercantilApi = {
  submitSms: (run_id: string, code: string) =>
    mercantilAxios
      .post<{ status: string }>("/api/mercantil/bot/sms", { run_id, code })
      .then((r) => r.data),
  smsState: (run_id: string) =>
    mercantilAxios
      .get<{ status: string }>("/api/mercantil/bot/sms/state", { params: { run_id } })
      .then((r) => r.data),

  sessionStatus: () =>
    mercantilAxios
      .get<{ status: "valid" | "none" | "logging_in"; saved_at: string | null }>(
        "/api/mercantil/bot/session-status"
      )
      .then((r) => r.data),

  getExtensionToken: () =>
    mercantilAxios
      .get<{ token: string }>("/api/mercantil/bot/extension-token")
      .then((r) => r.data),

  loginVisual: (opts?: { manual?: boolean }) =>
    mercantilAxios
      .post<{ status: string; run_id: string }>(
        "/api/mercantil/bot/login-visual",
        null,
        { params: opts?.manual ? { manual: 1 } : {} },
      )
      .then((r) => r.data),

  importSession: (dump: {
    url?: string;
    cookies?: string;
    localStorage?: Record<string, string>;
    sessionStorage?: Record<string, string>;
  }) =>
    mercantilAxios
      .post<{
        status: string;
        path: string;
        cookies_count: number;
        localStorage_keys: string[];
        has_pcb_auth: boolean;
      }>("/api/mercantil/bot/import-session", dump)
      .then((r) => r.data),

  botStart: (batchId?: string, mode: "dom" | "bff" = "dom") =>
    mercantilAxios
      .post<{ status: string; run_id: string }>("/api/mercantil/bot/start", null, {
        params: { ...(batchId ? { batch_id: batchId } : {}), mode },
      })
      .then((r) => r.data),

  botStop: () =>
    mercantilAxios.post("/api/mercantil/bot/stop").then((r) => r.data),

  botStatus: () =>
    mercantilAxios
      .get<{ status: string; run_id: string | null }>("/api/mercantil/bot/status")
      .then((r) => r.data),

  uploadCsv: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return mercantilAxios
      .post<{ job_id: string; batch_id: string }>("/api/mercantil/leads/upload", form)
      .then((r) => r.data);
  },

  uploadStatus: (jobId: string) =>
    mercantilAxios
      .get<{ status: string; total: number; processed: number; inserted: number; error?: string }>(
        `/api/mercantil/leads/upload/${jobId}`
      )
      .then((r) => r.data),

  currentBatch: () =>
    mercantilAxios
      .get<{ id: string; name: string } | null>("/api/mercantil/batches/current")
      .then((r) => r.data)
      .catch(() => null),
};

// Presença Bank endpoints
const presencaAxios = axios.create({ baseURL: BASE_URL });
presencaAxios.interceptors.request.use(async (config) => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return config;
});

export const presencaApi = {
  botStart: (batchId?: string, numWorkers = 2) =>
    presencaAxios
      .post<{ status: string; run_id: string }>("/api/presenca/bot/start", null, {
        params: { ...(batchId ? { batch_id: batchId } : {}), num_workers: numWorkers, mode: "api" },
      })
      .then((r) => r.data),

  botStop: () =>
    presencaAxios.post("/api/presenca/bot/stop").then((r) => r.data),

  botStatus: () =>
    presencaAxios
      .get<{ status: string; run_id: string | null }>("/api/presenca/bot/status")
      .then((r) => r.data),

  uploadCsv: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return presencaAxios
      .post<{ job_id: string; batch_id: string }>("/api/presenca/leads/upload", form)
      .then((r) => r.data);
  },

  uploadStatus: (jobId: string) =>
    presencaAxios
      .get<{ status: string; total: number; processed: number; inserted: number; error?: string }>(
        `/api/presenca/leads/upload/${jobId}`
      )
      .then((r) => r.data),

  currentBatch: () =>
    presencaAxios
      .get<{ id: string; name: string; scheduled_for?: string | null } | null>("/api/presenca/batches/current")
      .then((r) => r.data)
      .catch(() => null),

  scheduleBatch: (batchId: string, scheduledFor: string | null) =>
    presencaAxios
      .post<{ batch_id: string; scheduled_for: string | null }>(
        `/api/presenca/batches/${batchId}/schedule`,
        { scheduled_for: scheduledFor }
      )
      .then((r) => r.data),

  listBatches: () =>
    presencaAxios
      .get<{ data: Array<{ id: string; name: string; status: string; created_at: string; total_processed?: number; total_elegiveis?: number; total_liberado?: number }> }>("/api/presenca/batches/")
      .then((r) => r.data.data)
      .catch(() => [] as any[]),

  statsDashboard: (batchId?: string) =>
    presencaAxios
      .get<{ total: number; elegiveis: number; inelegiveis: number; pendentes: number; erros: number; processados: number; total_liberado: number }>(
        "/api/presenca/stats/dashboard",
        { params: batchId ? { batch_id: batchId } : {} }
      )
      .then((r) => r.data)
      .catch(() => null),

  retryErrors: (batchId?: string) =>
    presencaAxios
      .post<{ resetados: number }>("/api/presenca/leads/retry-errors", null, {
        params: batchId ? { batch_id: batchId } : {},
      })
      .then((r) => r.data),

  exportCsvUrl: (status = "elegivel") => {
    const base = (import.meta.env.VITE_API_URL || "") + "/api/presenca/leads/export";
    return `${base}?status=${status}`;
  },
};

const powerhubAxios = axios.create({ baseURL: BASE_URL });
powerhubAxios.interceptors.request.use(async (config) => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return config;
});

export const powerhubApi = {
  botStart: (batchId?: string, numWorkers = 3) =>
    powerhubAxios
      .post<{ run_id: string; num_workers: number }>("/api/powerhub/bot/start", null, {
        params: { ...(batchId ? { batch_id: batchId } : {}), num_workers: numWorkers },
      })
      .then((r) => r.data),

  botStop: () =>
    powerhubAxios.post("/api/powerhub/bot/stop").then((r) => r.data),

  botStatus: () =>
    powerhubAxios
      .get<{ status: string; run_id: string | null }>("/api/powerhub/bot/status")
      .then((r) => r.data),

  botEvents: () =>
    powerhubAxios.get<{ data: any[] }>("/api/powerhub/bot/events").then((r) => r.data.data),

  uploadCsv: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return powerhubAxios
      .post<{ job_id: string }>("/api/powerhub/leads/upload", form)
      .then((r) => r.data);
  },

  uploadStatus: (jobId: string) =>
    powerhubAxios
      .get<{ status: string; total: number; inserted: number; batch_id?: string; error?: string }>(
        `/api/powerhub/leads/upload/${jobId}`
      )
      .then((r) => r.data),

  currentBatch: () =>
    powerhubAxios
      .get<{ id: string; file_name: string; total_leads: number; status: string } | null>("/api/powerhub/batches/current")
      .then((r) => r.data)
      .catch(() => null),

  listBatches: () =>
    powerhubAxios
      .get<{ data: Array<{ id: string; file_name: string; total_leads: number; status: string; created_at: string }> }>("/api/powerhub/batches/")
      .then((r) => r.data.data)
      .catch(() => [] as any[]),

  stats: (batchId?: string) =>
    powerhubAxios
      .get<{ total: number; pending: number; processing: number; found: number; not_found: number; error: number; total_phones: number }>(
        "/api/powerhub/stats",
        { params: batchId ? { batch_id: batchId } : {} }
      )
      .then((r) => r.data)
      .catch(() => null),

  exportCsvUrl: (batchId?: string) => {
    const base = (import.meta.env.VITE_API_URL || "") + "/api/powerhub/leads/export";
    return batchId ? `${base}?batch_id=${batchId}&status=found` : `${base}?status=found`;
  },

  exportCsv: async (batchId?: string): Promise<void> => {
    const url = powerhubApi.exportCsvUrl(batchId);
    const resp = await powerhubAxios.get(url, { responseType: "blob" });
    const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const blob = new Blob([resp.data], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "powerhub_telefones.xlsx";
    a.click();
    URL.revokeObjectURL(a.href);
  },
};

const aesirAxios = axios.create({ baseURL: BASE_URL });
aesirAxios.interceptors.request.use(async (config) => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return config;
});

export const aesirApi = {
  // credentials
  getCredentials: () =>
    aesirAxios.get<{ configured: boolean; account_id?: string; meta_configured?: boolean; waba_ids?: string[]; updated_at?: string }>("/api/aesir-broadcast/credentials").then((r) => r.data),
  saveCredentials: (api_token: string, account_id: string) =>
    aesirAxios.post("/api/aesir-broadcast/credentials", { api_token, account_id }).then((r) => r.data),
  saveMetaCredentials: (meta_token: string, waba_ids: string[]) =>
    aesirAxios.post("/api/aesir-broadcast/meta-credentials", { meta_token, waba_ids }).then((r) => r.data),

  // instances
  listInstances: () =>
    aesirAxios.get<any[]>("/api/aesir-broadcast/instances").then((r) => r.data),
  pauseInstance: (instanceId: string) =>
    aesirAxios.post(`/api/aesir-broadcast/instances/${instanceId}/pause`).then((r) => r.data),
  resumeInstance: (instanceId: string) =>
    aesirAxios.post(`/api/aesir-broadcast/instances/${instanceId}/resume`).then((r) => r.data),
  refreshNumbers: () =>
    aesirAxios.post<{ ok: boolean; instances: any[]; meta_matched: number; meta_total?: number; aesir_error?: string | null; meta_error?: string | null }>("/api/aesir-broadcast/refresh-numbers").then((r) => r.data),

  // wizard
  analyzeCSV: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return aesirAxios.post<{ dispatch_id: string; total_leads: number; split: any; csv_columns: string[] }>("/api/aesir-broadcast/analyze", form).then((r) => r.data);
  },
  getTemplates: () =>
    aesirAxios.get<{ name: string; language: string; category: string; body: string; variables: string[] }[]>("/api/aesir-broadcast/templates").then((r) => r.data),
  confirmDispatch: (body: {
    dispatch_id: string;
    assignments: { instance_id: string; planned_count: number }[];
    message_tpl?: string;
    phone_column: string;
    campaign_name: string;
    cooldown_seconds: number;
    allow_partial?: boolean;
    send_mode?: string;
    template_name?: string;
    template_lang?: string;
    template_params?: { source: string; value: string }[];
  }) => aesirAxios.post<{ dispatch_id: string; status: string; assigned_count?: number; unassigned_count?: number }>("/api/aesir-broadcast/dispatch", body).then((r) => r.data),

  // dispatch control
  pauseDispatch: (id: string) =>
    aesirAxios.post(`/api/aesir-broadcast/dispatches/${id}/pause`).then((r) => r.data),
  cancelDispatch: (id: string) =>
    aesirAxios.post(`/api/aesir-broadcast/dispatches/${id}/cancel`).then((r) => r.data),

  // read
  listDispatches: () =>
    aesirAxios.get<any[]>("/api/aesir-broadcast/dispatches").then((r) => r.data),
  getSnapshot: () =>
    aesirAxios.get<{ instances: any[]; active_dispatches: any[] }>("/api/aesir-broadcast/snapshot").then((r) => r.data),
  getAnalytics: () =>
    aesirAxios.get<{ campaigns: any[]; total_sent: number; total_errors: number; total_campaigns: number }>("/api/aesir-broadcast/analytics").then((r) => r.data),
};

const chipcareAxios = axios.create({ baseURL: BASE_URL });
chipcareAxios.interceptors.request.use(async (config) => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return config;
});

export const chipcareApi = {
  // credentials
  getCredentials: () =>
    chipcareAxios.get<{ configured: boolean; tenant_id?: string; sa_create?: string; sa_activate?: string; updated_at?: string; meta_configured?: boolean; waba_ids?: string[] }>("/api/chipcare-broadcast/credentials").then((r) => r.data),
  saveCredentials: (email: string, password: string, tenant_id?: string) =>
    chipcareAxios.post("/api/chipcare-broadcast/credentials", { email, password, tenant_id }).then((r) => r.data),
  saveMetaCredentials: (meta_token: string, waba_ids: string[]) =>
    chipcareAxios.post("/api/chipcare-broadcast/meta-credentials", { meta_token, waba_ids }).then((r) => r.data),

  // SA hashes
  updateHashes: (hashes: { sa_create?: string; sa_activate?: string; sa_list_tpl?: string; sa_list_camps?: string }) =>
    chipcareAxios.post("/api/chipcare-broadcast/sa-hashes", hashes).then((r) => r.data),

  // channels
  listChannels: () =>
    chipcareAxios.get<any[]>("/api/chipcare-broadcast/channels").then((r) => r.data),
  refreshChannels: () =>
    chipcareAxios.post<{ ok: boolean; channels: any[]; count?: number; meta_total?: number; meta_matched?: number; chipcare_error?: string | null; meta_error?: string | null }>("/api/chipcare-broadcast/refresh-channels").then((r) => r.data),
  pauseChannel: (channelId: number) =>
    chipcareAxios.post(`/api/chipcare-broadcast/channels/${channelId}/pause`).then((r) => r.data),
  resumeChannel: (channelId: number) =>
    chipcareAxios.post(`/api/chipcare-broadcast/channels/${channelId}/resume`).then((r) => r.data),

  // templates
  listTemplates: () =>
    chipcareAxios.get<any[]>("/api/chipcare-broadcast/templates").then((r) => r.data),

  // wizard
  analyzeCSV: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return chipcareAxios.post<{ dispatch_id: string; total_leads: number; split: any; csv_columns: string[] }>("/api/chipcare-broadcast/analyze", form).then((r) => r.data);
  },
  dispatch: (body: {
    dispatch_id: string;
    assignments: { channel_id: number; planned_count: number }[];
    template: { template_name: string; template_id: string; language_code?: string; components?: any[] };
    campaign_name: string;
    aggression_level?: string;
    activate_immediately?: boolean;
    dry_run?: boolean;
    confirm_real_dispatch?: boolean;
    allow_partial?: boolean;
  }) => chipcareAxios.post<{
    dispatch_id: string;
    chipcare_campaign_id?: number;
    chipcare_campaign_ids?: number[];
    status: string;
    assigned_count?: number;
    unassigned_count?: number;
    campaigns?: any[];
    activated_count?: number;
  }>("/api/chipcare-broadcast/dispatch", body).then((r) => r.data),

  // dispatch control
  activateDispatch: (id: string) =>
    chipcareAxios.post(`/api/chipcare-broadcast/dispatches/${id}/activate`).then((r) => r.data),
  cancelDispatch: (id: string) =>
    chipcareAxios.post(`/api/chipcare-broadcast/dispatches/${id}/cancel`).then((r) => r.data),

  // read
  listDispatches: () =>
    chipcareAxios.get<any[]>("/api/chipcare-broadcast/dispatches").then((r) => r.data),
  getSnapshot: () =>
    chipcareAxios.get<{ channels: any[]; active_dispatches: any[] }>("/api/chipcare-broadcast/snapshot").then((r) => r.data),
  getAnalytics: () =>
    chipcareAxios.get<{ campaigns: any[]; total_campaigns: number }>("/api/chipcare-broadcast/analytics").then((r) => r.data),
};

export const broadcastApi = {
  getCredentialsStatus: () => broadcastAxios.get("/api/broadcast/credentials"),
  saveCredentials: (data: { email?: string; password?: string; meta_token?: string; account_id?: string; crm_token?: string }) =>
    broadcastAxios.post("/api/broadcast/credentials", data),
  // Multi-token Meta — até 10 portas (cada porta = 1 Business Manager)
  listMetaTokens: () => broadcastAxios.get<{ tokens: any[]; max: number }>("/api/broadcast/meta-tokens"),
  addMetaToken: (data: { label?: string; meta_token: string; bm_id?: string; waba_ids?: string[] }) =>
    broadcastAxios.post("/api/broadcast/meta-tokens", data),
  testMetaToken: (id: string) => broadcastAxios.post(`/api/broadcast/meta-tokens/${id}/test`),
  updateMetaToken: (id: string, data: { label?: string; waba_ids?: string[] }) =>
    broadcastAxios.patch(`/api/broadcast/meta-tokens/${id}`, data),
  deleteMetaToken: (id: string) => broadcastAxios.delete(`/api/broadcast/meta-tokens/${id}`),
  listNumbers: () => broadcastAxios.get<any[]>("/api/broadcast/numbers"),
  refreshNumbers: () => broadcastAxios.post<{
    ok: boolean;
    updated: string[];
    total: number;
    meta_total?: number;
    chatwoot_matched?: number;
    chatwoot_inboxes_found?: number;
    meta_error?: string | null;
    chatwoot_error?: string | null;
  }>("/api/broadcast/numbers/refresh"),
  resumeNumber: (phoneId: string) => broadcastAxios.post(`/api/broadcast/numbers/${phoneId}/resume`),
  analyzeCSV: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return broadcastAxios.post("/api/broadcast/analyze", form);
  },
  confirmDispatch: (data: {
    dispatch_id: string;
    assignments: any[];
    allow_partial?: boolean;
    phone_column?: string;
    campaign_name?: string;
    cooldown_seconds?: number;
    skip_weekends?: boolean;
    skip_night?: boolean;
    dedup_window_hours?: number;
  }) =>
    broadcastAxios.post("/api/broadcast/dispatch", data),
  listDispatches: () => broadcastAxios.get("/api/broadcast/dispatches"),
  getDispatch: (id: string) => broadcastAxios.get(`/api/broadcast/dispatches/${id}`),
  getDispatchMetrics: (id: string) => broadcastAxios.get<{
    dispatch_id: string;
    total_recipients: number;
    planned_count: number;
    queued_count: number;
    sent_count: number;
    failed_count: number;
    delivered_count: number;
    read_count: number;
    reply_count: number;
    conversion_count: number;
    has_per_recipient_data: boolean;
    has_delivered_data: boolean;
    has_read_data: boolean;
    has_reply_data: boolean;
    has_conversion_data: boolean;
  }>(`/api/broadcast/dispatches/${id}/metrics`),
  listDispatchRecipients: (id: string, params?: { status?: string; phone_id?: string; q?: string; limit?: number; offset?: number }) =>
    broadcastAxios.get<{ recipients: any[]; limit: number; offset: number }>(`/api/broadcast/dispatches/${id}/recipients`, { params }),
  pauseDispatch: (id: string) => broadcastAxios.post(`/api/broadcast/dispatches/${id}/pause`),
  resumeDispatch: (id: string) => broadcastAxios.post(`/api/broadcast/dispatches/${id}/resume`),
  revokeDispatch: (id: string) => broadcastAxios.post(`/api/broadcast/dispatches/${id}/revoke`),
  getAnalytics: () => broadcastAxios.get("/api/broadcast/analytics"),
  getAlerts: () => broadcastAxios.get("/api/broadcast/alerts"),
  getWabaIds: () => broadcastAxios.get("/api/broadcast/waba-ids"),
  saveWabaIds: (waba_ids: string[]) => broadcastAxios.post("/api/broadcast/waba-ids", { waba_ids }),
  getTemplates: () => broadcastAxios.get("/api/broadcast/templates"),
  getSnapshot: () => broadcastAxios.get("/api/broadcast/snapshot"),
};

export const commandCenterApi = {
  overview: (params?: { live_meta?: boolean }) =>
    broadcastAxios.get<any>("/api/command-center/overview", { params }).then((r) => r.data),
};
