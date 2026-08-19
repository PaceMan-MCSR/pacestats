import {NextRequest, NextResponse} from "next/server";
import {
    getCached,
    getAllNamesByNick,
    getAllNamesByTwitch,
    getSessionStats,
} from "@/app/data";
import {jsonResponse} from "@/app/api/_utils";

export async function GET(request: NextRequest) {
    let name = request.nextUrl.searchParams.get("name")
    let hours = Math.min(9999999, parseInt(request.nextUrl.searchParams.get("hours") || "24"))
    let hoursBetween = Math.min(9999999, parseInt(request.nextUrl.searchParams.get("hoursBetween") || "6"))
    let names = await getCached(getAllNamesByNick, "getAllNamesByNick", name)
    if(names === null){
        names = await getCached(getAllNamesByTwitch, "getAllNamesByTwitch", name)
        if(names === null){
            return NextResponse.json({error: "Unknown user"}, { status: 404 });
        }
    }
    const stats = await getCached(getSessionStats, "getSessionStats", names.uuid, hours, hoursBetween);
    return jsonResponse(stats, {cacheSeconds: 10, staleSeconds: 20});
}
