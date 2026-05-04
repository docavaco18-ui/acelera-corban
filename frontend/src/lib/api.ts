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

  exportCsv: async (status: string = "elegivel") => {
    const blob = await api
      .get("/api/leads/export", { params: { status }, responseType: "blob" })
      .then((r) => r.data as Blob);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `v8-${status}-${date}.csv`;
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
      .get<Record<"v8" | "vctex", BankSummary | null>>("/api/credentials")
      .then((r) => r.data),
  upsert: (bank: "v8" | "vctex", body: { login: string; password?: string; proxies: string[] }) =>
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
  delete: (id: string) => api.delete(`/api/batches/${id}`),
};
