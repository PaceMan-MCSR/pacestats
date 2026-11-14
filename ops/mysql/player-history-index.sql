-- Run against the PaceStats database before deploying SQL run-grid pagination.
-- Idempotent on MySQL 8: skip any existing index with the same leading columns.
-- This index bounds a cold default runs-page read to the requested page instead
-- of scanning other players by lastUpdated or decoding a lifetime in Node.
SET @history_index_exists = (
    SELECT COUNT(*) FROM (
        SELECT INDEX_NAME
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pace'
        GROUP BY INDEX_NAME
        HAVING GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) LIKE 'uuid,lastUpdated,id%'
    ) matching_indexes
);
SET @history_index_ddl = IF(
    @history_index_exists > 0,
    'SELECT ''Player history index already present'' AS result',
    'ALTER TABLE pace ADD INDEX idx_pace_uuid_last_updated_id (uuid, lastUpdated, id), ALGORITHM=INPLACE, LOCK=NONE'
);
PREPARE history_index_statement FROM @history_index_ddl;
EXECUTE history_index_statement;
DEALLOCATE PREPARE history_index_statement;

EXPLAIN SELECT id, lastUpdated FROM pace
WHERE uuid = 'sample-uuid'
ORDER BY lastUpdated DESC, id DESC LIMIT 25;
