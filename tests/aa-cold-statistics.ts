/** Docker only: compare the empty-cache web fallback with an independent producer snapshot. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import Redis from "ioredis";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

process.env.REDIS_URL = "redis://127.0.0.1:6379/14";
const fixture = new Redis(process.env.REDIS_URL);
const primary = new Redis("redis://127.0.0.1:6379/0");

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)).digest("hex");

async function main() {
    assert.equal(await fixture.exists("aa:leaderboards:9999day"), 0, "The isolated AA cache must be empty");
    const source = await import(pathToFileURL(resolve(process.env.PERF_SOURCE_ROOT ?? "/app", "app/data.ts")).href);
    const {getAALB} = source.default ?? source;
    global.gc?.();
    const before = process.memoryUsage();
    const cpu = process.cpuUsage();
    const started = performance.now();
    const actual = await getAALB("9999 DAY");
    const used = process.cpuUsage(cpu);
    const metrics = {durationMs: performance.now() - started, cpuMs: (used.user + used.system) / 1_000,
        heapDeltaMiB: (process.memoryUsage().heapUsed - before.heapUsed) / 1_048_576,
        rssDeltaMiB: (process.memoryUsage().rss - before.rss) / 1_048_576};
    const stored = await primary.call("JSON.GET", "aa:leaderboards:9999day", "$");
    assert.ok(stored, "An independent complete-producer AA snapshot is required");
    const expected = JSON.parse(String(stored))[0];
    for (const filter of Object.keys(actual)) {
        for (const category of Object.keys(actual[filter])) {
            const expectedByUuid = new Map(expected[filter][category].map((entry: any) => [entry.uuid, entry]));
            assert.equal(actual[filter][category].length, expectedByUuid.size);
            for (const entry of actual[filter][category]) {
                const reference = expectedByUuid.get(entry.uuid) as any;
                assert.ok(reference, `${filter}/${category}/${entry.uuid} is absent from the independent producer`);
                assert.equal(entry.qty, reference.qty);
                for (const field of ["value", "avg"]) {
                    // RedisJSON can reserialize a float one ULP differently.
                    assert.ok(Math.abs(entry[field] - reference[field]) <= Math.max(1e-8, Math.abs(reference[field]) * Number.EPSILON * 4),
                        `${filter}/${category}/${entry.uuid}/${field}`);
                }
            }
        }
    }
    if (process.env.PERF_COMPARE_SOURCE_ROOT) {
        const comparison = await import(pathToFileURL(resolve(process.env.PERF_COMPARE_SOURCE_ROOT, "app/data.ts")).href);
        const baseline = await (comparison.default ?? comparison).getAALB("9999 DAY");
        assert.equal(digest(actual), digest(baseline), "Every value, name, player order and tie must match the buffered baseline exactly");
    }
    if (!process.env.PERF_SOURCE_ROOT) {
        // Fail the actual row consumer while MySQL still has rows to send.
        // The reader must drain the command before returning its connection.
        const runtime = globalThis as typeof globalThis & {__paceStatsDbPool: any; __paceStatsDbPoolMetrics: {active: number; pending: number}};
        const acquire = runtime.__paceStatsDbPool.getConnection.bind(runtime.__paceStatsDbPool);
        runtime.__paceStatsDbPool.getConnection = async () => {
            const connection = await acquire();
            const core = connection.connection;
            const execute = core.execute.bind(core);
            core.execute = (options: any) => {
                core.execute = execute;
                const command = execute(options);
                if (options.rowsAsArray && options.sql.includes("FROM aa")) {
                    command.prependOnceListener("result", (row: any[]) => {
                        Object.defineProperty(row, 2, {get: () => {throw new Error("Injected AA row consumer failure");}});
                    });
                }
                return command;
            };
            return connection;
        };
        try {
            await assert.rejects(getAALB("9999 DAY"), /Injected AA row consumer failure/);
        } finally {
            runtime.__paceStatsDbPool.getConnection = acquire;
        }
        const [healthy] = await (source.default ?? source).getConn().then((connection: any) => connection.execute("SELECT 42 AS answer;"));
        assert.equal(healthy[0].answer, 42);
        assert.equal(runtime.__paceStatsDbPoolMetrics.active, 0);
        assert.equal(runtime.__paceStatsDbPoolMetrics.pending, 0);
    }
    console.log(JSON.stringify({case: "cold-aa-board-parity", ...metrics, resultBytes: JSON.stringify(actual).length, sha256: digest(actual)}));
}

main().then(() => 0, (error) => {console.error(error); return 1;}).then((code) => {
    fixture.disconnect();
    primary.disconnect();
    process.exit(code);
});
