/** Host-safe: startup uses fake cache-backed readers, with no SQL/Redis/upstream connections. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createContext, runInContext} from "node:vm";
import ts from "typescript";
import {startWebsiteCacheWarmup, warmWebsiteCaches} from "../app/cacheWarmup.server";
import {CategoryType, getMinQty} from "../app/utils";

type Data = typeof import("../app/data");
type Call = {name: string; args: unknown[]};
const periods = [30, 1, 7, 9999];
const categories = ["nether", "bastion", "fortress", "first_structure", "second_structure",
    "first_portal", "second_portal", "stronghold", "end", "finish"];
const readerNames = [
    "getBans", "getAllUsers", "getAllUserInfo", "getTrimmedLeaderboards", "getTrimmedAALB", "getPBs",
    "fetchLeaderboardCategoryFromRedis", "fetchFastestLeaderboardCategoryFromRedis",
    "getAllNamesByNick", "getAllNamesByTwitch", "getUserInfo", "fetchTwitchesFromRedis",
    "fetchPlayerStatsFromRedis", "fetchNphFromRedis", "getAAPlayerStats", "getPlayerRuns",
    "getRecentAARuns", "getRecentNethers", "getPlayerRunsOffsetPage", "getPlayerRunsPage",
    "getAAPlayerRunsPage", "getLatestRun", "jude", "getRecentTimestamps", "getAllPlayerRunsByPeriod", "getSplitRunsByPeriod",
    "getSessionStats", "getNPH", "getSessionNethers", "resolveCombinedPlayerUuids",
    "getCombinedSplitAggregates", "getCombinedNetherAggregate", "getWorldLiveData",
];
const keyFor = (name: string, args: unknown[]) => JSON.stringify([name, ...args]);
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function fixture(options: {delayMs?: number; fail?: (call: Call) => boolean} = {}) {
    const users = Array.from({length: 40}, (_, index) => ({
        id: `player-${index}`, nick: `Player${index}`,
        twitches: Array.from({length: 4}, (_, account) => `twitch-${index}-${account}`),
    }));
    // Every board contributes distinct players. Duplicates and unknown identities
    // must not consume the limit, and the remaining directory cannot seed warming.
    const boards = Array.from({length: 8}, (_, index) => ({
        [CategoryType.COUNT]: {nether: [
            {uuid: "unknown-player"}, {uuid: users[index].id}, {uuid: users[index].id},
            ...[8, 16, 24, 32].map(offset => ({uuid: users[index + offset].id})),
        ]},
    }));
    const calls: Call[] = [], reads: Call[] = [], cacheCalls: Call[] = [];
    const values = new Map<string, unknown>(), inflight = new Map<string, Promise<unknown>>();
    let active = 0, maxActive = 0;
    const memoized = (key: string, produce: () => Promise<unknown>): Promise<unknown> => {
        if (values.has(key)) return Promise.resolve(values.get(key));
        const pending = inflight.get(key);
        if (pending) return pending;
        const promise = Promise.resolve().then(produce).then(value => {
            values.set(key, value);
            return value;
        }).finally(() => inflight.delete(key));
        inflight.set(key, promise);
        return promise;
    };
    const methods: Record<string, (...args: any[]) => Promise<any>> = {};
    for (const name of readerNames) methods[name] = async (...args: unknown[]) => {
        const call = {name, args};
        calls.push(call);
        // Direct data readers have their own cache too. Keep these keys separate
        // from getCached so argument omissions remain observable on public keys.
        return memoized(`reader:${keyFor(name, args)}`, async () => {
            reads.push(call);
            active++;
            maxActive = Math.max(maxActive, active);
            try {
                if (options.delayMs) await delay(options.delayMs);
                else await Promise.resolve();
                if (options.fail?.(call)) throw new Error(`Injected ${name} failure`);
                if (name === "getAllUsers") return users;
                if (name === "getTrimmedLeaderboards") return boards[periods.indexOf(Number(args[0])) * 2];
                if (name === "getTrimmedAALB") return boards[periods.indexOf(Number(args[0])) * 2 + 1];
                if (name === "getPlayerRuns") return [
                    {id: "shared-world"}, {id: `${args[0]}-world`}, {id: "shared-world"},
                ];
                return [];
            } finally {active--;}
        });
    };
    methods.getCached = async (produce: (...args: unknown[]) => Promise<unknown>, name: string, ...args: unknown[]) => {
        cacheCalls.push({name, args});
        return memoized(`public:${keyFor(name, args)}`, () => produce(...args));
    };
    return {
        data: {...methods, SESSION_PAGE_ROWS: 1_000} as unknown as Data, users, calls, reads, cacheCalls,
        get maxActive() {return maxActive;},
        has(name: string, ...args: unknown[]) {
            return calls.some(call => keyFor(call.name, call.args) === keyFor(name, args));
        },
        cached(name: string, ...args: unknown[]) {
            return cacheCalls.some(call => keyFor(call.name, call.args) === keyFor(name, args));
        },
    };
}

async function verifyCoverageAndCacheHits() {
    const fake = fixture();
    const result = await warmWebsiteCaches(fake.data);
    assert.equal(result.failed, 0);
    assert.equal(result.skipped, 0);
    assert.deepEqual(result.failures, []);
    assert.equal(result.players, 12, "Default warming selects only twelve active board players");
    assert.equal(fake.maxActive, 2, "Two workers cap simultaneous cold data reads");
    for (const name of ["getBans", "getAllUsers", "getAllUserInfo"]) assert.ok(fake.cached(name), name);
    assert.ok(fake.cached("getPBs", [], []));
    for (const days of periods) {
        assert.ok(fake.cached("getTrimmedLeaderboards", days));
        assert.ok(fake.cached("getTrimmedAALB", days, 10, false));
        for (const category of categories) {
            for (const filter of [CategoryType.COUNT, CategoryType.AVG, CategoryType.FASTEST, CategoryType.CONVERSION]) {
                const minQty = filter === CategoryType.AVG || filter === CategoryType.CONVERSION ? getMinQty(category, days) : 0;
                assert.ok(fake.cached("fetchLeaderboardCategoryFromRedis", days, category, filter, 10, minQty),
                    `${days}/${category}/${filter} warms the public API key`);
            }
            assert.ok(fake.cached("fetchFastestLeaderboardCategoryFromRedis", days, category, 10));
        }
    }
    const selected = [...new Set(fake.calls.filter(call => call.name === "fetchPlayerStatsFromRedis").map(call => call.args[0]))];
    assert.deepEqual(selected, fake.users.slice(0, 12).map(user => user.id), "Selection takes turns across pace/AA period boards and deduplicates UUIDs");
    for (const user of fake.users.slice(0, 12)) {
        const uuid = user.id;
        assert.ok(fake.cached("getAllNamesByNick", user.nick));
        assert.ok(fake.cached("getUserInfo", uuid));
        assert.ok(fake.has("fetchTwitchesFromRedis", uuid));
        for (const twitch of user.twitches.slice(0, 3)) assert.ok(fake.cached("getAllNamesByTwitch", twitch));
        assert.ok(!fake.cached("getAllNamesByTwitch", user.twitches[3]), "Twitch aliases are bounded");
        for (const days of periods) for (const name of ["fetchPlayerStatsFromRedis", "fetchNphFromRedis", "getAAPlayerStats"]) {
            assert.ok(fake.has(name, uuid, days), `${name}/${days}`);
        }
        assert.ok(fake.cached("getPlayerRuns", uuid, 4));
        assert.ok(fake.cached("getRecentAARuns", uuid, 4));
        assert.ok(fake.cached("getRecentNethers", uuid, 100));
        assert.ok(fake.cached("getPlayerRunsOffsetPage", uuid, 0, 25, [], {column: "date", direction: "desc"}));
        assert.ok(fake.cached("getPlayerRunsPage", uuid, null, 25));
        assert.ok(fake.cached("getAAPlayerRunsPage", uuid, null, 100));
        assert.ok(fake.cached("getAAPlayerRunsPage", uuid, null, 25));
        assert.ok(fake.cached("getLatestRun", uuid));
        assert.ok(fake.cached("jude", uuid));
        assert.ok(fake.cached("getRecentTimestamps", uuid, 20, false));
        assert.ok(fake.cached("getAllPlayerRunsByPeriod", uuid, Math.ceil(9_999_999 / 24), 10));
        assert.ok(fake.cached("getSplitRunsByPeriod", uuid, 1, "nether", 1_000));
        for (const gap of [3, 2, 6]) {
            assert.ok(fake.cached("getSessionStats", uuid, 24, gap));
            assert.ok(fake.cached("getNPH", uuid, 24, gap), "Page NPH omits the optional false argument");
        }
        for (const gap of [2, 6]) {
            assert.ok(fake.cached("getNPH", uuid, 24, gap, false), "API NPH includes false in its cache key");
            assert.ok(fake.has("getSessionNethers", uuid, 24, gap, false, 0));
        }
        assert.ok(fake.cached("resolveCombinedPlayerUuids", [user.nick]));
        for (const gap of [2, 6]) {
            assert.ok(fake.cached("getCombinedSplitAggregates", [uuid], 24, gap, 0));
            assert.ok(fake.cached("getCombinedNetherAggregate", [uuid], 24, gap, 0, 99_999_999));
        }
        assert.ok(fake.cached("getWorldLiveData", `${uuid}-world`));
    }
    assert.equal(fake.calls.filter(call => call.name === "getWorldLiveData" && call.args[0] === "shared-world").length, 1);
    const coldReads = fake.reads.length;
    const repeated = await warmWebsiteCaches(fake.data);
    assert.deepEqual(repeated, result);
    assert.equal(fake.reads.length, coldReads, "Replaying website cache keys needs no additional backing reads");
}

async function verifyBoundsAndFailureIsolation() {
    const limited = fixture();
    assert.equal((await warmWebsiteCaches(limited.data, {playerLimit: 2})).players, 2);
    assert.deepEqual([...new Set(limited.calls.filter(call => call.name === "fetchPlayerStatsFromRedis").map(call => call.args[0]))],
        ["player-0", "player-1"]);
    const disabledPlayers = fixture();
    assert.equal((await warmWebsiteCaches(disabledPlayers.data, {playerLimit: 0})).players, 0);
    assert.ok(!disabledPlayers.calls.some(call => call.name === "fetchPlayerStatsFromRedis"));
    assert.ok(disabledPlayers.cached("getPBs", [], []), "Disabling player seeds retains common shared endpoints");

    const failing = fixture({fail: call =>
        call.name === "getTrimmedLeaderboards" && call.args[0] === 1 ||
        call.name === "fetchLeaderboardCategoryFromRedis" && call.args[0] === 30 && call.args[1] === "nether" && call.args[2] === CategoryType.AVG ||
        call.name === "fetchPlayerStatsFromRedis" && call.args[0] === "player-0" && call.args[1] === 30,
    });
    const result = await warmWebsiteCaches(failing.data, {playerLimit: 2});
    assert.equal(result.failed, 3);
    assert.deepEqual(new Set(result.failures), new Set(["getTrimmedLeaderboards", "fetchLeaderboardCategoryFromRedis", "fetchPlayerStatsFromRedis"]));
    assert.equal(result.skipped, 0);
    assert.ok(failing.cached("getTrimmedAALB", 9999, 10, false));
    assert.ok(failing.has("getAAPlayerStats", "player-1", 9999));
    assert.ok(failing.cached("getWorldLiveData", "player-1-world"), "Other endpoint failures do not stop subsequent player/world warming");

    const slow = fixture({delayMs: 10});
    const budgeted = await warmWebsiteCaches(slow.data, {budgetMs: 1});
    assert.ok(slow.reads.length <= 2, "Expired budget never starts additional queued jobs");
    assert.ok(budgeted.skipped > 0);
    assert.equal(budgeted.failed, 0);
    assert.equal(budgeted.warmed, slow.reads.length, "In-flight reads finish normally after the budget");
    assert.ok(slow.maxActive <= 2);
}

async function verifyStartupLifecycle() {
    // Disabled startup must return before the real data module is imported.
    const originalEnabled = process.env.DATA_CACHE_WARMUP_ENABLED, originalPhase = process.env.NEXT_PHASE;
    const runtime = globalThis as typeof globalThis & {__paceStatsCacheWarmup?: Promise<void>};
    const originalWarmup = runtime.__paceStatsCacheWarmup;
    try {
        delete runtime.__paceStatsCacheWarmup;
        process.env.DATA_CACHE_WARMUP_ENABLED = "false";
        startWebsiteCacheWarmup();
        assert.equal(runtime.__paceStatsCacheWarmup, undefined);
        process.env.DATA_CACHE_WARMUP_ENABLED = "true";
        process.env.NEXT_PHASE = "phase-production-build";
        startWebsiteCacheWarmup();
        assert.equal(runtime.__paceStatsCacheWarmup, undefined);
    } finally {
        if (originalEnabled === undefined) delete process.env.DATA_CACHE_WARMUP_ENABLED;
        else process.env.DATA_CACHE_WARMUP_ENABLED = originalEnabled;
        if (originalPhase === undefined) delete process.env.NEXT_PHASE;
        else process.env.NEXT_PHASE = originalPhase;
        if (originalWarmup === undefined) delete runtime.__paceStatsCacheWarmup;
        else runtime.__paceStatsCacheWarmup = originalWarmup;
    }

    // Execute the real module with its dynamic data import intercepted. Sharing
    // one VM global between evaluations also exercises development module reloads.
    const source = readFileSync(new URL("../app/cacheWarmup.server.ts", import.meta.url), "utf8");
    const compiled = ts.transpileModule(source, {compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021,
    }}).outputText;
    const fake = fixture(), logs: string[] = [];
    let imports = 0;
    const context = createContext({});
    const load = (failImport = false, vmContext = context) => {
        const exports: {startWebsiteCacheWarmup?: () => void} = {};
        const evaluate = runInContext(`(function(exports, require, process, console) {${compiled}\n})`, vmContext);
        evaluate(exports, (name: string) => {
            if (name === "./utils") return {CategoryType, getMinQty};
            assert.equal(name, "./data", "Startup cannot import external dependencies in this fixture");
            imports++;
            if (failImport) throw new Error("Injected data import failure");
            return fake.data;
        }, {env: {DATA_CACHE_WARMUP_PLAYERS: "0"}}, {
            info: (message: string) => logs.push(message), warn: (message: string) => logs.push(message),
        });
        return exports.startWebsiteCacheWarmup!;
    };
    const first = load();
    first();
    first();
    const promise = context.__paceStatsCacheWarmup as Promise<void>;
    assert.equal(typeof promise?.then, "function");
    load()();
    assert.equal(context.__paceStatsCacheWarmup, promise, "Reloaded modules reuse the process-global startup promise");
    await promise;
    assert.equal(imports, 1);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /cache-warmup.*Warmed/);

    const failingContext = createContext({});
    load(true, failingContext)();
    await failingContext.__paceStatsCacheWarmup;
    assert.equal(imports, 2);
    assert.match(logs[1], /Startup warming failed/);
}

async function main() {
    await verifyCoverageAndCacheHits();
    await verifyBoundsAndFailureIsolation();
    await verifyStartupLifecycle();
    console.log("Startup cache warmup: endpoint keys, cache hits, bounded fair player selection, concurrency, deadline, failure isolation and startup lifecycle passed");
}

main().catch(error => {console.error(error); process.exitCode = 1;});
