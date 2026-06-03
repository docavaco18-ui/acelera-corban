-- 024: Aesir ERP — segundo CRM de disparo WhatsApp

CREATE TABLE IF NOT EXISTS aesir_settings (
    owner_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    api_token_enc  TEXT NOT NULL,
    account_id     TEXT NOT NULL,
    updated_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE aesir_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_only" ON aesir_settings
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- instâncias Aesir (equivalente ao broadcast_numbers para VendeAI)
CREATE TABLE IF NOT EXISTS aesir_instances (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    instance_id  TEXT NOT NULL,
    name         TEXT,
    phone        TEXT,
    status       TEXT DEFAULT 'open',
    is_paused    BOOLEAN DEFAULT FALSE,
    daily_limit  INTEGER DEFAULT 500,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (owner_id, instance_id)
);

ALTER TABLE aesir_instances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_only" ON aesir_instances
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- campanhas Aesir (histórico de disparos)
CREATE TABLE IF NOT EXISTS aesir_dispatches (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    instance_id    TEXT NOT NULL,
    csv_filename   TEXT,
    total_contacts INTEGER DEFAULT 0,
    sent           INTEGER DEFAULT 0,
    errors         INTEGER DEFAULT 0,
    status         TEXT DEFAULT 'running',  -- running | paused | done | cancelled
    message_tpl    TEXT,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE aesir_dispatches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_only" ON aesir_dispatches
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());
