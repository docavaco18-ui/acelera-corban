-- migrations/011_chatwoot_labels.sql
-- Adiciona coluna `labels` (CSV) em chatwoot_lead_status para filtragem por tags do Chatwoot.

ALTER TABLE public.chatwoot_lead_status
  ADD COLUMN IF NOT EXISTS labels TEXT;

CREATE INDEX IF NOT EXISTS idx_chatwoot_lead_status_owner_labels
  ON public.chatwoot_lead_status (owner_id) WHERE labels IS NOT NULL;
