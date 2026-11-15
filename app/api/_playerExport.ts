import {NextRequest, NextResponse} from "next/server";
import {jsonResponse, withApiRequest} from "@/app/api/_utils";
import {getAllNamesByNick, getAllNamesByTwitch, getCached} from "@/app/data";
import {dailyExportColumns, exportCsv, parseExportPlayer, parsePlayerExportParams, recordExportColumns, statsDailyExportColumns, statsRecordExportColumns, type ExportCursor} from "@/app/playerExport";
import {getExportPlayerByUuid, getResetDailyExport, getResetRecordExportPage, getStatsDailyExport, getStatsRecordExportPage} from "@/app/playerExport.server";

type ExportKind = "stats" | "resetStats";
type ExportConfig = {
    endpoint: string;
    daily: (uuid: string, from: number, to: number) => Promise<{rows: object[]; summary: object}>;
    dailyCacheKey: string;
    records: (uuid: string, from: number, to: number, cursor: ExportCursor | null, limit: number) => Promise<{rows: object[]; hasMore: boolean; nextCursor: string | null}>;
    recordsCacheKey: string;
    dailyColumns: readonly string[];
    recordColumns: readonly string[];
    notes?: readonly string[];
};

const sharedNotes = [
    "Dates use UTC. The from date is inclusive and the to date is exclusive.",
    "Daily rows include only dates with stored records. Historical exports are not restricted to a 90-day window.",
    "Records are paginated from oldest to newest by timestamp and ID. Durations and splits are in milliseconds; timestamps use ISO 8601 UTC.",
];

const configurations: Record<ExportKind, ExportConfig> = {
    stats: {
        endpoint: "exportStats",
        daily: getStatsDailyExport,
        dailyCacheKey: "getStatsDailyExport",
        records: getStatsRecordExportPage,
        recordsCacheKey: "getStatsRecordExportPage",
        dailyColumns: statsDailyExportColumns,
        recordColumns: statsRecordExportColumns,
    },
    resetStats: {
        endpoint: "exportResetStats",
        daily: getResetDailyExport,
        dailyCacheKey: "getResetDailyExport",
        records: getResetRecordExportPage,
        recordsCacheKey: "getResetRecordExportPage",
        dailyColumns: dailyExportColumns,
        recordColumns: recordExportColumns,
        notes: [
            ...sharedNotes,
            "Only submitted reset stats records are available; missing days do not establish that no games were played.",
            "Dates and daily groups use the reset stats record submission time.",
            "Reported play and wall time cover intervals since the previous nether entry, so an interval can cross a daily or selected date boundary.",
            "netherEnters counts submitted records; previewsPlayed is separate. resetRecords reports how many records include reset data; unavailable reset data is not zero.",
            "Daily totals and the summary sum the available resets; resets is null when none are available, and resetsPerEnter is null unless every submitted record has a reset count. Raw negative reset counters indicate unavailable historical values and are preserved.",
            "RNPH = netherEnters * 3600000 / (wallTimeMs + playTimeMs); LNPH = netherEnters * 3600000 / playTimeMs. Rates are null when their denominator is zero.",
            "totalResets is a lifetime counter at the time of a submission and must not be summed across records.",
            "accurateRecords counts submissions marked isAccurate; all submitted records are included in the totals, regardless of that flag.",
            "In records mode, netherTimeMs is the pace run's in-game nether-entry time; trackerNetherTimeMs is the separate, possibly unavailable submitted nether time.",
        ],
    },
};

/** Keep validation, identity resolution, formats and pagination consistent. */
export function createPlayerExportHandler(kind: ExportKind) {
    const config = configurations[kind];
    return withApiRequest(config.endpoint, async (request: NextRequest) => {
        const params = request.nextUrl.searchParams;
        const selector = parseExportPlayer(params);
        // Validate the entire export request before performing identity/database reads.
        const options = parsePlayerExportParams(params);
        let player;
        if (selector.uuid !== null) {
            player = await getCached(getExportPlayerByUuid, "getExportPlayerByUuid", selector.uuid);
        } else {
            player = await getCached(getAllNamesByNick, "getAllNamesByNick", selector.name);
            if (player === null) player = await getCached(getAllNamesByTwitch, "getAllNamesByTwitch", selector.name);
        }
        if (player === null) return jsonResponse({error: "Unknown user"}, {status: 404});

        const result = options.mode === "daily"
            ? await getCached(config.daily, config.dailyCacheKey, player.uuid, options.from, options.to)
            : await getCached(config.records, config.recordsCacheKey, player.uuid, options.from, options.to, options.cursor, options.limit);
        const headers = new Headers({
            "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=120",
        });
        if (kind === "resetStats") {
            const safeUuid = String(player.uuid).replace(/[^a-zA-Z0-9-]/g, "");
            const filename = `paceman-${kind}-${safeUuid}-${options.fromDate}-${options.toDate}-${options.mode}.${options.format}`;
            headers.set("Content-Disposition", `attachment; filename="${filename}"`);
        }
        if (options.mode === "records") {
            headers.set("X-Has-More", String(result.hasMore));
            if (result.nextCursor !== null) {
                headers.set("X-Next-Cursor", result.nextCursor);
                const nextUrl = new URL(request.url);
                nextUrl.searchParams.set("from", options.fromDate);
                nextUrl.searchParams.set("to", options.toDate);
                nextUrl.searchParams.set("cursor", result.nextCursor);
                headers.set("Link", `<${nextUrl.toString()}>; rel="next"`);
            }
        }
        if (options.format === "csv") {
            headers.set("Content-Type", "text/csv; charset=utf-8");
            return new Response(exportCsv(result.rows, options.mode === "daily" ? config.dailyColumns : config.recordColumns), {headers});
        }
        return NextResponse.json({
            dataset: kind,
            player: {name: player.nick, uuid: player.uuid},
            range: {from: options.fromDate, to: options.toDate, timezone: "UTC", toExclusive: true},
            mode: options.mode,
            ...result,
            ...(options.mode === "records" ? {limit: options.limit} : {}),
            ...(config.notes ? {notes: config.notes} : {}),
        }, {headers});
    }, {limit: 6, concurrent: 2});
}
