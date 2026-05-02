-- migrations/005_batches.sql
-- Higienização por Base: cada upload vira uma "batch" com métricas próprias.
-- Aba HIGIENIZAÇÃO mostra a batch ativa; aba DASHBOARD mostra agregado + histórico.

-- 1. Tabela v8_batches
CREATE TABLE IF NOT EXISTS public.v8_batches (
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

CREATE INDEX IF NOT EXISTS idx_v8_batches_owner_created
    ON public.v8_batches (owner_id, created_at DESC);

DROP TRIGGER IF EXISTS v8_batches_updated_at ON public.v8_batches;
CREATE TRIGGER v8_batches_updated_at
    BEFORE UPDATE ON public.v8_batches
    FOR EACH ROW EXECUTE FUNCTION public.v8_update_updated_at();

-- 2. Coluna batch_id em v8_leads
ALTER TABLE public.v8_leads
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES public.v8_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_v8_leads_batch_status
    ON public.v8_leads (batch_id, status);

-- 3. Backfill: cria 1 batch "Legado" por owner_id que tem leads sem batch
DO $$
DECLARE
    rec RECORD;
    new_batch_id UUID;
BEGIN
    FOR rec IN
        SELECT owner_id, COUNT(*) AS n, MIN(created_at) AS first_seen
        FROM public.v8_leads
        WHERE batch_id IS NULL
        GROUP BY owner_id
    LOOP
        INSERT INTO public.v8_batches (owner_id, name, file_name, status, total_leads, started_at, finished_at)
        VALUES (rec.owner_id, 'Base Legada (pré-higienização)', NULL, 'concluida', rec.n, rec.first_seen, NOW())
        RETURNING id INTO new_batch_id;
        UPDATE public.v8_leads SET batch_id = new_batch_id
        WHERE batch_id IS NULL AND owner_id = rec.owner_id;
    END LOOP;
END $$;

-- 4. RLS em v8_batches (defesa secundária)
ALTER TABLE public.v8_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS v8_batches_owner ON public.v8_batches;
CREATE POLICY v8_batches_owner ON public.v8_batches USING (owner_id = auth.uid());
