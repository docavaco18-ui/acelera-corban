-- Aprovação e senha CRM
ALTER TABLE crm_propostas
  ADD COLUMN IF NOT EXISTS approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid;

-- Propostas antigas ficam aprovadas automaticamente
UPDATE crm_propostas SET approved = true WHERE approved = false;

-- Configurações CRM por tenant (senha de proteção)
CREATE TABLE IF NOT EXISTS crm_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  crm_password_hash text,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE crm_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_settings_owner" ON crm_settings
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE INDEX IF NOT EXISTS crm_settings_owner_idx ON crm_settings(owner_id);
