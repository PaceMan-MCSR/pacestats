/** Run with node --experimental-sqlite --import tsx tests/event-stats-route.ts [--live-upstream]. */
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {DatabaseSync} from "node:sqlite";
import {setTimeout as wait} from "node:timers/promises";
import {NextRequest} from "next/server";
import {GET} from "../app/api/getEventStats/route";

const compact = (id: number) => `00000000000040008000${id.toString(16).padStart(12, "0")}`;
const uuid = (id: number) => `00000000-0000-4000-8000-${id.toString(16).padStart(12, "0")}`;
const roster = [uuid(1), compact(1), ...Array.from({length: 25}, (_, index) => uuid(index + 2))];
const event = (vanity: string, overrides = {}) => ({
    event: {vanity, name: "Fixture", starts: [100, 300, 350], ends: [200, 400, 450], whitelist: roster, ...overrides},
    rankings: [{uuid: uuid(999)}],
});

function request(params: string) {
    return GET(new NextRequest(`http://localhost/stats/api/getEventStats?${params}`));
}

async function main() {
    // Execute the route's actual CTE and bindings against an in-memory SQL
    // fixture. Store Unix seconds directly and shim MySQL's time conversions.
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE pace (
        id INTEGER PRIMARY KEY, uuid TEXT COLLATE NOCASE, nickname TEXT, insertTime REAL,
        nether INTEGER, bastion INTEGER, fortress INTEGER, first_portal INTEGER,
        stronghold INTEGER, "end" INTEGER, finish INTEGER, obtainRod INTEGER
    ); CREATE INDEX pace_uuid_time ON pace(uuid, insertTime);`);

    const insert = db.prepare("INSERT INTO pace VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)");
    let runId = 187_307;
    for (const time of [99, 100, 199, 200, 250, 299, 300, 350, 400, 449, 450, 451]) {
        const spelling = time % 2 === 0 ? uuid(1) : compact(1);
        const finish = time === 100 ? 501_000 : [99, 200, 250, 299, 450, 451].includes(time) ? 1 : null;
        insert.run(runId++, spelling, time === 449 ? "Current" : "Older", time, 100, 250, 500_000, finish, 450_000);
    }
    for (let index = 0; index < 43; index++) {
        insert.run(runId++, uuid(1), "Older", 150, 100, null, null, null, null);
    }
    insert.run(runId++, uuid(2), "Other", 150, 1_000, null, null, 500_000, null);
    insert.run(runId++, uuid(2), "Other", 399, 2_000, null, null, null, null);
    insert.run(runId++, uuid(999), "Outside roster", 150, 1, null, null, null, null);

    const {__paceStatsDbPool: pool} = globalThis as typeof globalThis & {
        __paceStatsDbPool: {getConnection: () => Promise<unknown>};
    };
    const originalGetConnection = pool.getConnection;
    const realFetch = globalThis.fetch;
    const realNow = Date.now;
    let now = realNow();
    let reads = 0;
    const fetches = new Map<string, number>();
    let unblock!: () => void;
    const blocked = new Promise<void>(resolve => {unblock = resolve;});
    pool.getConnection = async () => ({
        release() {},
        connection: {
            execute({sql, values}: {sql: string; values: (string | number)[]}) {
                reads++;
                const emitter = new EventEmitter();
                queueMicrotask(() => {
                    try {
                        const statement = db.prepare(sql.replace(/\b(?:FROM_UNIXTIME|UNIX_TIMESTAMP)\(/g, "("));
                        for (const row of statement.all(...values)) emitter.emit("result", Object.values(row));
                        emitter.emit("end");
                    } catch (error) {
                        emitter.emit("error", error);
                    }
                });
                return emitter;
            },
        },
    });
    globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        const vanity = url.searchParams.get("vanity")!;
        assert.equal(url.origin + url.pathname, "https://paceman.gg/api/cs/event");
        assert.equal([...url.searchParams].length, 1);
        assert.equal(init?.cache, "no-store");
        fetches.set(vanity, (fetches.get(vanity) ?? 0) + 1);
        switch (vanity) {
            case "Multi/Case+": await blocked; break;
            case "Second": return Response.json(event(vanity, {starts: [600], ends: [700]}));
            case "Missing": return new Response(`Failed to find event with vanity ${vanity}.`, {status: 400});
            case "UpstreamError": return new Response("Other error", {status: 400});
            case "Empty": return Response.json(event(vanity, {whitelist: []}));
            case "Testing": return Response.json(event(vanity, {whitelist: ["TESTING"]}));
            case "Malformed": return Response.json(event(vanity, {ends: [200]}));
            case "BadUuid": return Response.json(event(vanity, {whitelist: ["bad-uuid"]}));
            case "TooManyPlayers": return Response.json(event(vanity, {whitelist: Array.from({length: 513}, (_, i) => uuid(i))}));
            case "TooManyWindows": return Response.json(event(vanity, {starts: Array(33).fill(100), ends: Array(33).fill(200)}));
            case "Timeout": await wait(5_000, undefined, {signal: init?.signal ?? undefined}); break;
            case "RunLimit": return Response.json(event(vanity, {starts: [900], ends: [1000]}));
        }
        return Response.json(event(vanity));
    };
    Date.now = () => now;

    try {
        for (const query of ["", "vanity=%20", "vanity=Multi&vanity=Second"]) {
            const response = await request(query);
            assert.equal(response.status, 400);
            assert.match(response.headers.get("cache-control")!, /no-store/);
        }
        assert.equal(fetches.size, 0);
        const first = request("vanity=%20Multi%2FCase%2B%20");
        const duplicate = request("vanity=Multi%2FCase%2B");
        await wait(0);
        assert.equal(fetches.get("Multi/Case+"), 1);
        assert.equal((await request("vanity=Second")).status, 429);
        unblock();
        const [response, repeated] = await Promise.all([first, duplicate]);
        assert.equal(response.status, 200);
        assert.equal(reads, 1);
        assert.match(response.headers.get("cache-control")!, /s-maxage=30\b/);
        const body = await response.json();
        assert.deepEqual(await repeated.json(), body);
        assert.deepEqual(body.event.windows, [{start: 100, end: 200}, {start: 300, end: 400}, {start: 350, end: 450}]);
        assert.deepEqual(body.players.map((player: {uuid: string}) => player.uuid), roster.filter(id => id !== compact(1)));
        assert.equal(body.players[0].runCount, 49);
        assert.equal(body.players[0].nickname, "Current");
        assert.equal(body.players[2].nickname, null);
        assert.equal(body.players[2].runCount, 0);
        assert.deepEqual(body.players[2].splits.nether, {count: 0, avgMs: null, bestMs: null});
        assert.deepEqual(body.players[0].splits.finish, {count: 1, avgMs: 501_000, bestMs: 501_000});
        assert.deepEqual(body.players[1].splits.finish, {count: 1, avgMs: 500_000, bestMs: 500_000});
        assert.deepEqual(body.players[0].splits.second_structure, {count: 6, avgMs: 450_000, bestMs: 450_000});
        assert.equal(body.overall.runCount, 51);
        assert.deepEqual(body.overall.splits.nether, {count: 51, avgMs: 100, bestMs: 100});
        for (const split of Object.keys(body.overall.splits)) {
            assert.equal(body.overall.splits[split].count,
                body.players.reduce((sum: number, player: typeof body.players[number]) => sum + player.splits[split].count, 0));
        }

        const empty = await (await request("vanity=Second")).json();
        assert.equal(empty.overall.runCount, 0);
        assert.equal(empty.players.length, body.players.length);
        assert.equal(reads, 2);
        now += 20_000;
        assert.match((await request("vanity=Multi%2FCase%2B")).headers.get("cache-control")!, /s-maxage=10\b/);
        assert.equal(reads, 2);
        now += 10_001;
        assert.equal((await request("vanity=Multi%2FCase%2B")).status, 200);
        assert.equal(fetches.get("Multi/Case+"), 2);
        assert.equal(reads, 3);

        for (const [vanity, status] of [
            ["Missing", 404], ["UpstreamError", 502], ["Empty", 422], ["Testing", 422], ["Malformed", 502],
            ["BadUuid", 502], ["TooManyPlayers", 422], ["TooManyWindows", 422], ["Timeout", 504],
        ] as const) {
            const result = await request(`vanity=${vanity}`);
            assert.equal(result.status, status, vanity);
            assert.match(result.headers.get("cache-control")!, /no-store/);
        }
        assert.equal((await request("vanity=Missing")).status, 404);
        assert.equal(fetches.get("Missing"), 2);
        assert.equal(reads, 3, "Invalid and unavailable events never reach SQL");

        db.prepare(`WITH RECURSIVE seq(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM seq WHERE x < 100001)
            INSERT INTO pace (id, uuid, nickname, insertTime) SELECT x, ?, 'Fixture', 950 FROM seq`).run(uuid(1));
        const overLimit = await request("vanity=RunLimit");
        assert.equal(overLimit.status, 422);
        assert.match(overLimit.headers.get("cache-control")!, /no-store/);
        db.exec("DELETE FROM pace WHERE id <= 100001;");
        assert.equal((await request("vanity=RunLimit")).status, 200);
        assert.equal(fetches.get("RunLimit"), 2);

        if (process.argv.includes("--live-upstream")) {
            let upstreamRoster: string[] = [];
            globalThis.fetch = async (input, init) => {
                const result = await realFetch(input, init);
                assert.equal(result.status, 200);
                upstreamRoster = (await result.clone().json()).event.whitelist;
                return result;
            };
            const normalize = (id: string) => id.replaceAll("-", "").toLowerCase();
            for (const vanity of ["playoffs-s3", "trt-btrl"]) {
                const result = await request(`vanity=${vanity}`);
                assert.equal(result.status, 200, vanity);
                const live = await result.json();
                assert.equal(live.event.vanity, vanity);
                assert.deepEqual(
                    live.players.map((player: {uuid: string}) => normalize(player.uuid)),
                    [...new Set(upstreamRoster.map(normalize))]
                );
            }
            console.log("Live PaceMan event definitions passed for playoffs-s3 and trt-btrl.");
        }
        console.log("Event stats route passed window, roster, aggregation, error, and cache checks.");
    } finally {
        pool.getConnection = originalGetConnection;
        globalThis.fetch = realFetch;
        Date.now = realNow;
        db.close();
    }
}

main().catch(error => {console.error(error); process.exitCode = 1;});
