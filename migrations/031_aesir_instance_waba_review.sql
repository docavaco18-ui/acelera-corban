-- WABA-level review/verification/currency fields for richer alerts UI
ALTER TABLE aesir_instances ADD COLUMN IF NOT EXISTS waba_name TEXT;
ALTER TABLE aesir_instances ADD COLUMN IF NOT EXISTS account_review_status TEXT;
ALTER TABLE aesir_instances ADD COLUMN IF NOT EXISTS business_verification_status TEXT;
ALTER TABLE aesir_instances ADD COLUMN IF NOT EXISTS waba_currency TEXT;
ALTER TABLE aesir_instances ADD COLUMN IF NOT EXISTS waba_country TEXT;
