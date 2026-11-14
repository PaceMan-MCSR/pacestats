/** Docker only: exact session overflow boundaries without materialized count prefixes. */
import assert from "node:assert/strict";
import {getConn, getNPH, getSessionStats} from "../app/data";

async function main() {
    const runtime = globalThis as typeof globalThis & {__paceStatsDbPool: any};
    const pool = runtime.__paceStatsDbPool, acquire = pool.getConnection.bind(pool);
    let totalRows = 0, probes: string[] = [];
    const now = Math.floor(Date.now() / 1_000);
    const fixture = Array.from({length: 1_000}, (_, index) => ({id: index + 1, nether: 100_000, bastion: null,
        fortress: null, first_portal: null, stronghold: null, end: null, finish: null, obtainRod: null,
        time: index === 0 ? now : now - 7_201 - index, wallTime: 1000, playTime: 2000, enters: 1, resets: 1, totalResets: 100}));
    pool.getConnection = async () => {
        const connection = await acquire(), execute = connection.execute.bind(connection);
        connection.execute = async (options: {sql: string}, values: unknown[]) => {
            connection.execute = execute;
            assert.ok(!options.sql.includes("COUNT("), "Truncation needs one sentinel rather than an aggregate");
            if (options.sql.includes("AS overflow")) {
                assert.equal(values.at(-1), "10000"); probes.push(options.sql);
                return [totalRows > 10_000 ? [{overflow: 1}] : [], []];
            }
            return [fixture, []];
        };
        return connection;
    };
    try {
        for (const size of [1_000, 10_000, 10_001]) {
            totalRows = size;
            const split = await getSessionStats(`overflow-${size}`, 24, 1);
            assert.equal(split.truncated, size > 10_000);
            for (const live of [false, true]) {
                const nph = await getNPH(`overflow-${size}`, 24, 1, live);
                assert.equal(nph.truncated, size > 10_000);
                assert.equal(nph.count, 1);
            }
        }
    } finally {pool.getConnection = acquire;}
    assert.equal(probes.length, 10);
    const connection = await getConn(), uuid = "e4cd494a-4e0a-423b-9988-618b86858c96";
    const from = "FROM nethers WHERE uuid=? AND insertTime >= NOW() - INTERVAL 9999 DAY";
    const [oldPlan] = await connection.execute<any[]>(`EXPLAIN ANALYZE SELECT COUNT(*) AS windowRows FROM (SELECT 1 ${from} LIMIT 10001) bounded;`, [uuid]);
    const [newPlan] = await connection.execute<any[]>(`EXPLAIN ANALYZE SELECT 1 AS overflow ${from} LIMIT 1 OFFSET 10000;`, [uuid]);
    assert.match(oldPlan[0].EXPLAIN, /Materialize/);
    assert.doesNotMatch(newPlan[0].EXPLAIN, /Materialize/);
    console.log(JSON.stringify({case: "session-overflow-probe", parityCases: 9, probes: probes.length,
        beforePlan: oldPlan[0].EXPLAIN, afterPlan: newPlan[0].EXPLAIN}));
}

main().then(() => process.exit(0), (error) => {console.error(error); process.exit(1);});
