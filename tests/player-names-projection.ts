/** Docker DB14 only: reuse immutable name projections until their source list changes. */
import assert from "node:assert/strict";
import Redis from "ioredis";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

process.env.REDIS_URL = "redis://127.0.0.1:6379/14";
const fixture = new Redis(process.env.REDIS_URL);
let created = false;

async function main() {
    assert.equal(await fixture.exists("users"), 0);
    const users = Array.from({length: 4_350}, (_, index) => ({id: `round4-${index}`, nick: `Player${index}`,
        twitches: index % 3 ? [] : [`alias${index}`, `Alias_${index}`], displayName: null, color: null, bgColor: null}));
    await fixture.call("JSON.SET", "users", "$", JSON.stringify(users)); created = true;
    const {getAllUsers, getCached} = await import("../app/data");
    const route = await import(pathToFileURL(resolve(process.env.PERF_SOURCE_ROOT ?? "/app", "app/api/getPlayerNames/route.ts")).href);
    const {GET} = route.default ?? route;
    const shared = await getCached(getAllUsers, "getAllUsers");
    const map = shared.map.bind(shared);
    let projections = 0;
    shared.map = (...args: any[]) => {projections++; return map(...args);};
    const expected = users.map((user) => user.twitches.length ? [user.nick, ...user.twitches] : user.nick);
    global.gc?.(); const cpu = process.cpuUsage(), heap = process.memoryUsage().heapUsed, started = performance.now();
    for (let index = 0; index < 100; index++) {
        const response = await GET();
        assert.match(response.headers.get("Cache-Control"), /s-maxage=600/);
        assert.deepEqual(await response.json(), expected);
    }
    const used = process.cpuUsage(cpu);
    const metrics = {durationMs: performance.now() - started, cpuMs: (used.user + used.system) / 1_000,
        heapDeltaMiB: (process.memoryUsage().heapUsed - heap) / 1_048_576, projections};
    if (!process.env.PERF_SOURCE_ROOT) assert.equal(projections, 1);
    const runtime = globalThis as typeof globalThis & {__paceStatsCache: {flushAll: () => void}};
    runtime.__paceStatsCache.flushAll();
    await fixture.call("JSON.SET", "users", "$", JSON.stringify([{id: "new", nick: "NewPlayer", twitches: ["newalias"]}]));
    assert.deepEqual(await (await GET()).json(), [["NewPlayer", "newalias"]]);
    console.log(JSON.stringify({case: "player-names-projection", requests: 100, users: users.length, ...metrics, replacementPassed: true}));
}

main().then(() => 0, (error) => {console.error(error); return 1;}).then(async (code) => {
    if (created) await fixture.del("users");
    fixture.disconnect(); process.exit(code);
});
