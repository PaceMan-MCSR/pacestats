/** Isolated local Docker Redis DB14; never alters the normal application cache. */
import assert from "node:assert/strict";
import Redis from "ioredis";

process.env.REDIS_URL = "redis://127.0.0.1:6379/14";
const fixture = new Redis(process.env.REDIS_URL);
const uuid = "redis-coalescing-fixture";
const keys = ["users", `nph:${uuid}:30day`, `users:twitch_details:${uuid}`];
const created: string[] = [];

async function main() {
    for (const key of keys) assert.equal(await fixture.exists(key), 0, `Reserved fixture key ${key} already exists`);
    const users = Array.from({length: 4_000}, (_, index) => ({
        id: index === 0 ? uuid : `fixture-${index}`, nick: `Fixture${index}`, twitches: [],
        displayName: index < 2 ? `Custom ${index}` : null, color: null, bgColor: null,
    }));
    const nph = {count: 25, rnph: 12.5};
    const twitch = [{twitch: "fixture", live: false, time: 1_700_000_000}];
    for (const [index, value] of [users, nph, twitch].entries()) {
        await fixture.call("JSON.SET", keys[index], "$", JSON.stringify(value));
        created.push(keys[index]);
    }
    const data = await import("../app/data");
    const runtime = globalThis as typeof globalThis & {__paceStatsRedis: Redis};
    const original = runtime.__paceStatsRedis.call.bind(runtime.__paceStatsRedis);
    const counts: Record<string, number> = {};
    runtime.__paceStatsRedis.call = ((command: string, ...args: any[]) => {
        if (command === "JSON.GET") counts[args[0]] = (counts[args[0]] ?? 0) + 1;
        return original(command, ...args);
    }) as typeof original;
    try {
        const started = performance.now();
        const values = await Promise.all(Array.from({length: 20}, async () => {
            const [info, identity, stats, accounts] = await Promise.all([
                data.getAllUserInfo(), data.getAllNamesByNick("Fixture0"),
                data.fetchNphFromRedis(uuid, 30), data.fetchTwitchesFromRedis(uuid),
            ]);
            assert.equal(info.length, 2);
            assert.deepEqual(identity, {uuid, nick: "Fixture0"});
            assert.deepEqual(stats, nph);
            assert.deepEqual(accounts, twitch);
            return info;
        }));
        assert.equal(values.length, 20);
        assert.deepEqual(counts, Object.fromEntries(keys.map((key) => [key, 1])));
        console.log(JSON.stringify({case: "parallel-profile-read-coalescing", requests: 20, redisReads: counts,
            durationMs: performance.now() - started}));
    } finally {
        runtime.__paceStatsRedis.call = original;
    }
}

main().then(() => 0, (error) => {console.error(error); return 1;}).then(async (code) => {
    if (created.length > 0) await fixture.del(...created);
    fixture.disconnect();
    process.exit(code);
});
