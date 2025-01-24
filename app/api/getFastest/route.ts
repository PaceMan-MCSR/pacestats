import {NextRequest, NextResponse} from "next/server";
import {getCached, getFastestLeaderboards} from "@/app/data";
import {CategoryType} from "@/app/utils";

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
    const data = (await getCached(getFastestLeaderboards, "getFastestLeaderboards", days + " day"))
    return NextResponse.json(data[category].slice(0, limit), { status: 200 });
}