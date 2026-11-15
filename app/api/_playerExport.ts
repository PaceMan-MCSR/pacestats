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
};

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
        }, {headers});
    }, {limit: 6, concurrent: 2});
}
