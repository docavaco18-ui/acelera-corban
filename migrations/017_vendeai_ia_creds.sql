-- 017: add VendeAI IA API credentials to vendeai_settings
ALTER TABLE vendeai_settings
    ADD COLUMN IF NOT EXISTS account_id     TEXT DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS crm_token_enc  TEXT DEFAULT NULL;
