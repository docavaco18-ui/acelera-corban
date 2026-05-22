-- PowerHub: enriquecimento de telefone via CPF
-- Tabelas: powerhub_batches, powerhub_leads, powerhub_bot_runs

CREATE TABLE IF NOT EXISTS public.powerhub_batches (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    uuid NOT NULL,
    file_name   text NOT NULL DEFAULT '',
    total_leads int  NOT NULL DEFAULT 0,
    status      text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','done','cancelled')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.powerhub_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY powerhub_batches_owner ON public.powerhub_batches
    USING (owner_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.powerhub_leads (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id   uuid NOT NULL,
    batch_id   uuid REFERENCES public.powerhub_batches(id) ON DELETE SET NULL,
    cpf        text NOT NULL,
    nome       text,
    status     text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','found','not_found','error')),
    phones     jsonb NOT NULL DEFAULT '[]',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.powerhub_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY powerhub_leads_owner ON public.powerhub_leads
    USING (owner_id = auth.uid());

CREATE INDEX IF NOT EXISTS powerhub_leads_owner_status ON public.powerhub_leads (owner_id, status);
CREATE INDEX IF NOT EXISTS powerhub_leads_batch ON public.powerhub_leads (batch_id);

CREATE TABLE IF NOT EXISTS public.powerhub_bot_runs (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    uuid NOT NULL,
    num_workers int  NOT NULL DEFAULT 1,
    status      text NOT NULL DEFAULT 'running'
                     CHECK (status IN ('running','done','failed')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz
);

ALTER TABLE public.powerhub_bot_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY powerhub_bot_runs_owner ON public.powerhub_bot_runs
    USING (owner_id = auth.uid());
