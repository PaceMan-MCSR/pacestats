/** Docker only: legacy session routes preserve their uncapped public response. */
import assert from "node:assert/strict";
import {NextRequest} from "next/server";
import {getConn} from "../app/data";

async function main() {
    await (await getConn()).execute("SELECT 1;");
    const runtime = globalThis as typeof globalThis & {__paceStatsDbPool: any};
    const acquire = runtime.__paceStatsDbPool.getConnection.bind(runtime.__paceStatsDbPool);
    const transfers: {endpoint: string; rows: number; columns: number}[] = [];
    let endpoint = "";
    runtime.__paceStatsDbPool.getConnection = async () => {
        const connection = await acquire(), execute = connection.execute.bind(connection);
        connection.execute = async (options: {sql: string}, values: unknown[]) => {
            connection.execute = execute;
            const result = await execute(options, values);
            if (options.sql.includes("INTERVAL ? DAY") && options.sql.includes("ORDER BY insertTime DESC")) {
                transfers.push({endpoint, rows: result[0].length, columns: result[1].length});
            }
            return result;
        };
        return connection;
    };
    try {
        for (endpoint of ["getSplitStats", "getSessionNethers"]) {
            const {GET} = await import(`../app/api/${endpoint}/route`);
            const query = "name=NoFearr1337&hours=9999999&hoursBetween=9999999";
            const reference = await fetch(`${process.env.PERF_BASELINE_ORIGIN ?? "http://127.0.0.1:5091"}/stats/api/${endpoint}?${query}`);
            assert.equal(reference.status, 200);
            const actual = await GET(new NextRequest(`http://localhost/stats/api/${endpoint}?${query}`));
            assert.equal(actual.status, 200);
            assert.deepEqual(await actual.json(), await reference.json());
            const rows = transfers.filter((row) => row.endpoint === endpoint);
            assert.equal(rows.length, 1, "A complete session window must not read its first1,000 rows twice");
            assert.ok(rows[0].rows > 10_000, "Retain the legacy route's larger existing cap");
        }
    } finally {runtime.__paceStatsDbPool.getConnection = acquire;}
    console.log(JSON.stringify({case: "legacy-session-query-work", parityCases: 2, transfers}));
}

main().then(() => process.exit(0), (error) => {console.error(error); process.exit(1);});
