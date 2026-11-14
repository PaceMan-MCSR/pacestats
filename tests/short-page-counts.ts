/** Docker only: infer exact short-page totals and retain out-of-range count semantics. */
import assert from "node:assert/strict";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

async function main() {
    const source = await import(pathToFileURL(resolve(process.env.PERF_SOURCE_ROOT ?? "/app", "app/data.ts")).href);
    const data = source.default ?? source, connection = await data.getConn();
    const [players] = await connection.execute(`SELECT uuid, COUNT(*) AS total FROM pace GROUP BY uuid HAVING total BETWEEN 1 AND 24 LIMIT 10;`);
    assert.equal(players.length, 10);
    const pool = (globalThis as typeof globalThis & {__paceStatsDbPool: any}).__paceStatsDbPool;
    const acquire = pool.getConnection.bind(pool);
    let reads = 0, counts = 0;
    pool.getConnection = async () => {
        const connection = await acquire(), execute = connection.execute.bind(connection);
        connection.execute = async (options: {sql: string}, values: unknown[]) => {
            connection.execute = execute;
            if (options.sql.includes("FROM pace")) {reads++; if (options.sql.includes("COUNT(*)")) counts++;}
            return execute(options, values);
        };
        return connection;
    };
    try {
        const started = performance.now();
        for (const player of players) {
            const result = await data.getPlayerRunsOffsetPage(player.uuid);
            assert.equal(result.rows.length, Number(player.total));
            assert.equal(result.rowCount, Number(player.total));
        }
        const metrics = {durationMs: performance.now() - started, reads, counts};
        if (!process.env.PERF_SOURCE_ROOT) {assert.equal(reads, 10); assert.equal(counts, 0);}
        const uuid = "e4cd494a-4e0a-423b-9988-618b86858c96";
        const [[reference]] = await connection.execute("SELECT COUNT(*) AS total FROM pace WHERE uuid=?", [uuid]);
        const total = Number(reference.total);
        for (const page of [0, Math.floor(total / 25), Math.ceil(total / 25), 1_000_000]) {
            const actual = await data.getPlayerRunsOffsetPage(uuid, page);
            assert.equal(actual.rowCount, total);
            assert.equal(actual.rows.length, Math.max(0, Math.min(25, total - page * 25)));
        }
        const empty = await data.getPlayerRunsOffsetPage("no-such-player");
        assert.deepEqual(empty, {rows: [], rowCount: 0});
        console.log(JSON.stringify({case: "short-page-counts", players: players.length, ...metrics, boundaryCases: 5}));
    } finally {pool.getConnection = acquire;}
}

main().then(() => process.exit(0), (error) => {console.error(error); process.exit(1);});
