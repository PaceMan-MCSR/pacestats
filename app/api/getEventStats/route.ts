import {NextRequest} from "next/server";
import {ApiInputError, jsonResponse, stringParam, withApiRequest} from "@/app/api/_utils";
import {getCached} from "@/app/data";
import {EventStatsError, getEventStats} from "@/app/eventStats.server";

export const GET = withApiRequest("eventStats", async (request: NextRequest) => {
    const params = request.nextUrl.searchParams;
    const vanity = stringParam(params, "vanity", {required: true});
    if (params.getAll("vanity").length !== 1) throw new ApiInputError("Provide exactly one vanity.");

    try {
        const {data, expiresAt}: Awaited<ReturnType<typeof getEventStats>> =
            await getCached(getEventStats, "getEventStats", vanity);
        const cacheSeconds = Math.max(0, Math.floor((expiresAt - Date.now()) / 1_000));
        return jsonResponse(data, {cacheSeconds, staleSeconds: 0});
    } catch (error) {
        if (error instanceof EventStatsError) return jsonResponse({error: error.message}, {status: error.status});
        throw error;
    }
}, {limit: 30, concurrent: 2});
