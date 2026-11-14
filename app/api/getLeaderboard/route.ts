import {NextRequest} from "next/server";
import {fetchLeaderboardCategoryFromRedis, getCached} from "@/app/data";
import {CategoryType, getMinQty} from "@/app/utils";
import {integerParam, jsonResponse, stringParam, withApiRequest} from "@/app/api/_utils";

export const GET = withApiRequest("getLeaderboard", async (request: NextRequest) => {
    let days = integerParam(request.nextUrl.searchParams, "days", {defaultValue: 30, min: 1, max: 9_999});
    const category = stringParam(request.nextUrl.searchParams, "category", {defaultValue: "nether", allowed: [
        "nether", "bastion", "fortress", "first_structure", "second_structure", "first_portal", "second_portal", "stronghold", "end", "finish",
    ]});
    const type = stringParam(request.nextUrl.searchParams, "type", {defaultValue: "qty", allowed: ["qty", "average", "fastest", "conversion"]});
    const limit = integerParam(request.nextUrl.searchParams, "limit", {defaultValue: 10, min: 1, max: 999_999});
    // average/fastest/conversion
    // don't let users specify custom ranges at this stage, to avoid lb cache misses
    if (days !== 1 && days !== 7 && days !== 30 && days !== 9999) {
        days = 30
    }
    let filter = CategoryType.COUNT;
    let minimumQty = 0;
    if(type === "conversion"){
        filter = CategoryType.CONVERSION;
        minimumQty = getMinQty(category, days);
    } else if (type === "average"){
        filter = CategoryType.AVG;
        minimumQty = getMinQty(category, days);
    } else if (type === "fastest"){
        filter = CategoryType.FASTEST;
    }
    const specific = await getCached(
        fetchLeaderboardCategoryFromRedis,
        "fetchLeaderboardCategoryFromRedis",
        days,
        category,
        filter,
        limit,
        minimumQty
    );
    return jsonResponse(specific, {cacheSeconds: 60, staleSeconds: 120});
}, {concurrent: 4});
