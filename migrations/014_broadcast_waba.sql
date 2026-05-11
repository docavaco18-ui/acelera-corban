-- 014: add waba_ids column to vendeai_settings for Meta quality fetching
alter table vendeai_settings
    add column if not exists waba_ids jsonb default '[]'::jsonb;
