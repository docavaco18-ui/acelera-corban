-- 027: Aesir — instance_id legado da 024, multi-instância usa assignments_json desde 026
ALTER TABLE aesir_dispatches ALTER COLUMN instance_id DROP NOT NULL;
ALTER TABLE aesir_dispatches ALTER COLUMN instance_id SET DEFAULT '';
