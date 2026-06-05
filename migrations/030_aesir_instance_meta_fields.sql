-- Extra Meta fields per instance for richer UI display
ALTER TABLE aesir_instances ADD COLUMN IF NOT EXISTS phone_id TEXT;
ALTER TABLE aesir_instances ADD COLUMN IF NOT EXISTS verified_name TEXT;
ALTER TABLE aesir_instances ADD COLUMN IF NOT EXISTS name_status TEXT;
ALTER TABLE aesir_instances ADD COLUMN IF NOT EXISTS account_mode TEXT;
ALTER TABLE aesir_instances ADD COLUMN IF NOT EXISTS restrictions JSONB DEFAULT '[]'::jsonb;
ALTER TABLE aesir_instances ADD COLUMN IF NOT EXISTS additional_info JSONB DEFAULT '[]'::jsonb;
ALTER TABLE aesir_instances ADD COLUMN IF NOT EXISTS has_payment_issue BOOLEAN DEFAULT false;
ALTER TABLE aesir_instances ADD COLUMN IF NOT EXISTS display_name_pending BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_aesir_instances_phone_id ON aesir_instances(phone_id) WHERE phone_id IS NOT NULL;
