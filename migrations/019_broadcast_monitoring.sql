-- 019_broadcast_monitoring.sql
-- Campos para histórico de campanhas e monitoramento em tempo real

-- Config da campanha no dispatch
ALTER TABLE broadcast_dispatches
  ADD COLUMN IF NOT EXISTS campaign_name TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS phone_column TEXT DEFAULT 'telefone',
  ADD COLUMN IF NOT EXISTS cooldown_seconds INT DEFAULT 5,
  ADD COLUMN IF NOT EXISTS skip_weekends BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS skip_night BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS dedup_window_hours INT DEFAULT 24,
  ADD COLUMN IF NOT EXISTS auto_pause_on_red BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ DEFAULT NULL;

-- Detalhe por assignment (template usado, qualidade no início, etc.)
ALTER TABLE broadcast_dispatch_assignments
  ADD COLUMN IF NOT EXISTS template_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS inbox_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS variable_mappings JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS quality_at_start TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS display_phone TEXT DEFAULT NULL;

-- Histórico de qualidade (detectar queda em relação ao snapshot anterior)
ALTER TABLE broadcast_numbers
  ADD COLUMN IF NOT EXISTS quality_previous TEXT DEFAULT NULL;
