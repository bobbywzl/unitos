-- DEFINE derivation (SPEC.md §4, §6): one word or one phrase → its meaning
-- in its sentence, streamed into the toolbar under the Define row. It
-- persists nothing; the value types the pipeline's per-type config.
ALTER TYPE "DerivationType" ADD VALUE IF NOT EXISTS 'DEFINE';
