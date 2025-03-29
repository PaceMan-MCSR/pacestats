import {NextRequest, NextResponse} from "next/server";
import {
    getCached,
    getAllNamesByNick,
    getAllNamesByTwitch,
    getAllPlayerRunsByPeriod,
} from "@/app/data";

export async function GET(request: NextRequest) {
    let name = request.nextUrl.searchParams.get("name")
    let hours = Math.min(9999999, parseInt(request.nextUrl.searchParams.get("hours") || "9999999"))
    let hoursBetween = Math.min(9999999, parseInt(request.nextUrl.searchParams.get("hoursBetween") || "9999999"))
    let limit = parseInt(request.nextUrl.searchParams.get("limit") || "10")
    let names = await getCached(getAllNamesByNick, "getAllNamesByNick", name)
    if(names === null){
        names = await getCached(getAllNamesByTwitch, "getAllNamesByTwitch", name)
        if(names === null){
            return NextResponse.json({error: "Unknown user"}, { status: 404 });
        }
    }
    const days = Math.ceil(hours / 24)
    const runs = await getCached(getAllPlayerRunsByPeriod, "getAllPlayerRunsByPeriod", names.uuid, days, limit)

    let lastTime = 0

    let response = []

    for(let run of runs){
        let diff = lastTime - run.time
        if(lastTime > 0 && diff > 60 * 60 * hoursBetween){
            break
        }
        if(Date.now() / 1000 - run.time > 60 * 60 * hours){
            break
        }
        response.push(run)
        lastTime = run.time
    }


    return NextResponse.json(response, { status: 200 });
}