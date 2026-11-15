/** Read-only local Docker fixture; Redis 15 stays empty and SQL rows are not changed. */
import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {mkdir, writeFile} from "node:fs/promises";
import {dirname} from "node:path";
import Redis from "ioredis";
import {NextRequest} from "next/server";
import type NodeCache from "node-cache";

assert.ok(existsSync("/.dockerenv"), "Run in the local Docker environment");
process.env.REDIS_URL = "redis://127.0.0.1:6379/15";
const primary = new Redis("redis://127.0.0.1:6379/0");

async function main() {
    const data = await import("../app/data");
    const {mapWithConcurrency} = await import("../app/api/_utils");
    const {GET} = await import("../app/api/getPlayerInfo/route");
    const runtime = globalThis as typeof globalThis & {
        __paceStatsRedis: Redis; __paceStatsCache: NodeCache; __paceStatsDbPool: any;
    };
    assert.equal(await runtime.__paceStatsRedis.dbsize(), 0, "Reserved Redis 15 must start empty");
    const raw = await primary.call("JSON.GET", "users", "$[0:30]");
    assert.ok(raw, "The local generated users document supplies actual fixture names");
    const decoded = JSON.parse(String(raw));
    const users: {id: string; nick: string}[] = Array.isArray(decoded[0]) ? decoded[0] : decoded;
    assert.ok(users.length >= 18);
    const names = users.slice(0, 18).map(user => user.nick.toLocaleLowerCase());
    const [aliases] = await (await data.getConn()).execute<any[]>(
        `SELECT nickname FROM pace WHERE uuid=? AND nickname<>? ORDER BY id DESC LIMIT 1;`,
        [users[0].id, users[0].nick]
    );
    names.push(aliases[0]?.nickname.toLocaleLowerCase() ?? "missing-player-batch", "__proto__");
    const bans = [...await data.getBans(), users[1].id];
    runtime.__paceStatsCache.set('["getBans"]', bans);
    const pool = runtime.__paceStatsDbPool, acquire = pool.getConnection.bind(pool);

    const legacyLookup = async (requested: string[]) => Object.fromEntries(await mapWithConcurrency(requested, 4, async name => {
        const identity = await data.getCached(data.getAllNamesByNick, "getAllNamesByNick", name);
        if (!identity || identity.nick.toLocaleLowerCase() !== name) return [name, null] as const;
        const info = await data.getCached(data.getUserInfo, "getUserInfo", identity.uuid);
        return [name, {id: identity.uuid, nick: identity.nick, displayName: info?.displayName ?? null,
            color: info?.color ?? null, bgColor: info?.bgColor ?? null}] as const;
    }));
    // Exact legacy fallback, including current-name-only behavior and a banned
    // real UUID. Reference work is outside the measured production statement.
    let legacyStatements = 0;
    const legacySql = new Map<string, {sql: string; values: unknown[]}>();
    pool.getConnection = async () => {
        const connection = await acquire(), execute = connection.execute.bind(connection);
        connection.execute = async (options: {sql: string}, values: unknown[]) => {
            connection.execute = execute;
            legacyStatements++;
            if (!legacySql.has(options.sql)) legacySql.set(options.sql, {sql: options.sql, values});
            return execute(options, values);
        };
        return connection;
    };
    let reference: Record<string, any>;
    try {reference = await legacyLookup(names);}
    finally {pool.getConnection = acquire;}
    assert.equal(reference[names[1]], null, "Banned players are absent");
    assert.equal(reference.__proto__, null, "Unknown names remain own null-valued entries");
    runtime.__paceStatsCache.flushAll();
    runtime.__paceStatsCache.set('["getBans"]', bans);

    const statements: {sql: string; values: unknown[]; rows: number}[] = [];
    pool.getConnection = async () => {
        const connection = await acquire(), execute = connection.execute.bind(connection);
        connection.execute = async (options: {sql: string}, values: unknown[]) => {
            connection.execute = execute;
            const result = await execute(options, values);
            statements.push({sql: options.sql, values, rows: Array.isArray(result[0]) ? result[0].length : 0});
            return result;
        };
        return connection;
    };
    try {
        const measurements: {round: number; kind: string; ms: number; statements: number}[] = [];
        const started = performance.now();
        const response = await GET(new NextRequest(`http://localhost:5050/stats/api/getPlayerInfo?names=${encodeURIComponent(names.join(","))}`));
        const ms = performance.now() - started;
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), reference);
        assert.equal(response.headers.get("cache-control"), "public, max-age=0, s-maxage=60, stale-while-revalidate=120");
        assert.equal(statements.length, 1, "Twenty cold names use one SQL statement when bans are already known");
        assert.equal(statements[0].values.length, 20);
        assert.ok(statements[0].rows <= 20);
        const [plans] = await (await data.getConn()).execute<any[]>(`EXPLAIN FORMAT=JSON ${statements[0].sql}`, statements[0].values);
        assert.ok(!/"filesort"/.test(plans[0].EXPLAIN), "Every current-name and nickname lookup must stop at an indexed top-one row");
        const paceTables: any[] = [];
        const visitPlan = (node: any) => {
            if (!node || typeof node !== "object") return;
            if (node.table_name === "pace") paceTables.push(node);
            for (const value of Object.values(node)) visitPlan(value);
        };
        visitPlan(JSON.parse(plans[0].EXPLAIN));
        assert.ok(paceTables.length >= 20);
        assert.ok(paceTables.every(table => table.key && table.access_type !== "ALL"), "Each pace branch must use its bounded index lookup");
        const beforeWarm = statements.length;
        const warmResponse = await GET(new NextRequest(`http://localhost:5050/stats/api/getPlayerInfo?names=${encodeURIComponent(names.join(","))}`));
        assert.deepEqual(await warmResponse.json(), reference);
        assert.equal(statements.length, beforeWarm, "The repeated bounded batch shares its cached result");
        assert.deepEqual(await data.getPlayerInfoByNames([]), {});
        await assert.rejects(data.getPlayerInfoByNames(Array(21).fill("name")), RangeError);
        assert.equal(await runtime.__paceStatsRedis.dbsize(), 0);
        // Reference requests already prepared their three small SQL shapes.
        // Prime both variants equally on four pool connections before comparing
        // value-cache misses, without mistaking preparation for ongoing work.
        const preparation = await Promise.all(Array.from({length: 4}, () => acquire()));
        try {
            await Promise.all(preparation.map(async connection => {
                for (const query of [...legacySql.values(), statements[0]]) await connection.execute({sql: query.sql}, query.values);
            }));
        } finally {for (const connection of preparation) connection.release();}
        for (let round = 0; round < 9; round++) {
            for (const kind of round % 2 ? ["optimized", "legacy"] : ["legacy", "optimized"]) {
                runtime.__paceStatsCache.flushAll();
                runtime.__paceStatsCache.set('["getBans"]', bans);
                const issued = statements.length, start = performance.now();
                let actual;
                if (kind === "legacy") actual = await legacyLookup(names);
                else {
                    const measuredResponse = await GET(new NextRequest(`http://localhost:5050/stats/api/getPlayerInfo?names=${encodeURIComponent(names.join(","))}`));
                    actual = await measuredResponse.json();
                }
                measurements.push({round, kind, ms: performance.now() - start, statements: statements.length - issued});
                assert.deepEqual(actual, reference);
            }
        }
        const output = process.env.PERF_OUTPUT ?? "/app/test-artifacts/performance/site-round/player-info-batches.json";
        await mkdir(dirname(output), {recursive: true});
        await writeFile(output, JSON.stringify({method: "Nine alternating in-process direct handler/legacy fallback pairs; four legacy workers, both variants' prepared SQL shapes primed equally on four pool connections; cold Node value caches, empty Redis 15, bans preknown, MySQL buffers not flushed. Not browser/HTTP latency.",
            names: names.length, legacyStatements, optimizedStatements: 1, returnedSqlRows: statements[0].rows,
            measurements, explain: JSON.parse(plans[0].EXPLAIN)}, null, 2));
        console.log(JSON.stringify({case: "cold-player-info-sql-batch", names: names.length,
            legacyStatements, statements: 1, returnedSqlRows: statements[0].rows, maxBoundNames: 20, ms,
            historicalAlias: aliases[0]?.nickname ?? null, fixtureRedisKeys: 0, measurements, output}));
    } finally {pool.getConnection = acquire;}

    // Shadow the tables with read-only CTEs. This exercises historical/reused
    // names and collation edges through the real SQL engine without inserting
    // fixture rows or depending on those rare cases being present in the dump.
    const identityRows = [
        [1, "uuid-alpha", "Legacy"], [2, "uuid-alpha", "Alpha"],
        [3, "uuid-former", "Reused"], [4, "uuid-former", "Changed"], [5, "uuid-current", "Reused"],
        [6, "uuid-allowed", "Blocked"], [7, "uuid-banned", "Blocked"],
        [8, "uuid-accent", "Accent"], [9, "uuid-padded", "Pad "],
        [10, "uuid-echo-old", "Echo"], [11, "uuid-echo-new", "Echo"],
    ];
    const cte = `WITH pace AS (${identityRows.map(() =>
        "SELECT ? AS id, CAST(? AS CHAR(36)) AS uuid, CAST(? AS CHAR(64)) COLLATE utf8mb4_unicode_ci AS nickname"
    ).join(" UNION ALL ")}), users AS (
        SELECT CAST(? AS CHAR(36)) AS uuid, CAST(? AS CHAR(64)) AS displayName,
            CAST(? AS CHAR(64)) AS color, CAST(? AS CHAR(64)) AS bgColor
    ) `;
    const cteValues = [...identityRows.flat(), "uuid-alpha", "Custom Alpha", "abcdef", null];
    let virtualStatements = 0;
    pool.getConnection = async () => {
        const connection = await acquire(), execute = connection.execute.bind(connection);
        connection.execute = async (options: {sql: string}, values: unknown[]) => {
            connection.execute = execute;
            virtualStatements++;
            return execute({...options, sql: cte + options.sql}, [...cteValues, ...values]);
        };
        return connection;
    };
    try {
        const inputs = ["ALPHA", "alpha", "Legacy", "Reused", "Blocked", "accént", "Pad", "Echo", "Unknown", "__proto__"];
        const normalized = [...new Set(inputs.map(name => name.toLocaleLowerCase()))];
        runtime.__paceStatsCache.flushAll();
        runtime.__paceStatsCache.set('["getBans"]', ["uuid-banned"]);
        const expected = await legacyLookup(normalized);
        assert.equal(expected.legacy, null);
        assert.equal(expected.reused.id, "uuid-current", "The latest nickname association wins");
        assert.equal(expected.blocked, null, "A banned latest owner cannot fall back to an older allowed owner");
        assert.equal(expected["accént"], null, "Case/accent-insensitive SQL lookup retains strict current-name validation");
        assert.equal(expected.pad, null, "SQL space-padding does not bypass the strict current-name check");
        assert.equal(expected.echo.id, "uuid-echo-new", "Association ordering uses the latest ID");
        runtime.__paceStatsCache.flushAll();
        runtime.__paceStatsCache.set('["getBans"]', ["uuid-banned"]);
        virtualStatements = 0;
        const response = await GET(new NextRequest(`http://localhost:5050/stats/api/getPlayerInfo?names=${encodeURIComponent(inputs.join(","))}`));
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), expected);
        assert.equal(virtualStatements, 1);
        assert.equal(await runtime.__paceStatsRedis.dbsize(), 0);
        console.log("PASS: current/historical/reused/unknown/case-duplicate names, banned owners and strict collation checks match the legacy fallback");
    } finally {pool.getConnection = acquire;}
}

main().then(() => 0, error => {console.error(error); return 1;}).then(code => {
    primary.disconnect(); process.exit(code);
});
