import { randomUUID } from "node:crypto";
import mysql, { type Connection } from "mysql2/promise";
import Redis from "ioredis";
import dotenv from "dotenv";
import { type FastestEntry } from "@/app/types";
import { calculateAvg, trimmedStats } from "@/app/trimmedAverage";
import {
    acquireRedisLock,
    assertRedisResults,
    deleteKeysIfLeaseHeld,
    envInt,
    forgetChangedDigests,
    LockUnavailableError,
    publishStagedEntries,
    readDigestLedger,
    replaceManifest,
    scanKeys,
    setHashIfLeaseHeld,
    setStringIfLeaseHeld,
    stageChangedJsonEntries,
    stageJsonEntries,
    streamRowBatches,
    writeDigestLedger,
    type RedisLease,
    type StagedKey,
} from "./cache-runtime";

interface QtyStats {
    min: number;
    good: number;
}

export const minQtys = new Map<number, { [category: string]: QtyStats }>([
    [1, {
        nether: {min: 5, good: 30}, bastion: {min: 3, good: 10}, fortress: {min: 1, good: 5},
        first_structure: {min: 3, good: 10}, second_structure: {min: 1, good: 5}, first_portal: {min: 1, good: 5},
        stronghold: {min: 1, good: 3}, end: {min: 1, good: 2}, finish: {min: 1, good: 2},
    }],
    [7, {
        nether: {min: 30, good: 80}, bastion: {min: 5, good: 20}, fortress: {min: 3, good: 10},
        first_structure: {min: 5, good: 20}, second_structure: {min: 3, good: 10}, first_portal: {min: 1, good: 5},
        stronghold: {min: 2, good: 4}, end: {min: 1, good: 2}, finish: {min: 1, good: 2},
    }],
    [30, {
        nether: {min: 200, good: 700}, bastion: {min: 50, good: 80}, fortress: {min: 5, good: 20},
        first_structure: {min: 30, good: 80}, second_structure: {min: 5, good: 20}, first_portal: {min: 5, good: 15},
        stronghold: {min: 3, good: 5}, end: {min: 1, good: 2}, finish: {min: 1, good: 2},
    }],
    [9999, {
        nether: {min: 500, good: 2000}, bastion: {min: 50, good: 600}, fortress: {min: 30, good: 100},
        first_structure: {min: 50, good: 600}, second_structure: {min: 30, good: 100}, first_portal: {min: 10, good: 60},
        stronghold: {min: 5, good: 30}, end: {min: 4, good: 8}, finish: {min: 3, good: 5},
    }],
]);

export function getMinQty(category: string, days: number): number {
    return minQtys.get(days)?.[category]?.min || 0;
}

dotenv.config({ path: ".env.local" });

const mysqlConfig = {
    host: process.env.DB_HOST,
    port: 3306,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: envInt("CACHE_DB_CONNECT_TIMEOUT_MS", 15_000),
};

export enum CategoryType {
    COUNT,
    AVG,
    FASTEST,
    CONVERSION,
}

interface Entry {
    uuid: string;
    name: string;
    value: number;
    qty: number;
    avg: number;
}

interface PaceRow {
    id: number;
    nickname: string;
    uuid: string;
    nether: number | null;
    bastion: number | null;
    fortress: number | null;
    first_portal: number | null;
    second_portal: number | null;
    stronghold: number | null;
    end: number | null;
    finish: number | null;
    obtainRod: number | null;
    insertTime: Date;
}

interface AaRow {
    id: number;
    nickname: string;
    uuid: string;
    nether: number | null;
    bastion: number | null;
    fortress: number | null;
    stronghold: number | null;
    end: number | null;
    elytra: number | null;
    credits: number | null;
    finish: number | null;
    insertTime: Date;
}

interface NetherPaceRow {
    id: number;
    uuid: string;
    nether: number;
    wallTime: number;
    playTime: number;
    enters: number;
    time: number;
    resets: number;
    totalResets: number;
}

interface CachedUser {
    id: string;
    nick: string;
    twitches: string[];
    displayName?: string | null;
    color?: string | null;
    bgColor?: string | null;
}

interface IdentityOutboxClaim {
    scope: "identity";
    entityId: string;
    token: string;
}

type Leaderboards = { [filter: number]: { [category: string]: Entry[] } };

interface CachePacer {
    rowBatchSize: number;
    delayMs: number;
    lease?: RedisLease;
}

async function pacingPause(pacer: CachePacer): Promise<void> {
    if (pacer.delayMs <= 0) return;
    pacer.lease?.assertHeld();
    await new Promise<void>((resolve) => setTimeout(resolve, pacer.delayMs));
    pacer.lease?.assertHeld();
}

const paceCategories = [
    "nether", "bastion", "first_structure", "second_structure", "fortress",
    "first_portal", "second_portal", "stronghold", "end", "finish",
] as const;
const aaCategories = ["nether", "bastion", "fortress", "stronghold", "end", "elytra", "credits", "finish"] as const;
const filters = [CategoryType.AVG, CategoryType.COUNT, CategoryType.FASTEST, CategoryType.CONVERSION] as const;

export const getFirstStructure = (bastion: number | null, fortress: number | null): number | null => {
    if (bastion !== null && fortress === null) return bastion;
    if (bastion === null && fortress !== null) return fortress;
    if (bastion !== null && fortress !== null) return Math.min(bastion, fortress);
    return null;
};

export const getSecondStructure = (bastion: number | null, fortress: number | null): number | null => {
    if (bastion === null || fortress === null) return null;
    return Math.max(bastion, fortress);
};

function getPreviousSplit(split: string): string | null {
    switch (split) {
        case "bastion": return "nether";
        case "fortress": return "bastion";
        case "first_structure": return "nether";
        case "second_structure": return "first_structure";
        case "first_portal": return "second_structure";
        case "stronghold": return "first_portal";
        case "end": return "stronghold";
        case "finish": return "end";
        default: return null;
    }
}

function getPreviousAaSplit(split: string): string | null {
    switch (split) {
        case "bastion": return "nether";
        case "fortress": return "bastion";
        case "stronghold": return "fortress";
        case "end": return "stronghold";
        case "elytra": return "end";
        case "credits": return "elytra";
        case "finish": return "credits";
        default: return null;
    }
}

export {calculateAvg};

function roundNumber(num: number, decimals = 2): number {
    return Math.round(num * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

function initLeaderboards(categories: readonly string[]): Leaderboards {
    const leaderboards: Leaderboards = {};
    for (const filter of filters) {
        leaderboards[filter] = {};
        for (const category of categories) leaderboards[filter][category] = [];
    }
    return leaderboards;
}

function sortLeaderboardsInPlace(leaderboards: Leaderboards, categories: readonly string[]): void {
    for (const filter of filters) {
        for (const category of categories) {
            leaderboards[filter][category].sort(
                filter === CategoryType.AVG || filter === CategoryType.FASTEST
                    ? (a, b) => a.value - b.value || b.qty - a.qty
                    : (a, b) => b.value - a.value || b.qty - a.qty,
            );
        }
    }
}

function topLeaderboards(leaderboards: Leaderboards, categories: readonly string[], days: number): Leaderboards {
    const top = initLeaderboards(categories);
    for (const filter of filters) {
        for (const category of categories) {
            const board = leaderboards[filter][category];
            const eligible = filter === CategoryType.AVG || filter === CategoryType.CONVERSION
                ? board.filter((entry) => entry.qty >= getMinQty(category, days))
                : board;
            top[filter][category] = eligible.slice(0, 10);
        }
    }
    return top;
}

function partitionRowsByDays<T extends { insertTime: Date }>(
    rows: T[],
    days: readonly number[],
    asOfMs: number,
): Map<number, T[]> {
    const partitions = new Map(days.map((day) => [day, [] as T[]]));
    for (const row of rows) {
        const ageMs = asOfMs - row.insertTime.getTime();
        for (const day of days) {
            if (day === 9999 || ageMs <= day * 86_400_000) partitions.get(day)!.push(row);
        }
    }
    return partitions;
}

type PaceMinimum = {time: number; id: number; insertTime: Date};
type PacePlayerAccumulator = {
    firstId: number;
    name: string;
    splits: Record<string, number[]>;
    minima: Record<string, PaceMinimum | undefined>;
};

function accumulatePaceRow(players: Map<string, PacePlayerAccumulator>, row: PaceRow): void {
    let player = players.get(row.uuid);
    if (!player) {
        player = {
            firstId: row.id,
            name: row.nickname,
            splits: Object.fromEntries(paceCategories.map((category) => [category, []])) as Record<string, number[]>,
            minima: {},
        };
        players.set(row.uuid, player);
    }
    if (row.id < player.firstId) player.firstId = row.id;
    const latestName = player.minima.__latestName;
    if (!latestName || row.insertTime > latestName.insertTime || (
        row.insertTime.getTime() === latestName.insertTime.getTime() && row.id > latestName.id
    )) {
        player.name = row.nickname;
        player.minima.__latestName = {time: 0, id: row.id, insertTime: row.insertTime};
    }

    const recordMinimum = (category: string, time: number | null) => {
        if (time === null) return;
        const existing = player!.minima[category];
        if (
            !existing
            || time < existing.time
            || (time === existing.time && (
                row.insertTime > existing.insertTime
                || (row.insertTime.getTime() === existing.insertTime.getTime() && row.id > existing.id)
            ))
        ) player!.minima[category] = {time, id: row.id, insertTime: row.insertTime};
    };

    const firstStructure = getFirstStructure(row.bastion, row.fortress);
    const secondStructure = getSecondStructure(row.bastion, row.fortress);
    recordMinimum("first_structure", firstStructure);
    if (firstStructure !== null) {
        player.splits.first_structure.push(
            firstStructure === row.fortress && row.obtainRod !== null && row.obtainRod < row.fortress
                ? row.obtainRod
                : firstStructure,
        );
    }
    if (secondStructure !== null) {
        if (row.id < 187307) {
            player.splits.second_structure.push(secondStructure);
            recordMinimum("second_structure", secondStructure);
        } else if (
            !(secondStructure === row.bastion && (row.obtainRod === null || row.obtainRod > secondStructure))
            && !(secondStructure === row.fortress && row.fortress - row.bastion! < 50_000)
        ) {
            recordMinimum("second_structure", secondStructure);
            player.splits.second_structure.push(
                secondStructure === row.fortress && row.obtainRod !== null && row.obtainRod < row.fortress
                    ? row.obtainRod
                    : secondStructure,
            );
        }
    }
    if (row.fortress !== null) {
        player.splits.fortress.push(
            row.obtainRod !== null && row.obtainRod < row.fortress ? row.obtainRod : row.fortress,
        );
    }
    for (const category of paceCategories) {
        if (category === "first_structure" || category === "second_structure" || category === "fortress") continue;
        const value = row[category];
        if (value !== null) {
            player.splits[category].push(value);
            recordMinimum(category, value);
        }
    }
    recordMinimum("fortress", row.fortress);
}

/**
 * Everything the leaderboards need from one player's rows. It does not
 * depend on the order the rows were accumulated in, so the all-time job can
 * keep it between runs and recompute it only for players whose rows changed.
 */
type PacePlayerSummary = {
    /** Smallest source row id, which orders players like an id-ordered scan. */
    firstId: number;
    name: string;
    latestNameId: number;
    latestNameInsertTimeMs: number;
    /** Per category with at least one value: [count, trimmed average, fastest]. */
    stats: Record<string, [number, number, number]>;
    /** Per category: [fastest time, run id] as chosen by accumulatePaceRow. */
    minima: Record<string, [number, number]>;
};

function summarizePacePlayer(player: PacePlayerAccumulator): PacePlayerSummary {
    const stats: Record<string, [number, number, number]> = {};
    const minima: Record<string, [number, number]> = {};
    for (const category of paceCategories) {
        const values = player.splits[category];
        if (values.length > 0) {
            const {count, avg, min} = trimmedStats(values);
            stats[category] = [count, avg, min];
        }
        const minimum = player.minima[category];
        if (minimum) minima[category] = [minimum.time, minimum.id];
    }
    const latestName = player.minima.__latestName!;
    return {
        firstId: player.firstId,
        name: player.name,
        latestNameId: latestName.id,
        latestNameInsertTimeMs: latestName.insertTime.getTime(),
        stats,
        minima,
    };
}

function finalizePacePlayers(players: Map<string, PacePlayerAccumulator>, days: number) {
    const summaries = new Map<string, PacePlayerSummary>();
    for (const [uuid, player] of players) summaries.set(uuid, summarizePacePlayer(player));
    return finalizePaceSummaries(summaries, days);
}

function finalizePaceSummaries(players: Map<string, PacePlayerSummary>, days: number): {
    full: Leaderboards;
    top: Leaderboards;
    fastest: { [category: string]: FastestEntry[] };
} {
    const leaderboards = initLeaderboards(paceCategories);
    for (const [uuid, player] of players) {
        for (const category of paceCategories) {
            const stats = player.stats[category];
            if (!stats) continue;
            const [qty, avg, fastest] = stats;
            const previous = getPreviousSplit(category);
            const previousCount = previous === null ? 0 : player.stats[previous]?.[0] ?? 0;
            const conversion = previous === null
                ? 0
                : previousCount === 0
                    ? 1
                    : (qty / previousCount) * 100;
            const valuesByFilter: Record<number, number> = {
                [CategoryType.COUNT]: qty,
                [CategoryType.AVG]: avg,
                [CategoryType.FASTEST]: Math.max(1, fastest),
                [CategoryType.CONVERSION]: conversion,
            };

            for (const filter of filters) {
                const value = valuesByFilter[filter];
                if (value <= 0) continue;
                leaderboards[filter][category].push({uuid, name: player.name, value, qty, avg});
            }
        }
    }

    sortLeaderboardsInPlace(leaderboards, paceCategories);
    const top = topLeaderboards(leaderboards, paceCategories, days);
    const fastest: { [category: string]: FastestEntry[] } = Object.fromEntries(
        paceCategories.map((category) => [category, []]),
    );
    for (const [uuid, player] of players) {
        for (const category of paceCategories) {
            const minimum = player.minima[category];
            if (!minimum || minimum[0] <= 0) continue;
            fastest[category].push({
                uuid,
                name: player.name,
                value: minimum[0],
                runId: minimum[1],
            });
        }
    }
    for (const category of paceCategories) {
        fastest[category].sort((a, b) => a.value - b.value);
        // Keep 100 entries for the public API; the front page gets its own
        // top-ten copy in the compact cache below.
        fastest[category] = fastest[category].slice(0, 100);
        // Keep the front page on the same compact top-leaderboard read used by
        // its other views while retaining the run ID needed for clickable times.
        const detailsByUuid = new Map(
            leaderboards[CategoryType.FASTEST][category].map((entry) => [entry.uuid, entry]),
        );
        top[CategoryType.FASTEST][category] = fastest[category].slice(0, 10).map((entry) => ({
            ...detailsByUuid.get(entry.uuid)!,
            ...entry,
        }));
    }
    return {full: leaderboards, top, fastest};
}

/**
 * Accumulate every period from one pass over the newest-first source rows.
 * Each period's accumulator receives its rows in the same order as a
 * separate pass over that period would, and pacing counts source rows.
 */
async function accumulatePacePeriods(
    rows: PaceRow[],
    days: readonly number[],
    asOfMs: number,
    pacer?: CachePacer,
): Promise<Map<number, Map<string, PacePlayerAccumulator>>> {
    const periods = days.map((day) => ({
        day,
        maxAgeMs: day * 86_400_000,
        players: new Map<string, PacePlayerAccumulator>(),
    }));
    for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        const ageMs = asOfMs - row.insertTime.getTime();
        for (const period of periods) {
            if (period.day === 9999 || ageMs <= period.maxAgeMs) accumulatePaceRow(period.players, row);
        }
        if (pacer && (index + 1) % pacer.rowBatchSize === 0) await pacingPause(pacer);
    }
    return new Map(periods.map(({day, players}) => [day, players]));
}

/** The NPH counterpart of accumulatePacePeriods, with calculateNph's filters. */
async function accumulateNphPeriods(
    rows: NetherPaceRow[],
    days: readonly number[],
    asOfMs: number,
    pacer?: CachePacer,
): Promise<Map<number, Map<string, NphAccumulator>>> {
    const asOfSeconds = asOfMs / 1_000;
    const periods = days.map((day) => ({
        day,
        cutoffSeconds: day === 9999 ? Number.NEGATIVE_INFINITY : asOfMs / 1000 - day * 86_400,
        grouped: new Map<string, NphAccumulator>(),
    }));
    for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        const ageSeconds = asOfSeconds - row.time;
        for (const period of periods) {
            if (
                (period.day === 9999 || ageSeconds <= period.day * 86_400)
                && row.time >= period.cutoffSeconds
            ) accumulateNphRow(period.grouped, row);
        }
        if (pacer && (index + 1) % pacer.rowBatchSize === 0) await pacingPause(pacer);
    }
    return new Map(periods.map(({day, grouped}) => [day, grouped]));
}

async function calculateAaLeaderboards(rows: AaRow[], pacer?: CachePacer): Promise<Leaderboards> {
    const leaderboards = initLeaderboards(aaCategories);
    const nickMap = new Map<string, string>();
    const splitData = new Map<string, Record<string, number[]>>();

    for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        if (pacer && index > 0 && index % pacer.rowBatchSize === 0) await pacingPause(pacer);
        if ((row.nether as number) < 120_000 && row.end === null) continue;
        if (row.credits !== null && row.elytra === null) continue;
        if (!nickMap.has(row.uuid)) nickMap.set(row.uuid, row.nickname);
        let player = splitData.get(row.uuid);
        if (!player) {
            player = Object.fromEntries(aaCategories.map((category) => [category, []])) as Record<string, number[]>;
            splitData.set(row.uuid, player);
        }
        for (const category of aaCategories) {
            const value = row[category];
            if (value !== null) player[category].push(value);
        }
    }

    for (const [uuid, player] of splitData) {
        for (const category of aaCategories) {
            const values = player[category];
            if (values.length === 0) continue;
            const {count: qty, avg, min: fastest} = trimmedStats(values);
            const previous = getPreviousAaSplit(category);
            const conversion = previous === null
                ? 0
                : player[previous].length === 0
                    ? 1
                    : (qty / player[previous].length) * 100;
            const valuesByFilter: Record<number, number> = {
                [CategoryType.COUNT]: qty,
                [CategoryType.AVG]: avg,
                [CategoryType.FASTEST]: fastest,
                [CategoryType.CONVERSION]: conversion,
            };
            for (const filter of filters) {
                const value = valuesByFilter[filter];
                if (value <= 0) continue;
                leaderboards[filter][category].push({ uuid, name: nickMap.get(uuid) || "", value, qty, avg });
            }
        }
    }

    sortLeaderboardsInPlace(leaderboards, aaCategories);
    return leaderboards;
}

function calculatePlayerStats(users: CachedUser[], leaderboards: Leaderboards, days: number): Array<[string, unknown]> {
    const dataByUuid = new Map<string, Record<string, Record<number, { ranking: number; value: number }>>>();
    for (const user of users) {
        dataByUuid.set(
            user.id,
            Object.fromEntries(paceCategories.map((category) => [category, {}])) as Record<string, Record<number, { ranking: number; value: number }>>,
        );
    }

    for (const filter of filters) {
        for (const category of paceCategories) {
            const minQty = filter === CategoryType.FASTEST || filter === CategoryType.COUNT
                ? 0
                : getMinQty(category, days);
            let eligibleRank = 0;
            for (const entry of leaderboards[filter][category]) {
                if (entry.qty === 0) continue;
                const player = dataByUuid.get(entry.uuid);
                if (entry.qty < minQty) {
                    if (player) player[category][filter] = { ranking: -1, value: entry.value };
                } else {
                    eligibleRank++;
                    if (player) player[category][filter] = { ranking: eligibleRank, value: entry.value };
                }
            }
        }
    }

    return [...dataByUuid].map(([uuid, data]) => [`playerStats:${uuid}:${days}day`, data]);
}

type NphAccumulator = {
    wallTime: number;
    playTime: number;
    firstTime: number;
    lastTime: number;
    latestId: number;
    resets: number;
    enters: number;
    totalResets: number;
    times: number[];
};

function accumulateNphRow(grouped: Map<string, NphAccumulator>, row: NetherPaceRow): void {
    let player = grouped.get(row.uuid);
    if (!player) {
        player = {
            wallTime: 0,
            playTime: 0,
            firstTime: row.time,
            lastTime: row.time,
            latestId: row.id,
            resets: 0,
            enters: 0,
            totalResets: row.totalResets,
            times: [],
        };
        grouped.set(row.uuid, player);
    }
    player.times.push(row.nether);
    player.playTime += row.playTime;
    player.wallTime += row.wallTime;
    if (row.time < player.lastTime) player.lastTime = row.time;
    if (row.time > player.firstTime || (row.time === player.firstTime && row.id > player.latestId)) {
        player.firstTime = row.time;
        player.latestId = row.id;
        player.totalResets = row.totalResets;
    }
    if (row.resets > 0) player.resets += row.resets;
    player.enters += row.enters;
}

/** An NphAccumulator with its nether times reduced to their count and trimmed average. */
type NphSummary = Omit<NphAccumulator, "times"> & {count: number; avg: number};

function summarizeNph(player: NphAccumulator): NphSummary {
    const {times, ...totals} = player;
    return {...totals, count: times.length, avg: calculateAvg(times)};
}

function finalizeNph(grouped: Map<string, NphAccumulator>, days: number, asOfMs: number): Array<[string, unknown]> {
    const summaries = new Map<string, NphSummary>();
    for (const [uuid, player] of grouped) summaries.set(uuid, summarizeNph(player));
    return finalizeNphSummaries(summaries, days, asOfMs);
}

function finalizeNphSummaries(grouped: Map<string, NphSummary>, days: number, asOfMs: number): Array<[string, unknown]> {
    const output: Array<[string, unknown]> = [];
    for (const [uuid, player] of grouped) {
        const nethers = player.count;
        if (nethers === 0) continue;
        const elapsedRtaMs = nethers > 1
            ? (player.firstTime - player.lastTime) * 1000
            : asOfMs - player.lastTime * 1000;
        const elapsedRtaHours = elapsedRtaMs / 3_600_000;
        const totalGameTimeHours = (player.wallTime + player.playTime) / 3_600_000;
        const playTimeHours = player.playTime / 3_600_000;
        output.push([`nph:${uuid}:${days}day`, {
            rtanph: roundNumber(elapsedRtaHours > 0 ? nethers / elapsedRtaHours : 0),
            rnph: roundNumber(totalGameTimeHours > 0 ? nethers / totalGameTimeHours : 0),
            lnph: roundNumber(playTimeHours > 0 ? nethers / playTimeHours : 0),
            count: nethers,
            avg: player.avg,
            playtime: player.playTime,
            walltime: player.wallTime,
            resets: player.resets,
            totalResets: player.totalResets,
            seedsPlayed: roundNumber(player.resets > 0 ? (player.enters / player.resets) * 100 : 0),
            rpe: roundNumber(player.resets / nethers),
        }]);
    }
    return output;
}

async function fetchUserData(conn: Connection): Promise<{users: CachedUser[]; details: Array<[string, unknown]>}> {
    const latestNicknamesQuery = `
        SELECT p.uuid, p.nickname
        FROM pace p
        INNER JOIN (
            SELECT uuid, MAX(id) AS max_id FROM pace GROUP BY uuid
        ) latest
            ON p.uuid = latest.uuid AND p.id = latest.max_id;
    `;
    const twitchAccountsQuery = `
        SELECT uuid, twitch, UNIX_TIMESTAMP(MAX(insertTime)) AS time
        FROM pace
        WHERE twitch IS NOT NULL
        GROUP BY uuid, twitch
        ORDER BY uuid, time DESC;
    `;
    const userCustomizationQuery = `SELECT uuid, displayName, color, bgColor FROM users;`;
    const [latestNicknameRows] = await conn.execute(latestNicknamesQuery) as any;
    const [twitchRows] = await conn.execute(twitchAccountsQuery) as any;
    const [customizationRows] = await conn.execute(userCustomizationQuery) as any;
    const usersByUuid = new Map<string, CachedUser>();
    const topTwitches = new Map<string, Array<{ twitch: string; time: number; live: boolean }>>();

    for (const row of latestNicknameRows) {
        usersByUuid.set(row.uuid, {
            id: row.uuid,
            nick: row.nickname,
            twitches: [],
            displayName: null,
            color: null,
            bgColor: null,
        });
        topTwitches.set(row.uuid, []);
    }
    for (const row of twitchRows) {
        const user = usersByUuid.get(row.uuid);
        if (!user) continue;
        user.twitches.push(row.twitch);
        const details = topTwitches.get(row.uuid)!;
        if (details.length < 2) details.push({ twitch: row.twitch, time: row.time, live: false });
    }
    for (const row of customizationRows) {
        const user = usersByUuid.get(row.uuid);
        if (!user) continue;
        user.displayName = row.displayName;
        user.color = row.color;
        user.bgColor = row.bgColor;
    }

    const details: Array<[string, unknown]> = [];
    for (const [uuid, accounts] of topTwitches) {
        if (accounts.length > 0) details.push([`users:twitch_details:${uuid}`, accounts]);
    }
    return { users: [...usersByUuid.values()], details };
}

async function readIdentityOutboxClaims(conn: Connection): Promise<IdentityOutboxClaim[]> {
    const [rows] = await conn.execute(
        `SELECT scope, entityId, token
         FROM cache_invalidation_outbox
         WHERE scope='identity'
         ORDER BY entityId ASC;`,
    );
    return rows as IdentityOutboxClaim[];
}

async function acknowledgeOutboxClaims(
    conn: Connection,
    claims: OutboxClaim[],
    batchSize: number,
): Promise<void> {
    for (let offset = 0; offset < claims.length; offset += batchSize) {
        const batch = claims.slice(offset, offset + batchSize);
        const tuples = batch.map(() => "(?,?,?)").join(",");
        await conn.execute(
            `DELETE FROM cache_invalidation_outbox WHERE (scope, entityId, token) IN (${tuples});`,
            batch.flatMap(({scope, entityId, token}) => [scope, entityId, token]),
        );
    }
}

async function findChangedIdentityUuids(
    conn: Connection,
    previousAsOf: Date,
    previousMaximumId: number,
    asOf: Date,
    maximumId: number,
    claims: OutboxClaim[],
): Promise<Set<string>> {
    const changed = new Set(claims.map(({entityId}) => entityId));
    const [insertedRows] = await conn.execute(
        `SELECT DISTINCT uuid FROM pace WHERE id > ? AND id <= ?;`,
        [previousMaximumId, maximumId],
    ) as any;
    const [updatedRows] = await conn.execute(
        `SELECT DISTINCT uuid
         FROM pace
         WHERE lastUpdated >= ? AND lastUpdated <= ?;`,
        [previousAsOf, asOf],
    ) as any;
    for (const row of [...insertedRows, ...updatedRows]) changed.add(row.uuid);
    return changed;
}

async function refreshChangedUserData(
    conn: Connection,
    existingUsers: CachedUser[],
    changedUuids: Set<string>,
    sqlBatchSize: number,
): Promise<{users: CachedUser[]; details: Array<[string, unknown]>}> {
    const usersByUuid = new Map(existingUsers.map((user) => [user.id, {...user, twitches: [...user.twitches]}]));
    const latestRows: any[] = [];
    const twitchRows: any[] = [];
    const customizationRows: any[] = [];
    const ordered = [...changedUuids].sort();

    for (let offset = 0; offset < ordered.length; offset += sqlBatchSize) {
        const batch = ordered.slice(offset, offset + sqlBatchSize);
        const placeholders = batch.map(() => "?").join(",");
        const [latest] = await conn.execute(
            `SELECT p.uuid, p.nickname
             FROM pace p
             INNER JOIN (
                 SELECT uuid, MAX(id) AS max_id
                 FROM pace
                 WHERE uuid IN (${placeholders})
                 GROUP BY uuid
             ) selected ON selected.max_id=p.id;`,
            batch,
        ) as any;
        const [twitches] = await conn.execute(
            `SELECT uuid, twitch, UNIX_TIMESTAMP(MAX(insertTime)) AS time
             FROM pace
             WHERE uuid IN (${placeholders}) AND twitch IS NOT NULL
             GROUP BY uuid, twitch
             ORDER BY uuid, time DESC;`,
            batch,
        ) as any;
        const [customizations] = await conn.execute(
            `SELECT uuid, displayName, color, bgColor FROM users WHERE uuid IN (${placeholders});`,
            batch,
        ) as any;
        latestRows.push(...latest);
        twitchRows.push(...twitches);
        customizationRows.push(...customizations);
    }

    for (const uuid of changedUuids) usersByUuid.delete(uuid);
    for (const row of latestRows) {
        usersByUuid.set(row.uuid, {
            id: row.uuid,
            nick: row.nickname,
            twitches: [],
            displayName: null,
            color: null,
            bgColor: null,
        });
    }
    const topTwitches = new Map<string, Array<{twitch: string; time: number; live: boolean}>>();
    for (const row of twitchRows) {
        const user = usersByUuid.get(row.uuid);
        if (!user) continue;
        user.twitches.push(row.twitch);
        const accounts = topTwitches.get(row.uuid) || [];
        if (accounts.length < 2) accounts.push({twitch: row.twitch, time: row.time, live: false});
        topTwitches.set(row.uuid, accounts);
    }
    for (const row of customizationRows) {
        const user = usersByUuid.get(row.uuid);
        if (!user) continue;
        user.displayName = row.displayName;
        user.color = row.color;
        user.bgColor = row.bgColor;
    }
    return {
        users: [...usersByUuid.values()],
        details: [...topTwitches].map(([uuid, accounts]) => [`users:twitch_details:${uuid}`, accounts]),
    };
}

async function fetchPaceRows(conn: Connection, cutoff: Date | null, asOf: Date): Promise<PaceRow[]> {
    const where = cutoff ? "WHERE insertTime >= ? AND insertTime <= ?" : "WHERE insertTime <= ?";
    const [rows] = await conn.execute(
        `SELECT id, nickname, uuid, nether, bastion, fortress, first_portal, second_portal,
            stronghold, end, finish, obtainRod, insertTime
         FROM pace ${where} ORDER BY insertTime DESC, id DESC;`,
        cutoff ? [cutoff, asOf] : [asOf],
    );
    return rows as PaceRow[];
}

async function fetchAaRows(conn: Connection, cutoff: Date | null, asOf: Date): Promise<AaRow[]> {
    const where = cutoff ? "WHERE insertTime >= ? AND insertTime <= ?" : "WHERE insertTime <= ?";
    const [rows] = await conn.execute(
        `SELECT id, nickname, uuid, nether, bastion, fortress, stronghold, end, elytra, credits, finish, insertTime
         FROM aa ${where} ORDER BY insertTime DESC, id DESC;`,
        cutoff ? [cutoff, asOf] : [asOf],
    );
    return rows as AaRow[];
}

async function fetchNetherRows(conn: Connection, cutoff: Date | null, asOf: Date): Promise<NetherPaceRow[]> {
    const where = cutoff
        ? "WHERE nethers.insertTime >= ? AND nethers.insertTime <= ?"
        : "WHERE nethers.insertTime <= ?";
    const [rows] = await conn.execute(
        `SELECT nethers.id, nethers.uuid, pace.nether AS nether, wallTime, playTime, enters,
            UNIX_TIMESTAMP(nethers.insertTime) AS time, resets, totalResets
         FROM nethers INNER JOIN pace ON nethers.runId = pace.id
         ${where} ORDER BY nethers.insertTime DESC, nethers.id DESC;`,
        cutoff ? [cutoff, asOf] : [asOf],
    );
    return rows as NetherPaceRow[];
}

function mergeLeaderboards(target: Leaderboards, source: Leaderboards, categories: readonly string[]): void {
    for (const filter of filters) {
        for (const category of categories) target[filter][category].push(...source[filter][category]);
    }
}

function applyCachedNames(
    leaderboards: Leaderboards,
    categories: readonly string[],
    users: CachedUser[],
    fastest?: {[category: string]: FastestEntry[]},
): void {
    const names = new Map(users.map((user) => [user.id, user.nick]));
    for (const filter of filters) {
        for (const category of categories) {
            for (const entry of leaderboards[filter][category]) entry.name = names.get(entry.uuid) || entry.name;
        }
    }
    if (fastest) {
        for (const category of categories) {
            for (const entry of fastest[category]) entry.name = names.get(entry.uuid) || entry.name;
        }
    }
}

/**
 * Read pace rows in per-player id order and reduce them to summaries:
 * every row up to `maximumId` and `asOf`, or, with `uuids`, only those
 * players' rows (the same filter, so a recomputed summary equals the one a
 * full scan would produce).
 */
async function readPaceSummaries(
    conn: Connection,
    uuids: string[] | null,
    maximumId: number,
    asOf: Date,
    sqlBatchSize: number,
    lease: RedisLease,
    pacer: CachePacer,
): Promise<{summaries: Map<string, PacePlayerSummary>; rowCount: number}> {
    const columns = `id, nickname, uuid, nether, bastion, fortress, first_portal, second_portal,
                stronghold, end, finish, obtainRod, insertTime`;
    const summaries = new Map<string, PacePlayerSummary>();
    let rowCount = 0;
    const consume = async (rows: PaceRow[], players: Map<string, PacePlayerAccumulator>) => {
        for (let index = 0; index < rows.length; index++) {
            accumulatePaceRow(players, rows[index]);
            rowCount++;
            if ((index + 1) % pacer.rowBatchSize === 0) await pacingPause(pacer);
        }
    };
    if (uuids === null) {
        const players = new Map<string, PacePlayerAccumulator>();
        let currentUuid: string | undefined;
        const flushPlayer = () => {
            if (currentUuid === undefined) return;
            summaries.set(currentUuid, summarizePacePlayer(players.get(currentUuid)!));
            players.clear();
        };
        await lease.verifyHeld();
        // The uuid index includes the primary key, so rows of a player
        // arrive together without a filesort. Only that player's split
        // arrays stay live, rather than every split in the whole table.
        await streamRowBatches<PaceRow>(conn, {
            sql: `SELECT ${columns}
                 FROM pace FORCE INDEX (uuid)
                 WHERE id <= ? AND insertTime <= ?
                 ORDER BY uuid ASC, id ASC;`,
        }, [maximumId, asOf], sqlBatchSize, async (rows) => {
            await lease.verifyHeld();
            for (let index = 0; index < rows.length; index++) {
                const row = rows[index];
                if (currentUuid !== undefined && currentUuid !== row.uuid) flushPlayer();
                currentUuid = row.uuid;
                accumulatePaceRow(players, row);
                rowCount++;
                if ((index + 1) % pacer.rowBatchSize === 0) await pacingPause(pacer);
            }
            await pacingPause(pacer);
        });
        flushPlayer();
        return {summaries, rowCount};
    }
    for (let offset = 0; offset < uuids.length; offset += FULL_UUID_BATCH_SIZE) {
        const batch = uuids.slice(offset, offset + FULL_UUID_BATCH_SIZE);
        const placeholders = batch.map(() => "?").join(",");
        const players = new Map<string, PacePlayerAccumulator>();
        let cursor: {uuid: string; id: number} | null = null;
        while (true) {
            await lease.verifyHeld();
            const [rawRows] = await conn.execute(
                `SELECT ${columns}
                 FROM pace
                 WHERE uuid IN (${placeholders}) AND id <= ? AND insertTime <= ?
                   ${cursor === null ? "" : "AND (uuid > ? OR (uuid = ? AND id > ?))"}
                 ORDER BY uuid ASC, id ASC
                 LIMIT ${sqlBatchSize};`,
                cursor === null
                    ? [...batch, maximumId, asOf]
                    : [...batch, maximumId, asOf, cursor.uuid, cursor.uuid, cursor.id],
            );
            const rows = rawRows as PaceRow[];
            if (rows.length === 0) break;
            await consume(rows, players);
            const last = rows[rows.length - 1];
            cursor = {uuid: last.uuid, id: last.id};
            if (rows.length < sqlBatchSize) break;
            await pacingPause(pacer);
        }
        for (const [uuid, player] of players) summaries.set(uuid, summarizePacePlayer(player));
    }
    return {summaries, rowCount};
}

/** The NPH counterpart of readPaceSummaries, grouped by nethers.uuid. */
async function readNphSummaries(
    conn: Connection,
    uuids: string[] | null,
    maximumId: number,
    asOf: Date,
    sqlBatchSize: number,
    lease: RedisLease,
    pacer: CachePacer,
): Promise<{summaries: Map<string, NphSummary>; rowCount: number}> {
    const columns = `nethers.id, nethers.uuid, pace.nether AS nether, wallTime, playTime, enters,
                UNIX_TIMESTAMP(nethers.insertTime) AS time, resets, totalResets`;
    const summaries = new Map<string, NphSummary>();
    let rowCount = 0;
    const consume = async (rows: NetherPaceRow[], grouped: Map<string, NphAccumulator>) => {
        for (let index = 0; index < rows.length; index++) {
            accumulateNphRow(grouped, rows[index]);
            rowCount++;
            if ((index + 1) % pacer.rowBatchSize === 0) await pacingPause(pacer);
        }
    };
    if (uuids === null) {
        const grouped = new Map<string, NphAccumulator>();
        let lastId = 0;
        while (true) {
            await lease.verifyHeld();
            const [rawRows] = await conn.execute(
                `SELECT ${columns}
                 FROM nethers INNER JOIN pace ON nethers.runId = pace.id
                 WHERE nethers.id > ? AND nethers.id <= ? AND nethers.insertTime <= ?
                 ORDER BY nethers.id ASC LIMIT ${sqlBatchSize};`,
                [lastId, maximumId, asOf],
            );
            const rows = rawRows as NetherPaceRow[];
            if (rows.length === 0) break;
            await consume(rows, grouped);
            lastId = rows[rows.length - 1].id;
            if (rows.length < sqlBatchSize) break;
            await pacingPause(pacer);
        }
        for (const [uuid, player] of grouped) summaries.set(uuid, summarizeNph(player));
        return {summaries, rowCount};
    }
    for (let offset = 0; offset < uuids.length; offset += FULL_UUID_BATCH_SIZE) {
        const batch = uuids.slice(offset, offset + FULL_UUID_BATCH_SIZE);
        const placeholders = batch.map(() => "?").join(",");
        const grouped = new Map<string, NphAccumulator>();
        let cursor: {uuid: string; id: number} | null = null;
        while (true) {
            await lease.verifyHeld();
            const [rawRows] = await conn.execute(
                `SELECT ${columns}
                 FROM nethers INNER JOIN pace ON nethers.runId = pace.id
                 WHERE nethers.uuid IN (${placeholders}) AND nethers.id <= ? AND nethers.insertTime <= ?
                   ${cursor === null ? "" : "AND (nethers.uuid > ? OR (nethers.uuid = ? AND nethers.id > ?))"}
                 ORDER BY nethers.uuid ASC, nethers.id ASC LIMIT ${sqlBatchSize};`,
                cursor === null
                    ? [...batch, maximumId, asOf]
                    : [...batch, maximumId, asOf, cursor.uuid, cursor.uuid, cursor.id],
            );
            const rows = rawRows as NetherPaceRow[];
            if (rows.length === 0) break;
            await consume(rows, grouped);
            const last = rows[rows.length - 1];
            cursor = {uuid: last.uuid, id: last.id};
            if (rows.length < sqlBatchSize) break;
            await pacingPause(pacer);
        }
        for (const [uuid, player] of grouped) summaries.set(uuid, summarizeNph(player));
    }
    return {summaries, rowCount};
}

// ---------------------------------------------------------------------------
// Incremental all-time aggregates
//
// The all-time boards are pure functions of per-player summaries, and a
// summary depends only on that player's rows. The full job keeps every
// summary in FULL_STATE_KEY and, on later runs, recomputes only players with
// rows inserted, updated (lastUpdated) or deleted (aggregate outbox) since
// the previous run. A complete rescan still happens on the first run, when
// the state format changes, every CACHE_FULL_REBUILD_INTERVAL_SECONDS, with
// --rebuild, or when too many players changed.
// ---------------------------------------------------------------------------

const FULL_STATE_KEY = "cache:aggregate:full:state";
const FULL_STATE_META_FIELD = "__meta";
const FULL_STATE_VERSION = 1;
const FULL_UUID_BATCH_SIZE = 50;

type FullStateMeta = {
    version: number;
    asOf: string;
    maximumPaceId: number;
    maximumNetherId: number;
    rebuiltAt: string;
};

type FullPlayerState = {p?: PacePlayerSummary; n?: NphSummary};

type FullState = {meta: FullStateMeta; players: Map<string, FullPlayerState>};

async function readFullState(redis: Redis): Promise<FullState | null> {
    const raw = await redis.hgetall(FULL_STATE_KEY);
    const metaRaw = raw[FULL_STATE_META_FIELD];
    if (!metaRaw) return null;
    const meta = JSON.parse(metaRaw) as FullStateMeta;
    if (meta.version !== FULL_STATE_VERSION) return null;
    const players = new Map<string, FullPlayerState>();
    for (const [uuid, value] of Object.entries(raw)) {
        if (uuid !== FULL_STATE_META_FIELD) players.set(uuid, JSON.parse(value));
    }
    return {meta, players};
}

interface OutboxClaim {
    scope: string;
    entityId: string;
    token: string;
}

async function readOutboxClaims(conn: Connection, scope: string): Promise<OutboxClaim[]> {
    const [rows] = await conn.execute(
        `SELECT scope, entityId, token
         FROM cache_invalidation_outbox
         WHERE scope=?
         ORDER BY entityId ASC;`,
        [scope],
    );
    return rows as OutboxClaim[];
}

/**
 * Deletions leave no trace in the columns used to find changed players, so
 * incremental runs need ops/mysql/aggregate-delete-triggers.sql. Without the
 * triggers, every run rescans all rows as before.
 */
async function hasAggregateDeleteTriggers(conn: Connection): Promise<boolean> {
    const [rows] = await conn.execute(
        `SELECT COUNT(*) AS triggerCount
         FROM information_schema.TRIGGERS
         WHERE TRIGGER_SCHEMA = DATABASE()
           AND TRIGGER_NAME IN ('trg_pace_aggregate_delete', 'trg_nethers_aggregate_delete');`,
    ) as any;
    return Number(rows[0].triggerCount) === 2;
}

/** Players whose all-time summaries may differ from the stored ones. */
async function findChangedFullPlayers(
    conn: Connection,
    meta: FullStateMeta,
    maximumPaceId: number,
    maximumNetherId: number,
    overlapSeconds: number,
    claims: OutboxClaim[],
): Promise<Set<string | null>> {
    const since = new Date(new Date(meta.asOf).getTime() - overlapSeconds * 1_000);
    // The delete triggers record a row without a uuid as ''.
    const changed = new Set<string | null>(claims.map(({entityId}) => entityId === "" ? null : entityId));
    const queries: Array<[string, any[]]> = [
        ["SELECT DISTINCT uuid FROM pace WHERE id > ? AND id <= ?;", [meta.maximumPaceId, maximumPaceId]],
        ["SELECT DISTINCT uuid FROM pace WHERE lastUpdated >= ?;", [since]],
        ["SELECT DISTINCT uuid FROM pace WHERE insertTime >= ?;", [since]],
        ["SELECT DISTINCT uuid FROM nethers WHERE id > ? AND id <= ?;", [meta.maximumNetherId, maximumNetherId]],
        ["SELECT DISTINCT uuid FROM nethers WHERE insertTime >= ?;", [since]],
    ];
    for (const [sql, values] of queries) {
        const [rows] = await conn.execute(sql, values) as any;
        for (const row of rows) changed.add(row.uuid);
    }
    return changed;
}

/** Order players by their smallest row id, as a full id-ordered scan meets them. */
function orderedByFirstId<T>(players: Map<string, FullPlayerState>, pick: (state: FullPlayerState) => T | undefined, firstId: (value: T) => number) {
    const entries: Array<[string, T]> = [];
    for (const [uuid, state] of players) {
        const value = pick(state);
        if (value !== undefined) entries.push([uuid, value]);
    }
    entries.sort((left, right) => firstId(left[1]) - firstId(right[1]));
    return new Map(entries);
}

async function writeFullState(
    redis: Redis,
    state: FullState,
    rebuilt: boolean,
    changedUuids: Iterable<string>,
    generation: string,
    batchSize: number,
    stagingTtlSeconds: number,
    lease: RedisLease,
): Promise<void> {
    const setScript = `
        if redis.call('GET', KEYS[1]) ~= ARGV[1] then
            return redis.error_reply('CACHE_LOCK_LOST')
        end
        for index = 2, #ARGV, 2 do
            if ARGV[index + 1] == '' then
                redis.call('HDEL', KEYS[2], ARGV[index])
            else
                redis.call('HSET', KEYS[2], ARGV[index], ARGV[index + 1])
            end
        end
        return 1
    `;
    const encode = (uuid: string): [string, string] => {
        const player = state.players.get(uuid);
        return [uuid, player && (player.p || player.n) ? JSON.stringify(player) : ""];
    };
    if (rebuilt) {
        // Build the whole hash under a staging key, then swap it in.
        const staging = `cache:staging:${generation}:aggregate-state`;
        const uuids = [...state.players.keys()];
        for (let offset = 0; offset < uuids.length; offset += batchSize) {
            const fields = uuids.slice(offset, offset + batchSize).map(encode).filter(([, value]) => value !== "");
            const pipeline = redis.pipeline();
            if (fields.length > 0) pipeline.hset(staging, ...fields.flat());
            pipeline.expire(staging, stagingTtlSeconds);
            assertRedisResults(await pipeline.exec(), "staging the all-time aggregate state");
        }
        await redis.hset(staging, FULL_STATE_META_FIELD, JSON.stringify(state.meta));
        lease.assertHeld();
        await redis.eval(`
            if redis.call('GET', KEYS[1]) ~= ARGV[1] then
                return redis.error_reply('CACHE_LOCK_LOST')
            end
            redis.call('RENAME', KEYS[2], KEYS[3])
            redis.call('PERSIST', KEYS[3])
            return 1
        `, 3, lease.key, staging, FULL_STATE_KEY, lease.token);
        lease.assertHeld();
        return;
    }
    // Player fields first and the metadata last: if the job stops in between,
    // the next run starts from the old metadata and recomputes a superset.
    const uuids = [...changedUuids];
    for (let offset = 0; offset < uuids.length; offset += batchSize) {
        lease.assertHeld();
        await redis.eval(setScript, 2, lease.key, FULL_STATE_KEY, lease.token,
            ...uuids.slice(offset, offset + batchSize).flatMap(encode));
    }
    lease.assertHeld();
    await redis.eval(setScript, 2, lease.key, FULL_STATE_KEY, lease.token,
        FULL_STATE_META_FIELD, JSON.stringify(state.meta));
    lease.assertHeld();
}

async function buildFullAaCache(
    conn: Connection,
    asOf: Date,
    sqlBatchSize: number,
    lease: RedisLease,
    pacer: CachePacer,
): Promise<{leaderboards: Leaderboards; rowCount: number}> {
    const leaderboards = initLeaderboards(aaCategories);
    let currentUuid: string | null = null;
    let currentRows: AaRow[] = [];
    let lastUuid: string | null = null;
    let lastId = 0;
    let rowCount = 0;
    const flushPlayer = async () => {
        if (currentRows.length === 0) return;
        mergeLeaderboards(leaderboards, await calculateAaLeaderboards(currentRows, pacer), aaCategories);
        currentRows = [];
    };
    while (true) {
        await lease.verifyHeld();
        const cursor = lastUuid === null ? "" : "AND (uuid > ? OR (uuid = ? AND id > ?))";
        const params = lastUuid === null ? [asOf] : [asOf, lastUuid, lastUuid, lastId];
        const [rawRows] = await conn.execute(
            `SELECT id, nickname, uuid, nether, bastion, fortress, stronghold, end, elytra, credits, finish, insertTime
             FROM aa WHERE insertTime <= ? ${cursor}
             ORDER BY uuid ASC, id ASC LIMIT ${sqlBatchSize};`,
            params,
        );
        const rows = rawRows as AaRow[];
        if (rows.length === 0) break;
        for (const row of rows) {
            if (currentUuid !== null && row.uuid !== currentUuid) await flushPlayer();
            currentUuid = row.uuid;
            currentRows.push(row);
            rowCount++;
        }
        const last = rows[rows.length - 1];
        lastUuid = last.uuid;
        lastId = last.id;
        if (rows.length < sqlBatchSize) break;
        await pacingPause(pacer);
    }
    await flushPlayer();
    sortLeaderboardsInPlace(leaderboards, aaCategories);
    return {leaderboards, rowCount};
}

async function readUsersFromRedis(redis: Redis): Promise<CachedUser[]> {
    const raw = await redis.call("JSON.GET", "users", "$");
    if (!raw) throw new Error("The 'users' cache is required for a --full run. Run the normal cache job first.");
    return JSON.parse(raw as string)[0] as CachedUser[];
}

async function removeLegacyStaleDynamicKeys(
    redis: Redis,
    scope: string,
    currentKeys: string[],
    batchSize: number,
    lease: RedisLease,
): Promise<number> {
    const patterns = scope === "full"
        ? ["playerStats:*:9999day", "nph:*:9999day"]
        : [
            "users:twitch_details:*",
            "playerStats:*:1day", "playerStats:*:7day", "playerStats:*:30day",
            "nph:*:1day", "nph:*:7day", "nph:*:30day",
        ];
    const oldKeys = new Set<string>();
    for (const pattern of patterns) {
        await lease.verifyHeld();
        for (const key of await scanKeys(redis, pattern)) oldKeys.add(key);
    }
    const current = new Set(currentKeys);
    const stale = [...oldKeys].filter((key) => !current.has(key));
    for (let offset = 0; offset < stale.length; offset += batchSize) {
        const batch = stale.slice(offset, offset + batchSize);
        await lease.verifyHeld();
        if (batch.length > 0) await deleteKeysIfLeaseHeld(redis, batch, lease);
    }
    return stale.length;
}

async function main(): Promise<void> {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) throw new Error("REDIS_URL is required.");
    const full = process.argv.includes("--full");
    const scope = full ? "full" : "normal";
    const days = full ? [9999] : [1, 7, 30];
    const generation = `${Date.now()}-${randomUUID()}`;
    const batchSize = envInt("CACHE_REDIS_BATCH_SIZE", 250);
    const publishBatchSize = envInt("CACHE_REDIS_PUBLISH_BATCH_SIZE", 250);
    const manifestBatchSize = envInt("CACHE_MANIFEST_BATCH_SIZE", 1_000);
    const sqlBatchSize = envInt("CACHE_SQL_BATCH_SIZE", 5_000);
    // Deliberately trade a little runtime for lower burst CPU/DB usage. Set the
    // delay to 0 to restore the old run-as-fast-as-possible behaviour.
    const pacingDelayMs = envInt("CACHE_PACING_DELAY_MS", 100, 0);
    const pacingRowBatchSize = envInt("CACHE_PACING_ROW_BATCH_SIZE", 2_000);
    const identityFullRefreshSeconds = envInt("CACHE_IDENTITY_FULL_REFRESH_SECONDS", 86_400);
    const stagingTtlSeconds = envInt("CACHE_STAGING_TTL_SECONDS", 21_600);
    const targetTtlSeconds = full
        ? envInt("CACHE_FULL_PLAYER_TTL_SECONDS", 3_888_000)
        : envInt("CACHE_PLAYER_TTL_SECONDS", 1_209_600);
    const lockTtlMs = envInt("CACHE_LOCK_TTL_MS", 7_200_000);
    const fullRebuildIntervalSeconds = envInt("CACHE_FULL_REBUILD_INTERVAL_SECONDS", 604_800);
    const fullOverlapSeconds = envInt("CACHE_FULL_WATERMARK_OVERLAP_SECONDS", 300, 0);
    const fullIncrementalMaxPlayers = envInt("CACHE_FULL_INCREMENTAL_MAX_PLAYERS", 2_000);
    let fullState: FullState | null = null;
    let fullStateRebuilt = false;
    let fullStateChanged: string[] = [];
    let aggregateClaims: OutboxClaim[] = [];

    const redis = new Redis(redisUrl, {
        connectTimeout: envInt("CACHE_REDIS_CONNECT_TIMEOUT_MS", 10_000),
        commandTimeout: envInt("CACHE_REDIS_COMMAND_TIMEOUT_MS", 60_000),
        maxRetriesPerRequest: 3,
    });
    let conn: Connection | null = null;
    let lock: Awaited<ReturnType<typeof acquireRedisLock>> | null = null;
    const stagedDynamic: StagedKey[] = [];
    const stagedFixed: StagedKey[] = [];
    const startedAt = Date.now();
    const phaseTimingsMs: Record<string, number> = {};
    let peakRssBytes = process.memoryUsage().rss;
    const sampleMemory = () => {
        peakRssBytes = Math.max(
            peakRssBytes,
            process.memoryUsage().rss,
            process.resourceUsage().maxRSS * 1_024,
        );
    };
    const measure = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
        const phaseStartedAt = Date.now();
        try { return await work(); }
        finally {
            phaseTimingsMs[name] = (phaseTimingsMs[name] || 0) + Date.now() - phaseStartedAt;
            sampleMemory();
        }
    };

    try {
        lock = await acquireRedisLock(redis, "cache:lock:aggregate", lockTtlMs);
        const pacer: CachePacer = {
            delayMs: pacingDelayMs,
            rowBatchSize: pacingRowBatchSize,
            lease: lock,
        };
        conn = await mysql.createConnection(mysqlConfig);
        const digestLedger = await readDigestLedger(redis, `cache:digest:${scope}`);
        const retainedDynamic: string[] = [];
        // Per-player values rarely change between runs (most players have no
        // runs in a period at all), so stage only values whose content differs
        // from what was last published; the rest keep their key and get their
        // TTL renewed.
        const stageDynamic = async (entries: Iterable<[string, unknown]>) => {
            const result = await stageChangedJsonEntries(
                redis, entries, generation, batchSize, stagingTtlSeconds, digestLedger, targetTtlSeconds, lock!,
            );
            stagedDynamic.push(...result.staged);
            retainedDynamic.push(...result.retained);
        };

        const [asOfRows] = await conn.query("SELECT NOW(3) AS asOf") as any;
        const asOf = new Date(asOfRows[0].asOf);
        const asOfMs = asOf.getTime();
        const cutoff = full ? null : new Date(asOf.getTime() - 30 * 86_400_000);
        let users: CachedUser[];
        let identityRefreshed = false;
        let identityFullRefreshed = false;
        let identityMaximumPaceId = 0;
        let identityClaims: IdentityOutboxClaim[] = [];
        let identityFullCompletedAt = "";
        let retainedIdentityTargets: string[] = [];
        const periodCounts = new Map<number, { pace: number; aa: number; nethers: number }>();
        if (full) {
            users = await readUsersFromRedis(redis);
        } else {
            const identityState = await redis.hgetall("cache:identity:state");
            const previousAsOf = identityState.asOf ? new Date(identityState.asOf) : null;
            const previousMaximumId = Number(identityState.maximumPaceId || 0);
            identityFullCompletedAt = identityState.fullCompletedAt || identityState.completedAt || "";
            const fullAgeMs = identityFullCompletedAt
                ? asOfMs - new Date(identityFullCompletedAt).getTime()
                : Infinity;
            const [[maximumRow]] = await conn.query("SELECT COALESCE(MAX(id), 0) AS maximumId FROM pace") as any;
            identityMaximumPaceId = Number(maximumRow.maximumId);
            identityClaims = await readIdentityOutboxClaims(conn);
            const refreshAllIdentity = await redis.exists("users") !== 1
                || !previousAsOf
                || !Number.isFinite(previousAsOf.getTime())
                || !Number.isFinite(previousMaximumId)
                || !Number.isFinite(fullAgeMs)
                || fullAgeMs >= identityFullRefreshSeconds * 1_000;
            if (refreshAllIdentity) {
                const userData = await measure("identity", () => fetchUserData(conn!));
                users = userData.users;
                identityRefreshed = true;
                identityFullRefreshed = true;
                identityFullCompletedAt = new Date().toISOString();
                stagedFixed.push(...await stageJsonEntries(
                    redis, [["users", users]], generation, 1, stagingTtlSeconds,
                ));
                await stageDynamic(userData.details);
            } else {
                users = await readUsersFromRedis(redis);
                retainedIdentityTargets = await scanKeys(redis, "users:twitch_details:*");
                const changedUuids = await findChangedIdentityUuids(
                    conn, previousAsOf, previousMaximumId, asOf, identityMaximumPaceId, identityClaims,
                );
                if (changedUuids.size > 0) {
                    const userData = await measure("identity", () => refreshChangedUserData(
                        conn!, users, changedUuids, Math.min(sqlBatchSize, 500),
                    ));
                    users = userData.users;
                    identityRefreshed = true;
                    const changedTargets = new Set(
                        [...changedUuids].map((uuid) => `users:twitch_details:${uuid}`),
                    );
                    retainedIdentityTargets = retainedIdentityTargets.filter((key) => !changedTargets.has(key));
                    stagedFixed.push(...await stageJsonEntries(
                        redis, [["users", users]], generation, 1, stagingTtlSeconds,
                    ));
                    await stageDynamic(userData.details);
                }
            }
        }
        lock.assertHeld();

        // Normal runs buffer the bounded 30-day sources. A full pace scan
        // streams in player order, releasing each player's raw splits once
        // summarised; the other full sources use bounded SQL pages.
        if (full) {
            const [[maximumPaceRow]] = await conn.query("SELECT COALESCE(MAX(id), 0) AS maximumId FROM pace") as any;
            const [[maximumNetherRow]] = await conn.query("SELECT COALESCE(MAX(id), 0) AS maximumId FROM nethers") as any;
            const maximumPaceId = Number(maximumPaceRow.maximumId);
            const maximumNetherId = Number(maximumNetherRow.maximumId);
            aggregateClaims = await readOutboxClaims(conn, "aggregate");
            const incrementalReady = !process.argv.includes("--rebuild") && await hasAggregateDeleteTriggers(conn);
            if (!incrementalReady && !process.argv.includes("--rebuild")) {
                console.log("Aggregate delete triggers are missing; rescanning every row.");
            }
            const previousState = incrementalReady ? await readFullState(redis) : null;
            let changedUuids: Set<string | null> | null = null;
            if (
                previousState
                && asOfMs - new Date(previousState.meta.rebuiltAt).getTime() < fullRebuildIntervalSeconds * 1_000
            ) {
                changedUuids = await measure("changeDetection", () => findChangedFullPlayers(
                    conn!, previousState.meta, maximumPaceId, maximumNetherId, fullOverlapSeconds, aggregateClaims,
                ));
                // A NULL uuid cannot be looked up by uuid; rescan instead.
                if (changedUuids.has(null) || changedUuids.size > fullIncrementalMaxPlayers) changedUuids = null;
            }
            const changed = changedUuids === null ? null : [...changedUuids as Set<string>].sort();
            const paceSummaries = await measure("pace", () => readPaceSummaries(
                conn!, changed, maximumPaceId, asOf, sqlBatchSize, lock!, pacer,
            ));
            await pacingPause(pacer);
            const nphSummaries = await measure("nph", () => readNphSummaries(
                conn!, changed, maximumNetherId, asOf, sqlBatchSize, lock!, pacer,
            ));
            const players = changed === null ? new Map<string, FullPlayerState>() : previousState!.players;
            for (const uuid of changed ?? []) players.delete(uuid);
            for (const [uuid, summary] of paceSummaries.summaries) players.set(uuid, {p: summary});
            for (const [uuid, summary] of nphSummaries.summaries) {
                const player = players.get(uuid);
                if (player) player.n = summary;
                else players.set(uuid, {n: summary});
            }
            fullState = {
                meta: {
                    version: FULL_STATE_VERSION,
                    asOf: asOf.toISOString(),
                    maximumPaceId,
                    maximumNetherId,
                    rebuiltAt: changed === null ? asOf.toISOString() : previousState!.meta.rebuiltAt,
                },
                players,
            };
            fullStateRebuilt = changed === null;
            fullStateChanged = changed ?? [];
            console.log(changed === null
                ? `Rebuilt all-time summaries from every row.`
                : `Recomputed all-time summaries for ${changed.length} changed players.`);

            const pace = {
                leaderboards: finalizePaceSummaries(orderedByFirstId(players, (state) => state.p, (p) => p.firstId), 9999),
                rowCount: paceSummaries.rowCount,
            };
            applyCachedNames(pace.leaderboards.full, paceCategories, users, pace.leaderboards.fastest);
            await stageDynamic(calculatePlayerStats(users, pace.leaderboards.full, 9999));
            const fixed: Array<[string, unknown]> = [
                ["topLeaderboards:9999day", pace.leaderboards.top],
                ["leaderboards:9999day", pace.leaderboards.full],
                ["fastestLeaderboards:9999day", pace.leaderboards.fastest],
            ];
            stagedFixed.push(...await stageJsonEntries(redis, fixed, generation, fixed.length, stagingTtlSeconds));
            periodCounts.set(9999, {pace: pace.rowCount, aa: 0, nethers: 0});

            await pacingPause(pacer);
            const aa = await measure("aa", () => buildFullAaCache(conn!, asOf, sqlBatchSize, lock!, pacer));
            applyCachedNames(aa.leaderboards, aaCategories, users);
            stagedFixed.push(...await stageJsonEntries(
                redis, [["aa:leaderboards:9999day", aa.leaderboards]], generation, 1, stagingTtlSeconds,
            ));
            periodCounts.get(9999)!.aa = aa.rowCount;

            const nphEntries = finalizeNphSummaries(
                orderedByFirstId(players, (state) => state.n, () => 0), 9999, asOfMs,
            );
            await stageDynamic(nphEntries);
            periodCounts.get(9999)!.nethers = nphEntries.length;
        } else {
            const paceStartedAt = Date.now();
            const paceRows = await fetchPaceRows(conn, cutoff, asOf);
            const pacePeriods = await accumulatePacePeriods(paceRows, days, asOfMs, pacer);
            const periodRowCounts = new Map(days.map((day) => [day, 0]));
            for (const row of paceRows) {
                const ageMs = asOfMs - row.insertTime.getTime();
                for (const day of days) {
                    if (day === 9999 || ageMs <= day * 86_400_000) periodRowCounts.set(day, periodRowCounts.get(day)! + 1);
                }
            }
            for (const day of days) {
                lock.assertHeld();
                const leaderboards = finalizePacePlayers(pacePeriods.get(day)!, day);
                pacePeriods.delete(day);
                await stageDynamic(calculatePlayerStats(users, leaderboards.full, day));
                const fixed: Array<[string, unknown]> = [
                    [`topLeaderboards:${day}day`, leaderboards.top],
                    [`leaderboards:${day}day`, leaderboards.full],
                    [`fastestLeaderboards:${day}day`, leaderboards.fastest],
                ];
                stagedFixed.push(...await stageJsonEntries(redis, fixed, generation, fixed.length, stagingTtlSeconds));
                periodCounts.set(day, {pace: periodRowCounts.get(day)!, aa: 0, nethers: 0});
                await pacingPause(pacer);
            }
            paceRows.length = 0;
            phaseTimingsMs.pace = Date.now() - paceStartedAt;
            sampleMemory();

            const aaStartedAt = Date.now();
            const aaRows = await fetchAaRows(conn, cutoff, asOf);
            const aaPeriods = partitionRowsByDays(aaRows, days, asOfMs);
            for (const day of days) {
                const periodRows = aaPeriods.get(day)!;
                stagedFixed.push(...await stageJsonEntries(
                    redis, [[`aa:leaderboards:${day}day`, await calculateAaLeaderboards(periodRows, pacer)]], generation, 1, stagingTtlSeconds,
                ));
                periodCounts.get(day)!.aa = periodRows.length;
                await pacingPause(pacer);
            }
            aaRows.length = 0;
            phaseTimingsMs.aa = Date.now() - aaStartedAt;
            sampleMemory();

            const nphStartedAt = Date.now();
            const netherRows = await fetchNetherRows(conn, cutoff, asOf);
            const netherPeriods = await accumulateNphPeriods(netherRows, days, asOfMs, pacer);
            for (const day of days) {
                const periodEntries = finalizeNph(netherPeriods.get(day)!, day, asOfMs);
                netherPeriods.delete(day);
                await stageDynamic(periodEntries);
                periodCounts.get(day)!.nethers = periodEntries.length;
                await pacingPause(pacer);
            }
            netherRows.length = 0;
            phaseTimingsMs.nph = Date.now() - nphStartedAt;
            sampleMemory();
        }

        for (const day of days) {
            const counts = periodCounts.get(day)!;
            console.log(
                `Calculated ${day}-day caches from ${counts.pace} pace rows, ${counts.aa} AA rows, `
                + `and data for ${counts.nethers} NPH players.`,
            );
        }

        lock.assertHeld();
        await pacingPause(pacer);
        const publishStartedAt = Date.now();
        const dynamicManifestKey = `cache:manifest:${scope}:dynamic`;
        const dynamicManifestWasPresent = await redis.exists(dynamicManifestKey) === 1;

        // Publish each period as a compact compatibility group. Dynamic keys are
        // renamed in bounded transactions; the small fixed board set for that
        // period is then switched in one atomic transaction.
        await forgetChangedDigests(redis, digestLedger, lock);
        const userDynamic = stagedDynamic.filter(({ target }) => target.startsWith("users:twitch_details:"));
        const userFixed = stagedFixed.filter(({ target }) => target === "users");
        lock.assertHeld();
        await publishStagedEntries(
            redis, userDynamic, publishBatchSize, targetTtlSeconds, lock, dynamicManifestKey,
        );
        await publishStagedEntries(redis, userFixed, Math.max(1, userFixed.length), 0, lock);
        lock.assertHeld();

        for (const day of days) {
            const suffix = `:${day}day`;
            const periodDynamic = stagedDynamic.filter(({ target }) => target.endsWith(suffix));
            const periodFixed = stagedFixed.filter(({ target }) => target.endsWith(`${day}day`));
            await publishStagedEntries(
                redis, periodDynamic, publishBatchSize, targetTtlSeconds, lock, dynamicManifestKey,
            );
            lock.assertHeld();
            await publishStagedEntries(redis, periodFixed, Math.max(1, periodFixed.length), 0, lock);
            lock.assertHeld();
            await setHashIfLeaseHeld(redis, `cache:metadata:${scope}:${day}day`, {
                generation,
                asOf: asOf.toISOString(),
                publishedAt: new Date().toISOString(),
                dynamicKeyCount: String(
                    periodDynamic.length + retainedDynamic.filter((target) => target.endsWith(suffix)).length,
                ),
                changedDynamicKeyCount: String(periodDynamic.length),
                fixedKeyCount: String(periodFixed.length),
            }, lock);
        }

        const dynamicTargets = [
            ...stagedDynamic.map(({target}) => target),
            ...retainedDynamic,
            ...retainedIdentityTargets,
        ];
        const legacyStaleDeleted = dynamicManifestWasPresent
            ? 0
            : await removeLegacyStaleDynamicKeys(redis, scope, dynamicTargets, batchSize, lock);
        const staleDeleted = legacyStaleDeleted + await replaceManifest(
            redis,
            dynamicManifestKey,
            dynamicTargets,
            batchSize,
            lock,
            [],
            manifestBatchSize,
        );
        await writeDigestLedger(redis, digestLedger, dynamicTargets, lock);
        if (fullState) {
            await writeFullState(
                redis, fullState, fullStateRebuilt, fullStateChanged, generation, batchSize, stagingTtlSeconds, lock,
            );
            await acknowledgeOutboxClaims(conn, aggregateClaims, Math.min(sqlBatchSize, 500));
        }
        phaseTimingsMs.publish = Date.now() - publishStartedAt;
        sampleMemory();
        lock.assertHeld();
        await setHashIfLeaseHeld(redis, `cache:metadata:${scope}`, {
            generation,
            asOf: asOf.toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: String(Date.now() - startedAt),
            fixedKeyCount: String(stagedFixed.length),
            dynamicKeyCount: String(dynamicTargets.length),
            changedDynamicKeyCount: String(stagedDynamic.length),
            staleKeysDeleted: String(staleDeleted),
            peakRssBytes: String(peakRssBytes),
            phaseTimingsMs: JSON.stringify(phaseTimingsMs),
        }, lock);
        lock.assertHeld();
        await setStringIfLeaseHeld(redis, `cache:generation:${scope}`, generation, lock);
        if (!full) {
            await setHashIfLeaseHeld(redis, "cache:identity:state", {
                generation,
                asOf: asOf.toISOString(),
                completedAt: new Date().toISOString(),
                fullCompletedAt: identityFullCompletedAt,
                maximumPaceId: String(identityMaximumPaceId),
                userCount: String(users.length),
                refreshMode: identityFullRefreshed ? "full" : identityRefreshed ? "incremental" : "unchanged",
            }, lock);
            await acknowledgeOutboxClaims(conn, identityClaims, Math.min(sqlBatchSize, 500));
        }
        console.log(
            `Published generation ${generation} (${stagedFixed.length} fixed, ${stagedDynamic.length} changed and `
            + `${retainedDynamic.length} unchanged dynamic, `
            + `${staleDeleted} stale removed) in ${Date.now() - startedAt}ms.`,
        );
    } finally {
        if (lock) await lock.release();
        if (conn) {
            try { await conn.end(); } catch (error) { console.error("Failed to close MySQL connection:", error); }
        }
        try { await redis.quit(); } catch { redis.disconnect(); }
    }
}

main().catch((error) => {
    if (error instanceof LockUnavailableError) {
        console.log(error.message);
        return;
    }
    console.error("Cache refresh failed:", error);
    process.exitCode = 1;
});
