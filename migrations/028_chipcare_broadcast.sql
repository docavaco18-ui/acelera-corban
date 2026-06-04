-- 028: Chipcare — terceiro CRM de disparo WhatsApp (Oficial API HSM)

CREATE TABLE IF NOT EXISTS chipcare_settings (
    owner_id        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email_enc       TEXT NOT NULL,
    password_enc    TEXT NOT NULL,
    tenant_id       TEXT,                -- "Sarah" or "Arthur" tenant
    chipcare_user_id TEXT,               -- numeric user id returned by auth (for _1_createdBy field)
    -- SA hashes (may change per Chipcare deploy)
    sa_create       TEXT DEFAULT '40be5a0f648930e0433281bce7c7e92b8608ca8538',
    sa_activate     TEXT DEFAULT '40d6c8e94ed90438c061742726eb102e9e30d7aad6',
    sa_list_tpl     TEXT DEFAULT '4076e492ad0bf871591d73486aaf60ef4b5899b6b5',
    sa_list_camps   TEXT DEFAULT '60d1f84d254eb29a6024a5d2206b8153916b2bbcc7',
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE chipcare_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_only" ON chipcare_settings
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- canais WA Oficial do Chipcare
CREATE TABLE IF NOT EXISTS chipcare_channels (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    channel_id  INTEGER NOT NULL,
    title       TEXT,                 -- phone number e.g. "5511942870777"
    status      TEXT DEFAULT 'CLOSED',
    channel_type TEXT DEFAULT 'WHATSAPP_OFFICIAL',
    description TEXT,
    is_paused   BOOLEAN DEFAULT FALSE,
    daily_limit INTEGER DEFAULT 500,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (owner_id, channel_id)
);

ALTER TABLE chipcare_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_only" ON chipcare_channels
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- campanhas Chipcare (rastreia campanhas criadas no Chipcare via nossa plataforma)
CREATE TABLE IF NOT EXISTS chipcare_dispatches (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    chipcare_campaign_id INTEGER,          -- id retornado pelo Chipcare após criação
    campaign_name       TEXT,
    csv_filename        TEXT,
    total_leads         INTEGER DEFAULT 0,
    channel_ids         JSONB DEFAULT '[]',
    template_name       TEXT,
    template_id         TEXT,
    aggression_level    TEXT DEFAULT 'MEDIUM',
    status              TEXT DEFAULT 'pending_confirm', -- pending_confirm | running | paused | done | cancelled | error
    assignments_json    JSONB DEFAULT '[]',
    source_type         TEXT DEFAULT 'XLSX_FILE',
    finished_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE chipcare_dispatches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_only" ON chipcare_dispatches
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());
