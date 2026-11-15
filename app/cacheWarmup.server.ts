import {CategoryType, getMinQty} from "./utils";

type Data = typeof import("./data");
type Task = {name: string; run: () => Promise<unknown>};
type Board = Record<string, Record<string, {uuid: string}[]>>;
type User = {id: string; nick: string; twitches?: string[]};

const periods = [30, 1, 7, 9999];
const categories = [
    "nether", "bastion", "fortress", "first_structure", "second_structure",
    "first_portal", "second_portal", "stronghold", "end", "finish",
];
const concurrency = 2;

export type CacheWarmupResult = {
    warmed: number;
    failed: number;
    skipped: number;
    players: number;
    failures: string[];
};

const boundedInteger = (value: unknown, fallback: number, min: number, max: number) => {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

/** Use the same helpers, argument lists and TTLs as pages/API routes. Never
 * regenerate Redis aggregates or change cache freshness as part of startup. */
export async function warmWebsiteCaches(data: Data, options: {playerLimit?: number; budgetMs?: number} = {}) {
    const playerLimit = boundedInteger(options.playerLimit ?? process.env.DATA_CACHE_WARMUP_PLAYERS, 12, 0, 50);
    const budgetMs = boundedInteger(options.budgetMs ?? process.env.DATA_CACHE_WARMUP_MAX_MS, 60_000, 1, 300_000);
    const deadline = Date.now() + budgetMs;
    const result: CacheWarmupResult = {warmed: 0, failed: 0, skipped: 0, players: 0, failures: []};
    const failures = new Set<string>();
    const cached = (name: keyof Data, ...args: unknown[]): Task => ({
        name,
        run: () => data.getCached(data[name] as (...values: unknown[]) => Promise<unknown>, name, ...args),
    });
    const runTasks = async (tasks: Task[]) => {
        let next = 0;
        await Promise.all(Array.from({length: Math.min(concurrency, tasks.length)}, async () => {
            while (next < tasks.length) {
                const task = tasks[next++];
                // Already-started reads retain their normal Redis/SQL timeouts;
                // stop queueing work once startup's separate budget is spent.
                if (Date.now() >= deadline) {result.skipped++; continue;}
                try {
                    await task.run();
                    result.warmed++;
                } catch {
                    result.failed++;
                    failures.add(task.name);
                }
            }
        }));
    };

    let users: User[] = [];
    // Keep board order deterministic even when the reads complete out of order.
    const boards: (Board | undefined)[] = Array(periods.length * 2);
    await runTasks([
        cached("getBans"),
        {name: "getAllUsers", run: async () => {users = await cached("getAllUsers").run() as User[];}},
        cached("getAllUserInfo"),
        ...periods.flatMap((days, index) => [
            {name: "getTrimmedLeaderboards", run: async () => {
                boards[index * 2] = await cached("getTrimmedLeaderboards", days).run() as Board;
            }},
            {name: "getTrimmedAALB", run: async () => {
                boards[index * 2 + 1] = await cached("getTrimmedAALB", days, 10, false).run() as Board;
            }},
        ]),
    ]);

    // Default public leaderboard requests have different keys from the compact
    // website boards. Warm their small branches without loading entire boards.
    await runTasks([
        ...periods.flatMap(days => categories.flatMap(category => [
            ...[CategoryType.COUNT, CategoryType.AVG, CategoryType.FASTEST, CategoryType.CONVERSION].map(filter =>
                cached("fetchLeaderboardCategoryFromRedis", days, category, filter, 10,
                    filter === CategoryType.AVG || filter === CategoryType.CONVERSION ? getMinQty(category, days) : 0)),
            cached("fetchFastestLeaderboardCategoryFromRedis", days, category, 10),
        ])),
        cached("getPBs", [], []),
    ]);

    const usersById = new Map(users.map(user => [user.id, user]));
    const candidates = boards.filter((board): board is Board => !!board).map(board =>
        Object.values(board).flatMap(branches => Object.values(branches).flat()));
    const selected = new Set<string>();
    // Take turns across pace/AA and all periods so one large board cannot fill
    // the player budget. Only identities in the shared player directory seed reads.
    for (let row = 0; selected.size < playerLimit && candidates.some(entries => row < entries.length); row++) {
        for (const entries of candidates) {
            const uuid = entries[row]?.uuid;
            if (uuid && usersById.has(uuid)) selected.add(uuid);
            if (selected.size === playerLimit) break;
        }
    }
    result.players = selected.size;

    const identities: Task[] = [];
    const profiles: Task[] = [];
    const recent: Task[] = [];
    const runIds = new Set<string>();
    for (const uuid of selected) {
        const user = usersById.get(uuid)!;
        identities.push(cached("getAllNamesByNick", user.nick), cached("getUserInfo", uuid),
            {name: "fetchTwitchesFromRedis", run: () => data.fetchTwitchesFromRedis(uuid)});
        for (const twitch of (user.twitches ?? []).slice(0, 3)) identities.push(cached("getAllNamesByTwitch", twitch));
        for (const days of periods) {
            profiles.push(
                {name: "fetchPlayerStatsFromRedis", run: () => data.fetchPlayerStatsFromRedis(uuid, days)},
                {name: "fetchNphFromRedis", run: () => data.fetchNphFromRedis(uuid, days)},
                {name: "getAAPlayerStats", run: () => data.getAAPlayerStats(uuid, days)},
            );
        }
        recent.push(
            {name: "getPlayerRuns", run: async () => {
                const runs = await cached("getPlayerRuns", uuid, 4).run() as {id: string | number}[];
                // These are the IDs linked by the profile's recent-run rows.
                for (const run of runs) if (run.id !== undefined) runIds.add(String(run.id));
            }},
            cached("getRecentAARuns", uuid, 4),
            cached("getRecentNethers", uuid, 100),
            cached("getPlayerRunsOffsetPage", uuid, 0, 25, [], {column: "date", direction: "desc"}),
            cached("getPlayerRunsPage", uuid, null, 25),
            cached("getAAPlayerRunsPage", uuid, null, 100),
            cached("getAAPlayerRunsPage", uuid, null, 25),
            cached("getLatestRun", uuid),
            cached("jude", uuid),
            cached("getRecentTimestamps", uuid, 20, false),
            cached("getAllPlayerRunsByPeriod", uuid, Math.ceil(9_999_999 / 24), 10),
            cached("getSplitRunsByPeriod", uuid, 1, "nether", data.SESSION_PAGE_ROWS),
            // Page, API and overlay defaults differ; argument count also forms
            // part of the cache key (omitting false is a distinct entry).
            ...[3, 2, 6].flatMap(gap => [cached("getSessionStats", uuid, 24, gap), cached("getNPH", uuid, 24, gap)]),
            ...[2, 6].map(gap => cached("getNPH", uuid, 24, gap, false)),
            {name: "getSessionNethers", run: () => data.getSessionNethers(uuid, 24, 2, false, 0)},
            {name: "getSessionNethers", run: () => data.getSessionNethers(uuid, 24, 6, false, 0)},
            cached("resolveCombinedPlayerUuids", [user.nick]),
            ...[2, 6].flatMap(gap => [
                cached("getCombinedSplitAggregates", [uuid], 24, gap, 0),
                cached("getCombinedNetherAggregate", [uuid], 24, gap, 0, 99_999_999),
            ]),
        );
    }
    // Longer-lived identity/projection entries first, short-lived live data last.
    await runTasks(identities);
    await runTasks(profiles);
    await runTasks(recent);
    await runTasks([...runIds].slice(0, playerLimit * 4).map(id => cached("getWorldLiveData", id)));
    result.failures = [...failures];
    return result;
}

type WarmupRuntime = typeof globalThis & {__paceStatsCacheWarmup?: Promise<void>};

/** Fire once per Node process, including development HMR/reloaded bundles.
 * Registration stays fast and unavailable dependencies cannot prevent serving. */
export function startWebsiteCacheWarmup() {
    if (process.env.DATA_CACHE_WARMUP_ENABLED === "false" || process.env.NEXT_PHASE === "phase-production-build") return;
    const runtime = globalThis as WarmupRuntime;
    runtime.__paceStatsCacheWarmup ??= import("./data")
        .then(data => warmWebsiteCaches(data))
        .then(result => {
            const summary = `[cache-warmup] Warmed ${result.warmed} reads for ${result.players} players; ` +
                `${result.failed} failed, ${result.skipped} skipped.`;
            if (result.failed || result.skipped) console.warn(summary, result.failures.join(", "));
            else console.info(summary);
        })
        .catch(() => {console.warn("[cache-warmup] Startup warming failed; requests will fill caches normally.");});
}
