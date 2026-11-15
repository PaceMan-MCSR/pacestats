/** Read-only Docker coverage for exact AA profile ranks and projected Redis reads. */
import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {mkdir, writeFile} from "node:fs/promises";
import {dirname} from "node:path";
import Redis from "ioredis";
import type NodeCache from "node-cache";
import type {Pool} from "mysql2/promise";
import {CategoryType, getMinAAQty} from "../app/utils";
import {
    AAPlayerStatProjectionError, aaPlayerStatBranches, aaPlayerStatCategories, aaPlayerStatsFromLeaderboard,
    aaPlayerStatsFromProjection, parseAAPlayerStatProjection,
} from "../app/aa/playerStats";

assert.ok(existsSync("/.dockerenv"), "Run in the local Docker environment");
process.env.REDIS_URL = "redis://127.0.0.1:6379/15";
const primary = new Redis("redis://127.0.0.1:6379/0");
type Board = Record<number, Record<string, Array<{uuid: string; qty: number; value: number}>>>;

// Frozen profile implementation: ordering and eligibility apply to all filters.
function legacyStats(lb: Board, uuid: string, days: number) {
    const filters = [CategoryType.AVG, CategoryType.COUNT, CategoryType.FASTEST, CategoryType.CONVERSION];
    const data: Record<string, Record<number, {ranking: number; value: number}>> = {};
    for (const category of aaPlayerStatCategories) data[category] = {};
    for (const filter of filters) {
        for (const category of aaPlayerStatCategories) {
            const minQty = getMinAAQty(category, days);
            const board = lb[filter][category];
            let i = 0;
            for (const entry of board) {
                if (entry.qty === 0) continue;
                if (entry.qty < minQty && entry.uuid !== uuid) continue;
                i++;
                if (entry.uuid === uuid) {
                    data[category][filter] = {ranking: entry.qty < minQty ? -1 : i, value: entry.value};
                    break;
                }
            }
        }
    }
    return data;
}

function syntheticProjection(lb: Board) {
    return Object.fromEntries(aaPlayerStatBranches.map(({filter, category, path}) => [path,
        lb[filter][category].flatMap(entry => [entry.uuid, entry.qty, entry.value])
    ]));
}

async function main() {
    const data = await import("../app/data");
    const runtime = globalThis as typeof globalThis & {
        __paceStatsRedis: Redis; __paceStatsCache: NodeCache; __paceStatsDbPool: Pool;
    };
    const redis = runtime.__paceStatsRedis, cache = runtime.__paceStatsCache;
    assert.equal(await redis.dbsize(), 0, "Reserved Redis 15 must start empty");
    const originalPipeline = redis.pipeline.bind(redis);
    const originalCall = redis.call.bind(redis);
    const originalAcquire = runtime.__paceStatsDbPool.getConnection.bind(runtime.__paceStatsDbPool);
    const originalError = console.error;
    let pipelines = 0, failureMessages = 0;
    console.error = (...args: unknown[]) => {
        if (String(args[0]).startsWith("Unable to read AA player statistics projection")) failureMessages++;
        else originalError(...args);
    };
    // Real RedisJSON reads remain entirely on the primary read-only documents.
    redis.pipeline = (() => {
        pipelines++;
        return primary.pipeline();
    }) as Redis["pipeline"];
    const results: unknown[] = [];
    let reference: Board | undefined;
    let referenceUuid = "";
    try {
        for (const days of [1, 7, 30, 9999]) {
            cache.flushAll();
            const raw = await primary.call("JSON.GET", `aa:leaderboards:${days}day`, "$");
            assert.ok(raw, "The independent generated local AA board is required");
            const lb: Board = JSON.parse(String(raw))[0];
            const ids = [...new Set(Object.values(lb).flatMap(Object.values).flat().map(entry => entry.uuid)), "unknown-player"];
            const before = pipelines;
            for (const uuid of ids) {
                const actual = await data.getAAPlayerStats(uuid, days);
                assert.deepEqual(actual, legacyStats(lb, uuid, days), `${days}/${uuid}`);
            }
            assert.equal(pipelines - before, 1, "Every player in a period shares one cached scalar projection");
            const ttl = cache.getTtl(`["readAAPlayerStatProjection",${days}]`)! - Date.now();
            assert.ok(ttl > 590_000 && ttl <= 600_000, "The original ten-minute board freshness limit remains");
            assert.equal(cache.get(`["getAALB","${days} day"]`), undefined, "The full public board is not loaded by a profile");
            if (days === 30) {
                const branch = aaPlayerStatBranches.find(({filter}) => filter === CategoryType.AVG)!;
                const row = lb[branch.filter][branch.category][0];
                assert.notEqual(row.qty, row.value, "The real average board distinguishes selector field order");
                assert.ok(Object.keys(row).indexOf("value") < Object.keys(row).indexOf("qty"),
                    "The source object's insertion order differs from requested uuid/qty/value order");
                const projection = cache.get<Record<string, unknown[]>>('["readAAPlayerStatProjection",30]')!;
                assert.deepEqual(projection[branch.path][0], [row.uuid, row.qty, row.value],
                    "RedisJSON honors selector order instead of stored property order");
                for (const fields of [["uuid", "qty", "value"], ["uuid", "value", "qty"], ["qty", "uuid", "value"],
                    ["qty", "value", "uuid"], ["value", "uuid", "qty"], ["value", "qty", "uuid"]]) {
                    const selected = await primary.call("JSON.GET", "aa:leaderboards:30day",
                        `$.${branch.filter}.${branch.category}[0:1][${fields.map(field => JSON.stringify(field)).join(",")}]`);
                    assert.deepEqual(JSON.parse(String(selected)), fields.map(field => row[field as keyof typeof row]),
                        "All property-selector permutations retain their requested order on the real RedisJSON document");
                }
            }
            results.push({days, profiles: ids.length, projectionPipelines: pipelines - before});
            if (days === 30) {
                reference = lb;
                referenceUuid = ids.find(uuid => uuid !== "unknown-player")!;
            }
        }
        assert.ok(reference && referenceUuid);

        // Same values and quantities deliberately retain source tie ordering.
        const tied: Board = Object.fromEntries([0, 1, 2, 3].map(filter => [filter,
            Object.fromEntries(aaPlayerStatCategories.map(category => [category, [
                {uuid: "zero", qty: 0, value: 0},
                {uuid: "small", qty: Math.max(1, getMinAAQty(category, 30) - 1), value: 22},
                {uuid: "tie-b", qty: 100, value: 42},
                {uuid: "tie-a", qty: 100, value: 42},
                {uuid: "second-b", qty: 50, value: 42},
                {uuid: "zero", qty: 50, value: 42},
            ]]))
        ]));
        const projected = syntheticProjection(tied);
        const counts = aaPlayerStatBranches.map(({filter, category}) => tied[filter][category].length);
        const parsed = parseAAPlayerStatProjection(JSON.stringify(projected), counts);
        for (const uuid of ["zero", "small", "tie-b", "tie-a", "second-b", "absent"]) {
            assert.deepEqual(aaPlayerStatsFromProjection(parsed, uuid, 30), legacyStats(tied, uuid, 30));
            assert.deepEqual(aaPlayerStatsFromLeaderboard(tied, uuid, 30), legacyStats(tied, uuid, 30));
        }
        for (const missing of [0, 1, 2]) {
            const malformed = structuredClone(projected);
            malformed[aaPlayerStatBranches[0].path].splice(missing, 1);
            assert.throws(() => parseAAPlayerStatProjection(JSON.stringify(malformed), counts), /Incomplete AA/);
        }
        const missingEntireRow = structuredClone(projected);
        missingEntireRow[aaPlayerStatBranches[0].path].splice(0, 3);
        assert.throws(() => parseAAPlayerStatProjection(JSON.stringify(missingEntireRow), counts), /Incomplete AA/);
        assert.throws(() => parseAAPlayerStatProjection(JSON.stringify(projected), [...counts, 0]), /Incomplete AA/);
        assert.throws(() => parseAAPlayerStatProjection(JSON.stringify(projected), counts.map(() => null)), /Incomplete AA/);
        assert.throws(() => parseAAPlayerStatProjection("not-json", counts), AAPlayerStatProjectionError);

        // 12,800 Entry rows were cacheable before this change. Their 38,400
        // scalar fields must not accidentally count as three times the rows.
        const largeProjection = Object.fromEntries(aaPlayerStatBranches.map(({path}) => [path,
            Array.from({length: 400}, (_, index) => [`large-${index}`, 100, 42]).flat()
        ]));
        cache.flushAll();
        let largePipelines = 0;
        redis.pipeline = (() => ({
            call() {return this;},
            async exec() {
                largePipelines++;
                return [[null, JSON.stringify(largeProjection)], [null, aaPlayerStatBranches.map(() => 400)]];
            },
        })) as unknown as Redis["pipeline"];
        const largeResult = await data.getAAPlayerStats("large-99", 30);
        assert.equal(largeResult.nether[CategoryType.COUNT].ranking, 100);
        assert.deepEqual(await data.getAAPlayerStats("large-99", 30), largeResult);
        assert.equal(largePipelines, 1, "12,800 rows keep their previous cache coverage");
        assert.equal(cache.get<unknown[]>('["readAAPlayerStatProjection",30]') !== undefined, true);

        // A complete board is preferred even when it is near expiration. This
        // prevents each subsequent profile from probing an unavailable Redis.
        const fallbackKey = '["getAALB","30 day"]';
        const expected = legacyStats(reference, referenceUuid, 30);
        cache.flushAll();
        cache.set(fallbackKey, reference, 1);
        const expires = cache.getTtl(fallbackKey);
        let unexpectedPipelines = 0;
        redis.pipeline = (() => {unexpectedPipelines++; throw new Error("The existing full board must bypass Redis");}) as Redis["pipeline"];
        assert.deepEqual(await data.getAAPlayerStats(referenceUuid, 30), expected);
        assert.equal(cache.getTtl(fallbackKey), expires, "A near-expired complete board keeps its original expiration");
        assert.equal(unexpectedPipelines, 0);

        // An in-flight public getAALB read is shared too, including differently
        // cased interval spellings that normalize to the same cache key.
        cache.flushAll();
        let releaseBoard!: (board: Board) => void;
        let completeLoads = 0;
        const pendingFull = data.getCached(async () => {
            completeLoads++;
            return new Promise<Board>(resolve => {releaseBoard = resolve;});
        }, "getAALB", "30 day");
        const pendingProfile = data.getAAPlayerStats(referenceUuid, 30);
        await Promise.resolve();
        releaseBoard(reference);
        await pendingFull;
        assert.deepEqual(await pendingProfile, expected);
        assert.equal(completeLoads, 1);
        assert.equal(unexpectedPipelines, 0);

        // A malformed legacy projection requires exactly one complete-root
        // compatibility read; later profiles use its original full-board TTL.
        cache.flushAll();
        let malformedPipelines = 0, compatibilityReads = 0;
        redis.pipeline = (() => ({
            call() {return this;},
            async exec() {
                malformedPipelines++;
                return [[null, JSON.stringify(missingEntireRow)], [null, counts]];
            },
        })) as unknown as Redis["pipeline"];
        redis.call = (async (...args: unknown[]) => {
            assert.deepEqual(args, ["JSON.GET", "aa:leaderboards:30day", "$"]);
            compatibilityReads++;
            return JSON.stringify([reference]);
        }) as Redis["call"];
        assert.deepEqual(await data.getAAPlayerStats(referenceUuid, 30), expected);
        const compatibilityExpires = cache.getTtl(fallbackKey);
        assert.deepEqual(await data.getAAPlayerStats(referenceUuid, 30), expected);
        assert.equal(compatibilityReads, 1);
        assert.equal(malformedPipelines, 1);
        assert.equal(cache.getTtl(fallbackKey), compatibilityExpires);
        assert.equal(cache.get('["readAAPlayerStatProjection",30]'), undefined);

        // I/O errors, rejected pipelines and missing documents go directly to
        // the existing SQL implementation. They must not incur a second Redis
        // command timeout, or another probe on the next profile.
        let forbiddenRootReads = 0;
        redis.call = (async () => {forbiddenRootReads++; throw new Error("Unexpected Redis fallback retry");}) as Redis["call"];
        const outageResults: unknown[] = [];
        for (const mode of ["missing", "command-error", "pipeline-reject"] as const) {
            cache.flushAll();
            let outagePipelines = 0, checkouts = 0;
            runtime.__paceStatsDbPool.getConnection = async () => {checkouts++; return originalAcquire();};
            redis.pipeline = (() => ({
                call() {return this;},
                async exec() {
                    outagePipelines++;
                    if (mode === "missing") return [[null, null], [null, null]];
                    if (mode === "command-error") return [[new Error("Injected Redis projection failure"), null], [null, counts]];
                    throw new Error("Injected pipeline rejection");
                },
            })) as unknown as Redis["pipeline"];
            const actual = await data.getAAPlayerStats(referenceUuid, 30);
            const fullSqlBoard = cache.get<Board>(fallbackKey)!;
            assert.ok(fullSqlBoard, "The direct SQL result uses the existing getAALB cache key");
            assert.deepEqual(actual, legacyStats(fullSqlBoard, referenceUuid, 30));
            const outageExpires = cache.getTtl(fallbackKey);
            assert.ok(outageExpires! - Date.now() > 590_000);
            assert.deepEqual(await data.getAAPlayerStats(referenceUuid, 30), actual);
            assert.equal(cache.getTtl(fallbackKey), outageExpires);
            assert.equal(outagePipelines, 1);
            assert.equal(checkouts, 1, "One SQL fallback serves both profiles");
            assert.equal(forbiddenRootReads, 0, "No second Redis read occurs before SQL");
            assert.equal(cache.get('["readAAPlayerStatProjection",30]'), undefined);
            outageResults.push({mode, projectionPipelines: outagePipelines, redisRootReads: forbiddenRootReads, sqlCheckouts: checkouts});
        }
        assert.equal(failureMessages, 3);

        // The true empty-cache route retains the existing read-only SQL path.
        cache.flushAll();
        redis.pipeline = originalPipeline;
        redis.call = originalCall;
        runtime.__paceStatsDbPool.getConnection = originalAcquire;
        const legacySql = await data.getCached(data.getAALB, "getAALB", "9999 DAY");
        const actualSql = await data.getAAPlayerStats(referenceUuid, 9999);
        assert.deepEqual(actualSql, legacyStats(legacySql, referenceUuid, 9999));
        assert.equal(cache.get('["readAAPlayerStatProjection",9999]'), undefined);
        assert.equal(await redis.dbsize(), 0, "The fixture performs no Redis writes");
        const output = process.env.PERF_OUTPUT ?? "/app/test-artifacts/performance/cold-round/aa-player-stats.json";
        await mkdir(dirname(output), {recursive: true});
        await writeFile(output, JSON.stringify({periods: results, syntheticTieProfiles: 6,
            malformedProperties: 3, completelyMissingRow: true, cacheableRows: 12_800,
            fallbackCases: 7, outageResults, fullBoardInflightLoads: completeLoads, nearExpiredBoardRedisReads: unexpectedPipelines,
            reservedRedisKeys: 0}, null, 2));
        console.log(JSON.stringify({periods: results, fallbackCases: 7, outageResults, reservedRedisKeys: 0}));
    } finally {
        redis.pipeline = originalPipeline;
        redis.call = originalCall;
        runtime.__paceStatsDbPool.getConnection = originalAcquire;
        console.error = originalError;
        primary.disconnect();
        redis.disconnect();
        cache.close();
        await runtime.__paceStatsDbPool.end();
    }
}

main().catch(error => {console.error(error); process.exitCode = 1; primary.disconnect();});
