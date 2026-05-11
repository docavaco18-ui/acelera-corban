-- 016: cross-reference Meta phone numbers with VendeAI/Chatwoot inboxes
ALTER TABLE broadcast_numbers
    ADD COLUMN IF NOT EXISTS chatwoot_connected BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS chatwoot_inbox_id  TEXT DEFAULT NULL;
