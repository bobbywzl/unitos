-- The opus role moves to Claude Opus 5.5 (CLAUDE_OPUS_5_5, lib/derive/config.ts).
-- A row the model update wrote for an older Opus would keep the calls and the
-- admin models section on that id, so the row follows the constant.
UPDATE "ModelChoice"
SET "previousModelId" = "modelId",
    "modelId" = 'claude-opus-5-5',
    "changedAt" = CURRENT_TIMESTAMP,
    "note" = 'Moved to claude-opus-5-5 with the app.'
WHERE "role" = 'opus' AND "modelId" <> 'claude-opus-5-5';
