-- 026: Aesir dispatch — multi-instância + wizard parity com VendeAI

ALTER TABLE aesir_dispatches
    ADD COLUMN IF NOT EXISTS campaign_name    TEXT,
    ADD COLUMN IF NOT EXISTS phone_column     TEXT DEFAULT 'telefone',
    ADD COLUMN IF NOT EXISTS total_leads      INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS assignments_json JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS cooldown_seconds INTEGER DEFAULT 5,
    ADD COLUMN IF NOT EXISTS finished_at      TIMESTAMPTZ;
