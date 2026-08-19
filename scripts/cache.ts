import { randomUUID } from "node:crypto";
import mysql, { type Connection } from "mysql2/promise";
import Redis from "ioredis";
import dotenv from "dotenv";
import { type FastestEntry } from "@/app/types";
import {
    acquireRedisLock,
    deleteKeysIfLeaseHeld,
    envInt,
    LockUnavailableError,
    publishStagedEntries,
    replaceManifest,
    scanKeys,
    setHashIfLeaseHeld,
    setStringIfLeaseHeld,
    stageJsonEntries,
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

function calculateAvgInPlace(data: number[]): number {
    if (!data || data.length === 0) return 0;
    data.sort((a, b) => a - b);
    const p98 = data.length >= 50 ? Math.floor(data.length * 0.98) : data.length;
    let sum = 0;
    for (let index = 0; index < p98; index++) sum += data[index];
    return sum / p98 || 0;
}

export function calculateAvg(data: number[]): number {
    return calculateAvgInPlace([...data]);
}

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

function partitionNetherRowsByDays(
    rows: NetherPaceRow[],
    days: readonly number[],
    asOfMs: number,
): Map<number, NetherPaceRow[]> {
    const partitions = new Map(days.map((day) => [day, [] as NetherPaceRow[]]));
    const asOfSeconds = asOfMs / 1_000;
    for (const row of rows) {
        const ageSeconds = asOfSeconds - row.time;
        for (const day of days) {
            if (day === 9999 || ageSeconds <= day * 86_400) partitions.get(day)!.push(row);
        }
    }
    return partitions;
}

type PaceMinimum = {time: number; id: number; insertTime: Date};
type PacePlayerAccumulator = {
    name: string;
    splits: Record<string, number[]>;
    minima: Record<string, PaceMinimum | undefined>;
};

function accumulatePaceRow(players: Map<string, PacePlayerAccumulator>, row: PaceRow): void {
    let player = players.get(row.uuid);
    if (!player) {
        player = {
            name: row.nickname,
            splits: Object.fromEntries(paceCategories.map((category) => [category, []])) as Record<string, number[]>,
            minima: {},
        };
        players.set(row.uuid, player);
    }
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

function finalizePacePlayers(players: Map<string, PacePlayerAccumulator>, days: number): {
    full: Leaderboards;
    top: Leaderboards;
    fastest: { [category: string]: FastestEntry[] };
} {
    const leaderboards = initLeaderboards(paceCategories);
    for (const [uuid, player] of players) {
        for (const category of paceCategories) {
            const values = player.splits[category];
            if (values.length === 0) continue;
            const qty = values.length;
            const avg = calculateAvgInPlace(values);
            const fastest = values[0];
            const previous = getPreviousSplit(category);
            const conversion = previous === null
                ? 0
                : player.splits[previous].length === 0
                    ? 1
                    : (qty / player.splits[previous].length) * 100;
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
            if (!minimum || minimum.time <= 0) continue;
            fastest[category].push({
                uuid,
                name: player.name,
                value: minimum.time,
                runId: minimum.id,
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

async function calculateLeaderboards(rows: PaceRow[], days: number, pacer?: CachePacer): Promise<{
    full: Leaderboards;
    top: Leaderboards;
    fastest: { [category: string]: FastestEntry[] };
}> {
    const players = new Map<string, PacePlayerAccumulator>();
    for (let index = 0; index < rows.length; index++) {
        accumulatePaceRow(players, rows[index]);
        if (pacer && (index + 1) % pacer.rowBatchSize === 0) await pacingPause(pacer);
    }
    return finalizePacePlayers(players, days);
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
            const qty = values.length;
            const avg = calculateAvgInPlace(values);
            const fastest = values[0];
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

function finalizeNph(grouped: Map<string, NphAccumulator>, days: number, asOfMs: number): Array<[string, unknown]> {
    const output: Array<[string, unknown]> = [];
    for (const [uuid, player] of grouped) {
        const nethers = player.times.length;
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
            avg: calculateAvgInPlace(player.times),
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

async function calculateNph(
    rows: NetherPaceRow[],
    days: number,
    asOfMs: number,
    pacer?: CachePacer,
): Promise<Array<[string, unknown]>> {
    const cutoffSeconds = days === 9999 ? Number.NEGATIVE_INFINITY : asOfMs / 1000 - days * 86_400;
    const grouped = new Map<string, NphAccumulator>();
    for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        if (row.time >= cutoffSeconds) accumulateNphRow(grouped, row);
        if (pacer && (index + 1) % pacer.rowBatchSize === 0) await pacingPause(pacer);
    }
    return finalizeNph(grouped, days, asOfMs);
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

async function acknowledgeIdentityOutboxClaims(
    conn: Connection,
    claims: IdentityOutboxClaim[],
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
    claims: IdentityOutboxClaim[],
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

async function buildFullPaceCaches(
    conn: Connection,
    asOf: Date,
    sqlBatchSize: number,
    lease: RedisLease,
    pacer: CachePacer,
): Promise<{
    leaderboards: {full: Leaderboards; top: Leaderboards; fastest: {[category: string]: FastestEntry[]}};
    rowCount: number;
}> {
    const players = new Map<string, PacePlayerAccumulator>();
    const [maximumRows] = await conn.query("SELECT COALESCE(MAX(id), 0) AS maximumId FROM pace") as any;
    const maximumId = Number(maximumRows[0].maximumId);
    let lastId = 0;
    let rowCount = 0;
    while (true) {
        await lease.verifyHeld();
        const [rawRows] = await conn.execute(
            `SELECT id, nickname, uuid, nether, bastion, fortress, first_portal, second_portal,
                stronghold, end, finish, obtainRod, insertTime
             FROM pace
             WHERE id > ? AND id <= ? AND insertTime <= ?
             ORDER BY id ASC
             LIMIT ${sqlBatchSize};`,
            [lastId, maximumId, asOf],
        );
        const rows = rawRows as PaceRow[];
        if (rows.length === 0) break;
        for (let index = 0; index < rows.length; index++) {
            accumulatePaceRow(players, rows[index]);
            rowCount++;
            if ((index + 1) % pacer.rowBatchSize === 0) await pacingPause(pacer);
        }
        const last = rows[rows.length - 1];
        lastId = last.id;
        if (rows.length < sqlBatchSize) break;
        await pacingPause(pacer);
    }
    return {leaderboards: finalizePacePlayers(players, 9999), rowCount};
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

async function buildFullNphCache(
    conn: Connection,
    asOf: Date,
    asOfMs: number,
    sqlBatchSize: number,
    lease: RedisLease,
    pacer: CachePacer,
): Promise<{entries: Array<[string, unknown]>; rowCount: number; playerCount: number}> {
    const grouped = new Map<string, NphAccumulator>();
    const [maximumRows] = await conn.query("SELECT COALESCE(MAX(id), 0) AS maximumId FROM nethers") as any;
    const maximumId = Number(maximumRows[0].maximumId);
    let lastId = 0;
    let rowCount = 0;
    while (true) {
        await lease.verifyHeld();
        const [rawRows] = await conn.execute(
            `SELECT nethers.id, nethers.uuid, pace.nether AS nether, wallTime, playTime, enters,
                UNIX_TIMESTAMP(nethers.insertTime) AS time, resets, totalResets
             FROM nethers INNER JOIN pace ON nethers.runId = pace.id
             WHERE nethers.id > ? AND nethers.id <= ? AND nethers.insertTime <= ?
             ORDER BY nethers.id ASC LIMIT ${sqlBatchSize};`,
            [lastId, maximumId, asOf],
        );
        const rows = rawRows as NetherPaceRow[];
        if (rows.length === 0) break;
        for (let index = 0; index < rows.length; index++) {
            accumulateNphRow(grouped, rows[index]);
            rowCount++;
            if ((index + 1) % pacer.rowBatchSize === 0) await pacingPause(pacer);
        }
        const last = rows[rows.length - 1];
        lastId = last.id;
        if (rows.length < sqlBatchSize) break;
        await pacingPause(pacer);
    }
    const entries = finalizeNph(grouped, 9999, asOfMs);
    return {entries, rowCount, playerCount: entries.length};
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
                stagedDynamic.push(...await stageJsonEntries(
                    redis, userData.details, generation, batchSize, stagingTtlSeconds,
                ));
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
                    stagedDynamic.push(...await stageJsonEntries(
                        redis, userData.details, generation, batchSize, stagingTtlSeconds,
                    ));
                }
            }
        }
        lock.assertHeld();

        // Normal runs buffer only the bounded 30-day sources. Full runs keyset-page
        // in player order and flush each player into the global output, bounding raw
        // source memory without holding a long MVCC transaction open.
        if (full) {
            const pace = await measure("pace", () => buildFullPaceCaches(conn!, asOf, sqlBatchSize, lock!, pacer));
            applyCachedNames(pace.leaderboards.full, paceCategories, users, pace.leaderboards.fastest);
            stagedDynamic.push(...await stageJsonEntries(
                redis, calculatePlayerStats(users, pace.leaderboards.full, 9999), generation, batchSize, stagingTtlSeconds,
            ));
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

            await pacingPause(pacer);
            const nph = await measure("nph", () => buildFullNphCache(conn!, asOf, asOfMs, sqlBatchSize, lock!, pacer));
            stagedDynamic.push(...await stageJsonEntries(
                redis, nph.entries, generation, batchSize, stagingTtlSeconds,
            ));
            periodCounts.get(9999)!.nethers = nph.playerCount;
        } else {
            const paceStartedAt = Date.now();
            const paceRows = await fetchPaceRows(conn, cutoff, asOf);
            const pacePeriods = partitionRowsByDays(paceRows, days, asOfMs);
            for (const day of days) {
                lock.assertHeld();
                const periodRows = pacePeriods.get(day)!;
                const leaderboards = await calculateLeaderboards(periodRows, day, pacer);
                stagedDynamic.push(...await stageJsonEntries(
                    redis, calculatePlayerStats(users, leaderboards.full, day), generation, batchSize, stagingTtlSeconds,
                ));
                const fixed: Array<[string, unknown]> = [
                    [`topLeaderboards:${day}day`, leaderboards.top],
                    [`leaderboards:${day}day`, leaderboards.full],
                    [`fastestLeaderboards:${day}day`, leaderboards.fastest],
                ];
                stagedFixed.push(...await stageJsonEntries(redis, fixed, generation, fixed.length, stagingTtlSeconds));
                periodCounts.set(day, {pace: periodRows.length, aa: 0, nethers: 0});
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
            const netherPeriods = partitionNetherRowsByDays(netherRows, days, asOfMs);
            for (const day of days) {
                const periodEntries = await calculateNph(netherPeriods.get(day)!, day, asOfMs, pacer);
                stagedDynamic.push(...await stageJsonEntries(redis, periodEntries, generation, batchSize, stagingTtlSeconds));
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
                dynamicKeyCount: String(periodDynamic.length),
                fixedKeyCount: String(periodFixed.length),
            }, lock);
        }

        const dynamicTargets = [...stagedDynamic.map(({target}) => target), ...retainedIdentityTargets];
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
            await acknowledgeIdentityOutboxClaims(conn, identityClaims, Math.min(sqlBatchSize, 500));
        }
        console.log(
            `Published generation ${generation} (${stagedFixed.length} fixed, ${stagedDynamic.length} dynamic, `
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
