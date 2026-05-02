-- migrations/006_vctex_batches.sql
-- Higienização por base também pro VCTex.
-- Mesma estrutura do v8_batches; vctex_leads ganha batch_id.

-- 1. Tabela vctex_batches
CREATE TABLE IF NOT EXISTS public.vctex_batches (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    file_name TEXT,
    status TEXT NOT NULL DEFAULT 'pendente'
        CHECK (status IN ('pendente','processando','concluida','cancelada')),
    total_leads INTEGER DEFAULT 0,
    total_processed INTEGER DEFAULT 0,
    total_elegiveis INTEGER DEFAULT 0,
    total_inelegiveis INTEGER DEFAULT 0,
    total_liberado NUMERIC(14,2) DEFAULT 0,
    total_margem NUMERIC(14,2) DEFAULT 0,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vctex_batches_owner_created
    ON public.vctex_batches (owner_id, created_at DESC);

DROP TRIGGER IF EXISTS vctex_batches_updated_at ON public.vctex_batches;
CREATE TRIGGER vctex_batches_updated_at
    BEFORE UPDATE ON public.vctex_batches
    FOR EACH ROW EXECUTE FUNCTION public.v8_update_updated_at();

-- 2. batch_id em vctex_leads e vctex_bot_runs
ALTER TABLE public.vctex_leads
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES public.vctex_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vctex_leads_batch_status
    ON public.vctex_leads (batch_id, status);

-- 3. RLS
ALTER TABLE public.vctex_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vctex_batches_owner ON public.vctex_batches;
CREATE POLICY vctex_batches_owner ON public.vctex_batches USING (owner_id = auth.uid());

ALTER TABLE public.vctex_leads    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vctex_bot_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vctex_leads_owner    ON public.vctex_leads;
DROP POLICY IF EXISTS vctex_bot_runs_owner ON public.vctex_bot_runs;
CREATE POLICY vctex_leads_owner    ON public.vctex_leads    USING (owner_id = auth.uid());
CREATE POLICY vctex_bot_runs_owner ON public.vctex_bot_runs USING (owner_id = auth.uid());
