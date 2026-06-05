-- Chipcare — adicionar Meta System User token + 14 colunas Meta nos channels.
-- Regra padrão dos 3 disparadores: cola token Meta → Refresh → puxa qualidade de cada número.

ALTER TABLE chipcare_settings ADD COLUMN IF NOT EXISTS meta_token_enc TEXT;
ALTER TABLE chipcare_settings ADD COLUMN IF NOT EXISTS waba_ids JSONB DEFAULT '[]'::jsonb;

ALTER TABLE chipcare_channels ADD COLUMN IF NOT EXISTS waba_id TEXT;
ALTER TABLE chipcare_channels ADD COLUMN IF NOT EXISTS phone_id TEXT;
ALTER TABLE chipcare_channels ADD COLUMN IF NOT EXISTS display_phone TEXT;
ALTER TABLE chipcare_channels ADD COLUMN IF NOT EXISTS quality_rating TEXT;
ALTER TABLE chipcare_channels ADD COLUMN IF NOT EXISTS messaging_tier TEXT;
ALTER TABLE chipcare_channels ADD COLUMN IF NOT EXISTS can_send TEXT;
ALTER TABLE chipcare_channels ADD COLUMN IF NOT EXISTS verified_name TEXT;
ALTER TABLE chipcare_channels ADD COLUMN IF NOT EXISTS name_status TEXT;
ALTER TABLE chipcare_channels ADD COLUMN IF NOT EXISTS account_mode TEXT;
ALTER TABLE chipcare_channels ADD COLUMN IF NOT EXISTS restrictions JSONB DEFAULT '[]'::jsonb;
ALTER TABLE chipcare_channels ADD COLUMN IF NOT EXISTS additional_info JSONB DEFAULT '[]'::jsonb;
ALTER TABLE chipcare_channels ADD COLUMN IF NOT EXISTS has_payment_issue BOOLEAN DEFAULT false;
ALTER TABLE chipcare_channels ADD COLUMN IF NOT EXISTS display_name_pending BOOLEAN DEFAULT false;
ALTER TABLE chipcare_channels ADD COLUMN IF NOT EXISTS waba_name TEXT;
ALTER TABLE chipcare_channels ADD COLUMN IF NOT EXISTS account_review_status TEXT;
ALTER TABLE chipcare_channels ADD COLUMN IF NOT EXISTS business_verification_status TEXT;
ALTER TABLE chipcare_channels ADD COLUMN IF NOT EXISTS waba_currency TEXT;
ALTER TABLE chipcare_channels ADD COLUMN IF NOT EXISTS waba_country TEXT;
ALTER TABLE chipcare_channels ADD COLUMN IF NOT EXISTS quality_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_chipcare_channels_waba_id ON chipcare_channels(waba_id) WHERE waba_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chipcare_channels_phone_id ON chipcare_channels(phone_id) WHERE phone_id IS NOT NULL;
