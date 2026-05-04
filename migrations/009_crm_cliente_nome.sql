ALTER TABLE crm_propostas
  ADD COLUMN IF NOT EXISTS cliente_nome text NOT NULL DEFAULT '';
