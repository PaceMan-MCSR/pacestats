-- PaceStats performance indexes (MySQL 8 / compatible MariaDB).
--
-- REVIEW BEFORE EXECUTION. This repository could not inspect the production
-- schema. First run the SHOW INDEX and duplicate probes below. Remove any ADD
-- INDEX already covered by an equivalent leftmost-prefix index under another
-- name. Test ALTER behavior on a production-sized copy and use an online
-- schema change tool if LOCK=NONE is unsupported for your server/table.

SHOW INDEX FROM pace;
SHOW INDEX FROM aa;
SHOW INDEX FROM nethers;
SHOW INDEX FROM users;

-- This must return no rows before the unique index is added.
SELECT runId, COUNT(*) AS duplicate_count
FROM nethers
GROUP BY runId
HAVING COUNT(*) > 1
LIMIT 100;

-- This must also return no rows if users.uuid is not already unique.
SELECT uuid, COUNT(*) AS duplicate_count
FROM users
GROUP BY uuid
HAVING COUNT(*) > 1
LIMIT 100;

-- Durable invalidations let a committed SQL deletion survive a Redis outage.
-- Deploy this table before the application code that writes to it.
CREATE TABLE IF NOT EXISTS cache_invalidation_outbox (
    scope VARCHAR(32) NOT NULL,
    entityId VARCHAR(64) NOT NULL,
    token CHAR(36) NOT NULL,
    createdAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (scope, entityId),
    INDEX idx_cache_invalidation_created (scope, createdAt)
) ENGINE=InnoDB;

-- Nickname/Twitch lookups. Do not add (worldId), (uuid,id), or
-- (insertTime,id): the existing (worldId,uuid), uuid, and insertTime indexes
-- cover those access paths because InnoDB secondary indexes carry the PK.
ALTER TABLE pace
    ADD INDEX idx_pace_nickname_id (nickname, id),
    ADD INDEX idx_pace_twitch_id (twitch, id),
    ALGORITHM=INPLACE, LOCK=NONE;

-- Time-window aggregate/session scans and incremental history refreshes.
ALTER TABLE pace
    ADD INDEX idx_pace_uuid_insert_time_id (uuid, insertTime, id),
    ADD INDEX idx_pace_uuid_twitch_insert_time (uuid, twitch, insertTime),
    ADD INDEX idx_pace_last_updated_id_uuid (lastUpdated, id, uuid),
    -- Enables a loose index scan for MIN(finish) per player. InnoDB appends id
    -- automatically, and the winning timestamp needs only one clustered lookup
    -- per player, so including id and insertTime here is needless write/storage
    -- amplification.
    ADD INDEX idx_pace_uuid_finish (uuid, finish),
    ALGORITHM=INPLACE, LOCK=NONE;

-- If upgrading from the earlier wide PB index, verify the compact index with
-- the EXPLAIN below before reclaiming it:
-- ALTER TABLE pace DROP INDEX idx_pace_uuid_finish_id_insertTime,
--     ALGORITHM=INPLACE, LOCK=NONE;

ALTER TABLE nethers
    ADD UNIQUE INDEX uq_nethers_run_id (runId),
    ADD INDEX idx_nethers_insert_time_id (insertTime, id),
    ADD INDEX idx_nethers_uuid_id (uuid, id),
    ADD INDEX idx_nethers_uuid_insert_time_id (uuid, insertTime, id),
    ALGORITHM=INPLACE, LOCK=NONE;

-- users.uuid is expected to remain the table's PRIMARY KEY. Do not add a
-- second unique copy of that key.

-- Representative plan probes. Substitute real values before comparing plans.
EXPLAIN SELECT id FROM pace WHERE worldId = 'sample-world-id' LIMIT 1;
EXPLAIN SELECT id FROM pace WHERE uuid = 'sample-uuid' ORDER BY id DESC LIMIT 26;
EXPLAIN SELECT uuid, MAX(id) FROM pace GROUP BY uuid;
EXPLAIN SELECT uuid, twitch, MAX(insertTime)
FROM pace WHERE twitch IS NOT NULL GROUP BY uuid, twitch;
EXPLAIN SELECT id FROM pace
WHERE uuid = 'sample-uuid' AND insertTime >= NOW() - INTERVAL 24 HOUR
ORDER BY insertTime DESC, id DESC LIMIT 10001;
EXPLAIN SELECT id, uuid, lastUpdated FROM pace
WHERE lastUpdated <= NOW()
  AND (lastUpdated > NOW() - INTERVAL 2 MINUTE
       OR (lastUpdated = NOW() - INTERVAL 2 MINUTE AND id > 0))
ORDER BY lastUpdated ASC, id ASC LIMIT 5000;
EXPLAIN SELECT id, uuid FROM pace
WHERE insertTime <= NOW()
ORDER BY uuid ASC, id ASC LIMIT 5000;
EXPLAIN SELECT id, uuid FROM aa
WHERE insertTime <= NOW()
ORDER BY uuid ASC, id ASC LIMIT 5000;
EXPLAIN SELECT id, uuid, insertTime FROM nethers
WHERE insertTime <= NOW()
ORDER BY uuid ASC, insertTime ASC, id ASC LIMIT 5000;
EXPLAIN SELECT nethers.id
FROM nethers INNER JOIN pace ON nethers.runId = pace.id
WHERE nethers.uuid = 'sample-uuid'
  AND nethers.insertTime >= NOW() - INTERVAL 24 HOUR
ORDER BY nethers.insertTime DESC, nethers.id DESC LIMIT 100;

-- Expected with idx_pace_uuid_finish: the derived scan reports
-- "Using index for group-by" rather than reading every pace row.
EXPLAIN FORMAT=JSON
SELECT best.finish, best.uuid,
       (SELECT UNIX_TIMESTAMP(p.insertTime)
        FROM pace p
        WHERE p.uuid=best.uuid AND p.finish=best.finish
        ORDER BY p.id ASC
        LIMIT 1) AS timestamp
FROM (
    SELECT uuid, MIN(finish) AS finish
    FROM pace
    WHERE finish IS NOT NULL
    GROUP BY uuid
) best
ORDER BY best.finish ASC;
