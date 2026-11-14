/** Docker DB14 only: repeated scoped fallbacks avoid repeated Redis timeouts and recover. */
import assert from "node:assert/strict";
import Redis from "ioredis";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

process.env.REDIS_URL = "redis://127.0.0.1:6379/14";
const fixture = new Redis(process.env.REDIS_URL);
let created = false;

async function main() {
    assert.equal(await fixture.exists("users"), 0);
    const source = await import(pathToFileURL(resolve(process.env.PERF_SOURCE_ROOT ?? "/app", "app/data.ts")).href);
    const data = source.default ?? source;
    const runtime = globalThis as typeof globalThis & {__paceStatsRedis: Redis};
    const original = runtime.__paceStatsRedis.call.bind(runtime.__paceStatsRedis), now = Date.now, log = console.error;
    let instant = now(), failures = 0, failing = true;
    Date.now = () => instant;
    console.error = () => undefined;
    runtime.__paceStatsRedis.call = (async (command: string, ...args: any[]) => {
        if (command === "JSON.GET" && args[0] === "users" && failing) {
            failures++; await new Promise((resolve) => setTimeout(resolve, 10));
            throw new Error("Injected compact-users Redis command failure");
        }
        return original(command, ...args);
    }) as typeof original;
    try {
        const started = performance.now();
        for (let index = 0; index < 6; index++) {
            assert.equal(await data.getAllNamesByNick("round4-unknown-player"), null);
            assert.equal(await data.getAllNamesByTwitch("round4-unknown-alias"), null);
            assert.equal(await data.getUserInfo("round4-no-metadata"), null);
        }
        const durationMs = performance.now() - started;
        if (!process.env.PERF_SOURCE_ROOT) assert.equal(failures, 1);
        failing = false;
        const user = {id: "round4-recovered", nick: "RecoveredRound4", twitches: [], displayName: "Recovered", color: "aabbcc", bgColor: null};
        await fixture.call("JSON.SET", "users", "$", JSON.stringify([user])); created = true;
        if (!process.env.PERF_SOURCE_ROOT) assert.equal(await data.getAllNamesByNick(user.nick), null);
        instant += 1_001;
        assert.deepEqual(await data.getAllNamesByNick(user.nick), {uuid: user.id, nick: user.nick});
        assert.equal((await data.getUserInfo(user.id)).color, user.color);
        console.log(JSON.stringify({case: "compact-users-failure-coalescing", serialFallbacks: 18, failures, durationMs, recoveredAfterMs: 1_001}));
    } finally {Date.now = now; console.error = log; runtime.__paceStatsRedis.call = original;}
}

main().then(() => 0, (error) => {console.error(error); return 1;}).then(async (code) => {
    if (created) await fixture.del("users");
    fixture.disconnect(); process.exit(code);
});
