-- Tabelas V8 no schema public com prefixo v8_ (mantém VCTex separado)

CREATE TABLE IF NOT EXISTS public.v8_leads (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    cpf VARCHAR(14) UNIQUE NOT NULL,
    telefone VARCHAR(20),
    nome VARCHAR(255),
    email VARCHAR(255),
    data_nascimento DATE,
    status VARCHAR(30) DEFAULT 'pendente'
        CHECK (status IN ('pendente','enriquecido','consentido','autorizado','aguardando_resultado','elegivel','inelegivel','erro')),
    consult_id UUID,
    margem_disponivel NUMERIC(12,2),
    valor_liberado NUMERIC(12,2),
    valor_parcela NUMERIC(12,2),
    num_parcelas INTEGER,
    cet_mensal NUMERIC(6,4),
    erro TEXT,
    tentativas INTEGER DEFAULT 0,
    proxima_tentativa TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.v8_bot_runs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    status VARCHAR(20) DEFAULT 'running',
    num_workers INTEGER,
    total_processed INTEGER DEFAULT 0,
    total_elegiveis INTEGER DEFAULT 0,
    total_inelegiveis INTEGER DEFAULT 0
);

CREATE OR REPLACE FUNCTION public.v8_update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS v8_leads_updated_at ON public.v8_leads;
CREATE TRIGGER v8_leads_updated_at
    BEFORE UPDATE ON public.v8_leads
    FOR EACH ROW EXECUTE FUNCTION public.v8_update_updated_at();
