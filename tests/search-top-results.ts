/** Isolated Docker Redis DB14; compare bounded results with a full-sort reference. */
import assert from "node:assert/strict";
import Redis from "ioredis";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

process.env.REDIS_URL = "redis://127.0.0.1:6379/14";
const redis = new Redis(process.env.REDIS_URL);
let created = false;

async function main() {
    assert.equal(await redis.exists("users"), 0);
    const users = Array.from({length: 4_350}, (_, index) => ({
        id: `fixture-${index}`, nick: `Player_${index * 1_543 % 4_350}`, twitches: [`alias${index}`, `shared${index % 10}`],
        displayName: `Custom${index}`, color: null, bgColor: null,
    }));
    for (const [index, nick] of ["alpha", "ALPHA", "álpha", "Alpha_", "Alpha_"].entries()) users[index].nick = nick;
    await redis.call("JSON.SET", "users", "$", JSON.stringify(users)); created = true;
    const source = await import(pathToFileURL(resolve(process.env.PERF_SOURCE_ROOT ?? "/app", "app/data.ts")).href);
    const data = source.default ?? source;
    const queries = ["player", "_1", "er", "al", "AA", "alias", "shared", "plaYer_432", "ál", "no-match", " x "];
    const reference = (query: string, limit: number) => {
        const q = query.trim().toLocaleLowerCase().slice(0, 64);
        if (q.length < 2) return [];
        return users.map((user) => {
            const name = user.nick.toLocaleLowerCase(), aliases = user.twitches.map((alias) => alias.toLocaleLowerCase());
            const score = name === q ? 0 : name.startsWith(q) ? 1 : aliases.includes(q) ? 2 :
                aliases.some((alias) => alias.startsWith(q)) ? 3 : name.includes(q) ? 4 : aliases.some((alias) => alias.includes(q)) ? 5 : Infinity;
            return {user, score};
        }).filter(({score}) => Number.isFinite(score)).sort((a, b) => a.score - b.score || a.user.nick.localeCompare(b.user.nick))
            .slice(0, limit).map(({user}) => ({id: user.id, name: user.nick, displayName: user.displayName, color: null, bgColor: null}));
    };
    for (const query of queries) for (const limit of [1, 8, 20]) {
        assert.deepEqual(await data.searchPlayers(query, limit), reference(query, limit), `${query}/${limit}`);
    }
    global.gc?.(); const heap = process.memoryUsage().heapUsed, cpu = process.cpuUsage(), started = performance.now();
    for (let index = 0; index < 300; index++) await data.searchPlayers(queries[index % queries.length], 8);
    const used = process.cpuUsage(cpu);
    console.log(JSON.stringify({case: "player-search", queries: 300, users: users.length, parityCases: queries.length * 3,
        durationMs: performance.now() - started, cpuMs: (used.user + used.system) / 1_000,
        heapDeltaMiB: (process.memoryUsage().heapUsed - heap) / 1_048_576}));
}

main().then(() => 0, (error) => {console.error(error); return 1;}).then(async (code) => {
    if (created) await redis.del("users");
    redis.disconnect(); process.exit(code);
});
