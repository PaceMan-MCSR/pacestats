/** Docker DB14 only: compact-board recovery must match all independent prefixes. */
import assert from "node:assert/strict";
import Redis from "ioredis";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {CategoryType, getMinQty} from "../app/utils";

process.env.REDIS_URL = "redis://127.0.0.1:6379/14";
const fixture = new Redis(process.env.REDIS_URL);
const keys = ["leaderboards:9999day", "fastestLeaderboards:9999day"];
const created: string[] = [];
const categories = ["nether", "bastion", "first_structure", "second_structure", "fortress", "first_portal", "second_portal", "stronghold", "end", "finish"];
const filters = [CategoryType.COUNT, CategoryType.AVG, CategoryType.FASTEST, CategoryType.CONVERSION];

async function main() {
    for (const key of [...keys, "topLeaderboards:9999day"]) assert.equal(await fixture.exists(key), 0);
    const board = Object.fromEntries(filters.map((filter) => [filter, Object.fromEntries(categories.map((category) => [category,
        Array.from({length: category === "finish" ? 3 : 380}, (_, index) => ({uuid: `fixture-${index}`, name: `Player${index}`,
            value: filter === CategoryType.COUNT ? 1_000 - index : index + 1, qty: index < 300 ? 1 : 1_000, avg: index + 5}))]))]));
    const fastest = Object.fromEntries(categories.map((category) => [category, board[CategoryType.FASTEST][category].slice(0, 10)
        .map((row, index) => ({uuid: row.uuid, value: row.value, runId: index + 100}))]));
    for (const [index, value] of [board, fastest].entries()) {
        await fixture.call("JSON.SET", keys[index], "$", JSON.stringify(value)); created.push(keys[index]);
    }
    const source = await import(pathToFileURL(resolve(process.env.PERF_SOURCE_ROOT ?? "/app", "app/data.ts")).href);
    const data = source.default ?? source;
    const runtime = globalThis as typeof globalThis & {__paceStatsRedis: Redis};
    const original = runtime.__paceStatsRedis.call.bind(runtime.__paceStatsRedis);
    let reads = 0, responseBytes = 0;
    runtime.__paceStatsRedis.call = (async (command: string, ...args: any[]) => {
        const value = await original(command, ...args);
        if (command === "JSON.GET") {reads++; responseBytes += Buffer.byteLength(String(value ?? ""));}
        return value;
    }) as typeof original;
    try {
        const started = performance.now();
        const actual = await data.getTrimmedLeaderboards(9_999);
        const durationMs = performance.now() - started;
        const expected = Object.fromEntries(filters.map((filter) => [filter, Object.fromEntries(categories.map((category) => [category,
            board[filter][category].filter((row) => ![CategoryType.AVG, CategoryType.CONVERSION].includes(filter) || row.qty >= getMinQty(category, 9_999)).slice(0, 10)]))]));
        for (const category of categories) expected[CategoryType.FASTEST][category] = fastest[category].map((row, index) => ({...board[CategoryType.FASTEST][category][index], ...row}));
        assert.deepEqual(actual, expected);
        if (!process.env.PERF_SOURCE_ROOT) assert.ok(reads <= 7, `Expected bounded batched reads, received ${reads}`);
        console.log(JSON.stringify({case: "compact-board-recovery", reads, responseBytes, durationMs}));
        await fixture.del(keys[1]);
        const noCompanion = await data.getTrimmedLeaderboards(9_999);
        assert.deepEqual(noCompanion[CategoryType.FASTEST], board[CategoryType.FASTEST] && Object.fromEntries(categories.map((category) => [category, board[CategoryType.FASTEST][category].slice(0, 10)])));
        await fixture.del(keys[0]);
        await assert.rejects(data.getTrimmedLeaderboards(9_999), {code: "CACHE_NOT_READY"});
    } finally {runtime.__paceStatsRedis.call = original;}
}

main().then(() => 0, (error) => {console.error(error); return 1;}).then(async (code) => {
    if (created.length > 0) await fixture.del(...created);
    fixture.disconnect(); process.exit(code);
});
