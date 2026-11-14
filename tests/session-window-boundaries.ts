/** Docker only: row-boundary fixtures replace query results, leaving MySQL data untouched. */
import assert from "node:assert/strict";
import {getNPH, getSessionStats} from "../app/data";

async function main() {
    const pool = (globalThis as typeof globalThis & {__paceStatsDbPool: any}).__paceStatsDbPool;
    const acquire = pool.getConnection.bind(pool);
    let fixtureRows: any[] = [], queries = 0;
    pool.getConnection = async () => {
        const connection = await acquire(), execute = connection.execute.bind(connection);
        connection.execute = (options: {sql: string}, values: unknown[]) => {
            connection.execute = execute;
            assert.ok(!options.sql.includes("COUNT("), "An already bounded complete window needs no count query");
            assert.equal(values.at(-1), "10001");
            queries++;
            return Promise.resolve([fixtureRows, []]);
        };
        return connection;
    };
    try {
        for (const size of [0, 999, 1_000, 1_001, 10_000, 10_001]) {
            fixtureRows = Array.from({length: size}, (_, index) => ({
                id: index + 1, nether: 100_000 + index, bastion: null, fortress: null, first_portal: null,
                stronghold: null, end: null, finish: null, obtainRod: null,
                time: Math.floor(Date.now() / 1_000) - index, wallTime: 1000, playTime: 2000,
                enters: 1, resets: 1, totalResets: 100,
            }));
            queries = 0;
            const split = await getSessionStats(`boundary-${size}`, 24, 24);
            const nether = split.nether;
            assert.ok(typeof nether === "object");
            assert.equal(nether.count, Math.min(size, 10_000));
            assert.equal(split.truncated, size > 10_000);
            assert.equal(queries, 1);
            queries = 0;
            const nph = await getNPH(`boundary-${size}`, 24, 24);
            assert.equal(nph.count, Math.min(size, 10_000));
            assert.equal(nph.truncated, size > 10_000);
            assert.equal(queries, 1);
        }
    } finally {pool.getConnection = acquire;}
    console.log("Session window boundaries: 12 cases preserve the cap, sentinel and single-query behavior");
}

main().then(() => process.exit(0), (error) => {console.error(error); process.exit(1);});
