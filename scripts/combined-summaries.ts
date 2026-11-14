import type { Connection } from "mysql2/promise";
import type Redis from "ioredis";
import { setTimeout as pause } from "node:timers/promises";
import {
    BucketAccumulator,
    bucketOf,
    bucketStart,
    closableBucket,
    COMBINED_BUCKET_SECONDS,
    COMBINED_DELETE_OVERLAP_SECONDS,
    COMBINED_KEY_PREFIX,
    COMBINED_MAX_ID_FIELD,
    COMBINED_STATE_KEY,
    COMBINED_SUMMARY_VERSION,
    COMBINED_ZONE_SLACK_SECONDS,
    combinedSplitCategories,
    combinedSplitRowsSql,
    combinedSummaryKey,
    insertTimeRangeSql,
    insertTimeRangeValues,
} from "@/app/combinedSummary";
import { scanKeys, setHashIfLeaseHeld, streamRowBatches, type RedisLease } from "./cache-runtime";

/**
 * Maintains the per-player bucket summaries read by the combined endpoints
 * (see app/combinedSummary.ts). Runs inside the run-history job, which
 * already visits every changed player once a minute:
 *
 * - a 30-day bucket is summarised for every player once it has been over for
 *   a few hours (one pass over that bucket's rows);
 * - a player whose rows in summarised buckets changed, or who had a run
 *   deleted, gets all buckets rebuilt from MySQL;
 * - `checkedFrom` then tells readers which changes are already reflected.
 *
 * The state hash is written last, so a run that stops early leaves readers on
 * the previous, still consistent state. A missing or different-format state
 * rebuilds everything.
 */

const splitColumns = combinedSplitCategories.join(", ");

const sourceRowsSql = (where: string, order = "") => `
    WITH window_rows AS (
        SELECT id, uuid, insertTime, nether, bastion, fortress, first_portal,
            stronghold, end, finish, obtainRod
        FROM pace
        WHERE ${where}
    ), ${combinedSplitRowsSql("window_rows")}
    SELECT uuid, id, UNIX_TIMESTAMP(insertTime) AS instant, ${splitColumns}
    FROM split_rows ${order};`;

const writeBucketScript = `
    if redis.call('GET', KEYS[1]) ~= ARGV[1] then
        return redis.error_reply('CACHE_LOCK_LOST')
    end
    for index = 2, #KEYS do
        local base = 3 + (index - 2) * 2
        redis.call('HSET', KEYS[index], ARGV[2], ARGV[base])
        local current = tonumber(redis.call('HGET', KEYS[index], '${COMBINED_MAX_ID_FIELD}') or '0')
        if tonumber(ARGV[base + 1]) > current then
            redis.call('HSET', KEYS[index], '${COMBINED_MAX_ID_FIELD}', ARGV[base + 1])
        end
    end
    return #KEYS - 1
`;

const replacePlayersScript = `
    if redis.call('GET', KEYS[1]) ~= ARGV[1] then
        return redis.error_reply('CACHE_LOCK_LOST')
    end
    local offset = 2
    for keyIndex = 2, #KEYS do
        local fieldCount = tonumber(ARGV[offset])
        offset = offset + 1
        redis.call('DEL', KEYS[keyIndex])
        for field = 0, fieldCount - 1, 2 do
            redis.call('HSET', KEYS[keyIndex], ARGV[offset + field], ARGV[offset + field + 1])
        end
        offset = offset + fieldCount
    end
    return #KEYS - 1
`;

const deleteKeysScript = `
    if redis.call('GET', KEYS[1]) ~= ARGV[1] then
        return redis.error_reply('CACHE_LOCK_LOST')
    end
    for index = 2, #KEYS do redis.call('DEL', KEYS[index]) end
    return #KEYS - 1
`;

async function hasDeleteTriggers(conn: Connection): Promise<boolean> {
    const [rows] = await conn.execute(
        `SELECT COUNT(*) AS triggerCount
         FROM information_schema.TRIGGERS
         WHERE TRIGGER_SCHEMA = DATABASE()
           AND TRIGGER_NAME IN ('trg_pace_aggregate_delete', 'trg_nethers_aggregate_delete');`,
    ) as any;
    return Number(rows[0].triggerCount) === 2;
}

/** Summarise one bucket for every player with rows in it. Returns the rows read. */
async function closeBucket(
    conn: Connection,
    redis: Redis,
    bucket: number,
    batchSize: number,
    sqlBatchSize: number,
    lease: RedisLease,
    pacingDelayMs = 0,
): Promise<number> {
    await lease.verifyHeld();
    let currentUuid: string | undefined;
    let currentPlayer: BucketAccumulator | undefined;
    let rowCount = 0;
    let batch: Array<[string, string, number]> = [];
    const flush = async () => {
        if (batch.length === 0) return;
        lease.assertHeld();
        await redis.eval(
            writeBucketScript,
            batch.length + 1,
            lease.key,
            ...batch.map(([uuid]) => combinedSummaryKey(uuid)),
            lease.token,
            String(bucket),
            ...batch.flatMap(([, summary, maxId]) => [summary, String(maxId)]),
        );
        batch = [];
    };
    const flushPlayer = async () => {
        if (!currentPlayer || currentUuid === undefined) return;
        batch.push([currentUuid, JSON.stringify(currentPlayer.summary()), currentPlayer.maxId]);
        currentPlayer = undefined;
        if (batch.length >= batchSize) await flush();
    };
    await streamRowBatches<any[]>(conn,
        {sql: sourceRowsSql(insertTimeRangeSql(), "ORDER BY uuid ASC"), rowsAsArray: true},
        insertTimeRangeValues(bucketStart(bucket), bucketStart(bucket + 1)),
        sqlBatchSize,
        async (rows) => {
            lease.assertHeld();
            rowCount += rows.length;
            for (const row of rows) {
                const uuid = row[0];
                if (uuid === null) continue;
                if (currentUuid !== uuid) {
                    await flushPlayer();
                    currentUuid = uuid;
                    currentPlayer = new BucketAccumulator();
                }
                currentPlayer!.add(Number(row[1]), row, 3);
            }
            if (pacingDelayMs > 0) await pause(pacingDelayMs);
        },
    );
    await flushPlayer();
    await flush();
    lease.assertHeld();
    return rowCount;
}

/** Rebuild every summarised bucket of these players. Returns the rows read. */
async function rebuildPlayers(
    conn: Connection,
    redis: Redis,
    uuids: string[],
    closedThrough: number,
    uuidBatchSize: number,
    sqlBatchSize: number,
    lease: RedisLease,
    pacingDelayMs = 0,
): Promise<number> {
    const closedEnd = bucketStart(closedThrough + 1);
    let rowCount = 0;
    for (let offset = 0; offset < uuids.length; offset += uuidBatchSize) {
        const batch = uuids.slice(offset, offset + uuidBatchSize);
        await lease.verifyHeld();
        let currentUuid: string | undefined;
        let buckets = new Map<number, BucketAccumulator>();
        const missing = new Set(batch);
        let replacements: Array<[string, string[]]> = [];
        let replacementBytes = 0;
        const maximumReplacementBytes = 256 * 1024;
        const flushReplacements = async () => {
            if (replacements.length === 0) return;
            lease.assertHeld();
            await redis.eval(replacePlayersScript, replacements.length + 1, lease.key,
                ...replacements.map(([uuid]) => combinedSummaryKey(uuid)), lease.token,
                ...replacements.flatMap(([, fields]) => [String(fields.length), ...fields]));
            replacements = [];
            replacementBytes = 0;
        };
        const flushPlayer = async (uuid: string) => {
            const fields: string[] = [];
            let maxId = 0;
            for (const [bucket, accumulator] of buckets) {
                fields.push(String(bucket), JSON.stringify(accumulator.summary()));
                if (accumulator.maxId > maxId) maxId = accumulator.maxId;
            }
            if (fields.length > 0) fields.push(COMBINED_MAX_ID_FIELD, String(maxId));
            // Numeric summary JSON is ASCII. Cap both bytes and player count;
            // an unusually large player is sent alone, as in the old writer.
            let bytes = 0;
            for (const field of fields) bytes += field.length;
            if (replacementBytes + bytes > maximumReplacementBytes) await flushReplacements();
            replacements.push([uuid, fields]);
            replacementBytes += bytes;
            missing.delete(uuid);
            buckets = new Map();
            if (replacements.length >= 25 || replacementBytes >= maximumReplacementBytes) await flushReplacements();
        };
        await streamRowBatches<any[]>(conn,
            {
                sql: sourceRowsSql(
                    `uuid IN (${batch.map(() => "?").join(",")})
                     AND insertTime < FROM_UNIXTIME(?) AND UNIX_TIMESTAMP(insertTime) < ?`,
                    "ORDER BY uuid ASC",
                ),
                rowsAsArray: true,
            },
            [...batch, closedEnd + COMBINED_ZONE_SLACK_SECONDS, closedEnd],
            sqlBatchSize,
            async (rows) => {
                lease.assertHeld();
                rowCount += rows.length;
                for (const row of rows) {
                    if (currentUuid !== undefined && currentUuid !== row[0]) await flushPlayer(currentUuid);
                    currentUuid = row[0];
                    const bucket = bucketOf(Number(row[2]));
                    let accumulator = buckets.get(bucket);
                    if (!accumulator) {
                        accumulator = new BucketAccumulator();
                        buckets.set(bucket, accumulator);
                    }
                    accumulator.add(Number(row[1]), row, 3);
                }
                if (pacingDelayMs > 0) await pause(pacingDelayMs);
            },
        );
        if (currentUuid !== undefined) await flushPlayer(currentUuid);
        // A player whose last old run was removed must lose its summaries.
        for (const uuid of missing) {
            await flushPlayer(uuid);
        }
        await flushReplacements();
    }
    lease.assertHeld();
    return rowCount;
}

/** Players whose summarised rows changed or were deleted since `checkedFrom`. */
async function findStalePlayers(
    conn: Connection,
    redis: Redis,
    checkedFrom: number,
    closedThrough: number,
): Promise<Set<string>> {
    const closedEnd = bucketStart(closedThrough + 1);
    const stale = new Set<string>();
    const [changedRows] = await conn.execute(
        `SELECT uuid,
            MAX(UNIX_TIMESTAMP(insertTime) < ?) AS hasClosedRow,
            MIN(IF(UNIX_TIMESTAMP(insertTime) < ?, NULL, id)) AS lowestOpenId
         FROM pace
         WHERE lastUpdated >= FROM_UNIXTIME(?) AND UNIX_TIMESTAMP(lastUpdated) >= ?
            AND uuid IS NOT NULL
         GROUP BY uuid;`,
        [closedEnd, closedEnd, Math.max(0, checkedFrom - COMBINED_ZONE_SLACK_SECONDS), checkedFrom],
    ) as any;
    // A changed row newer than the buckets is still covered if its id is: it
    // may have been moved there from a summarised bucket.
    const lowestOpenId = new Map<string, number>();
    for (const row of changedRows) {
        if (row.uuid === null) continue;
        if (Number(row.hasClosedRow) === 1) {
            stale.add(row.uuid);
        } else lowestOpenId.set(row.uuid, Number(row.lowestOpenId));
    }
    // Large watermark overlaps can touch every player. Keep Redis command and
    // reply buffers bounded instead of queuing one pipeline for the whole set.
    let candidates: Array<[string, number]> = [];
    const flushCandidates = async () => {
        if (candidates.length === 0) return;
        const pipeline = redis.pipeline();
        for (const [uuid] of candidates) pipeline.hget(combinedSummaryKey(uuid), COMBINED_MAX_ID_FIELD);
        const results = await pipeline.exec();
        for (let index = 0; index < candidates.length; index++) {
            const [error, maxId] = results![index];
            if (error) throw error;
            const [uuid, lowestId] = candidates[index];
            if (lowestId <= Number(maxId ?? 0)) stale.add(uuid);
        }
        candidates = [];
    };
    for (const [uuid, lowestId] of lowestOpenId) {
        if (stale.has(uuid)) continue;
        candidates.push([uuid, lowestId]);
        if (candidates.length === 500) await flushCandidates();
    }
    await flushCandidates();
    // Rows deleted outside deleteRun are reported by the aggregate triggers.
    // Those entries are acknowledged by the all-time job, so go by their time.
    const [deletedRows] = await conn.execute(
        `SELECT entityId
         FROM cache_invalidation_outbox
         WHERE scope='aggregate' AND UNIX_TIMESTAMP(createdAt) >= ?;`,
        [checkedFrom - COMBINED_DELETE_OVERLAP_SECONDS],
    ) as any;
    for (const row of deletedRows) {
        if (row.entityId !== "") stale.add(row.entityId);
    }
    return stale;
}

export interface CombinedSummaryResult {
    mode: "rebuilt" | "incremental";
    closedBuckets: number;
    rebuiltPlayers: number;
    rowCount: number;
    closedThrough: number;
}

/**
 * Bring the combined-endpoint summaries up to date.
 * `deletedUuids` are the players this run rebuilt because of deleted runs
 * (the dirty set and the 'recent' outbox entries).
 */
export async function refreshCombinedSummaries(
    conn: Connection,
    redis: Redis,
    options: {
        full: boolean;
        deletedUuids: Iterable<string>;
        overlapSeconds: number;
        redisBatchSize: number;
        uuidBatchSize: number;
        sqlBatchSize: number;
        pacingDelayMs: number;
        lease: RedisLease;
    },
): Promise<CombinedSummaryResult> {
    const {lease} = options;
    const [[clock]] = await conn.query("SELECT UNIX_TIMESTAMP() AS nowSeconds") as any;
    const nowSeconds = Number(clock.nowSeconds);
    const deleteTriggers = await hasDeleteTriggers(conn);
    const state = await redis.hgetall(COMBINED_STATE_KEY);
    const previousClosed = Number(state.closedThrough);
    const previousChecked = Number(state.checkedFrom);
    const usable = !options.full
        && Number(state.version) === COMBINED_SUMMARY_VERSION
        && Number(state.bucketSeconds) === COMBINED_BUCKET_SECONDS
        && Number.isSafeInteger(previousClosed)
        && Number.isSafeInteger(previousChecked);
    const target = Math.max(closableBucket(nowSeconds), usable ? previousClosed : -1);
    let rowCount = 0;
    let closedBuckets = 0;
    let rebuiltPlayers = 0;

    if (!usable) {
        // Hide the old summaries from readers before replacing them all.
        lease.assertHeld();
        await redis.eval(deleteKeysScript, 2, lease.key, COMBINED_STATE_KEY, lease.token);
        const oldKeys = await scanKeys(redis, `${COMBINED_KEY_PREFIX}*`);
        for (let offset = 0; offset < oldKeys.length; offset += 500) {
            const batch = oldKeys.slice(offset, offset + 500);
            lease.assertHeld();
            await redis.eval(deleteKeysScript, batch.length + 1, lease.key, ...batch, lease.token);
        }
        const [[first]] = await conn.query("SELECT UNIX_TIMESTAMP(MIN(insertTime)) AS firstSeconds FROM pace") as any;
        if (first.firstSeconds !== null) {
            for (let bucket = bucketOf(Number(first.firstSeconds)); bucket <= target; bucket++) {
                rowCount += await closeBucket(
                    conn, redis, bucket, options.redisBatchSize, options.sqlBatchSize, lease, options.pacingDelayMs,
                );
                closedBuckets++;
            }
        }
    } else {
        for (let bucket = previousClosed + 1; bucket <= target; bucket++) {
            rowCount += await closeBucket(
                conn, redis, bucket, options.redisBatchSize, options.sqlBatchSize, lease, options.pacingDelayMs,
            );
            closedBuckets++;
        }
        const stale = await findStalePlayers(conn, redis, previousChecked, target);
        for (const uuid of options.deletedUuids) stale.add(uuid);
        rebuiltPlayers = stale.size;
        rowCount += await rebuildPlayers(
            conn, redis, [...stale].sort(), target, options.uuidBatchSize, options.sqlBatchSize, lease, options.pacingDelayMs,
        );
    }

    await setHashIfLeaseHeld(redis, COMBINED_STATE_KEY, {
        version: String(COMBINED_SUMMARY_VERSION),
        bucketSeconds: String(COMBINED_BUCKET_SECONDS),
        closedThrough: String(target),
        // Readers and the next run re-examine every row changed from here on.
        checkedFrom: String(nowSeconds - options.overlapSeconds - 1),
        deleteTriggers: deleteTriggers ? "1" : "0",
        completedAt: new Date().toISOString(),
    }, lease);
    return {mode: usable ? "incremental" : "rebuilt", closedBuckets, rebuiltPlayers, rowCount, closedThrough: target};
}
