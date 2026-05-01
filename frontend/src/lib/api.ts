import axios from "axios";
import type { Lead, BotStatus, DashboardStats } from "./types";
import { supabase } from "./supabase";

const BASE_URL = import.meta.env.VITE_API_URL || "";
const api = axios.create({ baseURL: BASE_URL });

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
      .post<{ inserted: number }>("/api/leads/upload", form)
      .then((r) => r.data);
  },

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
  start: (numWorkers = 6) =>
    api
      .post<BotStatus>("/api/bot/start", null, { params: { num_workers: numWorkers } })
      .then((r) => r.data),
  stop: () => api.post<BotStatus>("/api/bot/stop").then((r) => r.data),
};

export const statsApi = {
  dashboard: () =>
    api.get<DashboardStats>("/api/stats/dashboard").then((r) => r.data),
};
