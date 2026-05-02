-- migrations/004_creds_text.sql
-- Hotfix: BYTEA → TEXT em user_bank_credentials.
-- Fernet token já é urlsafe-base64 ASCII; armazenar como TEXT evita
-- TypeError("Object of type bytes is not JSON serializable") via supabase-py.
-- Tabela está vazia em prod no momento desta migration — cast direto é seguro.

ALTER TABLE public.user_bank_credentials ALTER COLUMN login_enc    TYPE TEXT USING convert_from(login_enc,    'UTF8');
ALTER TABLE public.user_bank_credentials ALTER COLUMN password_enc TYPE TEXT USING convert_from(password_enc, 'UTF8');
ALTER TABLE public.user_bank_credentials ALTER COLUMN extra_enc    TYPE TEXT USING convert_from(extra_enc,    'UTF8');
ALTER TABLE public.user_bank_credentials ALTER COLUMN proxies_enc  TYPE TEXT USING convert_from(proxies_enc,  'UTF8');
