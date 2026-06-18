-- 038: limite diário manual por BM (porta) + nome real da BM no número.
-- Meta NÃO expõe messaging_limit_tier via Graph API para números CLOUD_API
-- recém-conectados (testado v21+v23, nó phone + WABA = vazio). O operador
-- informa o limite da BM (ex 2000) e CADA número da porta herda esse valor
-- enquanto a Meta não reporta o tier real — que, quando vier, sobrescreve no
-- refresh. bm_name guarda o nome REAL da BM (≠ waba_name, que é o nome da WABA).
ALTER TABLE vendeai_meta_tokens ADD COLUMN IF NOT EXISTS bm_daily_limit integer;
ALTER TABLE broadcast_numbers   ADD COLUMN IF NOT EXISTS bm_name text;
