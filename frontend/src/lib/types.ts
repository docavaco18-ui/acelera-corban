export type LeadStatus =
  | "pendente"
  | "enriquecido"
  | "consentido"
  | "autorizado"
  | "aguardando_resultado"
  | "elegivel"
  | "inelegivel"
  | "erro";

export interface Lead {
  id: string;
  cpf: string;
  telefone: string | null;
  nome: string | null;
  email: string | null;
  data_nascimento: string | null;
  status: LeadStatus;
  consult_id: string | null;
  margem_disponivel: number | null;
  valor_liberado: number | null;
  valor_parcela: number | null;
  num_parcelas: number | null;
  cet_mensal: number | null;
  erro: string | null;
  tentativas: number | null;
  proxima_tentativa: string | null;
  created_at: string;
  updated_at: string;
}

export interface BotStatus {
  status: "idle" | "running" | "stopped" | "already_running";
  run_id: string | null;
}

export interface BotRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  num_workers: number | null;
  total_processed: number;
  total_elegiveis: number;
  total_inelegiveis: number;
}

// Backend /api/stats/dashboard shape
export interface BatchStats {
  label: string;
  total: number;
  elegiveis: number;
  inelegiveis: number;
  pendentes: number;
  erros: number;
  em_processamento: number;
  aguardando_autorizacao: number;
  processados: number;
  total_liberado: number;
  total_margem: number;
  by_status: Record<string, number>;
}

export interface DashboardStats {
  total: number;
  elegiveis: number;
  inelegiveis: number;
  pendentes: number;
  erros: number;
  em_processamento: number;
  aguardando_autorizacao: number;
  total_liberado?: number;
  total_margem?: number;
  by_status: Record<string, number>;
  batch_cutoff?: string;
  batches?: { anterior: BatchStats; atual: BatchStats };
}

export interface BotEvent {
  type:
    | "cpf_processed"
    | "lead_result"
    | "status_update"
    | "worker_start"
    | "worker_idle"
    | "bot_status"
    | "cerebro_status"
    | "phase_update";
  worker_id?: number;
  worker_name?: string;
  worker_role?: "full" | "retry" | "supervisor";
  cpf?: string;
  nome?: string;
  fase?: string;
  resultado?: string;
  status?: string;
  message?: string;
  ts?: string;
  run_id?: string;
  counts?: Record<string, number>;
  phase?: number;
  count?: number;
}

export interface Batch {
  id: string;
  owner_id: string;
  name: string;
  file_name: string | null;
  status: "pendente" | "processando" | "concluida" | "cancelada";
  total_leads: number;
  total_processed: number;
  total_elegiveis: number;
  total_inelegiveis: number;
  total_liberado: number | string;
  total_margem: number | string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export type CrmStatus = "propostas" | "karol" | "giovanna" | "gabriel" | "importante" | "pendentes" | "leilao" | "fgts";

export interface CrmProposta {
  id: string;
  owner_id: string;
  nome_vendedor: string;
  banco: string;
  cliente_cpf: string;
  cliente_nome: string;
  data_venda: string;
  valor: number;
  prazo: number;
  parcela: number;
  codigo_proposta: string;
  status: CrmStatus;
  approved: boolean;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrmStats {
  total: number;
  total_valor: number;
  ticket_medio: number;
  by_status: Record<string, number>;
  by_banco: Record<string, number>;
  ranking: { nome: string; total: number }[];
  pending_count: number;
}

export interface CrmSettings {
  has_crm_password: boolean;
}

export interface ScheduledJob {
  id: string;
  action: "start" | "stop";
  scheduled_at: string;
  num_workers: number | null;
  batch_id: string | null;
  status: "pending" | "executed" | "cancelled" | "failed";
  executed_at: string | null;
  error: string | null;
  created_at: string;
}

export type Tier = "gold" | "silver" | "bronze";

export interface ScoredRecord extends Lead {
  score: number;
  tier: Tier;
}

export interface Badge {
  id: string;
  label: string;
  icon: string;
  earnedAt: string;
}

export interface WorkerState {
  id: number;
  name: string;
  color: string;
  xp: number;
  level: number;
  currentPhase: string | null;
  currentCpf: string | null;
  currentNome: string | null;
  startedAt: number | null;
  streak: number;
  maxStreak: number;
  processed: number;
  elegiveis: number;
  erros: number;
  eventTimestamps: number[];
  cpm: number;
  badges: Badge[];
  recentLog: string[];
}
