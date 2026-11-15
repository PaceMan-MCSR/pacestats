import {NextRequest, NextResponse} from "next/server";
import {
    formatCombinedNetherResponse,
    formatCombinedSplitResponse,
    getAllNamesByNick,
    getAllNamesByTwitch,
    getCached,
    getCombinedNetherAggregate,
    getCombinedSplitAggregates,
    getSessionNethers,
    getSessionStats,
    resolveCombinedPlayerUuids,
} from "@/app/data";
import {
    ApiInputError,
    booleanParam,
    hasValidApiKey,
    integerParam,
    listParam,
    stringParam,
    validationErrorResponse,
} from "@/app/api/_utils";

const MAX_RESPONSE_BYTES = 32 * 1024;
const MAX_ACTIVE_SNAPSHOTS = 4;
let activeSnapshots = 0;
const noStore = {"Cache-Control": "private, no-store"};

const failure = (error: string, status: number, retry = false) => NextResponse.json({error}, {
    status,
    headers: retry ? {...noStore, "Retry-After": "1"} : noStore,
});

/** Internal WS broker projection. Browser clients never receive its credential. */
export async function GET(request: NextRequest) {
    // Authenticate before allocating rate-limit buckets or checking out SQL.
    if (!hasValidApiKey(request, process.env.WS_TOKEN)) return failure("Unauthorized", 401);
    try {
        const params = request.nextUrl.searchParams;
        const kind = stringParam(params, "kind", {
            required: true, allowed: ["session", "nethers", "combinedStats", "combinedNethers"],
        });
        const combined = kind === "combinedStats" || kind === "combinedNethers";
        const hours = Math.min(9_999 * 24, integerParam(params, "hours", {defaultValue: 24, min: 1, max: 9_999_999}));
        const hoursBetween = integerParam(params, "hoursBetween", {defaultValue: 6, min: combined ? 1 : 0, max: 9_999_999});
        const names = combined
            ? listParam(params, "names", 20, 64)
            : [stringParam(params, "name", {required: true, maxLength: 64})];
        const liveOnly = kind === "nethers" ? booleanParam(params, "liveOnly") : false;
        const includeNph = kind === "nethers" ? booleanParam(params, "nph", true) : false;
        const dp = kind === "nethers" ? integerParam(params, "dp", {defaultValue: 0, min: 0, max: 3}) : 0;
        const start = combined ? integerParam(params, "start", {defaultValue: 0, min: 0, max: Number.MAX_SAFE_INTEGER}) : 0;
        const maxTime = kind === "combinedNethers"
            ? integerParam(params, "maxTime", {defaultValue: 99_999_999, min: 1, max: 99_999_999}) : 99_999_999;
        if (activeSnapshots >= MAX_ACTIVE_SNAPSHOTS) return failure("Snapshot provider is busy", 429, true);
        activeSnapshots++;
        try {
            let uuids: string[];
            if (combined) {
                const resolution = await getCached(resolveCombinedPlayerUuids, "resolveCombinedPlayerUuids", names);
                if (resolution.unknown.length) return failure(`Unknown user: ${resolution.unknown[0]}`, 404);
                uuids = resolution.uuids;
            } else {
                const identity = await getCached(getAllNamesByNick, "getAllNamesByNick", names[0])
                    ?? await getCached(getAllNamesByTwitch, "getAllNamesByTwitch", names[0]);
                if (!identity) return failure("Unknown user", 404);
                uuids = [identity.uuid];
            }
            // Call the authoritative helpers directly. Public response caches
            // deliberately remain unchanged for existing API consumers.
            let data: unknown;
            if (kind === "session") data = await getSessionStats(uuids[0], hours, hoursBetween, {fresh: true});
            else if (kind === "nethers") data = await getSessionNethers(uuids[0], hours, hoursBetween, liveOnly, dp, {fresh: true, includeNph});
            else if (kind === "combinedStats") data = formatCombinedSplitResponse(await getCombinedSplitAggregates(uuids, hours, hoursBetween, start));
            else data = formatCombinedNetherResponse(await getCombinedNetherAggregate(uuids, hours, hoursBetween, start, maxTime));
            const body = JSON.stringify({data, uuids});
            if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) throw new Error("OBS snapshot exceeds response limit");
            return new NextResponse(body, {headers: {...noStore, "Content-Type": "application/json"}});
        } finally {activeSnapshots--;}
    } catch (error) {
        if (error instanceof ApiInputError) return validationErrorResponse(error)!;
        console.error("Unable to read OBS snapshot:", error);
        return failure("Overlay data is temporarily unavailable", 503, true);
    }
}
