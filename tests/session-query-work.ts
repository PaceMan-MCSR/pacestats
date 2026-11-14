/** Docker only: compare session output and actual SQL transfer against a frozen source. */
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
    const uuid = "e4cd494a-4e0a-423b-9988-618b86858c96", hours = 9_999 * 24;
    await (await data.getConn()).execute("SELECT 1;");
    const runtime = globalThis as typeof globalThis & {__paceStatsDbPool: any};
    const pool = runtime.__paceStatsDbPool, acquire = pool.getConnection.bind(pool);
    const transfers: {kind: string; columns: number; rows: number; bytes: number}[] = [];
    pool.getConnection = async () => {
        const connection = await acquire(), execute = connection.execute.bind(connection);
        connection.execute = async (options: {sql: string}, values: unknown[]) => {
            connection.execute = execute;
            const result = await execute(options, values);
            if (options.sql.includes("obtainRod") || options.sql.includes("wallTime")) {
                transfers.push({kind: options.sql.includes("wallTime") ? "nph" : "splits", columns: result[1].length,
                    rows: result[0].length, bytes: Buffer.byteLength(JSON.stringify(result[0]))});
            }
            return result;
        };
        return connection;
    };
    global.gc?.(); const cpu = process.cpuUsage(), started = performance.now();
    let result;
    try {
        result = [await data.getSessionStats(uuid, hours, hours), await data.getNPH(uuid, hours, hours, false)];
    } finally {pool.getConnection = acquire;}
    const used = process.cpuUsage(cpu), durationMs = performance.now() - started;
    if (!process.env.PERF_SOURCE_ROOT) {
        assert.ok(transfers.filter((row) => row.kind === "splits").every((row) => row.columns === 10));
        assert.ok(transfers.filter((row) => row.kind === "nph").every((row) => row.columns === 7));
        assert.equal(transfers.length, 2, "An unbroken long window must read each source once");
        assert.ok(transfers.every((row) => row.rows === 10_001), "Keep one sentinel row outside the aggregate cap");
    }
    if (process.env.PERF_COMPARE_SOURCE_ROOT) {
        const baseline = await load(process.env.PERF_COMPARE_SOURCE_ROOT);
        assert.equal(hash(result), hash([await baseline.getSessionStats(uuid, hours, hours), await baseline.getNPH(uuid, hours, hours, false)]));
        for (const [window, gap, live] of [[24, 6, false], [hours, 6, false], [hours, 0, true]] as const) {
            assert.deepEqual(await data.getSessionStats(uuid, window, gap), await baseline.getSessionStats(uuid, window, gap));
            assert.deepEqual(await data.getNPH(uuid, window, gap, live), await baseline.getNPH(uuid, window, gap, live));
        }
    }
    console.log(JSON.stringify({case: "session-query-work", durationMs, cpuMs: (used.user + used.system) / 1_000,
        transfers, totalBytes: transfers.reduce((sum, row) => sum + row.bytes, 0), sha256: hash(result)}));
}

main().then(() => process.exit(0), (error) => {console.error(error); process.exit(1);});
