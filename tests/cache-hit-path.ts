/** Docker only: cache key semantics, undefined entries and the allocation-light hit path. */
import assert from "node:assert/strict";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

async function main() {
    const source = await import(pathToFileURL(resolve(process.env.PERF_SOURCE_ROOT ?? "/app", "app/data.ts")).href);
    const {getCached} = source.default ?? source;
    const runtime = globalThis as typeof globalThis & {__paceStatsCache: any};
    let reads = 0;
    const value = async () => {reads++; return {answer: 42};};
    const groups: unknown[][][] = [
        [[undefined], [null]], [[NaN], [Infinity], [-Infinity], [null]], [[1n], ["1"], [1]],
        [[new Date("2025-01-01")], ["2025-01-01T00:00:00.000Z"]],
        [[{b: 2, a: [undefined, null]}], [{a: [undefined, null], b: 2}]],
        [["30 DAY"], [" 30 days "]], [["name", "alias"], ["name,alias"]],
    ];
    for (const [index, group] of groups.entries()) {
        const results: unknown[] = [];
        for (const args of group) results.push(await getCached(value, `key-parity-${index}`, ...args));
        if ([4, 5].includes(index)) assert.strictEqual(results[0], results[1]);
        else assert.equal(new Set(results).size, group.length);
    }
    let undefinedReads = 0;
    const missing = async () => {undefinedReads++; return undefined;};
    await getCached(missing, "cache-hit-undefined"); await getCached(missing, "cache-hit-undefined");
    assert.equal(undefinedReads, 1);
    let failures = 0;
    const failing = async () => {failures++; throw new Error("fixture");};
    await assert.rejects(getCached(failing, "cache-hit-failure"), /fixture/);
    await assert.rejects(getCached(failing, "cache-hit-failure"), /fixture/);
    assert.equal(failures, 2);
    const args = ["e4cd494a-4e0a-423b-9988-618b86858c96", 30, false];
    await getCached(value, "cache-hit-benchmark", ...args);
    const cache = runtime.__paceStatsCache, get = cache.get.bind(cache), has = cache.has.bind(cache);
    let gets = 0, checks = 0;
    cache.get = (...args: any[]) => {gets++; return get(...args);};
    cache.has = (...args: any[]) => {checks++; return has(...args);};
    global.gc?.(); const cpu = process.cpuUsage(), heap = process.memoryUsage().heapUsed, started = performance.now();
    try {
        for (let index = 0; index < 50_000; index++) assert.equal((await getCached(value, "cache-hit-benchmark", ...args)).answer, 42);
    } finally {cache.get = get; cache.has = has;}
    const used = process.cpuUsage(cpu);
    if (!process.env.PERF_SOURCE_ROOT) {assert.equal(gets, 50_000); assert.equal(checks, 0);}
    console.log(JSON.stringify({case: "cache-hit-path", hits: 50_000, gets, checks, durationMs: performance.now() - started,
        cpuMs: (used.user + used.system) / 1_000, heapDeltaMiB: (process.memoryUsage().heapUsed - heap) / 1_048_576, reads}));
}

main().then(() => process.exit(0), (error) => {console.error(error); process.exit(1);});
