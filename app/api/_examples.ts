type JsonValue = null | boolean | number | string | JsonValue[] | {[key: string]: JsonValue};
type ApiExample = {
    query?: Record<string, string>;
    response: JsonValue;
};

// Documentation fixtures, not fetched player data. Keep them independent of
// the database and API so rendering or expanding the docs never makes requests.
const uuid = "00000000-0000-4000-8000-000000000001";
const name = "jojoe77777";
const worldId = "0123456789abcdef0123456789abcdef";
const sessionQuery = {name, hours: "24", hoursBetween: "6"};
const splitStats = {
    nether: {count: 24, avg: "3:00"},
    bastion: {count: 12, avg: "4:00"},
    fortress: {count: 8, avg: "5:30"},
    first_structure: {count: 16, avg: "4:10"},
    second_structure: {count: 6, avg: "5:40"},
    first_portal: {count: 4, avg: "7:00"},
    stronghold: {count: 3, avg: "9:00"},
    end: {count: 2, avg: "10:00"},
    finish: {count: 1, avg: "13:00"},
};
const run = {
    id: 42, time: 1704067200, updatedTime: 1704067800, realUpdated: 1704067800,
    nether: 180000, bastion: 240000, fortress: 330000, first_portal: 420000,
    stronghold: 540000, end: 600000, finish: 780000,
    lootBastion: 270000, obtainObsidian: 300000, obtainCryingObsidian: null, obtainRod: 360000,
};
const recentRuns = [run, {...run, id: 41, time: 1704063600}, {...run, id: 40, time: 1704060000}];
const playerRun = {
    id: 42, nether: 180000, bastion: 240000, fortress: 330000,
    first_structure: 240000, second_structure: 330000, first_portal: 420000,
    stronghold: 540000, end: 600000, finish: 780000,
    lastUpdated: 1704067800000, vodId: null, twitch: "jojoe77777",
};
const aaRun = {
    id: 42, nether: 180000, bastion: 240000, fortress: 330000, stronghold: 540000,
    end: 600000, elytra: 900000, credits: 1200000, finish: 10800000,
    lastUpdated: 1704078000000, vodId: null, twitch: "jojoe77777",
};
const statsTotals = {
    runs: 24, netherEnters: 24, bastionEnters: 12, fortressEnters: 8,
    firstPortalEnters: 4, secondPortalEnters: 4, strongholdEnters: 3,
    endEnters: 2, completions: 1, fastestNetherMs: 150000, fastestFinishMs: 780000,
};
const resetTotals = {
    netherEnters: 12, previewsPlayed: 120, resets: 96, resetRecords: 12, accurateRecords: 12,
    wallTimeMs: 1800000, playTimeMs: 3600000, rnph: 8, lnph: 12, resetsPerEnter: 8,
};
const exportQuery = {name, from: "2024-01-01", to: "2024-01-02", format: "json"};
const exportRange = {from: "2024-01-01", to: "2024-01-02", timezone: "UTC", toExclusive: true};
const exportNotes = [
    "Dates use UTC. The from date is inclusive and the to date is exclusive.",
    "Daily rows include only dates with stored records. Historical exports are not restricted to a 90-day window.",
    "Records are paginated from oldest to newest by timestamp and ID. Durations and splits are in milliseconds; timestamps use ISO 8601 UTC.",
];

export const apiExamples = {
    getLeaderboard: {
        query: {days: "30", category: "nether", type: "qty", limit: "10"},
        response: [
            {uuid, name, value: 240, qty: 240, avg: 180000},
            {uuid: "00000000-0000-4000-8000-000000000002", name: "AnotherPlayer", value: 180, qty: 180, avg: 190000},
            {uuid: "00000000-0000-4000-8000-000000000003", name: "ThirdPlayer", value: 120, qty: 120, avg: 200000},
        ],
    },
    getFastest: {
        query: {days: "30", category: "nether", limit: "10"},
        response: [
            {uuid, name, value: 150000, runId: 42},
            {uuid: "00000000-0000-4000-8000-000000000002", name: "AnotherPlayer", value: 155000, runId: 41},
            {uuid: "00000000-0000-4000-8000-000000000003", name: "ThirdPlayer", value: 160000, runId: 40},
        ],
    },
    getWorld: {
        query: {worldId: "42"},
        response: {
            data: {
                id: 42, worldId, nickname: name, uuid, twitch: "jojoe77777",
                nether: 180000, bastion: 240000, fortress: 330000, first_portal: 420000,
                stronghold: 540000, end: 600000, finish: 780000, netherRta: 185000,
                bastionRta: 245000, fortressRta: 335000, first_portalRta: 425000,
                strongholdRta: 545000, endRta: 605000, finishRta: 785000,
                insertTime: 1704067200, updateTime: 1704067800, realUpdate: 1704067800,
                vodId: null, vodOffset: null,
            },
            time: 1704068000000, isLive: false, liveStatusUnknown: false,
        },
    },
    getRecentRuns: {query: {...sessionQuery, limit: "10"}, response: recentRuns},
    getRecentTimestamps: {
        query: {name, limit: "10", onlyFort: "false"},
        response: [{
            id: 42, start: 1704067015, runName: "13:00 Finish",
            nether: 1704067200, bastion: 1704067260, fortress: 1704067350,
            first_portal: 1704067440, stronghold: 1704067560, end: 1704067620,
            finish: 1704067800, realUpdate: 1704067800, lastUpdated: 1704067800,
        }],
    },
    getLatestRun: {query: {name}, response: {id: 42, netherRta: 185000, time: 1704067200}},
    getLatestCompletion: {query: {name}, response: [run]},
    getPBs: {
        query: {names: name},
        response: [{uuid, finish: 780000, timestamp: 1704067200, pb: "13:00", name}],
    },
    getNickAlways: {query: {uuid}, response: {name}},
    getAllUsers: {
        response: [
            {id: uuid, nick: name, twitches: ["jojoe77777"]},
            {id: "00000000-0000-4000-8000-000000000002", nick: "AnotherPlayer", twitches: []},
            {id: "00000000-0000-4000-8000-000000000003", nick: "ThirdPlayer", twitches: ["thirdplayer"]},
        ],
    },
    getRunsPaginated: {
        query: {page: "1", pageSize: "100"},
        response: {pageCount: 1200, runs: [{
            id: 42, nickname: name, uuid, twitch: "jojoe77777", worldId,
            nether: 180000, bastion: 240000, fortress: 330000, first_portal: 420000,
            second_portal: 450000, stronghold: 540000, end: 600000, finish: 780000,
            time: "2024-01-01T00:00:00.000Z", obtainObsidian: 300000, obtainRod: 360000,
        }]},
    },
    getSessionStats: {query: sessionQuery, response: {...splitStats, truncated: false}},
    getSessionNethers: {query: {...sessionQuery, dp: "0"}, response: {count: 24, avg: "3:00", rnph: 8, uuid}},
    getSplitStats: {query: {...sessionQuery, split: "nether"}, response: {count: 24, avg: "3:00", ms: 180000}},
    getCombinedStats: {query: {names: `${name},AnotherPlayer`, hours: "24", hoursBetween: "6"}, response: splitStats},
    getCombinedNethers: {query: {names: `${name},AnotherPlayer`, hours: "24", hoursBetween: "6"}, response: {count: 48, avg: "3:10"}},
    getNPH: {
        query: {name, hours: "24", hoursBetween: "2", liveOnly: "false"},
        response: {rtanph: 7.2, rnph: 8, lnph: 12, count: 12, avg: 180000, playtime: 3600000,
            walltime: 1800000, resets: 96, totalResets: 10000, seedsPlayed: 125, rpe: 8, truncated: false},
    },
    exportStats: {
        query: exportQuery,
        response: {dataset: "stats", player: {name, uuid}, range: exportRange, mode: "daily",
            rows: [{date: "2024-01-01", ...statsTotals}], summary: statsTotals},
    },
    exportResetStats: {
        query: exportQuery,
        response: {dataset: "resetStats", player: {name, uuid}, range: exportRange, mode: "daily",
            rows: [{date: "2024-01-01", ...resetTotals}], summary: resetTotals, notes: exportNotes},
    },
    searchPlayers: {
        query: {q: name, limit: "8"},
        response: [{id: uuid, name, displayName: null, color: null, bgColor: null}],
    },
    getPlayerRuns: {
        query: {uuid, limit: "2"},
        response: {rows: [playerRun, {...playerRun, id: 41}], nextCursor: 41, hasMore: true, loadedCount: 2},
    },
    getAAPlayerRuns: {
        query: {uuid, limit: "2"},
        response: {rows: [aaRun, {...aaRun, id: 41}], nextCursor: 41, hasMore: true, loadedCount: 2},
    },
    "../aa/api/getAllData": {
        query: {days: "30"},
        response: {data: [{
            id: 42, nickname: name, uuid, twitch: "jojoe77777", worldId,
            nether: 180000, bastion: 240000, fortress: 330000, stronghold: 540000,
            end: 600000, elytra: 900000, credits: 1200000, finish: 10800000,
            insertTime: "2024-01-01T00:00:00.000Z", lastUpdated: "2024-01-01T03:00:00.000Z",
        }]},
    },
} satisfies Record<string, ApiExample>;

export type ApiEndpointPath = keyof typeof apiExamples;

export function exampleRequestUrl(endpoint: ApiEndpointPath): string {
    const url = new URL(`${endpoint}/`, "https://paceman.gg/stats/api/");
    const example: ApiExample = apiExamples[endpoint];
    for (const [key, value] of Object.entries(example.query ?? {})) url.searchParams.set(key, value);
    return url.toString();
}

/** Keep valid JSON, while bounding collections, wide rows, strings and nesting. */
export function exampleResponsePreview(response: JsonValue): {json: string; truncated: boolean} {
    let truncated = false;
    const shorten = (value: JsonValue, depth: number): JsonValue => {
        if (typeof value === "string" && value.length > 160) {
            truncated = true;
            return `${value.slice(0, 160)}…`;
        }
        if (value === null || typeof value !== "object") return value;
        if (depth >= 5) {
            truncated = true;
            return Array.isArray(value) ? [] : {};
        }
        if (Array.isArray(value)) {
            if (value.length > 2) truncated = true;
            return value.slice(0, 2).map(item => shorten(item, depth + 1));
        }
        const entries = Object.entries(value);
        if (entries.length > 12) truncated = true;
        return Object.fromEntries(entries.slice(0, 12).map(([key, item]) => [key, shorten(item, depth + 1)]));
    };
    const json = JSON.stringify(shorten(response, 0), null, 2);
    return {json, truncated};
}
