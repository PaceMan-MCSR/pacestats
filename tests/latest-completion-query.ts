/** Docker only: verify the complete endpoint row and its covering-ID selection. */
import assert from "node:assert/strict";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const load = async (root: string) => {
    const source = await import(pathToFileURL(resolve(root, "app/data.ts")).href);
    return source.default ?? source;
};

async function main() {
    const data = await load(process.env.PERF_SOURCE_ROOT ?? "/app");
    const ids = ["e4cd494a-4e0a-423b-9988-618b86858c96", "fa48d763-ba4c-452f-b85d-fca945b39c61", "3470272d-e7d2-46eb-9a8c-f3e5d65e8e07", "not-a-player"];
    const results: any[] = [];
    for (const uuid of ids) {
        const rows = await data.jude(uuid);
        const [expected] = await (await data.getConn()).execute("SELECT MAX(id) AS id FROM pace WHERE uuid=? AND finish IS NOT NULL;", [uuid]);
        assert.equal(rows[0]?.id ?? null, expected[0].id);
        results.push(rows);
    }
    if (process.env.PERF_COMPARE_SOURCE_ROOT) {
        const baseline = await load(process.env.PERF_COMPARE_SOURCE_ROOT);
        for (const [index, uuid] of ids.entries()) assert.deepEqual(results[index], await baseline.jude(uuid));
    }
    if (!process.env.PERF_SOURCE_ROOT) {
        const pool = (globalThis as typeof globalThis & {__paceStatsDbPool: any}).__paceStatsDbPool;
        const acquire = pool.getConnection.bind(pool);
        let statement: {sql: string; values: unknown[]} | undefined;
        pool.getConnection = async () => {
            const connection = await acquire(), execute = connection.execute.bind(connection);
            connection.execute = (options: {sql: string}, values: unknown[]) => {
                connection.execute = execute; statement = {sql: options.sql, values};
                return execute(options, values);
            };
            return connection;
        };
        try {await data.jude(ids[1]);} finally {pool.getConnection = acquire;}
        assert.ok(statement);
        const [plans] = await (await data.getConn()).execute(`EXPLAIN FORMAT=JSON ${statement.sql}`, statement.values);
        const plan = JSON.parse(plans[0].EXPLAIN);
        assert.equal(plan.query_block.table.key, "PRIMARY");
        assert.equal(plan.query_block.table.access_type, "const");
        const text = JSON.stringify(plan);
        assert.ok(text.includes('"key":"idx_pace_uuid_finish"') && text.includes('"using_index":true'));
    }
    const started = performance.now();
    for (let index = 0; index < 100; index++) await data.jude(ids[index % 3]);
    console.log(JSON.stringify({case: "latest-completion", requests: 100, durationMs: performance.now() - started, parityCases: ids.length}));
}

main().then(() => process.exit(0), (error) => {console.error(error); process.exit(1);});
