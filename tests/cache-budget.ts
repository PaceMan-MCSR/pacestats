/** Docker only: exercise retention limits without touching external caches. */
import assert from "node:assert/strict";

process.env.DATA_CACHE_MAX_ARRAY_ROWS = "1000";
process.env.DATA_CACHE_MAX_TOTAL_ROWS = "1000";

async function main() {
    const {getCached} = await import("../app/data");
    const runtime = globalThis as typeof globalThis & {
        __paceStatsCacheRows: number;
        __paceStatsCache: {flushAll: () => void; keys: () => string[]};
    };
    let aReads = 0, bReads = 0, nestedReads = 0;
    const a = async () => {aReads++; return Array.from({length: 600}, (_, id) => ({id}));};
    const b = async () => {bReads++; return {rows: Array.from({length: 600}, (_, id) => ({id})), rowCount: 600};};
    await getCached(a, "budget-a");
    assert.equal(runtime.__paceStatsCacheRows, 600);
    await getCached(b, "budget-b");
    assert.equal(runtime.__paceStatsCacheRows, 600);
    assert.ok(!runtime.__paceStatsCache.keys().includes('["budget-a"]'));
    await getCached(b, "budget-b");
    assert.equal(bReads, 1);
    await getCached(a, "budget-a");
    assert.equal(aReads, 2);
    const nested = async () => {nestedReads++; return {first: {rows: new Array(600).fill(null)}, second: {rows: new Array(600).fill(null)}};};
    await getCached(nested, "budget-nested");
    await getCached(nested, "budget-nested");
    assert.equal(nestedReads, 2, "An oversized nested board must not bypass the entry limit");
    assert.equal(runtime.__paceStatsCacheRows, 600);
    runtime.__paceStatsCache.flushAll();
    assert.equal(runtime.__paceStatsCacheRows, 0);
    let concurrentReads = 0;
    const once = async () => {concurrentReads++; return {rows: new Array(20).fill(null)};};
    await Promise.all(Array.from({length: 20}, () => getCached(once, "budget-deduped")));
    assert.equal(concurrentReads, 1);
    assert.equal(runtime.__paceStatsCacheRows, 20);
    console.log("Cache budget: nested entries, total-row LRU eviction, reuse, flush and concurrent deduplication passed");
}

main().then(() => process.exit(0), (error) => {console.error(error); process.exit(1);});
