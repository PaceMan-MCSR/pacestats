import {NextRequest} from "next/server";
import {fetchFastestLeaderboardCategoryFromRedis, getCached} from "@/app/data";
import {integerParam, jsonResponse, stringParam, withApiRequest} from "@/app/api/_utils";

export const GET = withApiRequest("getFastest", async (request: NextRequest) => {
    let days = integerParam(request.nextUrl.searchParams, "days", {defaultValue: 30, min: 1, max: 9_999});
    const category = stringParam(request.nextUrl.searchParams, "category", {defaultValue: "nether", allowed: [
        "nether", "bastion", "fortress", "first_structure", "second_structure", "first_portal", "second_portal", "stronghold", "end", "finish",
    ]});
    const limit = integerParam(request.nextUrl.searchParams, "limit", {defaultValue: 10, min: 1, max: 999_999});
    // don't let users specify custom ranges at this stage, to avoid lb cache misses
    if (days !== 1 && days !== 7 && days !== 30 && days !== 9999) {
        days = 30
    }
    const data = await getCached(
        fetchFastestLeaderboardCategoryFromRedis,
        "fetchFastestLeaderboardCategoryFromRedis",
        days,
        category,
        limit
    );
    return jsonResponse(data, {cacheSeconds: 60, staleSeconds: 120});
}, {concurrent: 4});
