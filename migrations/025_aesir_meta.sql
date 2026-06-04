-- 025: Aesir ERP — integração Meta BM (qualidade números WhatsApp)

ALTER TABLE aesir_settings
    ADD COLUMN IF NOT EXISTS meta_token_enc TEXT,
    ADD COLUMN IF NOT EXISTS waba_ids JSONB DEFAULT '[]'::jsonb;

ALTER TABLE aesir_instances
    ADD COLUMN IF NOT EXISTS quality_rating   TEXT DEFAULT 'UNKNOWN',
    ADD COLUMN IF NOT EXISTS messaging_tier   TEXT,
    ADD COLUMN IF NOT EXISTS can_send         TEXT DEFAULT 'UNKNOWN',
    ADD COLUMN IF NOT EXISTS display_phone    TEXT,
    ADD COLUMN IF NOT EXISTS quality_updated_at TIMESTAMPTZ;
