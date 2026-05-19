-- migrations/021_presenca.sql
-- Adiciona suporte ao Presença Bank: leads, batches, bot_runs.
-- ADITIVO. Não toca em v8_*, vctex_*, mercantil_*.

-- ============================================================
-- 0. Aceita bank_code = 'presenca' em user_bank_credentials
-- ============================================================
ALTER TABLE public.user_bank_credentials
    DROP CONSTRAINT IF EXISTS user_bank_credentials_bank_code_check;
ALTER TABLE public.user_bank_credentials
    ADD CONSTRAINT user_bank_credentials_bank_code_check
    CHECK (bank_code IN ('v8','vctex','mercantil','presenca'));

-- ============================================================
-- 1. Presença leads
-- ============================================================
CREATE TABLE IF NOT EXISTS public.presenca_leads (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    owner_id UUID,
    cpf VARCHAR(14) NOT NULL,
    telefone VARCHAR(20),
    nome VARCHAR(255),

    status VARCHAR(40) DEFAULT 'pendente'
        CHECK (status IN (
            'pendente',
            'elegivel',
            'inelegivel',
            'erro'
        )),

    valor_liberado NUMERIC(14,2),
    payload JSONB,
    erro TEXT,
    tentativas INTEGER DEFAULT 0,

    batch_id UUID,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (owner_id, cpf)
);

CREATE INDEX IF NOT EXISTS idx_presenca_leads_owner_status
    ON public.presenca_leads (owner_id, status);

DROP TRIGGER IF EXISTS presenca_leads_updated_at ON public.presenca_leads;
CREATE TRIGGER presenca_leads_updated_at
    BEFORE UPDATE ON public.presenca_leads
    FOR EACH ROW EXECUTE FUNCTION public.v8_update_updated_at();


-- ============================================================
-- 2. Presença batches
-- ============================================================
CREATE TABLE IF NOT EXISTS public.presenca_batches (
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
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_presenca_batches_owner_created
    ON public.presenca_batches (owner_id, created_at DESC);

DROP TRIGGER IF EXISTS presenca_batches_updated_at ON public.presenca_batches;
CREATE TRIGGER presenca_batches_updated_at
    BEFORE UPDATE ON public.presenca_batches
    FOR EACH ROW EXECUTE FUNCTION public.v8_update_updated_at();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'presenca_leads_batch_fk'
          AND table_name = 'presenca_leads'
    ) THEN
        ALTER TABLE public.presenca_leads
            ADD CONSTRAINT presenca_leads_batch_fk
            FOREIGN KEY (batch_id)
            REFERENCES public.presenca_batches(id)
            ON DELETE SET NULL;
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_presenca_leads_batch_status
    ON public.presenca_leads (batch_id, status);


-- ============================================================
-- 3. Presença bot runs
-- ============================================================
CREATE TABLE IF NOT EXISTS public.presenca_bot_runs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    owner_id UUID,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    status VARCHAR(20) DEFAULT 'running',
    num_workers INTEGER,
    total_processed INTEGER DEFAULT 0,
    total_elegiveis INTEGER DEFAULT 0,
    total_inelegiveis INTEGER DEFAULT 0,
    erro TEXT
);

CREATE INDEX IF NOT EXISTS idx_presenca_bot_runs_owner
    ON public.presenca_bot_runs (owner_id, started_at DESC);


-- ============================================================
-- 4. RLS (mesmo padrão v8/vctex/mercantil)
-- ============================================================
ALTER TABLE public.presenca_leads    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presenca_batches  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presenca_bot_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS presenca_leads_owner    ON public.presenca_leads;
DROP POLICY IF EXISTS presenca_batches_owner  ON public.presenca_batches;
DROP POLICY IF EXISTS presenca_bot_runs_owner ON public.presenca_bot_runs;

CREATE POLICY presenca_leads_owner    ON public.presenca_leads    USING (owner_id = auth.uid());
CREATE POLICY presenca_batches_owner  ON public.presenca_batches  USING (owner_id = auth.uid());
CREATE POLICY presenca_bot_runs_owner ON public.presenca_bot_runs USING (owner_id = auth.uid());
