-- Adiciona 'powerhub' à constraint bank_code em user_bank_credentials
-- Migration 022 criou as tabelas PowerHub mas esqueceu de atualizar o CHECK.

ALTER TABLE public.user_bank_credentials
    DROP CONSTRAINT IF EXISTS user_bank_credentials_bank_code_check;

ALTER TABLE public.user_bank_credentials
    ADD CONSTRAINT user_bank_credentials_bank_code_check
    CHECK (bank_code IN ('v8','vctex','mercantil','presenca','powerhub'));
