-- Add waba_id column to aesir_instances for UI display + future filtering
ALTER TABLE aesir_instances ADD COLUMN IF NOT EXISTS waba_id TEXT;
CREATE INDEX IF NOT EXISTS idx_aesir_instances_waba_id ON aesir_instances(waba_id) WHERE waba_id IS NOT NULL;
