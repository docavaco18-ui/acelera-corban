-- 036: Multi-token Meta — até 10 BMs por usuário ("portas" de disparo).
-- Cada linha = 1 token System User = 1 Business Manager.
-- Aditiva e backward-compatible: vendeai_settings.meta_token_enc continua válido
-- (porta legada) e é migrado pra 1 linha "Principal" no backfill abaixo.

CREATE TABLE IF NOT EXISTS vendeai_meta_tokens (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id          uuid NOT NULL,
    label             text,
    meta_token_enc    text NOT NULL,
    waba_ids          jsonb NOT NULL DEFAULT '[]'::jsonb,
    bm_id             text,
    bm_name           text,
    connection_status text NOT NULL DEFAULT 'unknown',   -- 'estavel' | 'erro' | 'unknown'
    connection_detail text,
    waba_count        integer NOT NULL DEFAULT 0,
    last_check_at     timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendeai_meta_tokens_owner ON vendeai_meta_tokens(owner_id);

ALTER TABLE vendeai_meta_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_only ON vendeai_meta_tokens;
CREATE POLICY owner_only ON vendeai_meta_tokens
    USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- broadcast_numbers: marca de qual porta/BM o número foi puxado (NULL = porta legada).
ALTER TABLE broadcast_numbers
    ADD COLUMN IF NOT EXISTS meta_token_id uuid;

-- Backfill: migra o token único legado pra 1 porta "Principal"
-- (apenas se o usuário ainda não tiver nenhuma porta cadastrada).
INSERT INTO vendeai_meta_tokens (owner_id, label, meta_token_enc, waba_ids)
SELECT s.owner_id, 'Principal', s.meta_token_enc, COALESCE(s.waba_ids, '[]'::jsonb)
FROM vendeai_settings s
WHERE s.meta_token_enc IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM vendeai_meta_tokens t WHERE t.owner_id = s.owner_id
  );
