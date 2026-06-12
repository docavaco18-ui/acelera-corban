-- 037: integridade — FK de broadcast_numbers.meta_token_id → vendeai_meta_tokens.id
-- ON DELETE SET NULL: se uma porta sumir por caminho externo (SQL/console), os
-- números viram "porta legada" (NULL) em vez de apontar pra token inexistente
-- (que o monitor consultaria com token de outra BM). Backstop da limpeza manual
-- feita em delete_meta_token. Índice acelera o SET NULL e o delete por porta.

CREATE INDEX IF NOT EXISTS idx_broadcast_numbers_meta_token
    ON broadcast_numbers(meta_token_id);

ALTER TABLE broadcast_numbers
    DROP CONSTRAINT IF EXISTS broadcast_numbers_meta_token_id_fkey;

ALTER TABLE broadcast_numbers
    ADD CONSTRAINT broadcast_numbers_meta_token_id_fkey
    FOREIGN KEY (meta_token_id) REFERENCES vendeai_meta_tokens(id) ON DELETE SET NULL;
