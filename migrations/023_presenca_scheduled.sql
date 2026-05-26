-- Migration 023 — Presença: agendamento de batches
-- Adiciona scheduled_for em presenca_batches. NULL = comportamento atual (start manual).
-- Scheduler loop pega batches WHERE status='pendente' AND scheduled_for <= NOW().

ALTER TABLE public.presenca_batches
    ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ NULL;

-- Index parcial pra scheduler scan (só batches realmente agendados)
CREATE INDEX IF NOT EXISTS idx_presenca_batches_scheduled
    ON public.presenca_batches (scheduled_for)
    WHERE status = 'pendente' AND scheduled_for IS NOT NULL;

COMMENT ON COLUMN public.presenca_batches.scheduled_for IS
    'Horário UTC pra disparo automático do bot. NULL = start manual via UI.';
