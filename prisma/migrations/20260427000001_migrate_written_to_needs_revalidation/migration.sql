-- One-shot data migration.
-- The previous /api/approve handler called an LLM with no Coda MCP tools wired in,
-- then flipped Review.status to WRITTEN purely on the model's stop_reason. No row
-- bearing this status was ever verified to exist in the live Coda doc. Move every
-- such row to NEEDS_REVALIDATION so downstream code never treats them as authoritative.
UPDATE "Review" SET "status" = 'NEEDS_REVALIDATION' WHERE "status" = 'WRITTEN';
