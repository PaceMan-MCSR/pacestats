import {NextRequest, NextResponse} from "next/server";
import {getCached, getLeaderboards} from "@/app/data";
import {CategoryType, getMinQty} from "@/app/utils";
import {Entry} from "@/app/types";

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
    const data = (await getCached(getLeaderboards, "getLeaderboards", days + " day"))
    let specific;
    if(type === "conversion"){
        specific = data[CategoryType.CONVERSION][category]
        specific = specific.filter((x: Entry) => x.qty >= getMinQty(category, days))
    } else if (type === "average"){
        specific = data[CategoryType.AVG][category]
        specific = specific.filter((x: Entry) => x.qty >= getMinQty(category, days))
    } else if (type === "fastest"){
        specific = data[CategoryType.FASTEST][category]
    } else {
        specific = data[CategoryType.COUNT][category]
    }
    return NextResponse.json(specific.slice(0, limit), { status: 200 });
}