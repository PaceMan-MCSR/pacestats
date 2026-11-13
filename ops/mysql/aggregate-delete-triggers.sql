-- Deletion signals for the incremental all-time aggregate job (MySQL 8 / MariaDB 10.2+).
--
-- `npm run cache:refresh:full` keeps per-player summaries in Redis and, on
-- later runs, recomputes only players whose rows changed. Inserts and updates
-- are found from pace.id, pace.lastUpdated, nethers.id and insertTime. A
-- deleted row leaves no trace in those columns, so these triggers record the
-- player in cache_invalidation_outbox (scope 'aggregate') whatever code path
-- deletes the row. The job acknowledges the entries it processed.
--
-- The job checks that both triggers exist and otherwise rescans every row on
-- every run, as it did before. Apply after performance-indexes.sql (which
-- creates cache_invalidation_outbox). Creating a trigger takes a brief
-- metadata lock on the table; run it outside peak write traffic. Requires the
-- TRIGGER privilege (and SUPER or log_bin_trust_function_creators when binary
-- logging is enabled without it).

DROP TRIGGER IF EXISTS trg_pace_aggregate_delete;
DROP TRIGGER IF EXISTS trg_nethers_aggregate_delete;

CREATE TRIGGER trg_pace_aggregate_delete
AFTER DELETE ON pace
FOR EACH ROW
    INSERT INTO cache_invalidation_outbox (scope, entityId, token, createdAt)
    VALUES ('aggregate', COALESCE(OLD.uuid, ''), UUID(), NOW(3))
    ON DUPLICATE KEY UPDATE token=VALUES(token), createdAt=VALUES(createdAt);

CREATE TRIGGER trg_nethers_aggregate_delete
AFTER DELETE ON nethers
FOR EACH ROW
    INSERT INTO cache_invalidation_outbox (scope, entityId, token, createdAt)
    VALUES ('aggregate', OLD.uuid, UUID(), NOW(3))
    ON DUPLICATE KEY UPDATE token=VALUES(token), createdAt=VALUES(createdAt);

-- Verify: both names must be listed.
SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA = DATABASE()
  AND TRIGGER_NAME IN ('trg_pace_aggregate_delete', 'trg_nethers_aggregate_delete');
