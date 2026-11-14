/** Docker only: compare the real10k export and top-level null-removal contract. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const load = async (root: string) => {
    const source = await import(pathToFileURL(resolve(root, "app/data.ts")).href);
    return source.default ?? source;
};
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function main() {
    const data = await load(process.env.PERF_SOURCE_ROOT ?? "/app");
    await data.getRunsPaginated(100, 1); // Warm pool/bounds/statement, keeping the measured batch cold.
    global.gc?.(); const heap = process.memoryUsage().heapUsed, cpu = process.cpuUsage(), started = performance.now();
    const result = await data.getRunsPaginated(100, 10_000);
    const used = process.cpuUsage(cpu);
    const metrics = {durationMs: performance.now() - started, cpuMs: (used.user + used.system) / 1_000,
        heapDeltaMiB: (process.memoryUsage().heapUsed - heap) / 1_048_576};
    assert.ok(result.runs.length > 9_000);
    assert.ok(result.runs.every((row: any) => Object.values(row).every((value) => value !== null)));
    assert.ok(result.runs.every((row: any, index: number) => index === 0 || row.id < result.runs[index - 1].id));
    if (process.env.PERF_COMPARE_SOURCE_ROOT) {
        const baseline = await load(process.env.PERF_COMPARE_SOURCE_ROOT);
        assert.equal(hash(result), hash(await baseline.getRunsPaginated(100, 10_000)), "Every exported value and field order must remain identical");
    }
    // Verify inherited/symbol/null properties are omitted and falsy values,
    // dates and one getter read retain the existing shallow-copy semantics.
    const pool = (globalThis as typeof globalThis & {__paceStatsDbPool: any}).__paceStatsDbPool;
    const acquire = pool.getConnection.bind(pool);
    const instant = new Date("2026-01-01T00:00:00Z");
    const fixture = Object.assign(Object.create({inherited: "omit"}), {id: 7, missing: null, zero: 0, empty: "", flag: false, time: instant, nested: [null]});
    fixture[Symbol("hidden")] = "omit";
    let reads = 0;
    Object.defineProperty(fixture, "getter", {enumerable: true, get: () => {reads++; return 42;}});
    pool.getConnection = async () => {
        const connection = await acquire(), execute = connection.execute.bind(connection);
        connection.execute = (options: {sql: string}, values: unknown[]) => {
            connection.execute = execute;
            return options.sql.includes("WHERE id >=") ? Promise.resolve([[fixture], []]) : execute(options, values);
        };
        return connection;
    };
    try {
        const fake = await data.getRunsPaginated(100, 1);
        assert.deepEqual(fake.runs, [{id: 7, zero: 0, empty: "", flag: false, time: instant, nested: [null], getter: 42}]);
        assert.equal(reads, 1);
    } finally {pool.getConnection = acquire;}
    console.log(JSON.stringify({case: "export-row-processing", rows: result.runs.length, ...metrics, sha256: hash(result)}));
}

main().then(() => process.exit(0), (error) => {console.error(error); process.exit(1);});
