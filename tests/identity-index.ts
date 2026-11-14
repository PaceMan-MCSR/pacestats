/** Isolated local Docker Redis DB14; measure distinct cold identity lookups. */
import assert from "node:assert/strict";
import Redis from "ioredis";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

process.env.REDIS_URL = "redis://127.0.0.1:6379/14";
const redis = new Redis(process.env.REDIS_URL);
let created = false;

async function main() {
    assert.equal(await redis.exists("users"), 0, "Reserved isolated users fixture already exists");
    const users = Array.from({length: 4_350}, (_, index) => ({
        id: `fixture-${index}`, nick: `Fixture${index}`, twitches: [`handle${index}`],
        displayName: `Custom${index}`, color: null, bgColor: null,
    }));
    users[0].twitches.push("HANDLE0");
    users.push({...users[0], id: "ambiguous1", nick: "NoFearr1337", twitches: ["nofearr1337"]});
    users.push({...users[0], id: "ambiguous2", nick: "NoFearr1337", twitches: ["NOFEARR1337"]});
    await redis.call("JSON.SET", "users", "$", JSON.stringify(users));
    created = true;
    const source = await import(pathToFileURL(resolve(process.env.PERF_SOURCE_ROOT ?? "/app", "app/data.ts")).href);
    const data = source.default ?? source;
    await data.getAllNamesByNick("Fixture0");
    global.gc?.();
    const before = process.memoryUsage();
    const cpu = process.cpuUsage();
    const started = performance.now();
    for (let index = 0; index < 500; index++) {
        assert.deepEqual(await data.getAllNamesByNick(`FIXTURE${index}`), {uuid: `fixture-${index}`, nick: `Fixture${index}`});
        assert.deepEqual(await data.getAllNamesByTwitch(`HANDLE${index}`), {uuid: `fixture-${index}`, nick: `Fixture${index}`});
        assert.equal((await data.getUserInfo(`fixture-${index}`)).displayName, `Custom${index}`);
    }
    const used = process.cpuUsage(cpu);
    const metrics = {durationMs: performance.now() - started, cpuMs: (used.user + used.system) / 1_000,
        heapDeltaMiB: (process.memoryUsage().heapUsed - before.heapUsed) / 1_048_576};
    const real = {uuid: "e4cd494a-4e0a-423b-9988-618b86858c96", nick: "NoFearr1337"};
    assert.deepEqual(await data.getAllNamesByNick("NoFearr1337"), real, "Ambiguous nicknames must use the latest SQL association");
    assert.deepEqual(await data.getAllNamesByTwitch("nofearr1337"), real, "Ambiguous aliases must use the latest SQL association");
    users[0].nick = "UpdatedFixture";
    await redis.call("JSON.SET", "users", "$", JSON.stringify(users));
    (globalThis as typeof globalThis & {__paceStatsCache: {del: (key: string) => number}}).__paceStatsCache.del('["fetchAllUsersFromRedis"]');
    assert.deepEqual(await data.getAllNamesByNick("UpdatedFixture"), {uuid: "fixture-0", nick: "UpdatedFixture"});
    assert.equal(await data.getAllNamesByNick("Fixture0"), null, "An index must be replaced with the parsed list");
    console.log(JSON.stringify({case: "identity-lookups", users: users.length, lookups: 1_500, ...metrics}));
}

main().then(() => 0, (error) => {console.error(error); return 1;}).then(async (code) => {
    if (created) await redis.del("users");
    redis.disconnect();
    process.exit(code);
});
