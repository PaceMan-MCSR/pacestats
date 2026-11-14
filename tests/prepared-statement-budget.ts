/** Docker only: exercise mysql2/server retention on one local connection. */
import assert from "node:assert/strict";

process.env.DB_MAX_PREPARED_STATEMENTS = "32";

async function main() {
    const {getConn} = await import("../app/data");
    const started = performance.now();
    for (let index = 0; index < 96; index++) {
        const [rows] = await (await getConn()).execute<any[]>(`SELECT ? AS value /* pace-perf-retention-${index} */`, [index]);
        assert.equal(rows[0].value, index);
    }
    const pool = (globalThis as typeof globalThis & {__paceStatsDbPool: any}).__paceStatsDbPool;
    const connection = await pool.getConnection();
    let retained: number;
    try {
        retained = connection.connection._statements.size;
        assert.equal(retained, 32, "Previously used statement shapes must leave the client LRU");
        const [rows] = await connection.query("SHOW SESSION STATUS LIKE 'Com_stmt_close';");
        assert.ok(Number(rows[0].Value) >= 64, "Evicted statements must also be closed on the server");
    } finally {
        connection.release();
    }
    // Reusing an evicted shape must transparently prepare it again.
    const [again] = await (await getConn()).execute<any[]>("SELECT ? AS value /* pace-perf-retention-0 */", [123]);
    assert.equal(again[0].value, 123);
    console.log(JSON.stringify({case: "prepared-statement-budget", distinctStatements: 96, retained, ms: performance.now() - started}));
}

main().then(() => process.exit(0), (error) => {console.error(error); process.exit(1);});
