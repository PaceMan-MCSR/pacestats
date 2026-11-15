/** Docker only: count real typed buffers for empty and populated SQL profile/NPH fallbacks. */
import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {mkdir, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import type NodeCache from "node-cache";
import type Redis from "ioredis";

assert.ok(existsSync("/.dockerenv"), "Run in the local Docker environment");
process.env.REDIS_URL = "redis://127.0.0.1:6379/15";

async function main() {
    const data = await import("../app/data");
    const baselinePath = resolve(process.env.PERF_COMPARE_SOURCE_ROOT ?? "/tmp/pacestats-cold2-baseline", "app/data.ts");
    const imported = await import(pathToFileURL(baselinePath).href);
    const legacy = imported.default ?? imported;
    const runtime = globalThis as typeof globalThis & {__paceStatsCache: NodeCache; __paceStatsRedis: Redis};
    assert.equal(await runtime.__paceStatsRedis.dbsize(), 0, "Reserved Redis 15 must remain empty");
    const uuid = "e4cd494a-4e0a-423b-9988-618b86858c96";
    const [counts] = await (await data.getConn()).execute<any[]>(
        `SELECT (SELECT COUNT(*) FROM pace WHERE uuid=? AND insertTime >= NOW() - INTERVAL 1 DAY) AS pace,
                (SELECT COUNT(*) FROM nethers WHERE uuid=? AND insertTime >= NOW() - INTERVAL 1 DAY) AS nethers;`, [uuid, uuid]
    );
    assert.deepEqual(counts[0], {pace: 0, nethers: 0}, "The local fixture supplies a real player's empty one-day windows");
    const original = globalThis.Float64Array;
    const measure = async (work: () => Promise<unknown>) => {
        runtime.__paceStatsCache.flushAll();
        const capacities: number[] = [];
        globalThis.Float64Array = new Proxy(original, {
            construct(target, args, newTarget) {
                const value = Reflect.construct(target, args, newTarget) as Float64Array;
                capacities.push(value.length);
                return value;
            },
        });
        try {
            const result = await work();
            return {result, capacities, allocatedBytes: capacities.reduce((total, length) => total + length * 8, 0)};
        } finally {globalThis.Float64Array = original;}
    };
    const results: {case: string; legacyBuffers: number; optimizedBuffers: number; legacyBytes: number; optimizedBytes: number}[] = [];
    for (const days of [1, 9_999]) {
        for (const kind of ["profile", "nph"] as const) {
            if (days > 1) {
                // The shared synchronous trim heap grows once per process;
                // prime it for both variants before comparing series buffers.
                for (const source of [legacy, data]) {
                    runtime.__paceStatsCache.flushAll();
                    if (kind === "profile") await source.fetchPlayerStatsFromRedis(uuid, days);
                    else await source.fetchNphFromRedis(uuid, days);
                }
            }
            const before = await measure(() => kind === "profile"
                ? legacy.fetchPlayerStatsFromRedis(uuid, days) : legacy.fetchNphFromRedis(uuid, days));
            const after = await measure(() => kind === "profile"
                ? data.fetchPlayerStatsFromRedis(uuid, days) : data.fetchNphFromRedis(uuid, days));
            assert.deepEqual(after.result, before.result, `${kind}/${days} public values stay identical`);
            if (days === 1) {
                assert.equal(before.capacities.filter(length => length === 1_024).length, kind === "profile" ? 10 : 1);
                assert.equal(after.capacities.length, 0, "An empty series allocates no per-request numeric buffer");
            } else {
                assert.ok(before.capacities.some(length => length > 1_024), "The lifetime fixture exercises typed growth");
                assert.deepEqual(after.capacities, before.capacities,
                    "Populated series retain the same first capacity and every growth allocation");
            }
            results.push({case: `${kind}/${days}`, legacyBuffers: before.capacities.length,
                optimizedBuffers: after.capacities.length, legacyBytes: before.allocatedBytes, optimizedBytes: after.allocatedBytes});
        }
    }
    assert.equal(await runtime.__paceStatsRedis.dbsize(), 0);
    const output = process.env.PERF_OUTPUT ?? "/app/test-artifacts/performance/cold2/time-series-allocation.json";
    await mkdir(dirname(output), {recursive: true});
    await writeFile(output, JSON.stringify({results, fixtureRedisKeys: 0,
        method: "Intercept actual Float64Array construction during independent old/current read-only SQL fallbacks; equal public values and populated growth sequence. Counts transient typed allocation, not retained heap/RSS or page latency."}, null, 2));
    console.log(JSON.stringify({case: "cold-time-series-allocation", results, output}));
}

main().then(() => process.exit(0), error => {console.error(error); process.exit(1);});
