/** Docker only: authenticated endpoint isolation, bounds, fanout-provider pressure and recovery. */
import assert from "node:assert/strict";
import {NextRequest} from "next/server";
import {getCached} from "../app/data";
import {GET} from "../app/api/obsSnapshot/route";

async function main() {
    const runtime = globalThis as typeof globalThis & {__paceStatsDbPool: any; __paceStatsRedis: any};
    const pool = runtime.__paceStatsDbPool, acquire = pool.getConnection.bind(pool);
    const redis = runtime.__paceStatsRedis, redisCall = redis.call.bind(redis);
    const oldToken = process.env.WS_TOKEN;
    process.env.WS_TOKEN = "local-obs-snapshot-fixture";
    let checkedOut = 0, redisCalls = 0, queries = 0, failQuery = false;
    let delay: Promise<void> | undefined;
    const request = (query: string, token: string | null = process.env.WS_TOKEN!) => new NextRequest(
        `http://127.0.0.1:5050/stats/api/obsSnapshot?${query}`,
        {headers: token === null ? {} : {authorization: `Bearer ${token}`}}
    );
    redis.call = (...args: any[]) => {redisCalls++; return redisCall(...args);};
    pool.getConnection = async () => {
        checkedOut++;
        const connection = await acquire(), execute = connection.execute.bind(connection);
        connection.execute = async (options: {sql: string}) => {
            connection.execute = execute;
            queries++;
            assert.match(options.sql, /WHERE (?:nethers\.)?uuid=\?/);
            assert.match(options.sql, /LIMIT \?/);
            if (delay) await delay;
            if (failQuery) throw new Error("Injected OBS SQL read failure");
            return [[{
                id: 500_001, nether: 100_000, bastion: null, fortress: null, first_portal: null,
                stronghold: null, end: null, finish: null, obtainRod: null,
                time: Math.floor(Date.now() / 1000), wallTime: 1000, playTime: 2000,
                enters: 1, resets: 1, totalResets: 100,
            }], []];
        };
        return connection;
    };
    try {
        const normal = "kind=session&name=OverlayFixture";
        for (const token of [null, "", "wrong", "x".repeat(10_000)]) {
            const response = await GET(request(normal, token));
            assert.equal(response.status, 401);
            assert.match(response.headers.get("cache-control")!, /no-store/);
        }
        process.env.WS_TOKEN = "";
        assert.equal((await GET(request(normal, "anything"))).status, 401);
        process.env.WS_TOKEN = "local-obs-snapshot-fixture";
        for (const query of [
            "kind=unknown&name=OverlayFixture", "kind=session", "kind=session&name=x&hours=0",
            "kind=session&name=x&hours=NaN", "kind=session&name=x&hoursBetween=-1",
            "kind=nethers&name=x&dp=4", "kind=nethers&name=x&liveOnly=1", "kind=nethers&name=x&nph=1",
            "kind=combinedStats&names=x&hoursBetween=0", "kind=combinedStats&names=x&start=-1",
            "kind=combinedNethers&names=x&maxTime=100000000",
            `kind=combinedNethers&names=${Array(21).fill("x").join(",")}`,
            `kind=session&name=${"x".repeat(65)}`,
        ]) assert.equal((await GET(request(query))).status, 400, query);
        assert.equal(checkedOut, 0, "Rejected requests cannot acquire SQL connections");
        assert.equal(redisCalls, 0, "Rejected requests cannot read Redis or identity data");
        const uuid = `obs-endpoint-${process.pid}`;
        await getCached(async () => ({uuid, nick: "OverlayFixture"}), "getAllNamesByNick", "OverlayFixture");
        const initial = await GET(request(normal));
        assert.equal(initial.status, 200);
        assert.match(initial.headers.get("cache-control")!, /no-store/);
        const body = await initial.json();
        assert.deepEqual(body.uuids, [uuid]);
        assert.deepEqual(body.data.nether, {count: 1, avg: "1:40"});
        await getCached(async () => null, "getAllNamesByNick", "OverlayTwitchAlias");
        await getCached(async () => ({uuid, nick: "OverlayFixture"}), "getAllNamesByTwitch", "OverlayTwitchAlias");
        assert.deepEqual((await (await GET(request("kind=session&name=OverlayTwitchAlias"))).json()).uuids, [uuid]);
        const oneRead = queries;
        const hidden = await GET(request("kind=nethers&name=OverlayFixture&nph=false&dp=3&liveOnly=true"));
        assert.deepEqual((await hidden.json()).data, {count: 1, avg: "1:40.000", rnph: 0, uuid});
        assert.equal(queries - oneRead, 1);
        const tracker = await GET(request("kind=nethers&name=OverlayFixture&nph=true"));
        assert.equal((await tracker.json()).data.rnph, 1200);
        for (const kind of ["combinedStats", "combinedNethers"]) {
            const response = await GET(request(`kind=${kind}&names=`));
            assert.equal(response.status, 200);
            const empty = await response.json();
            assert.deepEqual(empty.uuids, []);
            if (kind === "combinedNethers") assert.deepEqual(empty.data, {count: 0, avg: "0:00"});
            else assert.deepEqual(empty.data.nether, {count: 0, avg: "0:00"});
        }
        await getCached(async () => null, "getAllNamesByNick", "MissingOverlay");
        await getCached(async () => null, "getAllNamesByTwitch", "MissingOverlay");
        assert.equal((await GET(request("kind=session&name=MissingOverlay"))).status, 404);
        await getCached(async () => ({uuids: [], unknown: ["MissingCombined"]}), "resolveCombinedPlayerUuids", ["MissingCombined"]);
        assert.equal((await GET(request("kind=combinedStats&names=MissingCombined"))).status, 404);
        let release!: () => void;
        delay = new Promise(resolve => {release = resolve;});
        const before = queries;
        const active = Array.from({length: 4}, () => GET(request(normal)));
        for (let index = 0; queries < before + 4 && index < 100; index++) await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal(queries, before + 4);
        const busy = await GET(request(normal));
        assert.equal(busy.status, 429);
        assert.equal(busy.headers.get("retry-after"), "1");
        release();
        assert.ok((await Promise.all(active)).every(response => response.status === 200));
        delay = undefined;
        const errorLog = console.error;
        console.error = () => undefined;
        try {
            failQuery = true;
            assert.equal((await GET(request(normal))).status, 503);
            failQuery = false;
            assert.equal((await GET(request(normal))).status, 200, "Read failures release concurrency slots");
            await getCached(async () => ({uuid: "x".repeat(33_000), nick: "LargeFixture"}), "getAllNamesByNick", "LargeFixture");
            assert.equal((await GET(request("kind=session&name=LargeFixture"))).status, 503, "Oversized snapshots cannot reach the socket");
        } finally {console.error = errorLog;}
        assert.equal((await GET(request(normal))).status, 200);
        console.log("OBS snapshot route: auth-before-work,13 validation cases,4 kinds, hidden-RNPH query skip,4-read cap,404/503 recovery and32KiB cap pass");
    } finally {
        pool.getConnection = acquire;
        redis.call = redisCall;
        if (oldToken === undefined) delete process.env.WS_TOKEN;
        else process.env.WS_TOKEN = oldToken;
    }
}

main().then(() => process.exit(0), error => {console.error(error); process.exit(1);});
