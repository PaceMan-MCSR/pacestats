import {NextRequest, NextResponse} from "next/server";
import {getCached, getAllNamesByNick, getAllNamesByTwitch, getNPH} from "@/app/data";

export async function GET(request: NextRequest) {
    let name = request.nextUrl.searchParams.get("name")
    let hours = Math.min(9999999, parseInt(request.nextUrl.searchParams.get("hours") || "24"))
    let hoursBetween = Math.min(9999999, parseInt(request.nextUrl.searchParams.get("hoursBetween") || "2"))
    let liveOnly = request.nextUrl.searchParams.get("liveOnly") === "true"
    let names = await getCached(getAllNamesByNick, "getAllNamesByNick", name)
    if(names === null){
        names = await getCached(getAllNamesByTwitch, "getAllNamesByTwitch", name)
        if(names === null){
            return NextResponse.json({error: "Unknown user"}, { status: 404 });
        }
    }
    const nph = await getCached(getNPH, "getNPH", names.uuid, hours, hoursBetween, liveOnly)

    return NextResponse.json(nph, { status: 200 });
}