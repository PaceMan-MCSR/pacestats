import type {RowDataPacket} from "mysql2";
import {getBans, getCached, getConn} from "./data";
import {buildDailyExport, buildStatsDailyExport, encodeExportCursor, statsSplitColumns,
    type DailyExportInput, type ExportCursor, type ExportRecord, type StatsDailyExportInput, type StatsExportRecord} from "./playerExport";

/** Each UUID spelling probes one index entry, then the latest association wins.
 * Return the stored UUID so exports use exactly the same key as name lookups. */
export async function getExportPlayerByUuid(uuid: string): Promise<{uuid: string; nick: string | null} | null> {
    const compact = uuid.replaceAll("-", "");
    const [rows] = await (await getConn()).execute<(RowDataPacket & {uuid: string; nickname: string | null})[]>(
        `SELECT uuid, nickname FROM (
            (SELECT uuid, nickname, id FROM pace WHERE uuid=? ORDER BY id DESC LIMIT 1)
            UNION ALL
            (SELECT uuid, nickname, id FROM pace WHERE uuid=? ORDER BY id DESC LIMIT 1)
         ) identities ORDER BY id DESC LIMIT 1;`,
        [uuid, compact]
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    const bans = await getCached(getBans, "getBans");
    if (bans.includes(row.uuid)) return null;
    // Match the shared name helpers, including cached/in-flight getNick reads.
    const nick = await getCached(async () => row.nickname, "getNick", row.uuid);
    return {uuid: row.uuid, nick};
}

/** Aggregate inside MySQL so a lifetime export transfers days, not all runs.
 * Epoch-day grouping is UTC even if the SQL session uses another timezone. */
export async function getResetDailyExport(uuid: string, from: number, to: number) {
    const [rows] = await (await getConn()).execute<(DailyExportInput & RowDataPacket)[]>(
        `SELECT FLOOR(UNIX_TIMESTAMP(n.insertTime) / 86400) AS day,
            COUNT(*) AS netherEnters,
            SUM(n.enters) AS previewsPlayed,
            SUM(CASE WHEN n.resets > 0 THEN n.resets ELSE 0 END) AS resets,
            SUM(CASE WHEN n.resets >= 0 THEN 1 ELSE 0 END) AS resetRecords,
            SUM(CASE WHEN n.isAccurate = 1 THEN 1 ELSE 0 END) AS accurateRecords,
            SUM(n.wallTime) AS wallTimeMs, SUM(n.playTime) AS playTimeMs
         FROM nethers n
         WHERE n.uuid=? AND n.insertTime >= FROM_UNIXTIME(?) AND n.insertTime < FROM_UNIXTIME(?)
         GROUP BY day ORDER BY day ASC;`,
        [uuid, from, to]
    );
    return buildDailyExport(rows);
}

type RecordInput = RowDataPacket & Omit<ExportRecord, "timestamp" | "isAccurate"> & {time: number; isAccurate: number};

/** One indexed time/id page plus a sentinel; no OFFSET or lifetime row arrays. */
export async function getResetRecordExportPage(uuid: string, from: number, to: number, cursor: ExportCursor | null, limit: number) {
    const values: (string | number)[] = [uuid, from, to];
    const after = cursor === null ? "" : " AND (n.insertTime > FROM_UNIXTIME(?) OR (n.insertTime = FROM_UNIXTIME(?) AND n.id > ?))";
    if (cursor) values.push(cursor.time, cursor.time, cursor.id);
    // mysql2 LIMIT markers use decimal strings, as in the existing data readers.
    values.push(String(limit + 1));
    const [result] = await (await getConn()).execute<RecordInput[]>(
        `SELECT n.id, n.runId, p.worldId, UNIX_TIMESTAMP(n.insertTime) AS time,
            p.nether AS netherTimeMs, n.netherTime AS trackerNetherTimeMs,
            n.wallTime AS wallTimeMs, n.playTime AS playTimeMs,
            n.enters AS previewsPlayed, n.resets, n.totalResets, n.isAccurate
         FROM nethers n INNER JOIN pace p ON p.id=n.runId
         WHERE n.uuid=? AND n.insertTime >= FROM_UNIXTIME(?) AND n.insertTime < FROM_UNIXTIME(?)${after}
         ORDER BY n.insertTime ASC, n.id ASC LIMIT ?;`,
        values
    );
    const hasMore = result.length > limit;
    const page = result.slice(0, limit);
    const last = page[page.length - 1];
    const rows: ExportRecord[] = page.map(row => ({
        id: Number(row.id), runId: Number(row.runId), worldId: row.worldId,
        timestamp: new Date(Number(row.time) * 1_000).toISOString(),
        netherTimeMs: row.netherTimeMs === null ? null : Number(row.netherTimeMs),
        trackerNetherTimeMs: row.trackerNetherTimeMs === null ? null : Number(row.trackerNetherTimeMs),
        wallTimeMs: Number(row.wallTimeMs), playTimeMs: Number(row.playTimeMs), previewsPlayed: Number(row.previewsPlayed),
        resets: row.resets === null ? null : Number(row.resets),
        totalResets: row.totalResets === null ? null : Number(row.totalResets), isAccurate: Boolean(row.isAccurate),
    }));
    return {rows, hasMore, nextCursor: hasMore && last ? encodeExportCursor({time: Number(last.time), id: Number(last.id)}) : null};
}

/** Main stats include all stored pace runs, even without reset stats data. */
export async function getStatsDailyExport(uuid: string, from: number, to: number) {
    const [rows] = await (await getConn()).execute<(StatsDailyExportInput & RowDataPacket)[]>(
        `SELECT FLOOR(UNIX_TIMESTAMP(p.insertTime) / 86400) AS day,
            COUNT(*) AS runs, COUNT(p.nether) AS netherEnters,
            COUNT(p.bastion) AS bastionEnters, COUNT(p.fortress) AS fortressEnters,
            COUNT(p.first_portal) AS firstPortalEnters, COUNT(p.second_portal) AS secondPortalEnters,
            COUNT(p.stronghold) AS strongholdEnters, COUNT(p.end) AS endEnters, COUNT(p.finish) AS completions,
            MIN(p.nether) AS fastestNetherMs, MIN(p.finish) AS fastestFinishMs
         FROM pace p
         WHERE p.uuid=? AND p.insertTime >= FROM_UNIXTIME(?) AND p.insertTime < FROM_UNIXTIME(?)
         GROUP BY day ORDER BY day ASC;`,
        [uuid, from, to]
    );
    return buildStatsDailyExport(rows);
}

type StatsRecordInput = RowDataPacket & Omit<StatsExportRecord, "timestamp" | "lastUpdated" | "realUpdated"> & {
    time: number;
    updatedTime: number | null;
    realUpdatedTime: number | null;
};

export async function getStatsRecordExportPage(uuid: string, from: number, to: number, cursor: ExportCursor | null, limit: number) {
    const values: (string | number)[] = [uuid, from, to];
    const after = cursor === null ? "" : " AND (p.insertTime > FROM_UNIXTIME(?) OR (p.insertTime = FROM_UNIXTIME(?) AND p.id > ?))";
    if (cursor) values.push(cursor.time, cursor.time, cursor.id);
    values.push(String(limit + 1));
    // Only fixed, application-owned column names are interpolated here.
    const splits = Object.entries(statsSplitColumns).map(([name, column]) => `p.\`${column}\` AS \`${name}\``).join(", ");
    const [result] = await (await getConn()).execute<StatsRecordInput[]>(
        `SELECT p.id, p.worldId, p.nickname, UNIX_TIMESTAMP(p.insertTime) AS time,
            UNIX_TIMESTAMP(p.lastUpdated) AS updatedTime, UNIX_TIMESTAMP(p.realUpdated) AS realUpdatedTime,
            ${splits}
         FROM pace p
         WHERE p.uuid=? AND p.insertTime >= FROM_UNIXTIME(?) AND p.insertTime < FROM_UNIXTIME(?)${after}
         ORDER BY p.insertTime ASC, p.id ASC LIMIT ?;`,
        values
    );
    const hasMore = result.length > limit;
    const page = result.slice(0, limit);
    const last = page[page.length - 1];
    const rows: StatsExportRecord[] = page.map(row => {
        const times = Object.fromEntries(Object.keys(statsSplitColumns).map(name => [name,
            row[name] === null ? null : Number(row[name])])) as Pick<StatsExportRecord, keyof typeof statsSplitColumns>;
        return {id: Number(row.id), worldId: row.worldId, nickname: row.nickname,
            timestamp: new Date(Number(row.time) * 1_000).toISOString(),
            lastUpdated: row.updatedTime === null ? null : new Date(Number(row.updatedTime) * 1_000).toISOString(),
            realUpdated: row.realUpdatedTime === null ? null : new Date(Number(row.realUpdatedTime) * 1_000).toISOString(),
            ...times};
    });
    return {rows, hasMore, nextCursor: hasMore && last ? encodeExportCursor({time: Number(last.time), id: Number(last.id)}) : null};
}
