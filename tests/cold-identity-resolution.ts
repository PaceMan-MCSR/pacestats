/** Read-only Docker fixture: empty Redis 15, independent prior-source parity and indexed probes. */
import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {mkdir, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import type NodeCache from "node-cache";
import type Redis from "ioredis";

assert.ok(existsSync("/.dockerenv"), "Run in the local Docker environment");
process.env.REDIS_URL = "redis://127.0.0.1:6379/15";

async function main() {
    const data = await import("../app/data");
    const baselinePath = resolve(process.env.PERF_COMPARE_SOURCE_ROOT ?? "/tmp/pacestats-cold2-baseline", "app/data.ts");
    const imported = await import(pathToFileURL(baselinePath).href);
    const legacy = imported.default ?? imported;
    const runtime = globalThis as typeof globalThis & {
        __paceStatsCache: NodeCache; __paceStatsRedis: Redis; __paceStatsDbPool: any;
    };
    assert.equal(await runtime.__paceStatsRedis.dbsize(), 0, "Reserved Redis 15 must remain empty");
    const conn = await data.getConn();
    const uuid = "e4cd494a-4e0a-423b-9988-618b86858c96";
    const [names] = await conn.execute<any[]>(
        "SELECT nickname, twitch FROM pace WHERE uuid=? ORDER BY id DESC LIMIT 30;", [uuid]
    );
    const [past] = await conn.execute<any[]>(
        "SELECT nickname FROM pace WHERE uuid=? AND nickname<>? ORDER BY id DESC LIMIT 1;", [uuid, names[0].nickname]
    );
    const inputs: {method: "getAllNamesByNick" | "getAllNamesByTwitch"; name: string}[] = [
        {method: "getAllNamesByNick", name: names[0].nickname},
        {method: "getAllNamesByNick", name: names[0].nickname.toLocaleLowerCase()},
        {method: "getAllNamesByNick", name: past[0]?.nickname ?? "unknown-historical-name"},
        {method: "getAllNamesByTwitch", name: names.find(row => row.twitch)?.twitch ?? "unknown-twitch"},
        {method: "getAllNamesByNick", name: "unknown-cold-name"},
        {method: "getAllNamesByTwitch", name: "unknown-cold-twitch"},
    ];
    const reset = (bans: string[] = []) => {
        runtime.__paceStatsCache.flushAll();
        runtime.__paceStatsCache.set('["getBans"]', bans);
    };
    const pool = runtime.__paceStatsDbPool, acquire = pool.getConnection.bind(pool);
    let statements: {sql: string; values: unknown[]; rows: number}[] = [];
    let cte = "", cteValues: unknown[] = [];
    pool.getConnection = async () => {
        const connection = await acquire(), execute = connection.execute.bind(connection);
        connection.execute = async (options: {sql: string}, values: unknown[]) => {
            connection.execute = execute;
            const result = await execute({...options, sql: cte + options.sql}, [...cteValues, ...values]);
            statements.push({sql: options.sql, values, rows: result[0].length});
            return result;
        };
        return connection;
    };
    const measurements: {round: number; kind: string; ms: number; statements: number}[] = [];
    const counts: {input: typeof inputs[number]; legacy: number; optimized: number}[] = [];
    const queries = new Map<string, {sql: string; values: unknown[]}>();
    try {
        for (const input of inputs) {
            reset(); statements = [];
            const expected = await legacy[input.method](input.name);
            const legacyCount = statements.length;
            for (const query of statements) queries.set(query.sql, query);
            reset(); statements = [];
            assert.deepEqual(await data[input.method](input.name), expected);
            assert.equal(statements.length, 1, "Every cold SQL identity fallback uses one statement");
            assert.ok(statements[0].rows <= 1);
            counts.push({input, legacy: legacyCount, optimized: statements.length});
            for (const query of statements) queries.set(query.sql, query);
            const [plans] = await conn.execute<any[]>(`EXPLAIN FORMAT=JSON ${statements[0].sql}`, statements[0].values);
            assert.ok(!/"filesort"/.test(plans[0].EXPLAIN));
            const tables: any[] = [];
            const visit = (node: any) => {
                if (!node || typeof node !== "object") return;
                if (node.table_name === "pace" || node.table_name === "currentPlayer") tables.push(node);
                for (const value of Object.values(node)) visit(value);
            };
            visit(JSON.parse(plans[0].EXPLAIN));
            assert.ok(tables.every(table => table.key && table.access_type !== "ALL"));
            if (expected) assert.ok(tables.length >= 2, "Both association and current-name probes use their indexes");
        }
        for (const cachedName of ["An earlier cached nickname", null]) {
            reset(); runtime.__paceStatsCache.set(JSON.stringify(["getNick", uuid]), cachedName);
            assert.deepEqual(await data.getAllNamesByNick(names[0].nickname), {uuid, nick: cachedName});
        }
        reset(); runtime.__paceStatsCache.set(JSON.stringify(["getNick", uuid]), "Expired nickname", 0.001);
        await new Promise(resolve => setTimeout(resolve, 5));
        assert.deepEqual(await data.getAllNamesByNick(names[0].nickname), {uuid, nick: names[0].nickname});
        reset();
        let release!: (name: string) => void;
        const pending = data.getCached(() => new Promise<string>(resolve => {release = resolve;}), "getNick", uuid);
        await Promise.resolve();
        const resolving = data.getAllNamesByNick(names[0].nickname);
        release("In-flight nickname");
        await pending;
        assert.deepEqual(await resolving, {uuid, nick: "In-flight nickname"});
        for (const method of ["getAllNamesByNick", "getAllNamesByTwitch"] as const) {
            reset([uuid]);
            const input = inputs.find(input => input.method === method)!;
            assert.equal(await data[method](input.name), null);
        }

        // Small read-only tables exercise rare ownership/collation cases without SQL writes.
        const mixedCaseUuid = "ABCDEF01-2345-6789-ABCD-0123456789AB";
        const rows = [
            [1, "uuid-alpha", "Legacy", "old-handle"], [2, "uuid-alpha", "Alpha", "new-handle"],
            [3, "uuid-former", "Reused", "reused-handle"], [4, "uuid-former", "Changed", "changed-handle"],
            [5, "uuid-current", "Reused", "reused-handle"],
            [6, "uuid-allowed", "Blocked", "blocked-handle"], [7, "uuid-banned", "Blocked", "blocked-handle"],
            [8, "uuid-accent", "Accent", "accent-handle"], [9, "uuid-padded", "Pad ", "pad-handle "],
            [10, mixedCaseUuid, "LegacyCase", "legacy-case-handle"],
            [11, mixedCaseUuid.toLowerCase(), "CurrentCase", "current-case-handle"],
        ];
        cte = `WITH pace AS (${rows.map(() =>
            "SELECT ? AS id, CAST(? AS CHAR(36)) AS uuid, CAST(? AS CHAR(64)) COLLATE utf8mb4_unicode_ci AS nickname, CAST(? AS CHAR(64)) COLLATE utf8mb4_unicode_ci AS twitch"
        ).join(" UNION ALL ")}) `;
        cteValues = rows.flat();
        const virtualCases = [
            ["getAllNamesByNick", ["ALPHA", "Legacy", "Reused", "Blocked", "accént", "Pad", "Unknown", "LegacyCase", "CurrentCase"]],
            ["getAllNamesByTwitch", ["NEW-HANDLE", "old-handle", "reused-handle", "blocked-handle", "accént-handle", "pad-handle", "unknown-handle", "legacy-case-handle", "current-case-handle"]],
        ] as const;
        for (const [method, cases] of virtualCases) {
            for (const name of cases) {
                reset(["uuid-banned"]);
                const expected = await legacy[method](name);
                reset(["uuid-banned"]); statements = [];
                assert.deepEqual(await data[method](name), expected, `${method}/${name}`);
                assert.equal(statements.length, 1);
                if (/^reused/i.test(name)) assert.equal(expected.uuid, "uuid-current");
                if (/^blocked/i.test(name)) assert.equal(expected, null, "A banned latest owner must not select an earlier owner");
                if (name === "Legacy" || name === "old-handle") assert.equal(expected.nick, "Alpha");
                if (name === "LegacyCase" || name === "legacy-case-handle") {
                    assert.equal(expected.uuid, mixedCaseUuid, "Retain the association row's raw UUID spelling");
                    assert.equal(expected.nick, "CurrentCase");
                }
            }
        }
        for (const [method, name] of [
            ["getAllNamesByNick", "LegacyCase"], ["getAllNamesByTwitch", "legacy-case-handle"],
        ] as const) {
            for (const bannedUuid of [mixedCaseUuid, mixedCaseUuid.toLowerCase()]) {
                reset([bannedUuid]);
                const expected = await legacy[method](name);
                reset([bannedUuid]);
                assert.deepEqual(await data[method](name), expected, "Ban matching uses the latest association's UUID spelling");
                assert.equal(expected === null, bannedUuid === mixedCaseUuid);
            }
            reset();
            const upperKey = JSON.stringify(["getNick", mixedCaseUuid]);
            const lowerKey = JSON.stringify(["getNick", mixedCaseUuid.toLowerCase()]);
            runtime.__paceStatsCache.set(upperKey, "Association-key cached name");
            runtime.__paceStatsCache.set(lowerKey, "Current-row-key cached name");
            assert.deepEqual(await data[method](name), await legacy[method](name));
            assert.deepEqual(await data[method](name), {uuid: mixedCaseUuid, nick: "Association-key cached name"});
        }
        cte = ""; cteValues = [];
        if (process.env.PERF_TIMING === "1") {
            // Match preparation on both variants before alternating cache-cold calls.
            const prepared = await acquire();
            try {for (const query of queries.values()) await prepared.execute({sql: query.sql}, query.values);}
            finally {prepared.release();}
            const timingInputs = Array.from({length: 20}, (_, index) => inputs[index % 4]);
            for (let round = 0; round < 9; round++) {
                for (const kind of round % 2 ? ["optimized", "legacy"] : ["legacy", "optimized"]) {
                    statements = []; const started = performance.now();
                    for (const input of timingInputs) {
                        reset();
                        await (kind === "legacy" ? legacy : data)[input.method](input.name);
                    }
                    measurements.push({round, kind, ms: performance.now() - started, statements: statements.length});
                }
            }
        }
        assert.equal(await runtime.__paceStatsRedis.dbsize(), 0);
        const output = process.env.PERF_OUTPUT ?? "/app/test-artifacts/performance/cold2/cold-identity.json";
        await mkdir(dirname(output), {recursive: true});
        await writeFile(output, JSON.stringify({counts, warmedNameCacheCases: 4, virtualParityCases: 24,
            fixtureRedisKeys: 0, measurements, method: "Read-only SQL and empty Redis15; independent frozen prior source, optional nine alternating pairs of20 sequential lookups with Node values cleared per lookup and equally prepared SQL. MySQL/OS caches not flushed; not HTTP latency."}, null, 2));
        console.log(JSON.stringify({case: "cold-identity-resolution", counts, virtualParityCases: 24, measurements, output}));
    } finally {pool.getConnection = acquire;}
}

main().then(() => process.exit(0), error => {console.error(error); process.exit(1);});
