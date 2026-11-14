import {
    CategoryType,
    formatTime,
    getEventTime,
    getFirstStructure,
    getMinAAQty,
    getSecondStructure,
    roundNumber
} from "@/app/utils";
import mysql from 'mysql2/promise';
import type {QueryResult} from 'mysql2';
import { Entry } from "@/app/types";
import {calculateAvg, trimmedStats, type TrimmedStats} from "@/app/trimmedAverage";
import {
    bucketStart,
    COMBINED_BUCKET_SECONDS,
    COMBINED_DELETE_OVERLAP_SECONDS,
    COMBINED_MAX_ID_FIELD,
    COMBINED_MAX_STALENESS_SECONDS,
    COMBINED_SETTLE_SECONDS,
    COMBINED_STATE_KEY,
    COMBINED_SUMMARY_VERSION,
    COMBINED_ZONE_SLACK_SECONDS,
    combinedSplitCategories,
    combinedSplitRowsSql,
    combinedSummaryKey,
    unionTrimmedStats,
    type BucketSummary,
    type SummaryPart,
} from "@/app/combinedSummary";
import {
    LEGACY_RUN_HISTORY_PREFIX,
    parseRunHistoryBase,
    parseRunHistoryHead,
    runHistoryBaseKey,
    runHistoryHeadKey,
} from "@/app/runHistory";
import Redis from "ioredis";
import NodeCache from "node-cache";

const DEFAULT_DB_POOL_SIZE = 10;
const DEFAULT_DB_POOL_QUEUE_LIMIT = 500;
const DEFAULT_CACHE_MAX_KEYS = 2_000;
const DEFAULT_CACHE_MAX_ARRAY_ROWS = 25_000;
const MAX_LOOKBACK_DAYS = 9_999;
const MAX_STATS_ROWS_PER_PLAYER = 100_000;
const MAX_SESSION_ROWS = 10_000;

const boundedInteger = (value: unknown, fallback: number, min: number, max: number) => {
    const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
    return Number.isSafeInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

const boundedEnvInteger = (value: string | undefined, fallback: number, min: number, max: number) =>
    boundedInteger(value, fallback, min, max);

// mysql2 sends JavaScript numbers through the prepared-statement protocol as
// DOUBLE. MySQL 8.0 assigns integer types to LIMIT markers (and retains inferred
// marker types), which can reject those DOUBLE bindings with ER_WRONG_ARGUMENTS.
// These values are already range-checked integers; sending their decimal form
// lets MySQL cast them to the marker's inferred integer/interval type.
const mysqlIntegerParam = (value: number): string => String(value);

const intervalDays = (value: string | number, fallback = 30) => {
    const parsed = typeof value === "number"
        ? value
        : Number.parseInt(String(value).trim().split(/\s+/)[0], 10);
    return boundedInteger(parsed, fallback, 1, MAX_LOOKBACK_DAYS);
};

type PaceStatsRuntime = typeof globalThis & {
    __paceStatsCache?: NodeCache;
    __paceStatsCacheAccess?: Map<string, number>;
    __paceStatsCacheListenersRegistered?: boolean;
    __paceStatsPromiseCache?: Map<string, Promise<unknown>>;
    __paceStatsDbPool?: mysql.Pool;
    __paceStatsRedis?: Redis;
    __paceStatsRedisListenersRegistered?: boolean;
    __paceStatsLastRedisErrorAt?: number;
    __paceStatsLastPublishWarningAt?: number;
    __paceStatsDbPoolMetrics?: DbPoolMetrics;
    __paceStatsCombinedMetrics?: CombinedMetrics;
    __paceStatsRunBases?: Map<string, {version: string; runs: any[]}>;
};

/** How the combined endpoints without a session gap were answered. */
type CombinedMetrics = {
    /** Requests served from bucket summaries. */
    fromSummaries: number;
    /** Requests that read every row of the window instead. */
    fromRows: number;
    /** Buckets read from MySQL because their stored tail was too short. */
    bucketsReadInFull: number;
    /** Players read from MySQL because their summarised rows had changed. */
    stalePlayers: number;
};

type DbPoolMetrics = {
    active: number;
    pending: number;
    peakActive: number;
    peakPending: number;
    acquireTimeouts: number;
    acquireErrors: number;
    queryTimeouts: number;
    lastPressureWarningAt: number;
};

const runtime = globalThis as PaceStatsRuntime;
const cacheMaxKeys = boundedEnvInteger(process.env.DATA_CACHE_MAX_KEYS, DEFAULT_CACHE_MAX_KEYS, 100, 10_000);
const cacheMaxArrayRows = boundedEnvInteger(
    process.env.DATA_CACHE_MAX_ARRAY_ROWS,
    DEFAULT_CACHE_MAX_ARRAY_ROWS,
    1_000,
    250_000
);
const dbPoolSize = boundedEnvInteger(process.env.DB_POOL_SIZE, DEFAULT_DB_POOL_SIZE, 1, 30);
const dbAcquireTimeoutMs = boundedEnvInteger(process.env.DB_POOL_ACQUIRE_TIMEOUT_MS, 5_000, 250, 60_000);
const dbQueryTimeoutMs = boundedEnvInteger(process.env.DB_QUERY_TIMEOUT_MS, 30_000, 1_000, 300_000);
const dbCombinedQueryTimeoutMs = boundedEnvInteger(
    process.env.DB_COMBINED_QUERY_TIMEOUT_MS,
    120_000,
    1_000,
    600_000
);
const dbSlowAcquireMs = boundedEnvInteger(process.env.DB_POOL_SLOW_ACQUIRE_MS, 250, 10, 30_000);
const slowDataFetchMs = boundedEnvInteger(process.env.SLOW_DATA_FETCH_MS, 750, 50, 60_000);

const DEFAULT_CACHE_TTL_SECONDS = 60 * 30;
const cache = runtime.__paceStatsCache ?? new NodeCache({
    stdTTL: DEFAULT_CACHE_TTL_SECONDS,
    checkperiod: 60,
    useClones: false,
    maxKeys: cacheMaxKeys,
});
runtime.__paceStatsCache = cache;

const cacheAccess = runtime.__paceStatsCacheAccess ?? new Map<string, number>();
runtime.__paceStatsCacheAccess = cacheAccess;
if (!runtime.__paceStatsCacheListenersRegistered) {
    cache.on("del", (key) => cacheAccess.delete(String(key)));
    cache.on("expired", (key) => cacheAccess.delete(String(key)));
    cache.on("flush", () => cacheAccess.clear());
    runtime.__paceStatsCacheListenersRegistered = true;
}

const redis = runtime.__paceStatsRedis ?? new Redis(process.env.REDIS_URL!, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    connectTimeout: boundedEnvInteger(process.env.REDIS_CONNECT_TIMEOUT_MS, 5_000, 500, 30_000),
    commandTimeout: boundedEnvInteger(process.env.REDIS_COMMAND_TIMEOUT_MS, 3_000, 250, 30_000),
    retryStrategy: (attempt) => Math.min(attempt * 100, 2_000),
});
runtime.__paceStatsRedis = redis;
if (!runtime.__paceStatsRedisListenersRegistered) {
    redis.on("error", (error) => {
        const now = Date.now();
        if (now - (runtime.__paceStatsLastRedisErrorAt ?? 0) >= 30_000) {
            // Registering a listener prevents ioredis from emitting noisy
            // "Unhandled error event" messages on every reconnect attempt.
            console.error("Redis connection error:", error.message);
            runtime.__paceStatsLastRedisErrorAt = now;
        }
    });
    runtime.__paceStatsRedisListenersRegistered = true;
}

const promiseCache = runtime.__paceStatsPromiseCache ?? new Map<string, Promise<unknown>>();
runtime.__paceStatsPromiseCache = promiseCache;

const dbPool = runtime.__paceStatsDbPool ?? mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: boundedEnvInteger(process.env.DB_CONNECT_TIMEOUT_MS, 5_000, 500, 30_000),
    waitForConnections: true,
    connectionLimit: dbPoolSize,
    maxIdle: Math.min(dbPoolSize, boundedEnvInteger(process.env.DB_POOL_MAX_IDLE, dbPoolSize, 1, 30)),
    idleTimeout: boundedEnvInteger(process.env.DB_POOL_IDLE_TIMEOUT_MS, 60_000, 1_000, 600_000),
    // Queries take a millisecond or two, so a burst far larger than the pool
    // drains in tens of milliseconds. A 25-entry queue turned such bursts
    // (one client fetching many players at once, several page views landing
    // together) into "Queue limit reached" errors while the database was
    // idle. Waiting stays bounded by DB_POOL_ACQUIRE_TIMEOUT_MS.
    queueLimit: boundedEnvInteger(process.env.DB_POOL_QUEUE_LIMIT, DEFAULT_DB_POOL_QUEUE_LIMIT, 1, 10_000),
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
});
runtime.__paceStatsDbPool = dbPool;

const dbPoolMetrics = runtime.__paceStatsDbPoolMetrics ?? {
    active: 0,
    pending: 0,
    peakActive: 0,
    peakPending: 0,
    acquireTimeouts: 0,
    acquireErrors: 0,
    queryTimeouts: 0,
    lastPressureWarningAt: 0,
};
dbPoolMetrics.acquireErrors ??= 0;
runtime.__paceStatsDbPoolMetrics = dbPoolMetrics;

class DbPoolAcquireTimeoutError extends Error {
    code = "DB_POOL_ACQUIRE_TIMEOUT";

    constructor() {
        super(`Database pool checkout exceeded ${dbAcquireTimeoutMs}ms`);
        this.name = "DbPoolAcquireTimeoutError";
    }
}

const warnAboutPoolPressure = (message: string) => {
    const now = Date.now();
    if (now - dbPoolMetrics.lastPressureWarningAt < 30_000) return;
    console.warn(
        `[db-pool] ${message}; active=${dbPoolMetrics.active}/${dbPoolSize}, ` +
        `pending=${dbPoolMetrics.pending}, peakActive=${dbPoolMetrics.peakActive}, ` +
        `peakPending=${dbPoolMetrics.peakPending}, acquireTimeouts=${dbPoolMetrics.acquireTimeouts}, ` +
        `acquireErrors=${dbPoolMetrics.acquireErrors}, queryTimeouts=${dbPoolMetrics.queryTimeouts}`
    );
    dbPoolMetrics.lastPressureWarningAt = now;
};

const acquireDbConnection = async (): Promise<mysql.PoolConnection> => {
    const startedAt = Date.now();
    dbPoolMetrics.pending += 1;
    dbPoolMetrics.peakPending = Math.max(dbPoolMetrics.peakPending, dbPoolMetrics.pending);

    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const connectionPromise = dbPool.getConnection();
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
            timedOut = true;
            reject(new DbPoolAcquireTimeoutError());
        }, dbAcquireTimeoutMs);
    });

    try {
        const connection = await Promise.race([connectionPromise, timeoutPromise]);
        if (timeoutHandle) clearTimeout(timeoutHandle);
        dbPoolMetrics.active += 1;
        dbPoolMetrics.peakActive = Math.max(dbPoolMetrics.peakActive, dbPoolMetrics.active);
        const waitMs = Date.now() - startedAt;
        if (waitMs >= dbSlowAcquireMs) warnAboutPoolPressure(`Slow checkout (${waitMs}ms)`);
        return connection;
    } catch (error) {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (timedOut) {
            dbPoolMetrics.acquireTimeouts += 1;
            // mysql2 does not remove an individual waiter from its pool queue.
            // Release the eventual checkout so a timed-out request cannot leak it.
            void connectionPromise.then((connection) => connection.release(), () => undefined);
            warnAboutPoolPressure(`Checkout timeout (${dbAcquireTimeoutMs}ms)`);
        } else {
            dbPoolMetrics.acquireErrors += 1;
            warnAboutPoolPressure("Checkout failed");
        }
        throw error;
    } finally {
        dbPoolMetrics.pending -= 1;
    }
};

const releaseDbConnection = (connection: mysql.PoolConnection) => {
    dbPoolMetrics.active = Math.max(0, dbPoolMetrics.active - 1);
    connection.release();
};

const executeDb = async <T extends QueryResult>(
    sql: string,
    values?: any,
    timeoutMs = dbQueryTimeoutMs
): Promise<[T, mysql.FieldPacket[]]> => {
    const connection = await acquireDbConnection();
    try {
        return await connection.execute<T>({sql, timeout: timeoutMs}, values);
    } catch (error) {
        if ((error as {code?: string})?.code === "PROTOCOL_SEQUENCE_TIMEOUT") {
            dbPoolMetrics.queryTimeouts += 1;
            warnAboutPoolPressure(`Query timeout (${timeoutMs}ms)`);
        }
        throw error;
    } finally {
        releaseDbConnection(connection);
    }
};

const executeOnConnection = async <T extends QueryResult>(
    connection: mysql.PoolConnection,
    sql: string,
    values?: any
): Promise<[T, mysql.FieldPacket[]]> => {
    try {
        return await connection.execute<T>({sql, timeout: dbQueryTimeoutMs}, values);
    } catch (error) {
        if ((error as {code?: string})?.code === "PROTOCOL_SEQUENCE_TIMEOUT") {
            dbPoolMetrics.queryTimeouts += 1;
            warnAboutPoolPressure(`Transaction query timeout (${dbQueryTimeoutMs}ms)`);
        }
        throw error;
    }
};

async function fetchLeaderboardsFromRedis(days = 30) {
    const jsonString = await redis.call('JSON.GET', `leaderboards:${days}day`, '$');
    if (!jsonString) {
        console.error(`Error: Lb not found in Redis.`);
        throw new Error(`Leaderboards for ${days} days not found in Redis.`)
    }
    const parsedData = JSON.parse(jsonString as string);
    return parsedData[0];
}

const leaderboardCategoryNames = [
    "nether", "bastion", "first_structure", "second_structure", "fortress",
    "first_portal", "second_portal", "stronghold", "end", "finish",
] as const;
const leaderboardCategories = new Set<string>(leaderboardCategoryNames);
const leaderboardPeriods = new Set([1, 7, 30, 9_999]);

const parseRedisJsonArray = (value: unknown): any[] => {
    if (!value) return [];
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
};

/**
 * Read only the requested leaderboard branch from RedisJSON. The lifetime
 * aggregate is several megabytes serialized, so loading the root document to
 * return a few entries wastes network bandwidth, parse time, and heap.
 */
export async function fetchLeaderboardCategoryFromRedis(
    days: number,
    category: string,
    filter: CategoryType,
    limit: number,
    minimumQty = 0
) {
    const safeDays = leaderboardPeriods.has(days) ? days : 30;
    if (!leaderboardCategories.has(category)) throw new Error("Unsupported leaderboard category");
    if (![CategoryType.COUNT, CategoryType.AVG, CategoryType.FASTEST, CategoryType.CONVERSION].includes(filter)) {
        throw new Error("Unsupported leaderboard filter");
    }

    // The legacy public endpoint permits up to 999,999 results. Preserve that
    // contract while still asking RedisJSON for only the requested branch.
    const safeLimit = boundedInteger(limit, 10, 1, 999_999);
    const safeMinimumQty = boundedInteger(minimumQty, 0, 0, Number.MAX_SAFE_INTEGER);
    const basePath = `$.${filter}.${category}`;
    // RedisJSON currently cannot reliably apply an array slice after a JSONPath
    // filter. Fetch the already-small eligible set and trim it in-process.
    const path = filter === CategoryType.AVG || filter === CategoryType.CONVERSION
        ? `${basePath}[?(@.qty>=${safeMinimumQty})]`
        : `${basePath}[0:${safeLimit}]`;
    const jsonString = await redis.call("JSON.GET", `leaderboards:${safeDays}day`, path);
    if (!jsonString) throw new Error(`Leaderboards for ${safeDays} days not found in Redis.`);
    return parseRedisJsonArray(jsonString).slice(0, safeLimit);
}

export async function fetchFastestLeaderboardsFromRedis(days = 30, limit = 100) {
    const safeLimit = boundedInteger(limit, 100, 1, 100);
    const paths = leaderboardCategoryNames.map((category) => `$.${category}[0:${safeLimit}]`);
    const jsonString = await redis.call('JSON.GET', `fastestLeaderboards:${days}day`, ...paths);
    if (!jsonString) {
        console.error(`Error: Fastest lb not found in Redis.`);
        throw new Error(`Fastest leaderboards for ${days} days not found in Redis.`)
    }
    const parsedData = JSON.parse(String(jsonString));
    return Object.fromEntries(
        leaderboardCategoryNames.map((category, index) => [category, parsedData[paths[index]] ?? []])
    );
}

export async function fetchFastestLeaderboardCategoryFromRedis(
    days: number,
    category: string,
    limit: number
) {
    const safeDays = leaderboardPeriods.has(days) ? days : 30;
    if (!leaderboardCategories.has(category)) throw new Error("Unsupported leaderboard category");
    // The generated fastest document currently contains 100 rows per branch,
    // but retaining the public limit avoids coupling this reader to that detail.
    const safeLimit = boundedInteger(limit, 10, 1, 999_999);
    const jsonString = await redis.call(
        "JSON.GET",
        `fastestLeaderboards:${safeDays}day`,
        `$.${category}[0:${safeLimit}]`
    );
    if (!jsonString) throw new Error(`Fastest leaderboards for ${safeDays} days not found in Redis.`);
    return parseRedisJsonArray(jsonString).slice(0, safeLimit);
}

export async function fetchPlayerStatsFromRedis(uuid: string, days = 30) {
    const jsonString = await redis.call('JSON.GET', `playerStats:${uuid}:${days}day`, '$');
    if (!jsonString) {
        throw new Error(`Player data for ${days} days not found in Redis.`)
    }
    const parsedData = JSON.parse(jsonString as string);
    return parsedData[0];
}

export async function fetchTwitchesFromRedis(uuid: string) {
    const jsonString = await redis.call('JSON.GET', `users:twitch_details:${uuid}`, '$');
    if (!jsonString) {
        return []
    }
    const parsedData = JSON.parse(jsonString as string);
    return parsedData[0];
}

export async function fetchAllUsersFromRedis() {
    const jsonString = await redis.call('JSON.GET', `users`, '$');
    if (!jsonString) {
        return []
    }
    const parsedData = JSON.parse(jsonString as string);
    return parsedData[0];
}

async function getTheMostRecentOfRuns(uuid: string){
    const [rows, fields] = await (await getConn()).execute(
        `SELECT id, nether, bastion, fortress, 
        CASE
            WHEN bastion is null and fortress is null THEN null
            WHEN bastion is null and fortress is not null THEN fortress
            WHEN bastion is not null and fortress is null THEN bastion 
            WHEN bastion <= fortress then bastion 
            ELSE fortress 
        END as first_structure, 
        CASE 
            WHEN bastion is null and fortress is null THEN null
            WHEN bastion is null and fortress is not null THEN null
            WHEN bastion is not null and fortress is null THEN null
            WHEN bastion <= fortress then fortress
            ELSE bastion 
        END as second_structure, 
        first_portal,
        stronghold, 
        end,
        finish, 
        lastUpdated,
        vodId,
        twitch
    FROM pace
    WHERE uuid=? AND insertTime > NOW() - INTERVAL 1 HOUR ORDER BY insertTime DESC, id DESC;`,
        [uuid]
    )
    return rows
}

function mergeRuns(baseRuns: any[], newRuns: any[]): any[] {
    // 1. Create a Map of the new runs for efficient O(1) lookups by ID.
    const newRunsMap = new Map<string, any>(newRuns.map(run => [run.id, run]));

    // 2. Iterate through the base runs. If a run exists in our map, use the new
    //    version and remove it from the map. Otherwise, keep the old version.
    const updatedRuns = baseRuns.map(run => {
        if (newRunsMap.has(run.id)) {
            const updatedRun = newRunsMap.get(run.id)!;
            newRunsMap.delete(run.id); // Remove it so we know it's been processed
            return updatedRun;
        }
        return run; // Keep the original run
    });

    const result = [...newRunsMap.values(), ...updatedRuns];

    return result;
}

const csvDecodeRun = (csv: string): any => {
    const parts = csv.split(',');
    return {
        id: parseInt(parts[0]),
        nether: parseInt(parts[1]),
        bastion: parseInt(parts[2]) || null,
        fortress: parseInt(parts[3]) || null,
        first_structure: parseInt(parts[4]) || null,
        second_structure: parseInt(parts[5]) || null,
        first_portal: parseInt(parts[6]) || null,
        stronghold: parseInt(parts[7]) || null,
        end: parseInt(parts[8]) || null,
        finish: parseInt(parts[9]) || null,
        lastUpdated: parseInt(parts[10]),
        vodId: parts[11] || null,
        twitch: parts[12] || null
    };
}

const decodeRunLines = (lines: string): any[] =>
    lines === "" ? [] : lines.split("\n").map((run: string) => csvDecodeRun(run));

// Decoded history bases, least recently used first. A base changes only
// when the job rewrites it under a new version, so its decoded runs are
// shared between requests and never modified.
type DecodedRunBase = {version: string; runs: any[]};
const decodedRunBases = runtime.__paceStatsRunBases ?? new Map<string, DecodedRunBase>();
runtime.__paceStatsRunBases = decodedRunBases;
const runBaseCacheMaxRuns = boundedEnvInteger(process.env.DATA_RUN_HISTORY_CACHE_RUNS, 250_000, 0, 5_000_000);

const rememberDecodedRunBase = (uuid: string, base: DecodedRunBase) => {
    decodedRunBases.delete(uuid);
    if (base.runs.length > runBaseCacheMaxRuns) return;
    decodedRunBases.set(uuid, base);
    let total = 0;
    for (const cached of decodedRunBases.values()) total += cached.runs.length;
    for (const [oldest, cached] of decodedRunBases) {
        if (total <= runBaseCacheMaxRuns) break;
        decodedRunBases.delete(oldest);
        total -= cached.runs.length;
    }
};

/**
 * A player's cached run history, newest first, or null when Redis has none.
 * The job stores it as a small head (the newest runs) and a base that
 * changes rarely (see app/runHistory.ts): normally only the head is fetched
 * and decoded, and the base's decoded runs are reused.
 */
const readRunHistory = async (uuid: string): Promise<any[] | null> => {
    const headKey = runHistoryHeadKey(uuid);
    const stored = await redis.get(headKey);
    if (!stored) {
        // Not yet rewritten by a job that knows the head/base layout.
        const legacy = await redis.get(`${LEGACY_RUN_HISTORY_PREFIX}${uuid}`);
        return legacy ? decodeRunLines(legacy) : null;
    }
    let head = parseRunHistoryHead(stored);
    if (!head) return null;
    let baseRuns: any[] = [];
    if (head.baseVersion !== null) {
        const cached = decodedRunBases.get(uuid);
        if (cached && cached.version === head.baseVersion) {
            // Move to the recently-used end.
            decodedRunBases.delete(uuid);
            decodedRunBases.set(uuid, cached);
            baseRuns = cached.runs;
        } else {
            // One command, so the head read here continues the base read here.
            const [freshHead, storedBase] = await redis.mget(headKey, runHistoryBaseKey(uuid));
            head = freshHead ? parseRunHistoryHead(freshHead) : null;
            if (!head) return null;
            if (head.baseVersion !== null) {
                const base = storedBase ? parseRunHistoryBase(storedBase) : null;
                if (!base || base.version !== head.baseVersion) return null;
                baseRuns = decodeRunLines(base.body);
                rememberDecodedRunBase(uuid, {version: base.version, runs: baseRuns});
            }
        }
    }
    return decodeRunLines(head.body).concat(baseRuns);
};

export async function fetchAllPlayerRunsFromRedis(uuid: string){
    let runs: any[] | null = null;
    try {
        runs = await readRunHistory(uuid);
    } catch (error) {
        console.error(`Unable to read run history for ${uuid} from Redis; falling back to MySQL:`, error);
    }
    if (!runs || runs.length === 0) {
        return getAllPlayerRunsOptimized(uuid);
    }
    const recentRuns = await getTheMostRecentOfRuns(uuid) as any;
    return mergeRuns(runs, recentRuns);
}

export async function fetchNphFromRedis(uuid: string, days: number) {
    const jsonString = await redis.call('JSON.GET', `nph:${uuid}:${days}day`, '$');
    if (!jsonString) {
        return {
            rtanph: 0,
            rnph: 0,
            lnph: 0,
            count: 0,
            avg: 0,
            playtime: 0,
            walltime: 0,
            resets: 0,
            totalResets: 0,
            seedsPlayed: 0,
            rpe: 0
        };
    }
    const parsedData = JSON.parse(jsonString as string)[0];
    if (!parsedData) {
        return {
            rtanph: 0,
            rnph: 0,
            lnph: 0,
            count: 0,
            avg: 0,
            playtime: 0,
            walltime: 0,
            resets: 0,
            totalResets: 0,
            seedsPlayed: 0,
            rpe: 0
        };
    }
    return parsedData;
}

async function fetchTopLeaderboardsFromRedis(days = 30) {
    const jsonString = await redis.call('JSON.GET', `topLeaderboards:${days}day`, '$');
    if (!jsonString) {
        console.error(`Error: Top Lb not found in Redis.`);
        throw new Error(`Top leaderboards for ${days} days not found in Redis.`)
    }
    const parsedData = JSON.parse(jsonString as string);
    return parsedData[0];
}

/**
 * Run a query and hand each row to `onRow` as it arrives, as an array of
 * column values. A large result is then never held in memory as row objects.
 */
const streamOnConnection = async (
    connection: mysql.PoolConnection,
    sql: string,
    values: any,
    onRow: (row: any[]) => void,
    timeoutMs = dbQueryTimeoutMs
): Promise<void> => {
    try {
        await new Promise<void>((resolve, reject) => {
            let failure: unknown;
            // The promise wrapper buffers every row, so use the event-emitting
            // connection underneath it.
            const core = (connection as unknown as {connection: import("mysql2").Connection}).connection;
            core.execute({sql, values, rowsAsArray: true, timeout: timeoutMs})
                .on("error", reject)
                .on("result", (row: unknown) => {
                    if (failure !== undefined) return;
                    try {
                        onRow(row as any[]);
                    } catch (error) {
                        failure = error ?? new Error("Row handler failed");
                    }
                })
                .on("end", () => failure === undefined ? resolve() : reject(failure));
        });
    } catch (error) {
        if ((error as {code?: string})?.code === "PROTOCOL_SEQUENCE_TIMEOUT") {
            dbPoolMetrics.queryTimeouts += 1;
            warnAboutPoolPressure(`Query timeout (${timeoutMs}ms)`);
        }
        throw error;
    }
};

const streamDbRows = async (
    sql: string,
    values: any,
    onRow: (row: any[]) => void,
    timeoutMs = dbQueryTimeoutMs
): Promise<void> => {
    const connection = await acquireDbConnection();
    try {
        await streamOnConnection(connection, sql, values, onRow, timeoutMs);
    } finally {
        releaseDbConnection(connection);
    }
};

/**
 * Run several reads against one consistent InnoDB snapshot, so a result
 * assembled from more than one statement matches a single statement's view.
 */
const withReadSnapshot = async <T>(work: (connection: mysql.PoolConnection) => Promise<T>): Promise<T> => {
    const connection = await acquireDbConnection();
    let open = false;
    try {
        await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
        open = true;
        const result = await work(connection);
        open = false;
        await connection.query("COMMIT");
        return result;
    } finally {
        let reusable = true;
        if (open) {
            try {
                await connection.query("ROLLBACK");
            } catch (error) {
                // Never return a connection with an open transaction to the pool.
                console.error("Unable to end a read snapshot:", error);
                reusable = false;
            }
        }
        if (reusable) {
            releaseDbConnection(connection);
        } else {
            dbPoolMetrics.active = Math.max(0, dbPoolMetrics.active - 1);
            connection.destroy();
        }
    }
};

// Keep the existing call shape while routing every ordinary query through
// bounded checkout and execution timeouts.
const dbExecutor = {execute: executeDb};
export const getConn = async () => dbExecutor;

const ttls = {
    getWorld: 5,
    getBans: 60 * 10,
    getUUID: 60 * 60 * 6,
    getAllUsers: 60 * 10,
    getAllNamesByNick: 60 * 10,
    getAllNamesByTwitch: 60 * 10,
    getTwitchAccounts: 60,
    getNick: 60 * 30,
    getNickAlways: 60 * 30,
    isTwitchLive: 30,
    getAllAAData: 60 * 5,
    getPlayerRuns: 10,
    getRecentAARuns: 20,
    getAllPlayerRuns: 30,
    getAllPlayerRunsOptimized: 10,
    getAllPlayerRunsByPeriod: 20,
    getAllPlayerRunsByHours: 20,
    getRecentTimestamps: 10,
    getLeaderboards: {
        default: 60 * 60,
        "1 day": 60,
        "7 day": 60 * 30,
        "30 day": 60 * 60
    },
    getTrimmedLeaderboards: {
        default: 120,
        "1 day": 30,
        "7 day": 30,
        "30 day": 30
    },
    getLiveRuns: 5,
    getWorldLiveData: 5,
    getNPH: 5,
    getLatestRun: 5,
    getRecentNethers: 20,
    getUUIDByAccessKey: 60 * 30,
    getRunId: 60 * 30,
    getAALB: 60 * 10,
    getTrimmedAALB: 60 * 10,
    jude: 30,
    getNethersByPeriod: 5,
    getSessionStats: 10,
    getAllUserInfo: 60 * 10,
    getUserInfo: 60 * 10,
    getAllAARuns: 60 * 30,
    getAllPBs: 60,
    getPBs: 10,
    getLowestId: 60,
    getHighestId: 60,
    getRunsPaginated: 60,
    fetchAllUsersFromRedis: 60,
    fetchAllPlayerRunsFromRedis: 5,
    fetchFastestLeaderboardsFromRedis: 60,
    fetchFastestLeaderboardCategoryFromRedis: 60 * 30,
    fetchLeaderboardCategoryFromRedis: {
        default: 60 * 60,
        "1 day": 60,
        "7 day": 60 * 30,
        "30 day": 60 * 60
    },
    searchPlayers: 60,
    getPlayerRunsPage: 5,
    getPlayerRunsOffsetPage: 5,
    getAAPlayerRunsPage: 30,
    resolveCombinedPlayerUuids: 60,
    getCombinedSplitAggregates: 10,
    getCombinedNetherAggregate: 10,
}

export type CombinedPlayerResolution = {
    uuids: string[];
    unknown: string[];
};

const COMBINED_IDENTITY_BATCH_SIZE = 500;

/**
 * Resolve submitted nickname/Twitch names with indexed top-one lookups in
 * bounded SQL batches. Nicknames retain precedence over Twitch names,
 * matching the legacy endpoint behavior.
 */
export const resolveCombinedPlayerUuids = async (names: string[]): Promise<CombinedPlayerResolution> => {
    const uniqueNames = [...new Map(
        names.map((name) => [name.trim().toLocaleLowerCase(), name.trim()] as const)
    ).values()].filter(Boolean);
    if (uniqueNames.length === 0) return {uuids: [], unknown: []};

    const uuidByName = new Map<string, string>();
    for (let offset = 0; offset < uniqueNames.length; offset += COMBINED_IDENTITY_BATCH_SIZE) {
        const batch = uniqueNames.slice(offset, offset + COMBINED_IDENTITY_BATCH_SIZE);
        // Correlated lookups against a derived name list cannot use the
        // (nickname, id)/(twitch, id) indexes for ORDER BY id DESC and sort
        // every run of the player instead. Uncorrelated subqueries with bound
        // names read one index entry from the end of each range.
        const lookups = batch.map((_, index) =>
            `SELECT ${index} AS lookupOrder, LOWER(?) AS lookupName,
                COALESCE(
                    (SELECT uuid FROM pace WHERE nickname=? ORDER BY id DESC LIMIT 1),
                    (SELECT uuid FROM pace WHERE twitch=? ORDER BY id DESC LIMIT 1)
                ) AS uuid`
        ).join(" UNION ALL ");
        const [rows] = await (await getConn()).execute<any[]>(
            `${lookups} ORDER BY lookupOrder;`,
            batch.flatMap((name) => [name, name, name])
        );
        for (const row of rows) {
            if (row.uuid) uuidByName.set(String(row.lookupName).toLocaleLowerCase(), String(row.uuid));
        }
    }
    const uuids: string[] = [];
    const seenUuids = new Set<string>();
    const unknown: string[] = [];
    for (const name of uniqueNames) {
        const uuid = uuidByName.get(name.toLocaleLowerCase());
        if (!uuid) {
            unknown.push(name);
        } else if (!seenUuids.has(uuid)) {
            seenUuids.add(uuid);
            uuids.push(uuid);
        }
    }
    return {uuids, unknown};
};

export type CombinedSplitAggregate = {
    category: string;
    count: number;
    average: number;
};

const combinedMetrics = runtime.__paceStatsCombinedMetrics ?? {
    fromSummaries: 0,
    fromRows: 0,
    bucketsReadInFull: 0,
    stalePlayers: 0,
};
runtime.__paceStatsCombinedMetrics = combinedMetrics;

/** Rows read per player while looking for the start of the current session. */
const SESSION_GAP_SCAN_ROWS = 2_000;

type CombinedSessionWindow = {
    /** Lower edge of the window, as a Unix time, computed once by MySQL. */
    lowerBound: unknown;
    /** MySQL's clock when the window was fixed, as a Unix time. */
    nowSeconds: number;
    /** Per player: the Unix time of the oldest current-session run, or null for the whole window. */
    sessionStarts: Map<string, number | null>;
};

/**
 * Each player's current session is the run of newest rows before the first
 * gap longer than `hoursBetween` (TIMESTAMPDIFF between consecutive rows in
 * insertTime DESC, id DESC order). Rather than numbering the sessions of
 * every row in the window with window functions, read each player's newest
 * rows from the (uuid, insertTime, id) index until the first gap. Players
 * without rows in the window are absent from the result.
 */
const findCombinedSessionWindow = async (
    connection: mysql.PoolConnection,
    uuids: string[],
    hours: number,
    hoursBetween: number,
    start: number,
    detectSessionGaps: boolean
): Promise<CombinedSessionWindow> => {
    const [boundRows] = await executeOnConnection<any[]>(
        connection,
        `SELECT GREATEST(0, UNIX_TIMESTAMP() - (? * 3600), ?) AS lowerBound, UNIX_TIMESTAMP() AS nowSeconds;`,
        [hours, start]
    );
    const lowerBound = boundRows[0].lowerBound;
    const nowSeconds = Number(boundRows[0].nowSeconds);
    const sessionStarts = new Map<string, number | null>();
    if (!detectSessionGaps) {
        for (const uuid of uuids) sessionStarts.set(uuid, null);
        return {lowerBound, nowSeconds, sessionStarts};
    }

    const gapSeconds = hoursBetween * 3600;
    let pending = uuids;
    let limit: number | null = SESSION_GAP_SCAN_ROWS;
    while (pending.length > 0) {
        const limitClause = limit === null ? "" : ` LIMIT ${limit}`;
        const [rows] = await executeOnConnection<any[]>(
            connection,
            pending.map(() => `(SELECT uuid, id, UNIX_TIMESTAMP(insertTime) AS instant,
                    TO_SECONDS(insertTime) AS wallSeconds
                FROM pace
                WHERE uuid=? AND insertTime >= FROM_UNIXTIME(?)
                ORDER BY insertTime DESC, id DESC${limitClause})`).join(" UNION ALL ") + ";",
            pending.flatMap((uuid) => [uuid, lowerBound])
        );
        const rowsByUuid = new Map<string, any[]>();
        for (const row of rows) {
            const playerRows = rowsByUuid.get(row.uuid);
            if (playerRows) playerRows.push(row);
            else rowsByUuid.set(row.uuid, [row]);
        }
        const unresolved: string[] = [];
        for (const uuid of pending) {
            const playerRows = rowsByUuid.get(uuid);
            if (!playerRows) continue;
            // UNION ALL does not promise to keep each branch's order.
            playerRows.sort((left, right) =>
                Number(right.instant) - Number(left.instant) || Number(right.id) - Number(left.id)
            );
            let sessionStart: number | null = null;
            for (let index = 1; index < playerRows.length; index++) {
                // TIMESTAMPDIFF(SECOND, ...) is the difference of the two
                // session-time-zone wall clock values, as TO_SECONDS gives.
                if (Number(playerRows[index - 1].wallSeconds) - Number(playerRows[index].wallSeconds) > gapSeconds) {
                    sessionStart = Number(playerRows[index - 1].instant);
                    break;
                }
            }
            if (sessionStart !== null || limit === null || playerRows.length < limit) {
                sessionStarts.set(uuid, sessionStart);
            } else {
                unresolved.push(uuid);
            }
        }
        pending = unresolved;
        limit = limit !== null && limit < SESSION_GAP_SCAN_ROWS * 8 ? limit * 8 : null;
    }
    return {lowerBound, nowSeconds, sessionStarts};
};

/** A span of Unix insertTime, [from, to); null leaves that side open. */
type InsertTimeSpan = {from: number | null; to: number | null};
/** The rows of one player to read: the whole window (null) or some spans of it. */
type CombinedPlayerRows = {uuid: string; spans: InsertTimeSpan[] | null};

/**
 * The selected rows of every player as the `session_rows` CTE. The window
 * edge is the FROM_UNIXTIME comparison the endpoints have always used; span
 * edges compare exact Unix times, with a range two hours wider on the column
 * so the index can be used whatever the session time zone does around it.
 */
const combinedRowsCte = (lowerBound: unknown, players: CombinedPlayerRows[]): {sql: string; values: unknown[]} => {
    const values: unknown[] = [lowerBound];
    const conditions = players.map(({uuid, spans}) => {
        values.push(uuid);
        if (spans === null) return "(uuid=?)";
        const spanConditions = spans.map(({from, to}) => {
            const parts: string[] = [];
            if (from !== null) {
                values.push(Math.max(0, from - COMBINED_ZONE_SLACK_SECONDS));
                parts.push("insertTime >= FROM_UNIXTIME(?)");
            }
            if (to !== null) {
                values.push(to + COMBINED_ZONE_SLACK_SECONDS);
                parts.push("insertTime < FROM_UNIXTIME(?)");
            }
            if (from !== null) {
                values.push(from);
                parts.push("UNIX_TIMESTAMP(insertTime) >= ?");
            }
            if (to !== null) {
                values.push(to);
                parts.push("UNIX_TIMESTAMP(insertTime) < ?");
            }
            return `(${parts.join(" AND ")})`;
        });
        return `(uuid=? AND (${spanConditions.join(" OR ")}))`;
    });
    return {
        sql: `
    WITH session_rows AS (
        SELECT id, uuid, insertTime, nether, bastion, fortress, first_portal,
            stronghold, end, finish, obtainRod
        FROM pace
        WHERE insertTime >= FROM_UNIXTIME(?)
          AND (${conditions.join(" OR ")})
    )`,
        values,
    };
};

/** Split times collected from a streamed result, eight bytes per value. */
class TimeSeries {
    private values = new Float64Array(1_024);
    private length = 0;

    push(value: number) {
        if (this.length === this.values.length) {
            const grown = new Float64Array(this.values.length * 2);
            grown.set(this.values);
            this.values = grown;
        }
        this.values[this.length++] = value;
    }

    view(): Float64Array {
        return this.values.subarray(0, this.length);
    }
}

/**
 * These averages used to come from SQL AVG() over an INT column, which
 * returns a DECIMAL rounded half-up to four places. Round the same way so the
 * endpoints keep returning the same numbers.
 */
const averageAsSqlDecimal = (stats: TrimmedStats): number => {
    if (stats.kept === 0) return 0;
    if (!Number.isSafeInteger(stats.sum) || stats.sum < 0) {
        return Math.round(stats.avg * 10_000) / 10_000;
    }
    const kept = BigInt(stats.kept);
    const scaled = (BigInt(stats.sum) * BigInt(20_000) + kept) / (BigInt(2) * kept);
    return Number(scaled) / 10_000;
};

/** Which splits a combined request needs, and the slowest time it counts. */
type CombinedSplitRequest = {
    /** Indexes into combinedSplitCategories. */
    splits: number[];
    /** Values above this are left out; Infinity for no limit. */
    maxValue: number;
};

/**
 * Stream the selected rows and append each requested split's values to
 * `series` (one per requested split, in order).
 */
const streamCombinedSplitValues = async (
    connection: mysql.PoolConnection,
    lowerBound: unknown,
    players: CombinedPlayerRows[],
    request: CombinedSplitRequest,
    series: TimeSeries[]
): Promise<void> => {
    if (players.length === 0) return;
    const rows = combinedRowsCte(lowerBound, players);
    if (request.splits.length === 1 && request.splits[0] === 0) {
        // Only the nether time: no need to derive the structure splits.
        const limited = Number.isFinite(request.maxValue);
        await streamOnConnection(
            connection,
            `${rows.sql}
        SELECT nether
        FROM session_rows
        WHERE nether IS NOT NULL${limited ? " AND nether <= ?" : ""};`,
            limited ? [...rows.values, request.maxValue] : rows.values,
            (row) => series[0].push(Number(row[0])),
            dbCombinedQueryTimeoutMs
        );
        return;
    }
    await streamOnConnection(
        connection,
        `${rows.sql}, ${combinedSplitRowsSql("session_rows")}
        SELECT ${request.splits.map((split) => combinedSplitCategories[split]).join(", ")}
        FROM split_rows;`,
        rows.values,
        (row) => {
            for (let index = 0; index < series.length; index++) {
                const value = row[index];
                if (value !== null && Number(value) <= request.maxValue) series[index].push(Number(value));
            }
        },
        dbCombinedQueryTimeoutMs
    );
};

type CombinedSummaries = {
    /** Newest summarised bucket. */
    closedThrough: number;
    /** The job has accounted for every change with an older lastUpdated. */
    checkedFrom: number;
    /** Per requested player: the raw hash written by the run-history job. */
    hashes: Array<Record<string, string>>;
};

/**
 * The run-history job's bucket summaries for these players, or null when
 * they cannot be used (not built, another format, or no delete triggers to
 * report removed rows).
 */
const readCombinedSummaries = async (uuids: string[]): Promise<CombinedSummaries | null> => {
    try {
        const transaction = redis.multi().hgetall(COMBINED_STATE_KEY);
        for (const uuid of uuids) transaction.hgetall(combinedSummaryKey(uuid));
        const results = await transaction.exec();
        if (!results || results.some(([error]) => error)) return null;
        const state = results[0][1] as Record<string, string>;
        const closedThrough = Number(state.closedThrough);
        const checkedFrom = Number(state.checkedFrom);
        if (
            Number(state.version) !== COMBINED_SUMMARY_VERSION
            || Number(state.bucketSeconds) !== COMBINED_BUCKET_SECONDS
            || state.deleteTriggers !== "1"
            || !Number.isSafeInteger(closedThrough)
            || !Number.isSafeInteger(checkedFrom)
        ) return null;
        return {
            closedThrough,
            checkedFrom,
            hashes: results.slice(1).map(([, hash]) => hash as Record<string, string>),
        };
    } catch (error) {
        console.error("Unable to read combined summaries from Redis; reading MySQL instead:", error);
        return null;
    }
};

/**
 * Trimmed statistics of the window from bucket summaries plus the rows they
 * do not cover, or null when the summaries cannot serve this window. Runs on
 * the caller's snapshot, so the rows read here and a later fallback agree.
 */
const combinedStatsFromSummaries = async (
    connection: mysql.PoolConnection,
    uuids: string[],
    window: CombinedSessionWindow,
    summaries: CombinedSummaries,
    request: CombinedSplitRequest
): Promise<TrimmedStats[] | null> => {
    const lowerBound = Number(window.lowerBound);
    if (!Number.isFinite(lowerBound)) return null;
    // Buckets from here on start late enough to lie inside the window under
    // any time-zone reading of its lower edge.
    const firstBucket = Math.ceil((lowerBound + COMBINED_ZONE_SLACK_SECONDS) / COMBINED_BUCKET_SECONDS);
    const {closedThrough, checkedFrom} = summaries;
    if (firstBucket > closedThrough) return null;
    if (window.nowSeconds - checkedFrom > COMBINED_MAX_STALENESS_SECONDS) return null;
    const firstStart = bucketStart(firstBucket);
    const closedEnd = bucketStart(closedThrough + 1);

    // A summary is stale if a row it covers (or should cover) changed after
    // the job last looked, or was deleted and not yet processed.
    const [changedRows] = await executeOnConnection<any[]>(
        connection,
        `SELECT uuid, id, UNIX_TIMESTAMP(insertTime) AS instant
         FROM pace
         WHERE lastUpdated >= FROM_UNIXTIME(?) AND UNIX_TIMESTAMP(lastUpdated) >= ?;`,
        [Math.max(0, checkedFrom - COMBINED_ZONE_SLACK_SECONDS), checkedFrom]
    );
    const [deletedRows] = await executeOnConnection<any[]>(
        connection,
        `SELECT scope, entityId, UNIX_TIMESTAMP(createdAt) AS createdAt
         FROM cache_invalidation_outbox
         WHERE scope IN ('recent', 'aggregate') AND entityId IN (${uuids.map(() => "?").join(",")});`,
        uuids
    );
    const indexByUuid = new Map(uuids.map((uuid, index) => [uuid, index]));
    const maxIds = summaries.hashes.map((hash) => Number(hash[COMBINED_MAX_ID_FIELD] ?? 0));
    const stale = new Set<number>();
    // No hash means no settled rows, or a key Redis lost: read the player's
    // whole window either way (a player without settled rows has few).
    for (let player = 0; player < uuids.length; player++) {
        if (summaries.hashes[player][COMBINED_MAX_ID_FIELD] === undefined) stale.add(player);
    }
    for (const row of changedRows) {
        const index = indexByUuid.get(row.uuid);
        if (index === undefined) continue;
        if ((row.instant !== null && Number(row.instant) < closedEnd) || Number(row.id) <= maxIds[index]) stale.add(index);
    }
    for (const row of deletedRows) {
        const index = indexByUuid.get(row.entityId);
        if (index === undefined) continue;
        if (row.scope === "recent" || Number(row.createdAt) >= checkedFrom - COMBINED_DELETE_OVERLAP_SECONDS) stale.add(index);
    }

    type BucketRef = {player: number; bucket: number};
    // Per player: the usable buckets, parsed on first use.
    const buckets: Array<Map<number, BucketSummary>> = uuids.map(() => new Map());
    for (let player = 0; player < uuids.length; player++) {
        if (stale.has(player)) continue;
        for (const [field, raw] of Object.entries(summaries.hashes[player])) {
            if (field === COMBINED_MAX_ID_FIELD) continue;
            const bucket = Number(field);
            if (bucket >= firstBucket && bucket <= closedThrough) buckets[player].set(bucket, JSON.parse(raw));
        }
    }

    // Everything outside the usable buckets comes from MySQL: the window's
    // older edge, the open period after the newest bucket, stale players.
    const series = request.splits.map(() => new TimeSeries());
    await streamCombinedSplitValues(
        connection,
        window.lowerBound,
        uuids.map((uuid, player) => ({
            uuid,
            spans: stale.has(player) ? null : [{from: null, to: firstStart}, {from: closedEnd, to: null}],
        })),
        request,
        series
    );

    for (let round = 0; round < 6; round++) {
        const parts: Array<SummaryPart<BucketRef>> = [];
        const insufficient = new Map<string, BucketRef>();
        const stats: TrimmedStats[] = [];
        for (let index = 0; index < request.splits.length; index++) {
            parts.length = 0;
            const split = request.splits[index];
            for (let player = 0; player < buckets.length; player++) {
                for (const [bucket, summary] of buckets[player]) {
                    if (summary[split][0] > 0) parts.push({ref: {player, bucket}, summary: summary[split]});
                }
            }
            const result = unionTrimmedStats(parts, series[index].view(), request.maxValue);
            if (result.insufficient) {
                for (const ref of result.insufficient) insufficient.set(`${ref.player}:${ref.bucket}`, ref);
            } else {
                stats.push(result.stats);
            }
        }
        if (insufficient.size === 0) {
            combinedMetrics.fromSummaries += 1;
            combinedMetrics.stalePlayers += stale.size;
            return stats;
        }
        combinedMetrics.bucketsReadInFull += insufficient.size;

        // Some stored tails are too short to settle the slowest 2%: read
        // those buckets' rows instead, merging neighbours into one span.
        const spansByPlayer = new Map<number, InsertTimeSpan[]>();
        const refs = [...insufficient.values()].sort((left, right) => left.player - right.player || left.bucket - right.bucket);
        for (const {player, bucket} of refs) {
            buckets[player].delete(bucket);
            const spans = spansByPlayer.get(player) ?? [];
            const last = spans[spans.length - 1];
            if (last && last.to === bucketStart(bucket)) last.to = bucketStart(bucket + 1);
            else spans.push({from: bucketStart(bucket), to: bucketStart(bucket + 1)});
            spansByPlayer.set(player, spans);
        }
        await streamCombinedSplitValues(
            connection,
            window.lowerBound,
            [...spansByPlayer].map(([player, spans]) => ({uuid: uuids[player], spans})),
            request,
            series
        );
    }
    return null;
};

/**
 * Trimmed statistics of the requested splits over the players' current
 * sessions (or their whole window when no session gap can apply).
 */
const combinedSplitStats = async (
    uuids: string[],
    hours: number,
    hoursBetween: number,
    start: number,
    request: CombinedSplitRequest
): Promise<TrimmedStats[]> => {
    // Every filtered row is within `hours` of now. If the permitted session
    // gap is at least that large, a gap cannot split the result and the gap
    // search can be skipped (especially important for lifetime reads).
    const detectSessionGaps = hoursBetween < hours;
    // Bucket summaries only help a window long enough to contain a whole
    // settled bucket; shorter windows read a handful of rows anyway.
    const summaries = !detectSessionGaps
        && hours * 3_600 >= COMBINED_BUCKET_SECONDS + COMBINED_SETTLE_SECONDS
        ? await readCombinedSummaries(uuids)
        : null;
    return withReadSnapshot(async (connection) => {
        const window = await findCombinedSessionWindow(
            connection, uuids, hours, hoursBetween, start, detectSessionGaps
        );
        if (summaries) {
            const stats = await combinedStatsFromSummaries(connection, uuids, window, summaries, request);
            if (stats) return stats;
        }
        if (!detectSessionGaps) combinedMetrics.fromRows += 1;
        const series = request.splits.map(() => new TimeSeries());
        await streamCombinedSplitValues(
            connection,
            window.lowerBound,
            [...window.sessionStarts].map(([uuid, sessionStart]) => ({
                uuid,
                spans: sessionStart === null ? null : [{from: sessionStart, to: null}],
            })),
            request,
            series
        );
        return series.map((values) => trimmedStats(values.view()));
    });
};

/**
 * Combined split stats for several players. The database applies the session
 * and structure rules; long windows without a session gap are served from
 * the run-history job's bucket summaries plus the rows those do not cover.
 */
export const getCombinedSplitAggregates = async (
    uuids: string[],
    hours: number,
    hoursBetween: number,
    start: number
): Promise<CombinedSplitAggregate[]> => {
    if (uuids.length === 0) return [];
    const stats = await combinedSplitStats(uuids, hours, hoursBetween, start, {
        splits: combinedSplitCategories.map((_, index) => index),
        maxValue: Number.POSITIVE_INFINITY,
    });
    return combinedSplitCategories.map((category, index) => ({
        category,
        count: stats[index].count,
        average: averageAsSqlDecimal(stats[index]),
    }));
};

export const getCombinedNetherAggregate = async (
    uuids: string[],
    hours: number,
    hoursBetween: number,
    start: number,
    maxTime: number
): Promise<{count: number; average: number}> => {
    if (uuids.length === 0) return {count: 0, average: 0};
    const [stats] = await combinedSplitStats(uuids, hours, hoursBetween, start, {splits: [0], maxValue: maxTime});
    return {count: stats.count, average: averageAsSqlDecimal(stats)};
};

export async function fetchAALeaderboardsFromRedis(days = 30) {
    const jsonString = await redis.call('JSON.GET', `aa:leaderboards:${days}day`, '$');
    if (!jsonString) return null;
    return JSON.parse(jsonString as string)[0] ?? null;
}

export const getLiveRuns = async () => {
    const res = await fetch(process.env.LIVERUNS_ENDPOINT as string, {
        cache: "no-store",
        signal: AbortSignal.timeout(3_000),
    })
    if (!res.ok) throw new Error(`Live runs request failed with ${res.status}`);
    return await res.json()
}

export const getWorldLiveData = async (worldId: string) => {
    const storedData = await getCached(getWorld, "getWorld", worldId);
    if (!storedData) return storedData;
    // getCached intentionally returns shared objects. Keep live overlays from
    // mutating the short-lived database snapshot cached by getWorld.
    const data = {...storedData, data: {...storedData.data}};
    const updateTimeMs = Number(data.data.updateTime || 0) * 1_000;
    const clearlyHistorical = data.data.finish !== null
        || (updateTimeMs > 0 && updateTimeMs < Date.now() - 6 * 60 * 60 * 1_000);
    if (clearlyHistorical) {
        data.isLive = false;
        data.liveStatusUnknown = false;
        return data;
    }
    const liveRuns = await getCached(getLiveRuns, "getLiveRuns").catch((error) => {
        console.error("Unable to load live runs:", error);
        return null;
    });
    if (liveRuns === null) {
        data.isLive = false;
        data.liveStatusUnknown = true;
        return data;
    }
    data.liveStatusUnknown = false;
    if(data){
        const run = liveRuns.find((run: any) => run.worldId === data.data.worldId)
        data.isLive = !!run && !run.isCheated && !run.isHidden
        if(run){
            data.data = {
                ...data.data,
                nether: getEventTime(run, "rsg.enter_nether", false),
                bastion: getEventTime(run, "rsg.enter_bastion", false),
                fortress: getEventTime(run, "rsg.enter_fortress", false),
                first_portal: getEventTime(run, "rsg.first_portal", false),
                stronghold: getEventTime(run, "rsg.enter_stronghold", false),
                end: getEventTime(run, "rsg.enter_end", false),
                finish: getEventTime(run, "rsg.finish", false),

                netherRta: getEventTime(run, "rsg.enter_nether", true),
                bastionRta: getEventTime(run, "rsg.enter_bastion", true),
                fortressRta: getEventTime(run, "rsg.enter_fortress", true),
                first_portalRta: getEventTime(run, "rsg.first_portal", true),
                strongholdRta: getEventTime(run, "rsg.enter_stronghold", true),
                endRta: getEventTime(run, "rsg.enter_end", true),
                finishRta: getEventTime(run, "rsg.finish", true),
            }
        }
    }
    return data
}

export const getWorld = async (worldId: string) => {
    let results;
    let fields;
    if(worldId.length < 20){
        [results, fields] = await (await getConn()).execute(
            `SELECT id, worldId, nickname, uuid, twitch, nether, bastion, fortress, first_portal, stronghold, end, finish, 
        netherRta, bastionRta, fortressRta, first_portalRta, strongholdRta, endRta, finishRta,
        UNIX_TIMESTAMP(insertTime) as insertTime, UNIX_TIMESTAMP(lastUpdated) as updateTime, UNIX_TIMESTAMP(realUpdated) as realUpdate,
        vodId, vodOffset
        FROM pace WHERE id=? ORDER BY id ASC LIMIT 1;`,
            [worldId]
        );
    } else {
        [results, fields] = await (await getConn()).execute(
            `SELECT id, worldId, nickname, uuid, twitch, nether, bastion, fortress, first_portal, stronghold, end, finish, 
        netherRta, bastionRta, fortressRta, first_portalRta, strongholdRta, endRta, finishRta,
        UNIX_TIMESTAMP(insertTime) as insertTime, UNIX_TIMESTAMP(lastUpdated) as updateTime, UNIX_TIMESTAMP(realUpdated) as realUpdate,
        vodId, vodOffset
        FROM pace WHERE worldId=? ORDER BY id ASC LIMIT 1;`,
            [worldId]
        );
    }

    if (Array.isArray(results) && results.length === 0) {
        return null;
    }
    // @ts-ignore
    return {data: results[0], time: Date.now()};
};

export const getBans = async () => {
    return []
    /*const [results, fields] = await (await getConn()).execute(
        `SELECT uuid FROM bans;`
    );
    if (Array.isArray(results) && results.length === 0) {
        return null;
    }
    // @ts-ignore
    const uuids = results.map((x: any) => x["uuid"]);
    return uuids;*/
}

export const getUUID = async (nick: string) => {
    const [results, fields] = await (await getConn()).execute(
        `SELECT uuid FROM pace WHERE nickname=? ORDER BY id DESC LIMIT 1;`,
        [nick]
    );
    if (Array.isArray(results) && results.length === 0) {
        return null;
    }
    // @ts-ignore
    return results[0]["uuid"];
};

export const deleteRun = async (id: string) => {
    const connection = await acquireDbConnection();
    let uuid: string | null = null;
    let deleted = false;
    try {
        await connection.beginTransaction();
        const [runRows] = await executeOnConnection<any[]>(
            connection,
            `SELECT uuid FROM pace WHERE id=? LIMIT 1 FOR UPDATE;`,
            [id]
        );
        uuid = runRows[0]?.uuid ?? null;
        if (uuid) {
            // Keep invalidation in the same authoritative transaction as the
            // delete. Redis is only the fast wake-up path; the history job also
            // consumes this durable outbox entry.
            await executeOnConnection(
                connection,
                `INSERT INTO cache_invalidation_outbox (scope, entityId, token, createdAt)
                 VALUES ('recent', ?, UUID(), NOW(3)), ('identity', ?, UUID(), NOW(3))
                 ON DUPLICATE KEY UPDATE token=UUID(), createdAt=NOW(3);`,
                [uuid, uuid]
            );
        }
        await executeOnConnection(connection, `DELETE FROM nethers WHERE runId=?;`, [id]);
        const [results] = await executeOnConnection(connection, `DELETE FROM pace WHERE id=? LIMIT 1;`, [id]);
        await connection.commit();
        deleted = (results as mysql.ResultSetHeader).affectedRows === 1;
    } catch (error) {
        try {
            await connection.rollback();
        } catch (rollbackError) {
            console.error("Unable to roll back failed run deletion:", rollbackError);
        }
        throw error;
    } finally {
        releaseDbConnection(connection);
    }

    // Invalidation happens after the authoritative transaction. Failures here must
    // not attempt to roll back (or mask) a deletion that MySQL already committed.
    if (deleted && uuid) {
        try {
            const relatedKeys = cache.keys().filter((key) => {
                try {
                    const parts = JSON.parse(key);
                    return Array.isArray(parts) && parts.slice(1).includes(uuid);
                } catch {
                    return false;
                }
            });
            if (relatedKeys.length > 0) cache.del(relatedKeys);
        } catch (error) {
            console.error(`Unable to evict local run caches for ${uuid}:`, error);
        }
        try {
            await redis.sadd("cache:recent:dirty", uuid);
        } catch (error) {
            // The durable SQL outbox remains authoritative if Redis is down.
            console.error(`Unable to send the fast recent-run invalidation for ${uuid}:`, error);
        }
    }
    return deleted;
};

export const getAllUsers = async () => {
    try {
        const redisUsers = await fetchAllUsersFromRedis();
        if (redisUsers.length > 0) return redisUsers;
    } catch (error) {
        console.error("Unable to read users from Redis; falling back to MySQL:", error);
    }

    const bans = await getCached(getBans, "getBans");
    const [latestNamesResult, twitchResult] = await Promise.all([
        (await getConn()).execute(`
            SELECT p.uuid, p.nickname
            FROM pace p
            INNER JOIN (
                SELECT uuid, MAX(id) AS maxId
                FROM pace
                GROUP BY uuid
            ) latest ON latest.uuid=p.uuid AND latest.maxId=p.id;
        `),
        (await getConn()).execute(`
            SELECT DISTINCT uuid, twitch
            FROM pace
            WHERE twitch IS NOT NULL;
        `),
    ]);
    const latestNames = latestNamesResult[0] as any[];
    const twitchRows = twitchResult[0] as any[];
    const nameMap : {
        [uuid: string]: { id: string, nick: string, twitches: string[] }
    } = {}
    for (const row of latestNames) {
        if (!bans.includes(row.uuid)) {
            nameMap[row.uuid] = {id: row.uuid, nick: row.nickname, twitches: []};
        }
    }
    for (const row of twitchRows) {
        if (nameMap[row.uuid]) nameMap[row.uuid].twitches.push(row.twitch);
    }
    return Object.values(nameMap);
}

export const getAllNamesByNick = async (nick: string) => {
    try {
        const normalizedNick = nick.toLocaleLowerCase();
        const users = await getCached(getAllUsers, "getAllUsers");
        const matches = (users as any[]).filter(
            (candidate) => String(candidate.nick || "").toLocaleLowerCase() === normalizedNick
        );
        // Reused names can belong to multiple UUIDs. The compact cache does
        // not carry association IDs, so only use it when ownership is
        // unambiguous; SQL preserves the latest-association behavior.
        if (matches.length === 1) {
            const user = matches[0];
            const bans = await getCached(getBans, "getBans");
            return bans.includes(user.id) ? null : {nick: user.nick, uuid: user.id};
        }
    } catch (error) {
        console.error("Unable to resolve nickname from cached users; falling back to MySQL:", error);
    }
    const [results, fields] = await (await getConn()).execute(
        `SELECT uuid, nickname FROM pace WHERE nickname=? ORDER BY id DESC LIMIT 1;`,
        [nick]
    );
    if (Array.isArray(results) && results.length === 0) {
        return null;
    }
    const bans = await getCached(getBans, "getBans");
    // @ts-ignore
    if(bans.includes(results[0]["uuid"])){
        return null;
    }
    // @ts-ignore
    return {nick: await getCached(getNick, "getNick", results[0]["uuid"]), uuid: results[0]["uuid"]};
}

export const getAllNamesByTwitch = async (twitch: string) => {
    try {
        const normalizedTwitch = twitch.toLocaleLowerCase();
        const users = await getCached(getAllUsers, "getAllUsers");
        const matches = (users as any[]).filter((candidate) =>
            Array.isArray(candidate.twitches) && candidate.twitches.some(
                (account: unknown) => String(account).toLocaleLowerCase() === normalizedTwitch
            )
        );
        if (matches.length === 1) {
            const user = matches[0];
            const bans = await getCached(getBans, "getBans");
            return bans.includes(user.id) ? null : {nick: user.nick, uuid: user.id};
        }
    } catch (error) {
        console.error("Unable to resolve Twitch account from cached users; falling back to MySQL:", error);
    }
    const [results, fields] = await (await getConn()).execute(
        `SELECT uuid, nickname FROM pace WHERE twitch=? ORDER BY id DESC LIMIT 1;`,
        [twitch]
    );
    if (Array.isArray(results) && results.length === 0) {
        return null;
    }
    const bans = await getCached(getBans, "getBans");
    // @ts-ignore
    if(bans.includes(results[0]["uuid"])){
        return null;
    }
    // @ts-ignore
    return {nick: await getCached(getNick, "getNick", results[0]["uuid"]), uuid: results[0]["uuid"]};
}

/** Accounts looked up one by one before getTwitchAccounts groups every run instead. */
const TWITCH_ACCOUNT_LOOKUPS = 8;

/**
 * A player's two most recently used Twitch accounts. Grouping scans one
 * index entry per live run (21k for the busiest player), although players
 * have a handful of accounts: step through the distinct names in the
 * (uuid, twitch, insertTime) index instead, reading each one's newest entry.
 */
const readTwitchAccounts = async (uuid: string): Promise<any[]> => {
    const accounts: any[] = [];
    let previous: string | null = null;
    for (let lookup = 0; lookup <= TWITCH_ACCOUNT_LOOKUPS; lookup++) {
        // Each statement also says whether another name follows, so a player
        // with one account costs one statement.
        const [rows]: [any[], unknown] = await (await getConn()).execute<any[]>(
            `SELECT next.twitch,
                (SELECT UNIX_TIMESTAMP(MAX(insertTime)) FROM pace WHERE uuid=? AND twitch=next.twitch) AS time,
                (SELECT 1 FROM pace WHERE uuid=? AND twitch > next.twitch LIMIT 1) AS more
             FROM (
                 SELECT twitch FROM pace
                 WHERE uuid=? AND twitch IS NOT NULL${previous === null ? "" : " AND twitch > ?"}
                 ORDER BY twitch ASC LIMIT 1
             ) next;`,
            previous === null ? [uuid, uuid, uuid] : [uuid, uuid, uuid, previous]
        );
        if (rows.length > 0) accounts.push({twitch: rows[0].twitch, time: rows[0].time});
        if (rows.length === 0 || rows[0].more === null) {
            // Newest first; the sort is stable, so ties keep the grouped order.
            return accounts
                .sort((left, right) => (right.time ?? -Infinity) - (left.time ?? -Infinity))
                .slice(0, 2);
        }
        previous = rows[0].twitch;
    }
    const [results] = await (await getConn()).execute<any[]>(
        `SELECT twitch, UNIX_TIMESTAMP(MAX(insertTime)) AS time
         FROM pace
         WHERE uuid=? AND twitch IS NOT NULL
         GROUP BY twitch
         ORDER BY MAX(insertTime) DESC
         LIMIT 2;`,
        [uuid]
    );
    return results;
};

export const getTwitchAccounts = async (uuid: string) => {
    const results = await readTwitchAccounts(uuid);
    if (Array.isArray(results) && results.length === 0) {
        return null;
    }
    const bans = await getCached(getBans, "getBans");
    if(bans.includes(uuid)){
        return null;
    }

    return results;
}

export const getNick = async (uuid: string) => {
    const [results, fields] = await (await getConn()).execute(
        `SELECT nickname FROM pace WHERE uuid=? ORDER BY id DESC LIMIT 1;`,
        [uuid]
    );

    if (Array.isArray(results) && results.length === 0) {
        return null;
    }

    const bans = await getCached(getBans, "getBans");
    if(bans.includes(uuid)){
        return null;
    }

    // @ts-ignore
    return results[0]["nickname"];
}

export const getNickAlways = async (uuid: string) => {
    let nick = await getCached(getNick, "getNick", uuid);
    if(nick !== null){
        return nick;
    }
    const res = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`, {
        signal: AbortSignal.timeout(3_000),
    })
    if(res.status !== 200){
        return "Unknown"
    } else {
        return (await res.json()).name
    }
}

export const isTwitchLive = async (twitch: string) => {
    return false; // TODO fix
    let isLive = false
    const res = await fetch(`https://static-cdn.jtvnw.net/previews-ttv/live_user_${twitch}-80x45.jpg`, {
        cache: "no-store",
        signal: AbortSignal.timeout(3_000),
    })
    if (res.status !== 200) {
        console.log("Error checking if " + twitch + " is live: " + res.status)
        return false
    }
    isLive = res.headers.get('vary') === null
    return isLive
}

function getPreviousSplit(split: string) {
    switch (split) {
        case "bastion":
            return "nether"
        case "fortress":
            return "bastion"
        case "first_structure":
            return "nether"
        case "second_structure":
            return "first_structure"
        case "first_portal":
            return "second_structure"
        case "stronghold":
            return "first_portal"
        case "end":
            return "stronghold"
        case "finish":
            return "end"
        default:
            return null
    }
}

function getPreviousAASplit(split: string) {
    switch (split) {
        case "bastion":
            return "nether"
        case "fortress":
            return "bastion"
        case "stronghold":
            return "fortress"
        case "end":
            return "stronghold"
        case "elytra":
            return "end"
        case "credits":
            return "elytra"
        case "finish":
            return "credits"
        default:
            return null
    }
}

export {calculateAvg}

export const getAllAAData = async (interval: string = "30 DAY", filterCategory: string, limit: number = 10_000) => {
    const safeDays = intervalDays(interval);
    // The public export reads one sentinel row above its response cap so it can
    // report truncation accurately.
    const safeLimit = boundedInteger(limit, 10_000, 1, 10_001);
    const [rows, fields] = await (await getConn()).execute(
        `SELECT *
         FROM aa
         WHERE insertTime >= NOW() - INTERVAL ? DAY
         ORDER BY insertTime DESC, id DESC
         LIMIT ?;`,
        [mysqlIntegerParam(safeDays), mysqlIntegerParam(safeLimit)]
    )
    return rows
}

export const getPlayerRuns = async (uuid: string, limit : number = 5) => {
    const bans = await getCached(getBans, "getBans");
    if (bans.includes(uuid)) {
        return []
    }
    const safeLimit = boundedInteger(limit, 5, 1, 50);
    const [rows, fields] = await (await getConn()).execute(
        `SELECT id, nickname, uuid, twitch, nether, bastion, fortress, first_portal, stronghold, end, finish,
        lastUpdated, worldId, vodId, UNIX_TIMESTAMP(insertTime) AS time
        FROM pace WHERE uuid=? AND bastion > 0 AND fortress > 0 ORDER BY id DESC LIMIT ?;`,
        [uuid, mysqlIntegerParam(safeLimit)]
    )
    return rows
}

export const getRecentAARuns = async (uuid: string, limit : number = 5) => {
    const safeLimit = boundedInteger(limit, 5, 1, 50);
    const [rows, fields] = await (await getConn()).execute(
        `SELECT id, nickname, uuid, twitch, nether, bastion, fortress, stronghold, end, elytra, credits, finish,
        lastUpdated, NULL AS vodId, UNIX_TIMESTAMP(insertTime) AS time
        FROM aa WHERE uuid=? AND elytra > 0 ORDER BY id DESC LIMIT ?;`,
        [uuid, mysqlIntegerParam(safeLimit)]
    )
    return rows
}

export const getAllAARuns = async (uuid: string) => {
    const [rows, fields] = await (await getConn()).execute(
        `SELECT id, nickname, uuid, twitch, nether, bastion, fortress, stronghold, end, elytra, credits, finish,
        lastUpdated, NULL AS vodId, UNIX_TIMESTAMP(insertTime) AS time
        FROM aa WHERE uuid=? ORDER BY id DESC;`,
        [uuid]
    )
    return rows
}

export const getAllPlayerRuns = async (uuid: string, limit : number = 100) => {
    const bans = await getCached(getBans, "getBans");
    if (bans.includes(uuid)) {
        return []
    }
    const safeLimit = boundedInteger(limit, 100, 1, 1_000);
    const [rows, fields] = await (await getConn()).execute(
        `SELECT id, nickname, uuid, twitch, nether, bastion, fortress, first_portal, second_portal,
        stronghold, end, finish, lastUpdated, worldId, vodId, vodOffset,
        UNIX_TIMESTAMP(insertTime) AS time, UNIX_TIMESTAMP(lastUpdated) AS updatedTime
        FROM pace WHERE uuid=? ORDER BY id DESC LIMIT ?;`,
        [uuid, mysqlIntegerParam(safeLimit)]
    )
    return rows
}

export const getAllUserInfo = async () => {
    try {
        const users = await fetchAllUsersFromRedis();
        if (users.length > 0 && users.every((user: any) => Object.prototype.hasOwnProperty.call(user, "displayName"))) {
            // The Redis list holds every player for search. Pages embed this
            // projection in their HTML only to look up custom names and
            // colours, so drop the players who have none: lookups already
            // treat a missing user as "no customisation".
            return users
                .filter((user: any) => user.displayName || user.color || user.bgColor)
                .map((user: any) => ({
                    uuid: user.id,
                    displayName: user.displayName ?? null,
                    color: user.color ?? null,
                    bgColor: user.bgColor ?? null,
                }));
        }
    } catch (error) {
        console.error("Unable to read user customization from Redis; falling back to MySQL:", error);
    }
    const [rows, fields] = await (await getConn()).execute(
        `SELECT uuid, displayName, color, bgColor FROM users;`
    )
    return rows
}

export const getUserInfo = async (uuid: string) => {
    try {
        const users = await getCached(fetchAllUsersFromRedis, "fetchAllUsersFromRedis");
        const user = users.find((candidate: any) => candidate.id === uuid);
        if (user && Object.prototype.hasOwnProperty.call(user, "displayName")) {
            return {
                uuid,
                displayName: user.displayName ?? null,
                color: user.color ?? null,
                bgColor: user.bgColor ?? null,
            };
        }
    } catch (error) {
        console.error(`Unable to read customization for ${uuid} from Redis; falling back to MySQL:`, error);
    }
    const [rows] = await (await getConn()).execute<any[]>(
        `SELECT uuid, displayName, color, bgColor FROM users WHERE uuid=? LIMIT 1;`,
        [uuid]
    );
    return rows[0] ?? null;
}

export const getAllPlayerRunsOptimized = async (uuid: string) => {
    const [rows, fields] = await (await getConn()).execute(
        `SELECT id, nether, bastion, fortress, 
            CASE
                WHEN bastion is null and fortress is null THEN null
                WHEN bastion is null and fortress is not null THEN fortress
                WHEN bastion is not null and fortress is null THEN bastion 
                WHEN bastion <= fortress then bastion 
                ELSE fortress 
            END as first_structure, 
            CASE 
                WHEN bastion is null and fortress is null THEN null
                WHEN bastion is null and fortress is not null THEN null
                WHEN bastion is not null and fortress is null THEN null
                WHEN bastion <= fortress then fortress
                ELSE bastion 
            END as second_structure, 
            first_portal,
            stronghold, 
            end,
            finish, 
            lastUpdated,
            vodId,
            twitch
        FROM pace
        WHERE uuid=? ORDER BY id DESC;`,
        [uuid]
    )
    return rows
}

export const getLatestRun = async (uuid: string) => {
    const [rows, fields] = await (await getConn()).execute<[]>(
        `SELECT id, netherRta, UNIX_TIMESTAMP(insertTime) AS time FROM pace WHERE uuid=? ORDER BY id DESC LIMIT 1;`,
        [uuid]
    )
    if(rows.length === 0) return []
    return rows
}

export const getAllPlayerRunsByPeriod = async (uuid: string, days: number, limit : number = 9999999, liveOnly: boolean = false) => {
    const safeDays = boundedInteger(days, 30, 1, MAX_LOOKBACK_DAYS);
    const safeLimit = boundedInteger(limit, MAX_STATS_ROWS_PER_PLAYER, 1, MAX_STATS_ROWS_PER_PLAYER);
    let query = `SELECT id, nether, bastion, fortress, first_portal, stronghold, end, finish, 
        lootBastion, obtainObsidian, obtainCryingObsidian, obtainRod,
        UNIX_TIMESTAMP(insertTime) AS time, UNIX_TIMESTAMP(lastUpdated) AS updatedTime, UNIX_TIMESTAMP(realUpdated) AS realUpdated
        FROM pace WHERE uuid=? AND insertTime >= NOW() - INTERVAL ? DAY ORDER BY insertTime DESC, id DESC LIMIT ?;`;
    if(liveOnly){
        query = `SELECT id, nether, bastion, fortress, first_portal, stronghold, end, finish, 
        lootBastion, obtainObsidian, obtainCryingObsidian, obtainRod,
        UNIX_TIMESTAMP(insertTime) AS time, UNIX_TIMESTAMP(lastUpdated) AS updatedTime, UNIX_TIMESTAMP(realUpdated) AS realUpdated
        FROM pace WHERE uuid=? AND twitch IS NOT NULL AND insertTime >= NOW() - INTERVAL ? DAY ORDER BY insertTime DESC, id DESC LIMIT ?;`;
    }
    const [rows, fields] = await (await getConn()).execute(
        query,
        [uuid, mysqlIntegerParam(safeDays), mysqlIntegerParam(safeLimit)]
    )
    return rows
}

export const getNethersByPeriod = async (uuid: string, days: number, limit : number = 9999999, liveOnly: boolean = false) => {
    const safeDays = boundedInteger(days, 30, 1, MAX_LOOKBACK_DAYS);
    const safeLimit = boundedInteger(limit, MAX_STATS_ROWS_PER_PLAYER, 1, MAX_STATS_ROWS_PER_PLAYER);
    let query = `SELECT nether, UNIX_TIMESTAMP(insertTime) AS time FROM pace WHERE uuid=? AND insertTime >= NOW() - INTERVAL ? DAY ORDER BY insertTime DESC, id DESC LIMIT ?;`;
    if(liveOnly){
        query = `SELECT nether, UNIX_TIMESTAMP(insertTime) AS time FROM pace WHERE uuid=? AND twitch IS NOT NULL AND insertTime >= NOW() - INTERVAL ? DAY ORDER BY insertTime DESC, id DESC LIMIT ?;`;
    }
    const [rows, fields] = await (await getConn()).execute(
        query,
        [uuid, mysqlIntegerParam(safeDays), mysqlIntegerParam(safeLimit)]
    )
    return rows
}

export const jude = async (uuid: string) => {
    let query = `SELECT id, nether, bastion, fortress, first_portal, stronghold, end, finish, 
        lootBastion, obtainObsidian, obtainCryingObsidian, obtainRod,
        UNIX_TIMESTAMP(insertTime) AS time, UNIX_TIMESTAMP(lastUpdated) AS updatedTime, UNIX_TIMESTAMP(realUpdated) AS realUpdated
        FROM pace WHERE uuid=? AND finish IS NOT NULL ORDER BY id DESC LIMIT 1;`;
    const [rows, fields] = await (await getConn()).execute(
        query,
        [uuid]
    )
    return rows
}

export const getRecentTimestamps = async (uuid: string, limit : number = 5, onlyFortress : boolean = false) => {
    const bans = await getCached(getBans, "getBans");
    if (bans.includes(uuid)) {
        return []
    }
    const safeLimit = boundedInteger(limit, 5, 1, 50);
    const selectedColumns = `id, nether, bastion, fortress, first_portal, stronghold, end, finish,
        netherRta, bastionRta, fortressRta, first_portalRta, strongholdRta, endRta, finishRta,
        UNIX_TIMESTAMP(insertTime) AS insertTime, UNIX_TIMESTAMP(lastUpdated) AS updateTime,
        UNIX_TIMESTAMP(realUpdated) AS realUpdate`;
    let query = `SELECT ${selectedColumns} FROM pace WHERE uuid=? ORDER BY id DESC LIMIT ?;`
    if(onlyFortress){
        query = `SELECT ${selectedColumns} FROM pace WHERE uuid=? AND bastion > 0 AND fortress > 0 ORDER BY id DESC LIMIT ?;`
    }
    const [rows, fields] = await (await getConn()).execute(
        query,
        [uuid, mysqlIntegerParam(safeLimit)]
    )
    return rows
}

const serializeCacheArgument = (value: unknown): unknown => {
    if (value === undefined) return {type: "undefined"};
    if (typeof value === "number" && !Number.isFinite(value)) {
        return {type: "number", value: String(value)};
    }
    if (typeof value === "bigint") return {type: "bigint", value: value.toString()};
    if (value instanceof Date) return {type: "date", value: value.toISOString()};
    if (Array.isArray(value)) return value.map(serializeCacheArgument);
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, nestedValue]) => [key, serializeCacheArgument(nestedValue)])
        );
    }
    return value;
};

const makeCacheKey = (funcName: string, args: unknown[]) =>
    JSON.stringify([funcName, ...args.map(normalizeCacheKeyArgument).map(serializeCacheArgument)]);

// SQL interval units are case-insensitive, so normalize this common form before
// constructing a key. This lets callers using "30 DAY" and "30 day" share an
// entry without changing arbitrary string arguments such as player names.
const normalizeCacheKeyArgument = (value: unknown) => {
    if (typeof value !== "string") return value;

    const interval = /^(\d{1,4})\s+days?$/i.exec(value.trim());
    return interval ? `${interval[1]} day` : value;
};

const resolveCacheTtl = (funcName: string, args: unknown[]) => {
    const configuredTtl = (ttls as Record<string, number | Record<string, number>>)[funcName];
    if (typeof configuredTtl === "number") return configuredTtl;
    if (!configuredTtl) return undefined;

    const rawRange = args[0];
    const normalizedRange = typeof rawRange === "number"
        ? `${rawRange} day`
        : String(rawRange ?? "").trim().toLowerCase();
    return configuredTtl[normalizedRange] ?? configuredTtl[String(rawRange)] ?? configuredTtl.default;
};

const makeRoomInCache = (incomingKey: string) => {
    if (cache.has(incomingKey) || cache.getStats().keys < cacheMaxKeys) return;

    const entriesToRemove = Math.max(1, Math.ceil(cacheMaxKeys * 0.1));
    // node-cache drops an expired entry only when it is read or at its
    // periodic check, so most of a full cache is usually dead short-TTL
    // entries. Remove those first; evicting by age alone throws away live
    // entries (name lookups, 20-60 s row caches) while the dead ones stay.
    const now = Date.now();
    const victims: string[] = [];
    for (const [key, expiresAt] of cacheAccess) {
        if (expiresAt <= now) victims.push(key);
    }
    if (victims.length < entriesToRemove) {
        // Map iteration order is insertion order. touchCacheKey moves recently
        // accessed keys to the end, making the leading keys the LRU entries.
        const expired = new Set(victims);
        for (const key of cacheAccess.keys()) {
            if (victims.length >= entriesToRemove) break;
            if (!expired.has(key)) victims.push(key);
        }
    }

    if (victims.length > 0) {
        cache.del(victims);
        for (const key of victims) cacheAccess.delete(key);
    }
};

const shouldCacheResult = (result: unknown) =>
    !Array.isArray(result) || result.length <= cacheMaxArrayRows;

/** Moves a key to the recently-used end; the value is when its entry expires. */
const touchCacheKey = (key: string, expiresAt?: number) => {
    const known = expiresAt ?? cacheAccess.get(key) ?? Number.POSITIVE_INFINITY;
    cacheAccess.delete(key);
    cacheAccess.set(key, known);
};

export const getCached = async <T>(
    func: (...args: any[]) => Promise<T>, // Ensure the function returns a Promise
    funcName: string,
    ...args: any[]
): Promise<any> => {
    // Include type and argument boundaries so distinct requests cannot collide.
    const key = makeCacheKey(funcName, args);

    // 2. Check the main data cache first for a valid, non-expired result
    if (cache.has(key)) {
        touchCacheKey(key);
        //console.log(`[CACHE HIT] Returning data for key: ${key}`);
        return cache.get(key) as T;
    }

    // 3. Check if another request for the same key is already in-flight
    if (promiseCache.has(key)) {
        //console.log(`[PROMISE HIT] Waiting for in-flight request for key: ${key}`);
        // Return the existing promise for others to await
        return promiseCache.get(key)! as Promise<T>;
    }

    // 4. If no data and no in-flight promise, this is the first request.
    //    Create the promise, but DON'T await it yet.
    //console.log(`[FETCH] Starting new fetch for key: ${key}`);
    const startedAt = Date.now();
    // Defer invocation so synchronous throws participate in the same
    // in-flight/error path as rejected promises.
    const promise = Promise.resolve().then(() => func(...args));

    // 5. Store the promise in the promise cache immediately
    promiseCache.set(key, promise);

    try {
        // 6. Now, await the result of the function call
        const result = await promise;

        // 7. Determine the TTL
        const ttl = resolveCacheTtl(funcName, args);

        // 8. Store the final result in the main data cache
        if (shouldCacheResult(result)) {
            makeRoomInCache(key);
            try {
                if (ttl === undefined) {
                    cache.set(key, result);
                } else {
                    cache.set(key, result, ttl);
                }
                touchCacheKey(key, Date.now() + (ttl ?? DEFAULT_CACHE_TTL_SECONDS) * 1_000);
            } catch (error) {
                // A full local cache must never turn a successful database/Redis read into a 500.
                console.error(`Unable to cache ${funcName}:`, error);
            }
        }
        //console.log(`[SUCCESS] Cached data for key: ${key} with TTL: ${ttl}s`);

        return result;
    } catch (error) {
        // 9. If the promise fails, we must re-throw the error
        //    so the caller can handle it.
        //console.error(`[FAIL] Fetch failed for key: ${key}`, error);
        throw error;
    } finally {
        const elapsedMs = Date.now() - startedAt;
        if (elapsedMs >= slowDataFetchMs) {
            // Log the helper label only: arguments may include secrets or player data.
            console.warn(`[data] Slow fetch ${funcName}: ${elapsedMs}ms`);
        }
        // 10. CRITICAL: Whether it succeeded or failed, remove the
        //     promise from the in-flight cache. This allows subsequent
        //     requests to retry the fetch if it failed.
        promiseCache.delete(key);
    }
}

export const getTrimmedLeaderboards = async (days: number) => {
    return await fetchTopLeaderboardsFromRedis(days);
}

export const getTrimmedAALB = async (days: number, limit = 10, skipFastest = false) => {
    const lb = await getCached(getAALB, "getAALB", days + " DAY")
    const filters = [
        CategoryType.AVG,
        CategoryType.COUNT,
        CategoryType.FASTEST,
        CategoryType.CONVERSION
    ]
    const categories = [
        "nether",
        "bastion",
        "fortress",
        "stronghold",
        "end",
        "elytra",
        "credits",
        "finish"
    ]
    let leaderboards: { [filter: number]: { [category: string]: Entry[] } } = {}
    for (const filter of filters) {
        leaderboards[filter] = {}
        for (const category of categories) {
            leaderboards[filter][category] = []
        }
    }
    for (const filter of filters) {
        if(filter === CategoryType.FASTEST && skipFastest){
            continue
        }
        for (const category of categories) {
            const data = lb[filter][category]
            let specific;
            if(filter === CategoryType.CONVERSION){
                specific = data.filter((x: Entry) => x.qty >= getMinAAQty(category, days))
            } else if (filter === CategoryType.AVG){
                specific = data.filter((x: Entry) => x.qty >= getMinAAQty(category, days))
            } else if (filter === CategoryType.FASTEST){
                specific = data
            } else {
                specific = data
            }
            leaderboards[filter][category] = specific.slice(0, limit)
        }
    }
    return leaderboards
}

export const getLeaderboards = async (interval: string = "30 DAY") => {
    return await fetchLeaderboardsFromRedis(parseInt(interval.split(" ")[0]));
};

const calculateAALeaderboardsFromDatabase = async (interval: string = "30 DAY") => {
    const safeDays = intervalDays(interval);

    const filters = [
        CategoryType.AVG,
        CategoryType.COUNT,
        CategoryType.FASTEST,
        CategoryType.CONVERSION
    ]

    // Define stats categories
    const categories = [
        "nether",
        "bastion",
        "fortress",
        "stronghold",
        "end",
        "elytra",
        "credits",
        "finish"
    ]

    // Init categories
    let leaderboards: { [filter: number]: { [category: string]: Entry[] } } = {}
    for (const filter of filters) {
        leaderboards[filter] = {}
        for (const category of categories) {
            leaderboards[filter][category] = []
        }
    }

    const [rows, fields] = await (await getConn()).execute(
        `SELECT id, nickname, uuid, 
        nether, bastion, fortress, stronghold, end, elytra, credits, finish
        FROM aa WHERE insertTime >= NOW() - INTERVAL ? DAY ORDER BY insertTime DESC, id DESC;`,
        [mysqlIntegerParam(safeDays)]
    )

    const nickMap = new Map<string, string>()

    let splitData: {
        [uuid: string]: {
            [column: string]: number[]
        }
    } = {}

    let uuids: string[] = []
    // @ts-ignore
    for (let row of rows) {
        if (!uuids.includes(row["uuid"])) {
            uuids.push(row["uuid"])
        }
    }

    for (let uuid of uuids) {
        splitData[uuid] = {}
        for (const category of categories) {
            splitData[uuid][category] = []
        }
    }

    // @ts-ignore
    for (let row of rows) {
        const uuid = row["uuid"]
        const nether = row["nether"]
        const end = row["end"]
        const elytra = row["elytra"]
        const credits = row["credits"]
        const finish = row["finish"]
        if(nether < 120_000 && end === null){
            continue
        }
        if(credits !== null && elytra === null){
            continue
        }
        for (const category of categories) {
            if (row[category] !== null) {
                if (!nickMap.has(uuid)) {
                    nickMap.set(row["uuid"], row["nickname"])
                }
                if(!splitData[uuid]){
                    splitData[uuid] = {}
                }
                if(!splitData[uuid][category]){
                    splitData[uuid][category] = []
                }
                splitData[uuid][category].push(row[category])
            }
        }
    }

    for (let uuid in splitData) {
        for (const cat of categories) {
            if(!splitData[uuid][cat] || splitData[uuid][cat].length === 0){
                continue
            }
            // One pass per series gives the count, trimmed average, and fastest
            // value that all four boards share.
            const stats = trimmedStats(splitData[uuid][cat])
            for(const filter of filters) {
                let val = 0
                if (filter === CategoryType.COUNT) {
                    val = stats.count
                } else if (filter === CategoryType.AVG) {
                    val = stats.avg
                } else if(filter === CategoryType.FASTEST) {
                    val = stats.min
                } else if(filter === CategoryType.CONVERSION) {
                    const prev = getPreviousAASplit(cat)
                    if (prev !== null) {
                        const oldSplit = splitData[uuid][prev].length
                        const newSplit = stats.count
                        val = (newSplit / oldSplit) * 100
                        if(val === Infinity){
                            val = 1
                        }
                    }
                }
                if(val > 0) {
                    leaderboards[filter][cat].push({
                        uuid: uuid,
                        name: nickMap.get(uuid) as string,
                        value: val,
                        qty: stats.count,
                        avg: stats.avg
                    })
                }
            }
        }
    }


    // Sort and truncate categories
    for(const filter of filters) {
        for (const category of categories) {
            let cat = leaderboards[filter][category]
            if(cat == null || cat.length === 0){
                continue
            }
            // remove empty values
            cat = cat.filter((a) => a.value > 0)


            if (filter === CategoryType.AVG || filter === CategoryType.FASTEST) { // sort ascending (avg, fastest)
                cat = cat.sort((a, b) => a.value - b.value || b.qty - a.qty)
            } else { // sort descending (qty, conversion)
                cat = cat.sort((a, b) => b.value - a.value || b.qty - a.qty)
            }

            leaderboards[filter][category] = cat
        }
    }
    return leaderboards;
};

export const getAALB = async (interval: string = "30 DAY") => {
    const requestedDays = Number.parseInt(interval.split(" ")[0], 10);
    const days = [1, 7, 30, 9999].includes(requestedDays) ? requestedDays : 30;
    try {
        const cachedLeaderboards = await fetchAALeaderboardsFromRedis(days);
        if (cachedLeaderboards) return cachedLeaderboards;
    } catch (error) {
        console.error(`Unable to read AA leaderboards for ${days} days from Redis:`, error);
    }
    return calculateAALeaderboardsFromDatabase(`${days} DAY`);
};

export const getRecentNethers = async (uuid: string, limit: number = 100, liveOnly: boolean = false) => {
    const safeLimit = boundedInteger(limit, 100, 1, 500);
    let query = `SELECT runId, pace.nether, pace.vodId, twitch, wallTime, playTime, enters, isAccurate, UNIX_TIMESTAMP(nethers.insertTime) as time, resets, totalResets, sceneChanges
        FROM nethers INNER JOIN pace ON nethers.runId=pace.id 
        WHERE nethers.uuid=? ORDER BY nethers.id DESC LIMIT ?;`;
    if (liveOnly) {
        query = `SELECT runId, pace.vodId, pace.nether, twitch, wallTime, playTime, enters, isAccurate, UNIX_TIMESTAMP(nethers.insertTime) as time, resets, totalResets, sceneChanges
        FROM nethers INNER JOIN pace ON nethers.runId=pace.id 
        WHERE nethers.uuid=? AND pace.twitch IS NOT NULL ORDER BY nethers.id DESC LIMIT ?;`;
    }
    const [results, _] = await (await getConn()).execute<any[]>(
        query,
        [uuid, mysqlIntegerParam(safeLimit)]
    );

    return results;
}

/**
 * Session endpoints walk a player's runs newest first and stop at the first
 * gap longer than `hoursBetween`, so a long window usually needs only its
 * newest few rows. They read this many rows first and fall back to the full
 * window only when the walk reaches the end of a full page without stopping.
 * The page is a prefix of the full, totally ordered result, so the walk sees
 * exactly the rows it would have seen.
 */
export const SESSION_PAGE_ROWS = 1_000;

/**
 * How many rows a session window holds, counted up to `limit`. A session that
 * ends inside the first page still has to report whether the whole window
 * would have been truncated.
 */
const countWindowRows = async (from: string, values: unknown[], limit: number): Promise<number> => {
    const [rows] = await (await getConn()).execute<any[]>(
        `SELECT COUNT(*) AS windowRows FROM (SELECT 1 ${from} LIMIT ?) bounded;`,
        [...values, mysqlIntegerParam(limit)]
    );
    return Number(rows[0].windowRows);
};

const nphColumns = `pace.nether as nether, twitch, wallTime, playTime, enters, isAccurate,
    UNIX_TIMESTAMP(nethers.insertTime) as time, resets, totalResets`;

const nphWindow = (liveOnly: boolean) => `FROM nethers INNER JOIN pace ON nethers.runId=pace.id
        WHERE nethers.uuid=? ${liveOnly ? "AND pace.twitch IS NOT NULL " : ""}AND nethers.insertTime >= NOW() - INTERVAL ? HOUR`;

// nethers_ibfk_1 guarantees every nethers row joins to a pace row, so without
// the live filter the window can be counted from the nethers index alone.
const nphCountWindow = (liveOnly: boolean) => liveOnly
    ? nphWindow(true)
    : "FROM nethers WHERE nethers.uuid=? AND nethers.insertTime >= NOW() - INTERVAL ? HOUR";

/** Walks NPH rows newest first until the first long gap. */
const walkNphSession = (rows: any[], safeHoursBetween: number) => {
    let wallTime = 0;
    let playTime = 0;
    let firstTime = 0;
    let lastTime = 0;
    let nethers = 0;
    let resets = 0;
    let enters = 0;
    let times = [];
    let stopped = false;
    for (const row of rows) {
        if(firstTime === 0){
            firstTime = row.time
        }
        let diff = lastTime - row.time
        if(lastTime > 0 && diff > 60 * 60 * safeHoursBetween){
            stopped = true
            break
        }
        times.push(row.nether)
        playTime += row.playTime;
        wallTime += row.wallTime;
        lastTime = row.time;
        nethers += 1;
        if(row.resets > 0) {
            resets += row.resets;
        }
        enters += row.enters;
    }
    return {wallTime, playTime, firstTime, lastTime, nethers, resets, enters, times, stopped};
};

export const getNPH = async (uuid: string, hours: number, hoursBetween: number, liveOnly: boolean = false) => {
    const safeHours = boundedInteger(hours, 24, 1, MAX_LOOKBACK_DAYS * 24);
    const safeHoursBetween = boundedInteger(hoursBetween, 2, 0, MAX_LOOKBACK_DAYS * 24);
    const windowValues = [uuid, mysqlIntegerParam(safeHours)];
    const readRows = async (limit: number) => (await (await getConn()).execute<any[]>(
        `SELECT ${nphColumns} ${nphWindow(liveOnly)}
        ORDER BY nethers.insertTime DESC, nethers.id DESC LIMIT ?;`,
        [...windowValues, mysqlIntegerParam(limit)]
    ))[0];
    let results = await readRows(SESSION_PAGE_ROWS);
    let windowRows = results.length;
    let session = walkNphSession(results, safeHoursBetween);
    if (results.length === SESSION_PAGE_ROWS) {
        if (session.stopped) {
            // Only whether the window exceeds MAX_SESSION_ROWS matters. The
            // live rows are a subset of all the player's nether rows, which
            // the nethers index counts without the join; the join is needed
            // only when that count is itself over the limit.
            windowRows = await countWindowRows(nphCountWindow(false), windowValues, MAX_SESSION_ROWS + 1);
            if (liveOnly && windowRows > MAX_SESSION_ROWS) {
                windowRows = await countWindowRows(nphCountWindow(true), windowValues, MAX_SESSION_ROWS + 1);
            }
        } else {
            results = await readRows(MAX_SESSION_ROWS + 1);
            windowRows = results.length;
            session = walkNphSession(results.slice(0, MAX_SESSION_ROWS), safeHoursBetween);
        }
    }

    if (results.length === 0) {
        return {
            rtanph: 0,
            rnph: 0,
            lnph: 0,
            count: 0,
            avg: 0,
            playtime: 0,
            walltime: 0,
            resets: 0,
            totalResets: 0,
            seedsPlayed: 0,
            rpe: 0,
            truncated: false
        };
    }

    const truncated = windowRows > MAX_SESSION_ROWS;
    const {wallTime, playTime, firstTime, lastTime, nethers, resets, enters, times} = session;
    let avg = calculateAvg(times)

    let elapsedRta = Date.now() - (lastTime * 1000)
    if(nethers > 1){
        elapsedRta = (firstTime - lastTime) * 1000
    }

    return {
        rtanph: roundNumber(nethers / (elapsedRta / 1000 / 60 / 60)),
        rnph: roundNumber(nethers / (((wallTime + playTime) / 1000) / 60 / 60)),
        lnph: roundNumber(nethers / (playTime / 1000 / 60 / 60)),
        count: nethers,
        avg: avg,
        playtime: playTime,
        walltime: wallTime,
        resets: resets,
        totalResets: results[0].totalResets,
        seedsPlayed: roundNumber((enters / resets) * 100),
        rpe: roundNumber(resets / nethers),
        truncated
    };
}

export const submitStats = async (
    uuid: string,
    runId: number,
    wallTime: number,
    playTime: number,
    seedsPlayed: number,
    resets: number,
    totalResets: number,
    netherTime: number
) => {
    let result: mysql.ResultSetHeader;
    try {
        [result] = await (await getConn()).execute(
            `INSERT INTO nethers
                (uuid, runId, wallTime, playTime, enters, isAccurate, resets, totalResets, netherTime, sceneChanges)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE NOT EXISTS (SELECT 1 FROM nethers WHERE runId=? LIMIT 1);`,
            [uuid, runId, wallTime, playTime, seedsPlayed, true, resets, totalResets, netherTime, 0, runId]
        ) as [mysql.ResultSetHeader, mysql.FieldPacket[]];
    } catch (error: any) {
        // Once uq_nethers_run_id is deployed, concurrent identical submissions
        // race safely: the loser is an idempotent no-op rather than a 500.
        if (error?.code === "ER_DUP_ENTRY") return false;
        throw error;
    }
    const inserted = result.affectedRows === 1;
    if (!inserted) return false;

    try {
        const subscribers = await redis.publish(
            process.env.WS_REDIS_CHANNEL || "pacestats:run-updates",
            JSON.stringify({uuid})
        );
        if (subscribers === 0 && Date.now() - (runtime.__paceStatsLastPublishWarningAt ?? 0) >= 30_000) {
            console.warn("Run refresh was published with no WebSocket Redis subscribers")
            runtime.__paceStatsLastPublishWarningAt = Date.now();
        }
    } catch (error) {
        // The stats write is authoritative; a notification failure should not reject it.
        console.error("Unable to publish run refresh:", error);
    }
    return true;
}

export const getAllPlayerRunsByHours = async (
    uuid: string,
    hours: number,
    limit: number = 10_000,
    liveOnly: boolean = false
) => {
    const safeHours = boundedInteger(hours, 24, 1, MAX_LOOKBACK_DAYS * 24);
    // Callers that return aggregates may request one sentinel row so they can
    // disclose truncation instead of presenting a capped result as complete.
    const safeLimit = boundedInteger(limit, MAX_SESSION_ROWS, 1, MAX_SESSION_ROWS + 1);
    const liveClause = liveOnly ? "AND twitch IS NOT NULL" : "";
    const [rows] = await (await getConn()).execute(
        `SELECT id, nether, bastion, fortress, first_portal, stronghold, end, finish,
            lootBastion, obtainObsidian, obtainCryingObsidian, obtainRod,
            UNIX_TIMESTAMP(insertTime) AS time, UNIX_TIMESTAMP(lastUpdated) AS updatedTime,
            UNIX_TIMESTAMP(realUpdated) AS realUpdated
         FROM pace
         WHERE uuid=? AND insertTime >= NOW() - INTERVAL ? HOUR ${liveClause}
         ORDER BY insertTime DESC, id DESC
         LIMIT ?;`,
        [uuid, mysqlIntegerParam(safeHours), mysqlIntegerParam(safeLimit)]
    );
    return rows;
}

export const getUUIDByAccessKey = async (accessKey: string) => {
    try {
        const url = new URL(process.env.GETUSER_ENDPOINT as string);
        url.searchParams.set("accessCode", accessKey);
        const res = await fetch(url, {
            cache: "no-store",
            signal: AbortSignal.timeout(3_000),
        });
        const data = await res.json();
        if (res.status !== 200) {
            return null;
        }
        return data.uuid;
    } catch {
        // Fetch errors can embed request URLs. Never risk logging the access
        // code that was placed in the upstream query string.
        console.error("Access-key verification request failed")
        return null;
    }
}

export const getRunId = async (uuid: string, worldId: string) => {
    const [results, fields] = await (await getConn()).execute<any>(
        `SELECT id FROM pace WHERE uuid=? AND worldId=? LIMIT 1;`,
        [uuid, worldId]
    );
    if(results.length === 0) {
        return null;
    }

    return results[0].id;
}

const sessionStatsCategories = [
    "nether",
    "bastion",
    "fortress",
    "first_structure",
    "second_structure",
    "first_portal",
    "stronghold",
    "end",
    "finish"
]

/** Collects session split times newest first until a long gap or the window edge. */
const walkSessionStats = (boundedRuns: any[], safeHours: number, safeHoursBetween: number) => {
    let lastTime = 0
    let stopped = false

    const splits = new Map<string, number[]>()
    for (const category of sessionStatsCategories) {
        splits.set(category, [])
    }

    for(let run of boundedRuns){
        let diff = lastTime - run.time
        if(lastTime > 0 && diff > 60 * 60 * safeHoursBetween){
            stopped = true
            break
        }
        if(Date.now() / 1000 - run.time > 60 * 60 * safeHours){
            stopped = true
            break
        }
        const bastion = run["bastion"]
        const fortress = run["fortress"]
        const firstStructure = getFirstStructure(bastion, fortress)
        const secondStructure = getSecondStructure(bastion, fortress)
        const rod = run["obtainRod"] || null

        if(firstStructure != null){
            if(firstStructure === fortress && rod !== null && rod < fortress){
                splits.get("first_structure")?.push(rod)
            } else {
                splits.get("first_structure")?.push(firstStructure)
            }
        }
        if(secondStructure != null){
            const id = run["id"]
            if(id >= 187307){ // when context logging was added, march 29th 2024
                const rod = run["obtainRod"]
                if(!(secondStructure === bastion && (rod === null || rod > secondStructure)) && !(secondStructure === fortress && (fortress - bastion < 50000))){
                    if(secondStructure === fortress && rod !== null && rod < fortress){
                        splits.get("second_structure")?.push(rod)
                    } else {
                        splits.get("second_structure")?.push(secondStructure)
                    }
                }
            } else {
                splits.get("second_structure")?.push(secondStructure)
            }
        }

        for (const category of sessionStatsCategories) {
            if(category === "first_structure" || category === "second_structure"){
                continue
            }
            if(run[category] != null){
                splits.get(category)?.push(run[category])
            }
        }
        lastTime = run.time
    }
    return {splits, stopped}
}

export const getSessionStats = async (uuid: string, hours: number, hoursBetween: number) => {
    const safeHours = boundedInteger(hours, 24, 1, MAX_LOOKBACK_DAYS * 24);
    const safeHoursBetween = boundedInteger(hoursBetween, 6, 0, MAX_LOOKBACK_DAYS * 24);
    // Most sessions end inside the newest page; read the whole window only
    // when the walk runs off the end of a full page.
    let runs = await getCached(
        getAllPlayerRunsByHours,
        "getAllPlayerRunsByHours",
        uuid,
        safeHours,
        SESSION_PAGE_ROWS,
        false
    )
    let windowRows = runs.length
    let walk = walkSessionStats(runs, safeHours, safeHoursBetween)
    if (runs.length === SESSION_PAGE_ROWS) {
        if (walk.stopped) {
            windowRows = await countWindowRows(
                "FROM pace WHERE uuid=? AND insertTime >= NOW() - INTERVAL ? HOUR",
                [uuid, mysqlIntegerParam(safeHours)],
                MAX_SESSION_ROWS + 1
            )
        } else {
            runs = await getCached(
                getAllPlayerRunsByHours,
                "getAllPlayerRunsByHours",
                uuid,
                safeHours,
                MAX_SESSION_ROWS + 1,
                false
            )
            windowRows = runs.length
            walk = walkSessionStats(runs.slice(0, MAX_SESSION_ROWS), safeHours, safeHoursBetween)
        }
    }

    const truncated = windowRows > MAX_SESSION_ROWS;
    const categories = sessionStatsCategories
    const splits = walk.splits

    let response: { [category: string] : {count: number, avg: string} | boolean } = {}

    if(runs.length === 0){
        for (const category of categories) {
            response[category] = {count: 0, avg: "0:00"}
        }
        response.truncated = false
        return response
    }

    for (const category of categories) {
        const data = splits.get(category) as number[]
        const count = data.length
        if(count === 0){
            response[category] = {count: 0, avg: "0:00"}
        } else {
            response[category] = {count: count, avg: formatTime(calculateAvg(data))}
        }
    }
    response.truncated = truncated
    return response
}

export const getAllPBs = async () => {
    // Keep the loose grouped scan compact. Candidate IDs are supplied by the
    // InnoDB PK suffix of (uuid, finish), then timestamps are fetched in
    // primary-key batches instead of performing a dependent lookup per player.
    const usersPromise = getCached(getAllUsers, "getAllUsers");
    const [candidateRows] = await (await getConn()).execute<any[]>(
        `SELECT p.id, p.uuid, p.finish
         FROM pace p
         INNER JOIN (
             SELECT uuid, MIN(finish) AS finish
             FROM pace
             WHERE finish IS NOT NULL
             GROUP BY uuid
         ) best ON best.uuid=p.uuid AND best.finish=p.finish
         ORDER BY p.uuid ASC, p.id ASC;`,
    );
    const winners = new Map<string, any>();
    for (const candidate of candidateRows) {
        if (!winners.has(candidate.uuid)) winners.set(candidate.uuid, candidate);
    }
    const results = [...winners.values()];
    const timestampById = new Map<number, number>();
    for (let offset = 0; offset < results.length; offset += 500) {
        const ids = results.slice(offset, offset + 500).map((result) => result.id);
        const placeholders = ids.map(() => "?").join(",");
        const [timestampRows] = await (await getConn()).execute<any[]>(
            `SELECT id, UNIX_TIMESTAMP(insertTime) AS timestamp
             FROM pace WHERE id IN (${placeholders});`,
            ids,
        );
        for (const row of timestampRows) timestampById.set(Number(row.id), Number(row.timestamp));
    }
    const users = await usersPromise;
    const usersByUuid = new Map((users as any[]).map((user: any) => [user.id, user.nick]));
    for (let result of results) {
        result.timestamp = timestampById.get(Number(result.id)) ?? null;
        delete result.id;
        const nick = usersByUuid.get(result.uuid);
        if (nick) result.name = nick;
        result.pb = formatTime(result.finish)
    }
    results.sort((a, b) => a.finish - b.finish)
    return results;
}

export const getPBs = async (nicks: string[], uuids: string[]) => {
    const all = await getCached(getAllPBs, "getAllPBs")
    if(nicks.length > 0){
        return all.filter((x: any) => nicks.includes(x.name))
    }
    if(uuids.length > 0){
        return all.filter((x: any) => uuids.includes(x.uuid))
    }
    return all;
}

export interface CursorPage<T = any> {
    rows: T[];
    nextCursor: number | null;
    hasMore: boolean;
    loadedCount: number;
}

export type PlayerRunFilter = {
    column: "date" | "nether" | "bastion" | "fortress" | "first_structure" |
        "second_structure" | "first_portal" | "stronghold" | "end" | "finish";
    operatorValue: "before" | "after" | "during" | "lessThan" | "greaterThan" |
        "isNotEmpty" | "isEmpty";
    value?: number;
    endValue?: number;
};

export type PlayerRunSort = {
    column: PlayerRunFilter["column"];
    direction: "asc" | "desc";
};

export interface OffsetPage<T = any> {
    rows: T[];
    rowCount: number;
}

const playerRunFilterValue = (run: any, column: PlayerRunFilter["column"]): number | null => {
    if (column === "date") {
        if (run.lastUpdated == null) return null;
        if (typeof run.lastUpdated === "number") return run.lastUpdated;
        const timestamp = new Date(run.lastUpdated).getTime();
        return Number.isFinite(timestamp) ? timestamp : null;
    }
    const value = run[column];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const matchesPlayerRunFilter = (run: any, filter: PlayerRunFilter): boolean => {
    const value = playerRunFilterValue(run, filter.column);
    if (filter.operatorValue === "isNotEmpty") return value !== null;
    if (filter.operatorValue === "isEmpty") return value === null;
    if (value === null || filter.value === undefined) return false;
    if (filter.operatorValue === "during") {
        return filter.endValue !== undefined && value >= filter.value && value < filter.endValue;
    }
    if (filter.operatorValue === "lessThan") return value < filter.value;
    if (filter.operatorValue === "greaterThan") return value > filter.value;
    if (filter.operatorValue === "before") return value <= filter.value;
    return value >= filter.value;
};

export const getPlayerRunsOffsetPage = async (
    uuid: string,
    page: number = 0,
    pageSize: number = 25,
    filters: PlayerRunFilter[] = [],
    sort: PlayerRunSort = {column: "date", direction: "desc"}
): Promise<OffsetPage> => {
    const bans = await getCached(getBans, "getBans");
    if (bans.includes(uuid)) return {rows: [], rowCount: 0};

    const safePage = boundedInteger(page, 0, 0, 1_000_000);
    const safePageSize = boundedInteger(pageSize, 25, 1, 100);
    const history = await getCached(
        fetchAllPlayerRunsFromRedis,
        "fetchAllPlayerRunsFromRedis",
        uuid,
    ) as any[];
    const matchingRows = filters.length === 0
        ? [...history]
        : history.filter((run) => filters.every((filter) => matchesPlayerRunFilter(run, filter)));
    matchingRows.sort((left, right) => {
        const leftValue = playerRunFilterValue(left, sort.column);
        const rightValue = playerRunFilterValue(right, sort.column);

        // Keep missing splits at the bottom in either direction, matching the
        // useful behavior of the old data grid.
        if (leftValue === null && rightValue !== null) return 1;
        if (leftValue !== null && rightValue === null) return -1;
        if (leftValue !== null && rightValue !== null && leftValue !== rightValue) {
            return sort.direction === "asc" ? leftValue - rightValue : rightValue - leftValue;
        }

        // A stable, deterministic tie-breaker prevents rows from moving
        // between pages when several runs have the same split.
        return Number(right.id) - Number(left.id);
    });
    const offset = safePage * safePageSize;

    return {
        rows: matchingRows.slice(offset, offset + safePageSize),
        rowCount: matchingRows.length,
    };
};

export const getPlayerRunsPage = async (
    uuid: string,
    beforeId: number | null = null,
    limit: number = 25
): Promise<CursorPage> => {
    const bans = await getCached(getBans, "getBans");
    if (bans.includes(uuid)) return {rows: [], nextCursor: null, hasMore: false, loadedCount: 0};

    const safeLimit = boundedInteger(limit, 25, 1, 100);
    const safeBeforeId = beforeId === null ? null : boundedInteger(beforeId, 0, 1, Number.MAX_SAFE_INTEGER);
    const cursorClause = safeBeforeId === null ? "" : "AND id < ?";
    const parameters = safeBeforeId === null ? [uuid] : [uuid, safeBeforeId];
    const [result] = await (await getConn()).execute<any[]>(
        `SELECT id, nether, bastion, fortress,
            CASE
                WHEN bastion IS NULL AND fortress IS NULL THEN NULL
                WHEN bastion IS NULL THEN fortress
                WHEN fortress IS NULL THEN bastion
                WHEN bastion <= fortress THEN bastion
                ELSE fortress
            END AS first_structure,
            CASE
                WHEN bastion IS NULL OR fortress IS NULL THEN NULL
                WHEN bastion <= fortress THEN fortress
                ELSE bastion
            END AS second_structure,
            first_portal, stronghold, end, finish,
            UNIX_TIMESTAMP(lastUpdated) * 1000 AS lastUpdated,
            vodId, twitch
         FROM pace
         WHERE uuid=? ${cursorClause}
         ORDER BY id DESC
         LIMIT ?;`,
        [...parameters, mysqlIntegerParam(safeLimit + 1)]
    );

    const hasMore = result.length > safeLimit;
    const rows = hasMore ? result.slice(0, safeLimit) : result;
    return {
        rows,
        nextCursor: hasMore && rows.length > 0 ? Number(rows[rows.length - 1].id) : null,
        hasMore,
        loadedCount: rows.length,
    };
};

export const getAAPlayerRunsPage = async (
    uuid: string,
    beforeId: number | null = null,
    limit: number = 25
): Promise<CursorPage> => {
    const safeLimit = boundedInteger(limit, 25, 1, 100);
    const safeBeforeId = beforeId === null ? null : boundedInteger(beforeId, 0, 1, Number.MAX_SAFE_INTEGER);
    const cursorClause = safeBeforeId === null ? "" : "AND id < ?";
    const parameters = safeBeforeId === null ? [uuid] : [uuid, safeBeforeId];
    const [result] = await (await getConn()).execute<any[]>(
        `SELECT id, nether, bastion, fortress, stronghold, end, elytra, credits, finish,
            UNIX_TIMESTAMP(lastUpdated) * 1000 AS lastUpdated,
            NULL AS vodId, twitch
         FROM aa
         WHERE uuid=? ${cursorClause}
         ORDER BY id DESC
         LIMIT ?;`,
        [...parameters, mysqlIntegerParam(safeLimit + 1)]
    );

    const hasMore = result.length > safeLimit;
    const rows = hasMore ? result.slice(0, safeLimit) : result;
    return {
        rows,
        nextCursor: hasMore && rows.length > 0 ? Number(rows[rows.length - 1].id) : null,
        hasMore,
        loadedCount: rows.length,
    };
};

export interface PlayerSearchResult {
    id: string;
    name: string;
    displayName: string | null;
    color: string | null;
    bgColor: string | null;
}

type SearchableUser = {user: any; name: string; normalizedName: string; aliases: string[]};

// getCached hands out the same users array until its entry expires, so the
// lower-cased names are computed once per array instead of on every search.
const searchIndexes = new WeakMap<object, SearchableUser[]>();

const searchIndexFor = (users: any[]): SearchableUser[] => {
    let index = searchIndexes.get(users);
    if (!index) {
        index = users.map((user) => {
            const name = String(user.nick || "");
            return {
                user,
                name,
                normalizedName: name.toLocaleLowerCase(),
                aliases: Array.isArray(user.twitches)
                    ? user.twitches.map((alias: unknown) => String(alias).toLocaleLowerCase())
                    : [],
            };
        });
        searchIndexes.set(users, index);
    }
    return index;
};

export const searchPlayers = async (query: string, limit: number = 8): Promise<PlayerSearchResult[]> => {
    const normalizedQuery = query.trim().toLocaleLowerCase().slice(0, 64);
    if (normalizedQuery.length < 2) return [];
    const safeLimit = boundedInteger(limit, 8, 1, 20);
    const users = await getCached(getAllUsers, "getAllUsers");
    const matches = searchIndexFor(users as any[])
        .map(({user, name, normalizedName, aliases}) => {
            let score = Number.POSITIVE_INFINITY;
            if (normalizedName === normalizedQuery) score = 0;
            else if (normalizedName.startsWith(normalizedQuery)) score = 1;
            else if (aliases.some((alias: string) => alias === normalizedQuery)) score = 2;
            else if (aliases.some((alias: string) => alias.startsWith(normalizedQuery))) score = 3;
            else if (normalizedName.includes(normalizedQuery)) score = 4;
            else if (aliases.some((alias: string) => alias.includes(normalizedQuery))) score = 5;
            return {user, name, score};
        })
        .filter(({score}) => Number.isFinite(score))
        .sort((left, right) => left.score - right.score || left.name.localeCompare(right.name))
        .slice(0, safeLimit);

    let userInfoByUuid = new Map<string, any>();
    if (matches.some(({user}) => !Object.prototype.hasOwnProperty.call(user, "displayName"))) {
        const userInfo = await getCached(getAllUserInfo, "getAllUserInfo");
        userInfoByUuid = new Map((userInfo as any[]).map((info) => [info.uuid, info]));
    }

    return matches
        .map(({user, name}) => {
            const info = Object.prototype.hasOwnProperty.call(user, "displayName")
                ? user
                : userInfoByUuid.get(user.id);
            return {
                id: user.id,
                name,
                displayName: info?.displayName ?? null,
                color: info?.color ?? null,
                bgColor: info?.bgColor ?? null,
            };
        });
};

export const getLowestId = async () => {
    const [results, _] = await (await getConn()).execute<any[]>(
        `SELECT id FROM pace ORDER BY id ASC LIMIT 1;`
    );
    return results.length > 0 ? results[0].id : null;
}

export const getHighestId = async () => {
    const [results, _] = await (await getConn()).execute<any[]>(
        `SELECT id FROM pace ORDER BY id DESC LIMIT 1;`
    );
    return results.length > 0 ? results[0].id : null;
}

function filterNullValues(obj: any) {
    return Object.entries(obj).reduce((acc, [key, value]) => {
        if (value !== null) {
            // @ts-ignore
            acc[key] = value;
        }
        return acc;
    }, {});
}

function filterNullValuesInArray(arrayOfObjects: any) {
    return arrayOfObjects.map(filterNullValues);
}

export const getRunsPaginated = async (page: number, pageSize: number = 10_000) => {
    const safePage = boundedInteger(page, 1, 1, 1_000_000);
    const safePageSize = boundedInteger(pageSize, 10_000, 1, 10_000);
    const [minId, maxId] = await Promise.all([
        getCached(getLowestId, "getLowestId"),
        getCached(getHighestId, "getHighestId"),
    ]);
    if (minId === null || maxId === null) {
        return {pageCount: 0, runs: []};
    }
    const pageCount = Math.floor((maxId - minId) / safePageSize) + 1;
    if(safePage > pageCount){
        return {
            error: "Invalid page number",
            pageCount: pageCount,
            runs: []
        }
    }
    const minForPage = minId + (safePage - 1) * safePageSize;
    const maxForPage = minForPage + safePageSize;
    const [results, _] = await (await getConn()).execute<any[]>(
      `SELECT id, nickname, uuid, twitch, nether, bastion, fortress, first_portal, second_portal,
        stronghold, end, finish, insertTime as time, worldId, vodId, vodOffset, obtainObsidian, obtainCryingObsidian, obtainRod
        FROM pace WHERE id >= ? AND id < ? ORDER BY id DESC;`,
      [minForPage, maxForPage]
    );
    return {
      pageCount,
        runs: filterNullValuesInArray(results)
    };
}
