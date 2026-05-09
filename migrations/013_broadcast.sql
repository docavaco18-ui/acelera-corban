-- migrations/013_broadcast.sql

-- 1. vendeai_settings
CREATE TABLE IF NOT EXISTS vendeai_settings (
    owner_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email_enc TEXT,
    password_enc TEXT,
    bearer_token_enc TEXT,
    token_expires_at TIMESTAMPTZ,
    meta_token_enc TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE vendeai_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_only" ON vendeai_settings
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- 2. broadcast_numbers
CREATE TABLE IF NOT EXISTS broadcast_numbers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    phone_id TEXT NOT NULL,
    display_phone TEXT,
    quality_rating TEXT DEFAULT 'UNKNOWN',
    messaging_tier TEXT,
    daily_limit INTEGER DEFAULT 1000,
    is_paused BOOLEAN DEFAULT FALSE,
    last_meta_check_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(owner_id, phone_id)
);
ALTER TABLE broadcast_numbers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_only" ON broadcast_numbers
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- 3. broadcast_dispatches
CREATE TABLE IF NOT EXISTS broadcast_dispatches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    csv_filename TEXT,
    total_leads INTEGER DEFAULT 0,
    claude_split_json JSONB,
    status TEXT NOT NULL DEFAULT 'pending_confirm',
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE broadcast_dispatches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_only" ON broadcast_dispatches
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- 4. broadcast_dispatch_assignments
CREATE TABLE IF NOT EXISTS broadcast_dispatch_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispatch_id UUID NOT NULL REFERENCES broadcast_dispatches(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    phone_id TEXT NOT NULL,
    vendeai_mailing_id TEXT,
    planned_count INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    open_count INTEGER DEFAULT 0,
    converted_count INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'scheduled',
    last_poll_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE broadcast_dispatch_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_only" ON broadcast_dispatch_assignments
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- 5. broadcast_alerts
CREATE TABLE IF NOT EXISTS broadcast_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    dispatch_id UUID REFERENCES broadcast_dispatches(id) ON DELETE SET NULL,
    phone_id TEXT,
    alert_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'warn',
    message TEXT,
    action_taken TEXT DEFAULT 'none',
    action_id TEXT UNIQUE,
    ts TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE broadcast_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_only" ON broadcast_alerts
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- Indexes
CREATE INDEX IF NOT EXISTS idx_broadcast_numbers_owner ON broadcast_numbers(owner_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_dispatches_owner ON broadcast_dispatches(owner_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_dispatches_status ON broadcast_dispatches(status);
CREATE INDEX IF NOT EXISTS idx_broadcast_assignments_dispatch ON broadcast_dispatch_assignments(dispatch_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_alerts_owner ON broadcast_alerts(owner_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_alerts_dispatch ON broadcast_alerts(dispatch_id);
