-- 007_crm.sql — Tabela de acompanhamento de propostas (CRM)

CREATE TABLE IF NOT EXISTS public.crm_propostas (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    nome_vendedor    text NOT NULL,
    banco            text NOT NULL,
    cliente_cpf      text NOT NULL,
    data_venda       date NOT NULL,
    valor            numeric(12,2) NOT NULL,
    prazo            integer NOT NULL,
    parcela          numeric(10,2) NOT NULL,
    codigo_proposta  text NOT NULL DEFAULT '',
    status           text NOT NULL DEFAULT 'propostas'
                     CHECK (status IN ('propostas','importante','pendentes','leilao','fgts')),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS crm_propostas_owner_idx  ON public.crm_propostas (owner_id);
CREATE INDEX IF NOT EXISTS crm_propostas_status_idx ON public.crm_propostas (owner_id, status);
CREATE INDEX IF NOT EXISTS crm_propostas_banco_idx  ON public.crm_propostas (owner_id, banco);

-- RLS
ALTER TABLE public.crm_propostas ENABLE ROW LEVEL SECURITY;

CREATE POLICY crm_propostas_owner
    ON public.crm_propostas
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- Auto-updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS crm_propostas_updated_at ON public.crm_propostas;
CREATE TRIGGER crm_propostas_updated_at
    BEFORE UPDATE ON public.crm_propostas
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
