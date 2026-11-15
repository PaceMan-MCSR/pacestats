/** Server-only projection shared by SSR and the authenticated WS provider.
 * Keep this module out of client components; no browser credential is needed. */
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
import {booleanParam, integerParam, listParam, stringParam} from "@/app/api/_utils";

const MAX_RESPONSE_BYTES = 32 * 1024;
const MAX_ACTIVE_SNAPSHOTS = 4;
// Next.js can load separate copies of a helper in page and route bundles.
// Their authoritative read budget must still be shared within this process.
const runtime = globalThis as typeof globalThis & {__paceStatsActiveOverlaySnapshots?: number};

export class OverlaySnapshotError extends Error {
    constructor(public readonly status: 404 | 429, message: string) {super(message);}
}

export type OverlaySnapshot = {data: any; uuids: string[]};

export async function readOverlaySnapshot(params: URLSearchParams): Promise<OverlaySnapshot> {
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
    if ((runtime.__paceStatsActiveOverlaySnapshots ?? 0) >= MAX_ACTIVE_SNAPSHOTS) {
        throw new OverlaySnapshotError(429, "Snapshot provider is busy");
    }
    runtime.__paceStatsActiveOverlaySnapshots = (runtime.__paceStatsActiveOverlaySnapshots ?? 0) + 1;
    try {
        let uuids: string[];
        if (combined) {
            const resolution = await getCached(resolveCombinedPlayerUuids, "resolveCombinedPlayerUuids", names);
            if (resolution.unknown.length) throw new OverlaySnapshotError(404, `Unknown user: ${resolution.unknown[0]}`);
            uuids = resolution.uuids;
        } else {
            const identity = await getCached(getAllNamesByNick, "getAllNamesByNick", names[0])
                ?? await getCached(getAllNamesByTwitch, "getAllNamesByTwitch", names[0]);
            if (!identity) throw new OverlaySnapshotError(404, "Unknown user");
            uuids = [identity.uuid];
        }
        // Public API caches remain unchanged. SSR and WS use the same fresh
        // helper values and bounds without requesting the public HTTP API.
        let data: unknown;
        if (kind === "session") data = await getSessionStats(uuids[0], hours, hoursBetween, {fresh: true});
        else if (kind === "nethers") data = await getSessionNethers(uuids[0], hours, hoursBetween, liveOnly, dp, {fresh: true, includeNph});
        else if (kind === "combinedStats") data = formatCombinedSplitResponse(await getCombinedSplitAggregates(uuids, hours, hoursBetween, start));
        else data = formatCombinedNetherResponse(await getCombinedNetherAggregate(uuids, hours, hoursBetween, start, maxTime));
        const snapshot = {data, uuids};
        if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > MAX_RESPONSE_BYTES) {
            throw new Error("OBS snapshot exceeds response limit");
        }
        return snapshot;
    } finally {
        runtime.__paceStatsActiveOverlaySnapshots = Math.max(0, (runtime.__paceStatsActiveOverlaySnapshots ?? 1) - 1);
    }
}
