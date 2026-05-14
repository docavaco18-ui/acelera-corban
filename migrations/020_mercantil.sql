-- migrations/020_mercantil.sql
-- Adiciona suporte ao banco Mercantil: leads, batches, bot_runs.
-- ADITIVO. Não toca em v8_* nem vctex_*. Espelha estrutura do VCTex
-- (002_multibank.sql + 006_vctex_batches.sql) com campos extras pra
-- portal Angular Material (UUID dinâmico no path, cenários A/B, etc).

-- ============================================================
-- 0. Aceita bank_code = 'mercantil' em user_bank_credentials
-- ============================================================
ALTER TABLE public.user_bank_credentials
    DROP CONSTRAINT IF EXISTS user_bank_credentials_bank_code_check;
ALTER TABLE public.user_bank_credentials
    ADD CONSTRAINT user_bank_credentials_bank_code_check
    CHECK (bank_code IN ('v8','vctex','mercantil'));

-- ============================================================
-- 1. Mercantil leads
-- ============================================================
CREATE TABLE IF NOT EXISTS public.mercantil_leads (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    owner_id UUID,
    cpf VARCHAR(14) NOT NULL,
    telefone VARCHAR(20),
    nome VARCHAR(255),

    -- status enum cobre todos os estados do fluxo
    status VARCHAR(40) DEFAULT 'pendente'
        CHECK (status IN (
            'pendente',
            'fase1_consulta',          -- preencheu UF+convenio+CPF, esperando redirect
            'fase2_check_auth',        -- chegou em /consignado-privado/{UUID}, verifica cenário
            'fase3_dataprev',          -- precisa autorização (Plurio em andamento)
            'aguardando_autorizacao',  -- Plurio assinado, polling produtos disponíveis
            'fase4_simular',           -- pronto pra simular
            'elegivel',                -- aprovado com valores
            'inelegivel',              -- sem margem OU política de crédito
            'erro'
        )),

    -- cenário detectado após "Nova operação"
    cenario VARCHAR(10),                      -- 'A' (já autorizado) | 'B' (precisa Plurio) | null
    uuid_portal UUID,                         -- UUID capturado da URL /consignado-privado/{UUID}

    -- Campos extraídos do resultado da simulação (todos opcionais)
    valor_liberado NUMERIC(14,2),
    valor_parcela NUMERIC(14,2),
    qtd_parcelas INTEGER,
    prazo INTEGER,
    taxa_juros_mes NUMERIC(8,4),
    valor_financiado NUMERIC(14,2),
    valor_emprestimo NUMERIC(14,2),
    valor_iof NUMERIC(14,2),
    capital_segurado NUMERIC(14,2),
    valor_seguro_prestamista NUMERIC(14,2),
    data_vencimento DATE,

    -- Catch-all pra qualquer campo novo que aparecer no portal
    payload JSONB,
    erro TEXT,
    tentativas INTEGER DEFAULT 0,

    batch_id UUID,  -- FK adicionada depois de criar a tabela mercantil_batches

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (owner_id, cpf)
);

CREATE INDEX IF NOT EXISTS idx_mercantil_leads_owner_status
    ON public.mercantil_leads (owner_id, status);

-- Trigger reutiliza função v8_update_updated_at criada na migration 001
DROP TRIGGER IF EXISTS mercantil_leads_updated_at ON public.mercantil_leads;
CREATE TRIGGER mercantil_leads_updated_at
    BEFORE UPDATE ON public.mercantil_leads
    FOR EACH ROW EXECUTE FUNCTION public.v8_update_updated_at();


-- ============================================================
-- 2. Mercantil batches
-- ============================================================
CREATE TABLE IF NOT EXISTS public.mercantil_batches (
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

CREATE INDEX IF NOT EXISTS idx_mercantil_batches_owner_created
    ON public.mercantil_batches (owner_id, created_at DESC);

DROP TRIGGER IF EXISTS mercantil_batches_updated_at ON public.mercantil_batches;
CREATE TRIGGER mercantil_batches_updated_at
    BEFORE UPDATE ON public.mercantil_batches
    FOR EACH ROW EXECUTE FUNCTION public.v8_update_updated_at();

-- FK de leads → batches (separada porque batches é criado depois de leads)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'mercantil_leads_batch_fk'
          AND table_name = 'mercantil_leads'
    ) THEN
        ALTER TABLE public.mercantil_leads
            ADD CONSTRAINT mercantil_leads_batch_fk
            FOREIGN KEY (batch_id)
            REFERENCES public.mercantil_batches(id)
            ON DELETE SET NULL;
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_mercantil_leads_batch_status
    ON public.mercantil_leads (batch_id, status);


-- ============================================================
-- 3. Mercantil bot runs
-- ============================================================
CREATE TABLE IF NOT EXISTS public.mercantil_bot_runs (
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

CREATE INDEX IF NOT EXISTS idx_mercantil_bot_runs_owner
    ON public.mercantil_bot_runs (owner_id, started_at DESC);


-- ============================================================
-- 4. RLS (mesmo padrão v8/vctex)
-- ============================================================
ALTER TABLE public.mercantil_leads    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mercantil_batches  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mercantil_bot_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mercantil_leads_owner    ON public.mercantil_leads;
DROP POLICY IF EXISTS mercantil_batches_owner  ON public.mercantil_batches;
DROP POLICY IF EXISTS mercantil_bot_runs_owner ON public.mercantil_bot_runs;

CREATE POLICY mercantil_leads_owner    ON public.mercantil_leads    USING (owner_id = auth.uid());
CREATE POLICY mercantil_batches_owner  ON public.mercantil_batches  USING (owner_id = auth.uid());
CREATE POLICY mercantil_bot_runs_owner ON public.mercantil_bot_runs USING (owner_id = auth.uid());
