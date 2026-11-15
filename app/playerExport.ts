import {ApiInputError, integerParam, stringParam} from "./api/_utils";

export type ExportCursor = {time: number; id: number};

/** A name retains the same nickname/Twitch lookup path as other player APIs.
 * Normalize UUID spelling before caching so all accepted forms share a lookup. */
export function parseExportPlayer(params: URLSearchParams): {name: string | null; uuid: string | null} {
    if (params.has("name") === params.has("uuid")) throw new ApiInputError("Provide exactly one of name or uuid");
    if (params.has("name")) return {name: stringParam(params, "name", {required: true, maxLength: 64}), uuid: null};
    const raw = stringParam(params, "uuid", {required: true, maxLength: 36});
    if (!/^(?:[\da-f]{32}|[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})$/i.test(raw)) {
        throw new ApiInputError("uuid must be a Minecraft UUID");
    }
    const compact = raw.replaceAll("-", "").toLowerCase();
    const uuid = `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
    return {name: null, uuid};
}

export type ExportTotals = {
    netherEnters: number;
    previewsPlayed: number;
    resets: number | null;
    resetRecords: number;
    accurateRecords: number;
    wallTimeMs: number;
    playTimeMs: number;
    rnph: number | null;
    lnph: number | null;
    resetsPerEnter: number | null;
};
export type DailyExportRow = ExportTotals & {date: string};
export type ExportRecord = {
    id: number;
    runId: number;
    worldId: string | null;
    timestamp: string;
    netherTimeMs: number | null;
    trackerNetherTimeMs: number | null;
    wallTimeMs: number;
    playTimeMs: number;
    previewsPlayed: number;
    resets: number | null;
    totalResets: number | null;
    isAccurate: boolean;
};

export type StatsExportTotals = {
    runs: number;
    netherEnters: number;
    bastionEnters: number;
    fortressEnters: number;
    firstPortalEnters: number;
    secondPortalEnters: number;
    strongholdEnters: number;
    endEnters: number;
    completions: number;
    fastestNetherMs: number | null;
    fastestFinishMs: number | null;
};
export type StatsDailyExportRow = StatsExportTotals & {date: string};
export type StatsDailyExportInput = {day: number | string} & {
    [Key in keyof StatsExportTotals]: number | string | null;
};

/** Stored split and milestone columns, with public names that carry their units.
 * These are raw times, including separate in-game and real-time splits. */
export const statsSplitColumns = {
    netherMs: "nether", bastionMs: "bastion", fortressMs: "fortress",
    firstPortalMs: "first_portal", secondPortalMs: "second_portal",
    strongholdMs: "stronghold", endMs: "end", finishMs: "finish",
    netherRtaMs: "netherRta", bastionRtaMs: "bastionRta", fortressRtaMs: "fortressRta",
    firstPortalRtaMs: "first_portalRta", secondPortalRtaMs: "second_portalRta",
    strongholdRtaMs: "strongholdRta", endRtaMs: "endRta", finishRtaMs: "finishRta",
    obtainIronMs: "obtainIron", obtainPickMs: "obtainPick", obtainLavaMs: "obtainLava",
    distractPiglinMs: "distractPiglin", lootBastionMs: "lootBastion",
    obtainObsidianMs: "obtainObsidian", obtainCryingObsidianMs: "obtainCryingObsidian", obtainRodMs: "obtainRod",
} as const;
export type StatsExportRecord = {
    id: number;
    worldId: string | null;
    nickname: string | null;
    timestamp: string;
    lastUpdated: string | null;
    realUpdated: string | null;
} & Record<keyof typeof statsSplitColumns, number | null>;

const dayMs = 86_400_000;
const parseDate = (raw: string, name: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new ApiInputError(`${name} must be a UTC date (YYYY-MM-DD)`);
    const instant = Date.parse(`${raw}T00:00:00.000Z`);
    if (!Number.isFinite(instant) || instant < 0 || new Date(instant).toISOString().slice(0, 10) !== raw) {
        throw new ApiInputError(`${name} must be a valid UTC date on or after 1970-01-01`);
    }
    return instant / 1_000;
};

export const encodeExportCursor = (cursor: ExportCursor) =>
    Buffer.from(JSON.stringify([cursor.time, cursor.id])).toString("base64url");

function decodeExportCursor(raw: string): ExportCursor {
    try {
        if (raw.length > 128 || !/^[\w-]+$/.test(raw)) throw new Error();
        const decoded: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
        if (!Array.isArray(decoded) || decoded.length !== 2 ||
            !Number.isSafeInteger(decoded[0]) || decoded[0] < 0 ||
            !Number.isSafeInteger(decoded[1]) || decoded[1] < 1) throw new Error();
        return {time: decoded[0], id: decoded[1]};
    } catch {
        throw new ApiInputError("Invalid cursor; use nextCursor from the previous export page");
    }
}

export function parsePlayerExportParams(params: URLSearchParams, now = Date.now()) {
    const tomorrow = (Math.floor(now / dayMs) + 1) * dayMs;
    const fromDate = stringParam(params, "from", {defaultValue: "1970-01-01"});
    const toDate = stringParam(params, "to", {defaultValue: new Date(tomorrow).toISOString().slice(0, 10)});
    const from = parseDate(fromDate, "from"), to = parseDate(toDate, "to");
    if (from >= to) throw new ApiInputError("from must be before to (to is exclusive)");
    if (to * 1_000 > tomorrow) throw new ApiInputError("to cannot be later than tomorrow's UTC date");
    const mode = stringParam(params, "mode", {defaultValue: "daily", allowed: ["daily", "records"]}) as "daily" | "records";
    const format = stringParam(params, "format", {defaultValue: "json", allowed: ["json", "csv"]}) as "json" | "csv";
    const limit = integerParam(params, "limit", {defaultValue: 1_000, min: 1, max: 5_000});
    const rawCursor = params.get("cursor");
    if (mode === "daily" && (params.has("cursor") || params.has("limit"))) {
        throw new ApiInputError("cursor and limit are only supported with mode=records");
    }
    const cursor = rawCursor === null ? null : decodeExportCursor(rawCursor);
    if (cursor && (cursor.time < from || cursor.time >= to)) throw new ApiInputError("cursor is outside the requested date range");
    return {from, to, fromDate, toDate, mode, format, limit, cursor};
}

// MySQL SUM/DECIMAL values may be strings. Normalize only the explicitly
// selected numeric columns; no nicknames, credentials or unrelated rows export.
export type DailyExportInput = {
    day: number | string;
    netherEnters: number | string;
    previewsPlayed: number | string;
    resets: number | string | null;
    resetRecords: number | string;
    accurateRecords: number | string;
    wallTimeMs: number | string;
    playTimeMs: number | string;
};

const rate = (numerator: number, denominator: number) => denominator > 0
    ? Math.round(numerator / denominator * 100) / 100 : null;

function withRates(totals: Omit<ExportTotals, "rnph" | "lnph" | "resetsPerEnter">): ExportTotals {
    return {...totals,
        rnph: rate(totals.netherEnters * 3_600_000, totals.wallTimeMs + totals.playTimeMs),
        lnph: rate(totals.netherEnters * 3_600_000, totals.playTimeMs),
        // Missing historical reset counts must not look like zero resets.
        resetsPerEnter: totals.resetRecords === totals.netherEnters && totals.resets !== null
            ? rate(totals.resets, totals.netherEnters) : null,
    };
}

export function buildDailyExport(input: DailyExportInput[]) {
    const rows: DailyExportRow[] = input.map(row => {
        const resetRecords = Number(row.resetRecords);
        return {date: new Date(Number(row.day) * dayMs).toISOString().slice(0, 10), ...withRates({
            netherEnters: Number(row.netherEnters), previewsPlayed: Number(row.previewsPlayed),
            resets: resetRecords > 0 ? Number(row.resets ?? 0) : null,
            resetRecords, accurateRecords: Number(row.accurateRecords),
            wallTimeMs: Number(row.wallTimeMs), playTimeMs: Number(row.playTimeMs),
        })};
    });
    const sums = {netherEnters: 0, previewsPlayed: 0, resets: 0, resetRecords: 0,
        accurateRecords: 0, wallTimeMs: 0, playTimeMs: 0};
    for (const row of rows) {
        sums.netherEnters += row.netherEnters;
        sums.previewsPlayed += row.previewsPlayed;
        sums.resets += row.resets ?? 0;
        sums.resetRecords += row.resetRecords;
        sums.accurateRecords += row.accurateRecords;
        sums.wallTimeMs += row.wallTimeMs;
        sums.playTimeMs += row.playTimeMs;
    }
    return {rows, summary: withRates({...sums, resets: sums.resetRecords > 0 ? sums.resets : null})};
}

const statsCountColumns = ["runs", "netherEnters", "bastionEnters", "fortressEnters", "firstPortalEnters",
    "secondPortalEnters", "strongholdEnters", "endEnters", "completions"] as const;
const statsFastestColumns = ["fastestNetherMs", "fastestFinishMs"] as const;

export function buildStatsDailyExport(input: StatsDailyExportInput[]) {
    const summary: StatsExportTotals = {runs: 0, netherEnters: 0, bastionEnters: 0, fortressEnters: 0,
        firstPortalEnters: 0, secondPortalEnters: 0, strongholdEnters: 0, endEnters: 0, completions: 0,
        fastestNetherMs: null, fastestFinishMs: null};
    const rows: StatsDailyExportRow[] = input.map(row => {
        const totals = {...summary};
        for (const column of statsCountColumns) totals[column] = Number(row[column]);
        for (const column of statsFastestColumns) totals[column] = row[column] === null ? null : Number(row[column]);
        return {date: new Date(Number(row.day) * dayMs).toISOString().slice(0, 10), ...totals};
    });
    for (const row of rows) {
        for (const column of statsCountColumns) summary[column] += row[column];
        for (const column of statsFastestColumns) {
            const value = row[column];
            if (value !== null && (summary[column] === null || value < summary[column])) summary[column] = value;
        }
    }
    return {rows, summary};
}

export const dailyExportColumns: readonly (keyof DailyExportRow)[] = [
    "date", "netherEnters", "previewsPlayed", "resets", "resetRecords", "accurateRecords",
    "wallTimeMs", "playTimeMs", "rnph", "lnph", "resetsPerEnter",
];
export const recordExportColumns: readonly (keyof ExportRecord)[] = [
    "id", "runId", "worldId", "timestamp", "netherTimeMs", "trackerNetherTimeMs",
    "wallTimeMs", "playTimeMs", "previewsPlayed", "resets", "totalResets", "isAccurate",
];
export const statsDailyExportColumns: readonly (keyof StatsDailyExportRow)[] = ["date", ...statsCountColumns, ...statsFastestColumns];
export const statsRecordExportColumns: readonly (keyof StatsExportRecord)[] = [
    "id", "worldId", "nickname", "timestamp", "lastUpdated", "realUpdated",
    ...Object.keys(statsSplitColumns) as (keyof typeof statsSplitColumns)[],
];

export function exportCsv(rows: readonly object[], columns: readonly string[]) {
    const cell = (value: unknown) => {
        if (value === null || value === undefined) return "";
        let text = String(value);
        if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
        return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    return [columns.join(","), ...rows.map(row => columns.map(column => cell((row as Record<string, unknown>)[column])).join(","))].join("\r\n") + "\r\n";
}
