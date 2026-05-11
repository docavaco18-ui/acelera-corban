-- 018: store waba_id per phone number for per-WABA template filtering
ALTER TABLE broadcast_numbers
    ADD COLUMN IF NOT EXISTS waba_id TEXT DEFAULT NULL;
