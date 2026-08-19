import { randomUUID } from "node:crypto";
import mysql, { type Connection } from "mysql2/promise";
import Redis from "ioredis";
import dotenv from "dotenv";
import {
    acquireRedisLock,
    assertRedisResults,
    deleteKeysIfLeaseHeld,
    envInt,
    LockUnavailableError,
    publishStagedEntries,
    replaceManifest,
    scanKeys,
    setHashIfLeaseHeld,
    stageStringEntries,
    type RedisLease,
    type StagedKey,
} from "./cache-runtime";

dotenv.config({ path: ".env.local" });

const mysqlConfig = {
    host: process.env.DB_HOST,
    port: 3306,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: envInt("RECENT_DB_CONNECT_TIMEOUT_MS", 15_000),
};

interface RunRow {
    uuid: string;
    id: number;
    nether: number | null;
    bastion: number | null;
    fortress: number | null;
    first_structure: number | null;
    second_structure: number | null;
    first_portal: number | null;
    stronghold: number | null;
    end: number | null;
    finish: number | null;
    lastUpdated: Date;
    vodId: string | null;
    twitch: string | null;
}

interface OutboxClaim {
    scope: string;
    entityId: string;
    token: string;
}

const runColumns = `
    uuid, id, nether, bastion, fortress,
    CASE
        WHEN bastion IS NULL AND fortress IS NULL THEN NULL
        WHEN bastion IS NULL THEN fortress
        WHEN fortress IS NULL THEN bastion
        WHEN bastion <= fortress THEN bastion
        ELSE fortress
    END AS first_structure,
    CASE
        WHEN bastion IS NULL OR fortress IS NULL THEN NULL
        WHEN bastion <= fortress THEN fortress
        ELSE bastion
    END AS second_structure,
    first_portal, stronghold, end, finish, lastUpdated, vodId, twitch
`;

function recentFullScanMode(): "primary" | "uuid" {
    return (process.env.RECENT_FULL_SCAN_MODE || "primary").toLowerCase() === "uuid" ? "uuid" : "primary";
}

function csvEncodeRun(run: RunRow): string {
    const updatedAt = run.lastUpdated instanceof Date
        ? run.lastUpdated.getTime()
        : new Date(run.lastUpdated).getTime();
    return [
        run.id, run.nether, run.bastion, run.fortress,
        run.first_structure, run.second_structure,
        run.first_portal, run.stronghold, run.end, run.finish,
        updatedAt, run.vodId, run.twitch,
    ].join(",");
}

async function databaseNow(conn: Connection): Promise<Date> {
    const [rows] = await conn.query("SELECT NOW(3) AS asOf") as any;
    return new Date(rows[0].asOf);
}

async function readOutboxClaims(
    conn: Connection,
    scope: string,
    sqlBatchSize: number,
): Promise<OutboxClaim[]> {
    const claims: OutboxClaim[] = [];
    let lastEntityId: string | null = null;
    while (true) {
        const cursorClause = lastEntityId === null ? "" : "AND entityId > ?";
        const params = lastEntityId === null ? [scope] : [scope, lastEntityId];
        const [rawRows] = await conn.execute(
            `SELECT scope, entityId, token
             FROM cache_invalidation_outbox
             WHERE scope = ? ${cursorClause}
             ORDER BY entityId ASC
             LIMIT ${sqlBatchSize};`,
            params,
        );
        const rows = rawRows as OutboxClaim[];
        claims.push(...rows);
        if (rows.length < sqlBatchSize) break;
        lastEntityId = rows[rows.length - 1].entityId;
    }
    return claims;
}

async function acknowledgeOutboxClaims(
    conn: Connection,
    claims: OutboxClaim[],
    sqlBatchSize: number,
): Promise<void> {
    for (let offset = 0; offset < claims.length; offset += sqlBatchSize) {
        const batch = claims.slice(offset, offset + sqlBatchSize);
        const tuples = batch.map(() => "(?,?,?)").join(",");
        const params = batch.flatMap(({scope, entityId, token}) => [scope, entityId, token]);
        await conn.execute(
            `DELETE FROM cache_invalidation_outbox WHERE (scope, entityId, token) IN (${tuples});`,
            params,
        );
    }
}

async function stageRunEntries(
    redis: Redis,
    entries: Array<[string, string]>,
    generation: string,
    redisBatchSize: number,
    stagingTtlSeconds: number,
): Promise<StagedKey[]> {
    if (entries.length === 0) return [];
    return stageStringEntries(redis, entries, generation, redisBatchSize, stagingTtlSeconds);
}

async function fullRebuildByUuid(
    conn: Connection,
    redis: Redis,
    generation: string,
    maximumId: number,
    sqlBatchSize: number,
    redisBatchSize: number,
    stagingTtlSeconds: number,
    lease: RedisLease,
): Promise<{ staged: StagedKey[]; rowCount: number }> {
    const staged: StagedKey[] = [];
    let pending: Array<[string, string]> = [];
    let currentUuid: string | null = null;
    let currentRuns: string[] = [];
    let lastUuid: string | null = null;
    let lastId = 0;
    let rowCount = 0;
    let nextLogAt = 100_000;

    const flushPlayer = async () => {
        if (currentUuid === null) return;
        // The covering index is (uuid, id) ascending. Scan in that order to
        // avoid a whole-table filesort, then restore the legacy newest-first
        // value shape for readers.
        pending.push([`playerRunsOptimized:${currentUuid}`, currentRuns.reverse().join("\n")]);
        currentUuid = null;
        currentRuns = [];
        if (pending.length >= redisBatchSize) {
            staged.push(...await stageRunEntries(redis, pending, generation, redisBatchSize, stagingTtlSeconds));
            pending = [];
        }
    };

    while (true) {
        lease.assertHeld();
        const where = lastUuid === null
            ? "WHERE id <= ?"
            : "WHERE id <= ? AND (uuid > ? OR (uuid = ? AND id > ?))";
        const params = lastUuid === null
            ? [maximumId]
            : [maximumId, lastUuid, lastUuid, lastId];
        const [rawRows] = await conn.execute(
            `SELECT ${runColumns} FROM pace ${where} ORDER BY uuid ASC, id ASC LIMIT ${sqlBatchSize};`,
            params,
        );
        const rows = rawRows as RunRow[];
        if (rows.length === 0) break;

        for (const row of rows) {
            if (currentUuid !== null && row.uuid !== currentUuid) await flushPlayer();
            if (currentUuid === null) currentUuid = row.uuid;
            currentRuns.push(csvEncodeRun(row));
            rowCount++;
        }
        const last = rows[rows.length - 1];
        lastUuid = last.uuid;
        lastId = last.id;
        if (rowCount >= nextLogAt) {
            console.log(`Staged ${rowCount} run rows so far (through UUID ${lastUuid}).`);
            nextLogAt += 100_000;
        }
        if (rows.length < sqlBatchSize) break;
    }

    await flushPlayer();
    staged.push(...await stageRunEntries(redis, pending, generation, redisBatchSize, stagingTtlSeconds));
    return { staged, rowCount };
}

async function fullRebuildPrimary(
    conn: Connection,
    redis: Redis,
    generation: string,
    maximumId: number,
    sqlBatchSize: number,
    redisBatchSize: number,
    stagingTtlSeconds: number,
    lease: RedisLease,
): Promise<{staged: StagedKey[]; rowCount: number}> {
    const staged: StagedKey[] = [];
    const histories = new Map<string, string[]>();
    let lastId = 0;
    let rowCount = 0;
    let nextLogAt = 100_000;

    while (true) {
        await lease.verifyHeld();
        const [rawRows] = await conn.execute(
            `SELECT ${runColumns}
             FROM pace
             WHERE id > ? AND id <= ?
             ORDER BY id ASC
             LIMIT ${sqlBatchSize};`,
            [lastId, maximumId],
        );
        const rows = rawRows as RunRow[];
        if (rows.length === 0) break;
        for (const row of rows) {
            let history = histories.get(row.uuid);
            if (!history) {
                history = [];
                histories.set(row.uuid, history);
            }
            history.push(csvEncodeRun(row));
            rowCount++;
        }
        lastId = rows[rows.length - 1].id;
        if (rowCount >= nextLogAt) {
            console.log(`Read ${rowCount} run rows so far (through ID ${lastId}).`);
            nextLogAt += 100_000;
        }
        if (rows.length < sqlBatchSize) break;
    }

    let pending: Array<[string, string]> = [];
    for (const [uuid, history] of histories) {
        pending.push([`playerRunsOptimized:${uuid}`, history.reverse().join("\n")]);
        histories.delete(uuid);
        if (pending.length >= redisBatchSize) {
            staged.push(...await stageRunEntries(redis, pending, generation, redisBatchSize, stagingTtlSeconds));
            pending = [];
        }
    }
    staged.push(...await stageRunEntries(redis, pending, generation, redisBatchSize, stagingTtlSeconds));
    return {staged, rowCount};
}

async function fullRebuild(
    conn: Connection,
    redis: Redis,
    generation: string,
    maximumId: number,
    sqlBatchSize: number,
    redisBatchSize: number,
    stagingTtlSeconds: number,
    lease: RedisLease,
): Promise<{staged: StagedKey[]; rowCount: number}> {
    if (recentFullScanMode() === "uuid") {
        return fullRebuildByUuid(
            conn, redis, generation, maximumId, sqlBatchSize, redisBatchSize, stagingTtlSeconds, lease,
        );
    }
    return fullRebuildPrimary(
        conn, redis, generation, maximumId, sqlBatchSize, redisBatchSize, stagingTtlSeconds, lease,
    );
}

async function findChangedUuids(
    conn: Connection,
    since: Date,
    asOf: Date,
    sqlBatchSize: number,
    maximumPlayers: number,
    lease: RedisLease,
): Promise<Set<string>> {
    const uuids = new Set<string>();
    let cursorTime = since;
    let cursorId = 0;

    while (true) {
        lease.assertHeld();
        const [rawRows] = await conn.execute(
            `SELECT id, uuid, lastUpdated
             FROM pace
             WHERE lastUpdated <= ?
               AND (lastUpdated > ? OR (lastUpdated = ? AND id > ?))
             ORDER BY lastUpdated ASC, id ASC
             LIMIT ${sqlBatchSize};`,
            [asOf, cursorTime, cursorTime, cursorId],
        );
        const rows = rawRows as Array<{ id: number; uuid: string; lastUpdated: Date }>;
        if (rows.length === 0) break;
        for (const row of rows) uuids.add(row.uuid);
        if (uuids.size > maximumPlayers) return uuids;
        const last = rows[rows.length - 1];
        cursorTime = new Date(last.lastUpdated);
        cursorId = last.id;
        if (rows.length < sqlBatchSize) break;
    }
    return uuids;
}

async function incrementalRefresh(
    conn: Connection,
    redis: Redis,
    uuids: Set<string>,
    generation: string,
    sqlBatchSize: number,
    redisBatchSize: number,
    uuidBatchSize: number,
    maximumRows: number,
    stagingTtlSeconds: number,
    lease: RedisLease,
): Promise<{ staged: StagedKey[]; rowCount: number; deletedTargets: string[]; exceededWorkBudget: boolean }> {
    const staged: StagedKey[] = [];
    const deletedTargets: string[] = [];
    let pending: Array<[string, string]> = [];
    let rowCount = 0;

    const flushPending = async () => {
        if (pending.length === 0) return;
        staged.push(...await stageRunEntries(redis, pending, generation, redisBatchSize, stagingTtlSeconds));
        pending = [];
    };

    const orderedUuids = [...uuids].sort();
    for (let uuidOffset = 0; uuidOffset < orderedUuids.length; uuidOffset += uuidBatchSize) {
        const batchUuids = orderedUuids.slice(uuidOffset, uuidOffset + uuidBatchSize);
        const placeholders = batchUuids.map(() => "?").join(",");
        const seenUuids = new Set<string>();
        let currentUuid: string | null = null;
        let currentRuns: string[] = [];
        let cursorUuid: string | null = null;
        let cursorId = 0;

        const flushPlayer = async () => {
            if (currentUuid === null) return;
            pending.push([`playerRunsOptimized:${currentUuid}`, currentRuns.reverse().join("\n")]);
            currentUuid = null;
            currentRuns = [];
            if (pending.length >= redisBatchSize) await flushPending();
        };

        while (true) {
            await lease.verifyHeld();
            const cursorClause = cursorUuid === null
                ? ""
                : "AND (uuid > ? OR (uuid = ? AND id > ?))";
            const params = cursorUuid === null
                ? batchUuids
                : [...batchUuids, cursorUuid, cursorUuid, cursorId];
            const [rawRows] = await conn.execute(
                `SELECT ${runColumns}
                 FROM pace
                 WHERE uuid IN (${placeholders}) ${cursorClause}
                 ORDER BY uuid ASC, id ASC
                 LIMIT ${sqlBatchSize};`,
                params,
            );
            const rows = rawRows as RunRow[];
            if (rows.length === 0) break;
            if (rowCount + rows.length > maximumRows) {
                return {staged, rowCount, deletedTargets, exceededWorkBudget: true};
            }
            for (const row of rows) {
                if (currentUuid !== null && row.uuid !== currentUuid) await flushPlayer();
                if (currentUuid === null) currentUuid = row.uuid;
                seenUuids.add(row.uuid);
                currentRuns.push(csvEncodeRun(row));
            }
            rowCount += rows.length;
            const last = rows[rows.length - 1];
            cursorUuid = last.uuid;
            cursorId = last.id;
            if (rows.length < sqlBatchSize) break;
        }
        await flushPlayer();
        for (const uuid of batchUuids) {
            if (!seenUuids.has(uuid)) deletedTargets.push(`playerRunsOptimized:${uuid}`);
        }
    }
    await flushPending();
    return {staged, rowCount, deletedTargets, exceededWorkBudget: false};
}

async function deleteKeys(
    redis: Redis,
    keys: string[],
    batchSize: number,
    lease?: RedisLease,
    manifestKey?: string,
): Promise<void> {
    for (let offset = 0; offset < keys.length; offset += batchSize) {
        const batch = keys.slice(offset, offset + batchSize);
        if (lease) await deleteKeysIfLeaseHeld(redis, batch, lease, manifestKey);
        else if (batch.length > 0) {
            const transaction = redis.multi().del(...batch);
            if (manifestKey) transaction.srem(manifestKey, ...batch);
            assertRedisResults(await transaction.exec(), `deleting ${batch.length} cache entries`);
        }
    }
}

async function claimDirtyUuids(
    redis: Redis,
    dirtyKey: string,
    lease: RedisLease,
): Promise<{ uuids: Set<string>; processingKeys: string[] }> {
    // A single durable processing set avoids a full-keyspace SCAN on every
    // frequent incremental run. The Redis lease guarantees one active claimer;
    // a killed process leaves this set ready for the next run to recover.
    const processingKey = `${dirtyKey}:processing`;
    const claimed = await redis.eval(`
        if redis.call('GET', KEYS[1]) ~= ARGV[1] then
            return redis.error_reply('CACHE_LOCK_LOST')
        end
        if redis.call('EXISTS', KEYS[2]) == 1 then
            redis.call('SUNIONSTORE', KEYS[3], KEYS[3], KEYS[2])
            redis.call('DEL', KEYS[2])
        end
        return redis.call('SMEMBERS', KEYS[3])
    `, 3, lease.key, dirtyKey, processingKey, lease.token);
    lease.assertHeld();
    const uuids = new Set(claimed as string[]);
    return { uuids, processingKeys: uuids.size > 0 ? [processingKey] : [] };
}

async function main(): Promise<void> {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) throw new Error("REDIS_URL is required.");
    const forceFull = process.argv.includes("--full");
    const sqlBatchSize = envInt("RECENT_SQL_BATCH_SIZE", 5_000);
    const outboxBatchSize = envInt("RECENT_OUTBOX_BATCH_SIZE", 500);
    const redisBatchSize = envInt("RECENT_REDIS_BATCH_SIZE", 25);
    const uuidBatchSize = envInt("RECENT_UUID_BATCH_SIZE", 50);
    const manifestBatchSize = envInt("CACHE_MANIFEST_BATCH_SIZE", 1_000);
    const stagingTtlSeconds = envInt("CACHE_STAGING_TTL_SECONDS", 21_600);
    const lockTtlMs = envInt("RECENT_LOCK_TTL_MS", 3_600_000);
    const maximumIncrementalPlayers = envInt("RECENT_INCREMENTAL_MAX_PLAYERS", 1_000);
    const maximumIncrementalRows = envInt("RECENT_INCREMENTAL_MAX_ROWS", 250_000);
    const overlapSeconds = envInt("RECENT_WATERMARK_OVERLAP_SECONDS", 2);
    const configuredTargetTtl = Number.parseInt(process.env.RECENT_CACHE_TTL_SECONDS || "0", 10);
    const targetTtlSeconds = Number.isFinite(configuredTargetTtl) ? Math.max(0, configuredTargetTtl) : 0;
    const generation = `${Date.now()}-${randomUUID()}`;
    const stateKey = "cache:recent:state";
    const manifestKey = "cache:manifest:recent";
    const dirtyKey = "cache:recent:dirty";
    const startedAt = Date.now();
    const phaseTimingsMs: Record<string, number> = {};
    let peakRssBytes = process.memoryUsage().rss;
    const sampleMemory = () => {
        peakRssBytes = Math.max(
            peakRssBytes,
            process.memoryUsage().rss,
            process.resourceUsage().maxRSS * 1_024,
        );
    };

    const redis = new Redis(redisUrl, {
        connectTimeout: envInt("CACHE_REDIS_CONNECT_TIMEOUT_MS", 10_000),
        commandTimeout: envInt("CACHE_REDIS_COMMAND_TIMEOUT_MS", 60_000),
        maxRetriesPerRequest: 3,
    });
    let conn: Connection | null = null;
    let lock: Awaited<ReturnType<typeof acquireRedisLock>> | null = null;
    let claimedDirty = new Set<string>();
    let dirtyProcessingKeys: string[] = [];
    let completed = false;

    try {
        lock = await acquireRedisLock(redis, "cache:lock:recent", lockTtlMs);
        conn = await mysql.createConnection(mysqlConfig);
        const detectionStartedAt = Date.now();
        const asOf = await databaseNow(conn);
        const previousWatermarkRaw = await redis.hget(stateKey, "lastSuccessfulAsOf");
        const previousWatermark = previousWatermarkRaw ? new Date(previousWatermarkRaw) : null;
        const outboxClaims = await readOutboxClaims(conn, "recent", outboxBatchSize);
        let full = forceFull || !previousWatermark || Number.isNaN(previousWatermark.getTime());
        let sourceMaxId: number | null = null;
        let changedUuids = new Set<string>();
        const dirtyClaim = await claimDirtyUuids(redis, dirtyKey, lock);
        const dirtyUuids = dirtyClaim.uuids;
        claimedDirty = dirtyUuids;
        dirtyProcessingKeys = dirtyClaim.processingKeys;

        if (!full) {
            const since = new Date(previousWatermark!.getTime() - overlapSeconds * 1000);
            changedUuids = await findChangedUuids(
                conn, since, asOf, sqlBatchSize, maximumIncrementalPlayers, lock,
            );
            for (const uuid of dirtyUuids) changedUuids.add(uuid);
            for (const claim of outboxClaims) changedUuids.add(claim.entityId);
            if (changedUuids.size > maximumIncrementalPlayers) {
                console.log(
                    `${changedUuids.size} players exceed the incremental threshold; falling back to a full rebuild.`,
                );
                full = true;
            }
        }
        phaseTimingsMs.changeDetection = Date.now() - detectionStartedAt;
        sampleMemory();

        const rebuildStartedAt = Date.now();
        let result: { staged: StagedKey[]; rowCount: number; deletedTargets: string[] };
        if (full) {
            console.log(`Starting full run-history rebuild (${recentFullScanMode()} scan).`);
            const [maximumRows] = await conn.query("SELECT COALESCE(MAX(id), 0) AS maximumId FROM pace") as any;
            sourceMaxId = Number(maximumRows[0].maximumId);
            const fullResult = await fullRebuild(
                conn, redis, generation, sourceMaxId, sqlBatchSize, redisBatchSize, stagingTtlSeconds, lock,
            );
            result = { ...fullResult, deletedTargets: [] };
        } else if (changedUuids.size > 0) {
            console.log(`Refreshing complete histories for ${changedUuids.size} changed players.`);
            const incremental = await incrementalRefresh(
                conn, redis, changedUuids, generation, sqlBatchSize, redisBatchSize,
                uuidBatchSize, maximumIncrementalRows, stagingTtlSeconds, lock,
            );
            if (incremental.exceededWorkBudget) {
                console.log(
                    `Incremental history work exceeded ${maximumIncrementalRows} rows; falling back to a full rebuild.`,
                );
                full = true;
                const [maximumRows] = await conn.query("SELECT COALESCE(MAX(id), 0) AS maximumId FROM pace") as any;
                sourceMaxId = Number(maximumRows[0].maximumId);
                const fullResult = await fullRebuild(
                    conn, redis, generation, sourceMaxId, sqlBatchSize, redisBatchSize, stagingTtlSeconds, lock,
                );
                result = {...fullResult, deletedTargets: []};
            } else {
                result = incremental;
            }
        } else {
            result = { staged: [], rowCount: 0, deletedTargets: [] };
            console.log("No run-history changes found.");
        }
        phaseTimingsMs.rebuild = Date.now() - rebuildStartedAt;
        sampleMemory();

        lock.assertHeld();
        const publishStartedAt = Date.now();
        await publishStagedEntries(
            redis, result.staged, redisBatchSize, targetTtlSeconds, lock, manifestKey,
        );
        const publishedKeys = result.staged.map(({ target }) => target);
        let staleDeleted = 0;
        lock.assertHeld();
        if (full) {
            await lock.verifyHeld();
            const existingKeys = await scanKeys(redis, "playerRunsOptimized:*");
            await lock.verifyHeld();
            staleDeleted = await replaceManifest(
                redis,
                manifestKey,
                publishedKeys,
                redisBatchSize,
                lock,
                existingKeys,
                manifestBatchSize,
            );
        }
        if (!full && result.deletedTargets.length > 0) {
            await deleteKeys(redis, result.deletedTargets, redisBatchSize, lock, manifestKey);
            staleDeleted += result.deletedTargets.length;
        }
        phaseTimingsMs.publish = Date.now() - publishStartedAt;
        sampleMemory();
        lock.assertHeld();
        await setHashIfLeaseHeld(redis, stateKey, {
            generation,
            lastSuccessfulAsOf: asOf.toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: String(Date.now() - startedAt),
            mode: full ? "full" : "incremental",
            fullScanMode: full ? recentFullScanMode() : "",
            changedPlayers: String(full ? publishedKeys.length : changedUuids.size),
            rowsRead: String(result.rowCount),
            sourceMaxId: sourceMaxId === null ? "" : String(sourceMaxId),
            staleKeysDeleted: String(staleDeleted),
            peakRssBytes: String(peakRssBytes),
            phaseTimingsMs: JSON.stringify(phaseTimingsMs),
        }, lock);
        if (dirtyProcessingKeys.length > 0) {
            await deleteKeys(redis, dirtyProcessingKeys, redisBatchSize, lock);
        }
        await acknowledgeOutboxClaims(conn, outboxClaims, outboxBatchSize);
        completed = true;
        console.log(
            `Published ${publishedKeys.length} run-history keys from ${result.rowCount} rows in `
            + `${Date.now() - startedAt}ms (${full ? "full" : "incremental"}).`,
        );
    } finally {
        if (!completed && claimedDirty.size > 0) {
            try {
                const transaction = redis.multi().sadd(dirtyKey, ...claimedDirty);
                if (dirtyProcessingKeys.length > 0) transaction.del(...dirtyProcessingKeys);
                assertRedisResults(await transaction.exec(), "restoring dirty UUID claims");
            } catch (error) {
                console.error("Failed to restore claimed dirty UUIDs:", error);
            }
        }
        if (lock) await lock.release();
        if (conn) {
            try { await conn.end(); } catch (error) { console.error("Failed to close MySQL connection:", error); }
        }
        try { await redis.quit(); } catch { redis.disconnect(); }
    }
}

main().catch((error) => {
    if (error instanceof LockUnavailableError) {
        console.log(error.message);
        return;
    }
    console.error("Recent-run cache refresh failed:", error);
    process.exitCode = 1;
});
