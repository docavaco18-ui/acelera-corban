-- migrations/003_multitenant_v8.sql
-- Completa 002_multi_tenant.sql: NOT NULL, UNIQUE consult_id, RLS, backfill admin.
-- Aplicar APÓS 002. Runbook na spec (parar container, backup, etc.).

-- 1. Backfill: substitua <ADMIN_USER_ID> antes de rodar
-- UPDATE public.v8_leads    SET owner_id = '<ADMIN_USER_ID>' WHERE owner_id IS NULL;
-- UPDATE public.v8_bot_runs SET owner_id = '<ADMIN_USER_ID>' WHERE owner_id IS NULL;

-- 2. NOT NULL após backfill
ALTER TABLE public.v8_leads    ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE public.v8_bot_runs ALTER COLUMN owner_id SET NOT NULL;

-- 3. UNIQUE em consult_id (parcial — ignora NULLs de leads ainda não consultados)
DROP INDEX IF EXISTS public.v8_leads_consult_id_unique;
CREATE UNIQUE INDEX v8_leads_consult_id_unique
    ON public.v8_leads(consult_id)
    WHERE consult_id IS NOT NULL;

-- 4. RLS (defesa secundária — service_role bypassa, mas previne acesso direto via JWT)
ALTER TABLE public.v8_leads    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v8_bot_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS v8_leads_owner    ON public.v8_leads;
DROP POLICY IF EXISTS v8_bot_runs_owner ON public.v8_bot_runs;
CREATE POLICY v8_leads_owner    ON public.v8_leads    USING (owner_id = auth.uid());
CREATE POLICY v8_bot_runs_owner ON public.v8_bot_runs USING (owner_id = auth.uid());
