-- migrations/034_broadcast_recipients.sql
-- Per-recipient tracking for broadcast dispatches.
-- Fatia 1: tabela básica. Sem events e sem metrics cache (premature).

CREATE TABLE IF NOT EXISTS broadcast_recipients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    dispatch_id UUID NOT NULL REFERENCES broadcast_dispatches(id) ON DELETE CASCADE,
    assignment_id UUID REFERENCES broadcast_dispatch_assignments(id) ON DELETE SET NULL,
    phone_id TEXT NOT NULL,
    display_phone TEXT,
    recipient_phone TEXT NOT NULL,
    recipient_name TEXT,
    csv_row_index INTEGER NOT NULL DEFAULT 0,
    csv_payload JSONB DEFAULT '{}'::jsonb,
    template_id TEXT,
    provider TEXT NOT NULL DEFAULT 'vendeai',
    provider_message_id TEXT,
    provider_mailing_id TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    failure_code TEXT,
    failure_reason TEXT,
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    first_reply_at TIMESTAMPTZ,
    converted_at TIMESTAMPTZ,
    conversion_label TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE broadcast_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_only" ON broadcast_recipients
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_recipients_owner_dispatch ON broadcast_recipients(owner_id, dispatch_id);
CREATE INDEX IF NOT EXISTS idx_recipients_owner_phone ON broadcast_recipients(owner_id, recipient_phone);
CREATE INDEX IF NOT EXISTS idx_recipients_owner_status ON broadcast_recipients(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_recipients_assignment ON broadcast_recipients(assignment_id);
CREATE INDEX IF NOT EXISTS idx_recipients_mailing ON broadcast_recipients(provider_mailing_id);
CREATE INDEX IF NOT EXISTS idx_recipients_created ON broadcast_recipients(created_at);
