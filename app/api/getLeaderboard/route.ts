import {NextRequest} from "next/server";
import {fetchLeaderboardCategoryFromRedis, getCached} from "@/app/data";
import {CategoryType, getMinQty} from "@/app/utils";
import {jsonResponse} from "@/app/api/_utils";

export async function GET(request: NextRequest) {
    let days = parseInt(request.nextUrl.searchParams.get("days") || "30")
    if (isNaN(days)) {
        days = 30
    }
    let category = request.nextUrl.searchParams.get("category") || "nether"
    let type = request.nextUrl.searchParams.get("type") || "qty"
    let limit = Math.min(999999, parseInt(request.nextUrl.searchParams.get("limit") || "10"))
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
}
