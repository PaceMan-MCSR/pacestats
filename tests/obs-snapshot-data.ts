/** Docker only: exact public values and read-after-event freshness, with no SQL writes. */
import assert from "node:assert/strict";
import {getCached, getSessionNethers, getSessionStats} from "../app/data";

async function main() {
    const runtime = globalThis as typeof globalThis & {__paceStatsDbPool: any};
    const pool = runtime.__paceStatsDbPool;
    const acquire = pool.getConnection.bind(pool);
    const now = Date.now;
    const instant = now();
    Date.now = () => instant;
    let version = 1;
    const queries: string[] = [];
    pool.getConnection = async () => {
        const connection = await acquire(), execute = connection.execute.bind(connection);
        connection.execute = (options: {sql: string}, values: unknown[]) => {
            connection.execute = execute;
            queries.push(options.sql);
            assert.match(options.sql, /WHERE (?:nethers\.)?uuid=\?/);
            assert.match(options.sql, /LIMIT \?/);
            assert.ok(!/FROM users|FROM nicknames|FROM twitch/.test(options.sql), "A UUID snapshot skips identity work");
            const rows = Array.from({length: version}, (_, index) => ({
                id: 500_000 + index, nether: 100_000 + index * 1000, bastion: 200_000,
                fortress: 300_000, first_portal: null, stronghold: null, end: null,
                finish: null, obtainRod: 250_000, time: Math.floor(instant / 1000) - index * 60,
                wallTime: 1000, playTime: 2000, enters: 1, resets: 1, totalResets: 100,
            }));
            return Promise.resolve([rows, []]);
        };
        return connection;
    };
    try {
        const uuid = `obs-fresh-${process.pid}`;
        const publicSplits = await getCached(getSessionStats, "getSessionStats", uuid, 24, 6);
        const publicNethers = await getSessionNethers(uuid, 24, 6, false, 3);
        assert.equal((publicSplits.nether as {count: number}).count, 1);
        assert.deepEqual(publicNethers, {count: 1, avg: "1:40.000", rnph: 1200, uuid});
        const initialQueries = queries.length;
        assert.deepEqual(await getSessionStats(uuid, 24, 6, {fresh: true}), publicSplits);
        assert.deepEqual(await getSessionNethers(uuid, 24, 6, false, 3, {fresh: true}), publicNethers);
        assert.equal(queries.length - initialQueries, 3);
        version = 2;
        const splitStart = queries.length;
        const freshSplits = await getSessionStats(uuid, 24, 6, {fresh: true});
        assert.equal((freshSplits.nether as {count: number}).count, 2);
        assert.equal(queries.length - splitStart, 1);
        const netherStart = queries.length;
        const nethers = await getSessionNethers(uuid, 24, 6, true, 1, {fresh: true});
        assert.deepEqual(nethers, {count: 2, avg: "1:40.5", rnph: 1200, uuid});
        assert.equal(queries.length - netherStart, 2);
        assert.ok(queries.slice(netherStart).every(sql => sql.includes("pace.twitch IS NOT NULL") || sql.includes("twitch IS NOT NULL")));
        const hiddenNphStart = queries.length;
        assert.deepEqual(await getSessionNethers(uuid, 24, 6, false, 1, {fresh: true, includeNph: false}),
            {count: 2, avg: "1:40.5", rnph: 0, uuid});
        assert.equal(queries.length - hiddenNphStart, 1, "An overlay hiding RNPH does not read tracker rows");
        // Public callers retain their short-lived cache behavior independently.
        assert.equal(((await getSessionStats(uuid, 24, 6)).nether as {count: number}).count, 1);
        assert.deepEqual(await getSessionNethers(uuid, 24, 6, false, 3), publicNethers);
        version = 0;
        for (const dp of [0, 1, 2, 3]) {
            assert.deepEqual(await getSessionNethers(uuid, 24, 6, false, dp, {fresh: true}), {
                count: 0, avg: dp ? `0:00.${"0".repeat(dp)}` : "0:00", rnph: 0, uuid,
            });
        }
    } finally {pool.getConnection = acquire; Date.now = now;}
    console.log("OBS snapshot data: public-value parity, cache bypass, live-only scope, empty formatting and zero identity reads pass");
}

main().then(() => process.exit(0), error => {console.error(error); process.exit(1);});
