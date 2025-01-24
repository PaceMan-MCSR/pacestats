import {NextRequest, NextResponse} from "next/server";
import { getAllAAData, getCached } from "@/app/data";

export async function GET(request: NextRequest) {
    let days = parseInt(request.nextUrl.searchParams.get("days") || "30")
    if (isNaN(days)) {
        days = 30
    }
    // don't let users specify custom ranges at this stage, to avoid lb cache misses
    if (days !== 1 && days !== 7 && days !== 30 && days !== 9999) {
        days = 30
    }
    const data = await getCached(getAllAAData, "getAllAAData", days + " day", "average")
    const filteredData = data.map((item: any) => {
        const filteredEntries = Object.entries(item).filter(([key, value]) => value !== null && key !== "realUpdated");
        return Object.fromEntries(filteredEntries);
    });
    return NextResponse.json({data: filteredData}, { status: 200 });
}