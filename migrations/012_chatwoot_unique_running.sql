-- migrations/012_chatwoot_unique_running.sql
-- F3: garante apenas 1 sync rodando por owner via unique partial index.
-- Evita TOCTOU race entre check e insert no start_sync.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_chatwoot_running_per_owner
  ON public.chatwoot_sync_runs (owner_id)
  WHERE status = 'running';
