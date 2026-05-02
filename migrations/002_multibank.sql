-- 002_multibank.sql
-- Adiciona infra multi-banco: credenciais por usuário + tabelas VCTex.
-- ADITIVO. Não toca em v8_leads / v8_bot_runs.

-- ============================================================
-- 1. Credenciais por usuário (Fernet-encrypted)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_bank_credentials (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    bank_code TEXT NOT NULL CHECK (bank_code IN ('v8','vctex')),
    login_enc TEXT,
    password_enc TEXT,
    extra_enc TEXT,
    proxies_enc TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, bank_code)
);

CREATE INDEX IF NOT EXISTS idx_user_bank_creds_user
    ON public.user_bank_credentials (user_id);

CREATE OR REPLACE FUNCTION public.user_bank_creds_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_bank_creds_updated_at_trg ON public.user_bank_credentials;
CREATE TRIGGER user_bank_creds_updated_at_trg
    BEFORE UPDATE ON public.user_bank_credentials
    FOR EACH ROW EXECUTE FUNCTION public.user_bank_creds_updated_at();

-- RLS: bloquear acesso direto via PostgREST. Apenas service_role lê.
ALTER TABLE public.user_bank_credentials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all ON public.user_bank_credentials;
CREATE POLICY deny_all ON public.user_bank_credentials FOR ALL USING (false);

-- ============================================================
-- 2. VCTex leads
-- ============================================================
CREATE TABLE IF NOT EXISTS public.vctex_leads (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    owner_id UUID,
    cpf VARCHAR(14) NOT NULL,
    telefone VARCHAR(20),
    nome VARCHAR(255),
    status VARCHAR(30) DEFAULT 'pendente'
        CHECK (status IN ('pendente','fase0','fase1','fase2','elegivel','inelegivel','erro')),
    valor_liberado NUMERIC(12,2),
    payload JSONB,
    erro TEXT,
    tentativas INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (owner_id, cpf)
);

CREATE INDEX IF NOT EXISTS idx_vctex_leads_owner_status
    ON public.vctex_leads (owner_id, status);

DROP TRIGGER IF EXISTS vctex_leads_updated_at ON public.vctex_leads;
CREATE TRIGGER vctex_leads_updated_at
    BEFORE UPDATE ON public.vctex_leads
    FOR EACH ROW EXECUTE FUNCTION public.v8_update_updated_at();

-- ============================================================
-- 3. VCTex bot runs
-- ============================================================
CREATE TABLE IF NOT EXISTS public.vctex_bot_runs (
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

CREATE INDEX IF NOT EXISTS idx_vctex_bot_runs_owner
    ON public.vctex_bot_runs (owner_id, started_at DESC);
