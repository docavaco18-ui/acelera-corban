-- 015: add real Meta fields to broadcast_numbers
ALTER TABLE broadcast_numbers
    ADD COLUMN IF NOT EXISTS can_send        TEXT DEFAULT 'UNKNOWN',
    ADD COLUMN IF NOT EXISTS name_status     TEXT DEFAULT 'UNKNOWN',
    ADD COLUMN IF NOT EXISTS throughput_level TEXT DEFAULT 'STANDARD',
    ADD COLUMN IF NOT EXISTS phone_status    TEXT DEFAULT 'UNKNOWN',
    ADD COLUMN IF NOT EXISTS restriction_codes JSONB DEFAULT '[]'::jsonb;
