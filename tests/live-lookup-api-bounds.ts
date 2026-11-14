/** Docker DB14 only: reject invalid lookups before IO and bound distinct upstream work. */
import assert from "node:assert/strict";
import {NextRequest} from "next/server";
import Redis from "ioredis";

process.env.REDIS_URL = "redis://127.0.0.1:6379/14";
const fixture = new Redis(process.env.REDIS_URL);
let created = false;

async function main() {
    assert.equal(await fixture.exists("users"), 0);
    const data = await import("../app/data");
    const runtime = globalThis as typeof globalThis & {__paceStatsDbPool: any; __paceStatsRedis: Redis};
    const acquire = runtime.__paceStatsDbPool.getConnection.bind(runtime.__paceStatsDbPool);
    const redisCall = runtime.__paceStatsRedis.call.bind(runtime.__paceStatsRedis);
    let dbReads = 0, redisReads = 0;
    runtime.__paceStatsDbPool.getConnection = async () => {dbReads++; return acquire();};
    runtime.__paceStatsRedis.call = ((...args: any[]) => {redisReads++; return (redisCall as any)(...args);}) as typeof redisCall;
    const cases = [
        ["getWorld", ""], ["getWorld", `worldId=${"x".repeat(65)}`],
        ["getLatestRun", ""], ["getLatestRun", "name=x&forceName=invalid"],
        ["getLatestCompletion", `name=${"x".repeat(65)}`], ["getLatestCompletion", ""],
        ["getNickAlways", "uuid=not-a-uuid"], ["getNickAlways", ""],
    ];
    try {
        for (const [endpoint, query] of cases) {
            const {GET} = await import(`../app/api/${endpoint}/route`);
            assert.equal((await GET(new NextRequest(`http://localhost/stats/api/${endpoint}?${query}`))).status, 400);
        }
        assert.equal(dbReads, 0); assert.equal(redisReads, 0);
    } finally {runtime.__paceStatsDbPool.getConnection = acquire; runtime.__paceStatsRedis.call = redisCall;}
    const user = {id: "e4cd494a-4e0a-423b-9988-618b86858c96", nick: "NoFearr1337", twitches: ["round4-alias"]};
    await fixture.call("JSON.SET", "users", "$", JSON.stringify([user])); created = true;
    const {GET: latest} = await import("../app/api/getLatestRun/route");
    const alias = await latest(new NextRequest("http://localhost/stats/api/getLatestRun?name=round4-alias"));
    assert.equal(alias.status, 200); assert.deepEqual(await alias.json(), (await data.getLatestRun(user.id))[0]);
    assert.equal((await latest(new NextRequest("http://localhost/stats/api/getLatestRun?name=round4-alias&forceName=true"))).status, 401);
    const {GET: nick} = await import("../app/api/getNickAlways/route");
    const fetch = globalThis.fetch;
    let release!: () => void, started = 0;
    const waiting = new Promise<void>((resolve) => {release = resolve;});
    globalThis.fetch = (async () => {started++; await waiting; return Response.json({name: "FixtureName"});}) as typeof fetch;
    try {
        const requests = Array.from({length: 8}, (_, index) => nick(new NextRequest(`http://localhost/stats/api/getNickAlways?uuid=00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`)));
        assert.equal((await nick(new NextRequest("http://localhost/stats/api/getNickAlways?uuid=00000000-0000-0000-0000-000000000009"))).status, 429);
        while (started < 8) await new Promise((resolve) => setTimeout(resolve, 1));
        release();
        for (const response of await Promise.all(requests)) {assert.equal(response.status, 200); assert.deepEqual(await response.json(), {name: "FixtureName"});}
        assert.equal((await nick(new NextRequest("http://localhost/stats/api/getNickAlways?uuid=00000000-0000-0000-0000-000000000009"))).status, 200);
        console.log(JSON.stringify({case: "live-lookup-api-bounds", invalidCases: cases.length, invalidDbReads: dbReads,
            invalidRedisReads: redisReads, maxConcurrentUpstreams: 8, overloadStatus: 429, recoveryPassed: true}));
    } finally {release(); globalThis.fetch = fetch;}
}

main().then(() => 0, (error) => {console.error(error); return 1;}).then(async (code) => {
    if (created) await fixture.del("users");
    fixture.disconnect(); process.exit(code);
});
