-- VendeAI broadcast_numbers — alinhar com aesir_instances (regra padrão pros 3 disparadores)
ALTER TABLE broadcast_numbers ADD COLUMN IF NOT EXISTS verified_name TEXT;
ALTER TABLE broadcast_numbers ADD COLUMN IF NOT EXISTS account_mode TEXT;
ALTER TABLE broadcast_numbers ADD COLUMN IF NOT EXISTS restrictions JSONB DEFAULT '[]'::jsonb;
ALTER TABLE broadcast_numbers ADD COLUMN IF NOT EXISTS additional_info JSONB DEFAULT '[]'::jsonb;
ALTER TABLE broadcast_numbers ADD COLUMN IF NOT EXISTS has_payment_issue BOOLEAN DEFAULT false;
ALTER TABLE broadcast_numbers ADD COLUMN IF NOT EXISTS display_name_pending BOOLEAN DEFAULT false;
ALTER TABLE broadcast_numbers ADD COLUMN IF NOT EXISTS waba_name TEXT;
ALTER TABLE broadcast_numbers ADD COLUMN IF NOT EXISTS account_review_status TEXT;
ALTER TABLE broadcast_numbers ADD COLUMN IF NOT EXISTS business_verification_status TEXT;
ALTER TABLE broadcast_numbers ADD COLUMN IF NOT EXISTS waba_currency TEXT;
ALTER TABLE broadcast_numbers ADD COLUMN IF NOT EXISTS waba_country TEXT;
ALTER TABLE broadcast_numbers ADD COLUMN IF NOT EXISTS quality_updated_at TIMESTAMPTZ;
