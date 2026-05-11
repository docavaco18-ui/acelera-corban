-- migrations/010_chatwoot.sql
-- Chatwoot CRM cross-reference: settings + classification cache.

-- 1. Settings (Chatwoot URL + token por user)
CREATE TABLE IF NOT EXISTS public.chatwoot_settings (
    owner_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    chatwoot_url TEXT NOT NULL,
    account_id   TEXT NOT NULL,
    api_token    TEXT NOT NULL,
    inbox_ids    TEXT,
    last_sync_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.chatwoot_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chatwoot_settings_owner ON public.chatwoot_settings;
CREATE POLICY chatwoot_settings_owner ON public.chatwoot_settings
    USING (owner_id = auth.uid());

DROP TRIGGER IF EXISTS chatwoot_settings_updated_at ON public.chatwoot_settings;
CREATE TRIGGER chatwoot_settings_updated_at
    BEFORE UPDATE ON public.chatwoot_settings
    FOR EACH ROW EXECUTE FUNCTION public.v8_update_updated_at();


-- 2. Classification cache (1 linha por v8_lead com cruzamento Chatwoot)
CREATE TABLE IF NOT EXISTS public.chatwoot_lead_status (
    lead_id              UUID PRIMARY KEY REFERENCES public.v8_leads(id) ON DELETE CASCADE,
    owner_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    cpf                  VARCHAR(14),
    chatwoot_contact_id  BIGINT,
    bucket               TEXT NOT NULL
        CHECK (bucket IN ('respondeu','visualizou_sem_responder','conversa_sem_msg','nunca_contatado')),
    status_conversa      TEXT,
    canal                TEXT,
    n_conversas          INTEGER DEFAULT 0,
    n_msgs_outgoing      INTEGER DEFAULT 0,
    n_msgs_incoming      INTEGER DEFAULT 0,
    primeira_outgoing_at TIMESTAMPTZ,
    ultima_outgoing_at   TIMESTAMPTZ,
    ultima_incoming_at   TIMESTAMPTZ,
    tempo_resposta_horas NUMERIC(10,2),
    synced_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chatwoot_lead_status_owner_bucket
    ON public.chatwoot_lead_status (owner_id, bucket);
CREATE INDEX IF NOT EXISTS idx_chatwoot_lead_status_owner_synced
    ON public.chatwoot_lead_status (owner_id, synced_at DESC);

ALTER TABLE public.chatwoot_lead_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chatwoot_lead_status_owner ON public.chatwoot_lead_status;
CREATE POLICY chatwoot_lead_status_owner ON public.chatwoot_lead_status
    USING (owner_id = auth.uid());


-- 3. Sync run log (1 linha por execução)
CREATE TABLE IF NOT EXISTS public.chatwoot_sync_runs (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    owner_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    started_at      TIMESTAMPTZ DEFAULT NOW(),
    finished_at     TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running','completed','failed','cancelled')),
    total_contacts  INTEGER,
    total_leads     INTEGER,
    total_matched   INTEGER,
    total_responded INTEGER,
    error           TEXT
);

CREATE INDEX IF NOT EXISTS idx_chatwoot_sync_runs_owner_started
    ON public.chatwoot_sync_runs (owner_id, started_at DESC);

ALTER TABLE public.chatwoot_sync_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chatwoot_sync_runs_owner ON public.chatwoot_sync_runs;
CREATE POLICY chatwoot_sync_runs_owner ON public.chatwoot_sync_runs
    USING (owner_id = auth.uid());
