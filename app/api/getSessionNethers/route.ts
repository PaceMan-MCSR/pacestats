import {NextRequest, NextResponse} from "next/server";
import {
    getCached,
    getAllPlayerRunsByPeriod,
    getAllNamesByNick,
    getAllNamesByTwitch,
    getNPH,
    calculateAvg, getNethersByPeriod
} from "@/app/data";
import {formatDecimals, formatTime} from "@/app/utils";

export async function GET(request: NextRequest) {
    let name = request.nextUrl.searchParams.get("name")
    let hours = Math.min(9999999, parseInt(request.nextUrl.searchParams.get("hours") || "24"))
    let hoursBetween = Math.min(9999999, parseInt(request.nextUrl.searchParams.get("hoursBetween") || "6"))
    let liveOnly = request.nextUrl.searchParams.get("liveOnly") === "true"
    let dp = Math.min(3, parseInt(request.nextUrl.searchParams.get("dp") || "0"))
    let names = await getCached(getAllNamesByNick, "getAllNamesByNick", name)
    if(names === null){
        names = await getCached(getAllNamesByTwitch, "getAllNamesByTwitch", name)
        if(names === null){
            return NextResponse.json({error: "Unknown user"}, { status: 404 });
        }
    }
    const days = Math.ceil(hours / 24)
    const runs = await getCached(getNethersByPeriod, "getNethersByPeriod", names.uuid, days, 9999999, liveOnly)
    if(runs.length === 0){
        return NextResponse.json({count: 0, avg: (dp > 0 ? "0:00." + ("0".repeat(dp)) : "0:00"), rnph: 0, uuid: names.uuid}, { status: 200 });
    }

    let lastTime = 0 // oldest
    let firstTime = 0 // most recent
    let count = 0
    let times = []
    for(let run of runs){
        let diff = lastTime - run.time
        if(lastTime > 0 && diff > 60 * 60 * hoursBetween){
            break
        }
        if(Date.now() / 1000 - run.time > 60 * 60 * hours){
            break
        }
        if(count === 0){
            firstTime = run.time
        }
        times.push(run.nether)
        count += 1
        lastTime = run.time
    }
    if(count === 0){
        return NextResponse.json({count: 0, avg: (dp > 0 ? "0:00." + ("0".repeat(dp)) : "0:00"), rnph: 0, uuid: names.uuid}, { status: 200 });
    }
    let avg = calculateAvg(times)
    let nph = await getNPH(names.uuid, hours, hoursBetween, liveOnly)

    return NextResponse.json({count: count, avg: formatDecimals(avg, dp), rnph: nph.rnph, uuid: names.uuid}, { status: 200 });
}