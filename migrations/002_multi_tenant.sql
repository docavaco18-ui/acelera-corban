-- ============================================================================
-- V8 CLT — Migration 002: Multi-tenancy + role admin
-- Rode este SQL no SQL Editor do Supabase (Dashboard → SQL Editor → New query)
-- ============================================================================

-- 1) Coluna owner_id em v8_leads (FK lógica para auth.users.id)
ALTER TABLE public.v8_leads
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_v8_leads_owner_id ON public.v8_leads(owner_id);
CREATE INDEX IF NOT EXISTS idx_v8_leads_owner_status ON public.v8_leads(owner_id, status);

-- 2) Coluna owner_id também em v8_bot_runs (cada run pertence a quem disparou)
ALTER TABLE public.v8_bot_runs
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_v8_bot_runs_owner_id ON public.v8_bot_runs(owner_id);

-- 3) Garantir que CPF é único por dono (mesmo CPF pode existir entre owners diferentes)
-- Drop antigo unique global em cpf, se existir
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.v8_leads'::regclass AND conname = 'v8_leads_cpf_key'
  ) THEN
    ALTER TABLE public.v8_leads DROP CONSTRAINT v8_leads_cpf_key;
  END IF;
END $$;

-- Unique composto: (owner_id, cpf) — permite o mesmo CPF para diferentes donos
ALTER TABLE public.v8_leads
  DROP CONSTRAINT IF EXISTS v8_leads_owner_cpf_unique;
ALTER TABLE public.v8_leads
  ADD CONSTRAINT v8_leads_owner_cpf_unique UNIQUE (owner_id, cpf);

-- 4) Marcar todos os leads existentes (legado) como pertencentes ao admin
-- Substitua pelo UID do admin DEPOIS que ele logar pela primeira vez.
-- Para rodar agora, deixe os legados com owner_id = NULL (admin enxerga NULLs).
-- Quando quiser atribuir todos os legados ao admin, descomente e rode:
--
-- UPDATE public.v8_leads SET owner_id = '<UUID_DO_ADMIN>' WHERE owner_id IS NULL;
-- UPDATE public.v8_bot_runs SET owner_id = '<UUID_DO_ADMIN>' WHERE owner_id IS NULL;
