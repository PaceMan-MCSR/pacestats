import {NextRequest} from "next/server";
import {fetchFastestLeaderboardCategoryFromRedis, getCached} from "@/app/data";
import {jsonResponse} from "@/app/api/_utils";

export async function GET(request: NextRequest) {
    let days = parseInt(request.nextUrl.searchParams.get("days") || "30")
    if (isNaN(days)) {
        days = 30
    }
    let category = request.nextUrl.searchParams.get("category") || "nether"
    let limit = Math.min(999999, parseInt(request.nextUrl.searchParams.get("limit") || "10"))
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
}
