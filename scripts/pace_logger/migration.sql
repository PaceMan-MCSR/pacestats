-- Run against the intended pace database during a planned writer stop.
-- This script NEVER deletes/merges existing rows or changes their IDs.
-- Back up first. Inspect SHOW CREATE TABLE and skip ALTER clauses already applied.
SHOW CREATE TABLE pace;
SHOW INDEX FROM pace;

-- MUST return zero rows. If duplicates exist, reconcile their data and any linked
-- nethers.runId records manually before adding the unique index.
SELECT worldId, uuid, COUNT(*) AS duplicate_count
FROM pace
WHERE worldId IS NOT NULL AND uuid IS NOT NULL
GROUP BY worldId, uuid
HAVING COUNT(*) > 1
LIMIT 100;

-- Existing NULL identifiers are historical rows; the replacement rejects new
-- missing/empty identities. A unique index permits existing NULLs.
SELECT COUNT(*) AS rows_with_missing_identity
FROM pace WHERE worldId IS NULL OR uuid IS NULL OR worldId = '' OR uuid = '';

-- The old index named uniquerun is NONUNIQUE in the supplied dump.
-- ADD UNIQUE fails safely if duplicates remain; no automatic cleanup is done.
-- This may scan/lock a large table. Use your normal production DDL procedure.
ALTER TABLE pace
    ADD COLUMN sourceLastUpdatedMs BIGINT NULL DEFAULT NULL,
    ADD UNIQUE INDEX uq_pace_world_uuid (worldId, uuid);

-- Keep the old index for rollout; it can be removed later after verification.
-- Stop the old logger before starting the replacement. All future writers must
-- honor this unique constraint. sourceLastUpdatedMs is upstream epoch milliseconds;
-- lastUpdated and realUpdated keep their existing application meanings.
