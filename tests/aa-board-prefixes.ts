/** Docker DB14 only: compare bounded AA presentation reads with the full producer board. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import Redis from "ioredis";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {CategoryType, getMinAAQty} from "../app/utils";

process.env.REDIS_URL = "redis://127.0.0.1:6379/14";
const fixture = new Redis(process.env.REDIS_URL), primary = new Redis("redis://127.0.0.1:6379/0");
const key = "aa:leaderboards:9999day";
let created = false;

async function main() {
    assert.equal(await fixture.exists(key), 0);
    const raw = await primary.call("JSON.GET", key, "$");
    assert.ok(raw);
    const board = JSON.parse(String(raw))[0];
    await fixture.call("JSON.SET", key, "$", JSON.stringify(board)); created = true;
    const source = await import(pathToFileURL(resolve(process.env.PERF_SOURCE_ROOT ?? "/app", "app/data.ts")).href);
    const data = source.default ?? source;
    const runtime = globalThis as typeof globalThis & {__paceStatsRedis: Redis};
    const original = runtime.__paceStatsRedis.call.bind(runtime.__paceStatsRedis);
    let responseBytes = 0, reads = 0;
    runtime.__paceStatsRedis.call = (async (command: string, ...args: any[]) => {
        const value = await original(command, ...args);
        if (command === "JSON.GET") {reads++; responseBytes += Buffer.byteLength(String(value ?? ""));}
        return value;
    }) as typeof original;
    try {
        global.gc?.(); const cpu = process.cpuUsage(), heap = process.memoryUsage().heapUsed, started = performance.now();
        const actual = await data.getTrimmedAALB(9_999, 10, false);
        const used = process.cpuUsage(cpu);
        const metrics = {durationMs: performance.now() - started, cpuMs: (used.user + used.system) / 1_000,
            heapDeltaMiB: (process.memoryUsage().heapUsed - heap) / 1_048_576, reads, responseBytes};
        for (const limit of [0, 1, 10, 100]) for (const skip of [false, true]) {
            const expected = Object.fromEntries(Object.entries(board).map(([filter, categories]) => [filter,
                Object.fromEntries(Object.entries(categories as object).map(([category, rows]) => [category,
                    Number(filter) === CategoryType.FASTEST && skip ? [] : (rows as any[]).filter((row) =>
                        ![CategoryType.AVG, CategoryType.CONVERSION].includes(Number(filter)) || row.qty >= getMinAAQty(category, 9_999)).slice(0, limit)]))]));
            assert.deepEqual(await data.getTrimmedAALB(9_999, limit, skip), expected);
        }
        if (!process.env.PERF_SOURCE_ROOT) assert.ok(metrics.responseBytes < Buffer.byteLength(String(raw)) / 2);
        console.log(JSON.stringify({case: "aa-board-prefixes", ...metrics, parityCases: 8,
            sha256: createHash("sha256").update(JSON.stringify(actual)).digest("hex")}));
        await fixture.del(key);
        // The earlier reads must not leave a full root in the local cache.
        if (!process.env.PERF_SOURCE_ROOT) {
            const cold = await data.getTrimmedAALB(9_999, 10, true);
            assert.ok(cold[CategoryType.COUNT].nether.length > 0);
            assert.deepEqual(cold[CategoryType.FASTEST].nether, []);
        }
    } finally {runtime.__paceStatsRedis.call = original;}
}

main().then(() => 0, (error) => {console.error(error); return 1;}).then(async (code) => {
    if (created) await fixture.del(key);
    fixture.disconnect(); primary.disconnect(); process.exit(code);
});
