import {NextRequest, NextResponse} from "next/server";
import {getCached, getAllPlayerRunsByPeriod, getAllNamesByNick, getAllNamesByTwitch, calculateAvg} from "@/app/data";
import {formatTime} from "@/app/utils";

export async function GET(request: NextRequest) {
    let names = (request.nextUrl.searchParams.get("names") || "").split(",").map(n => n.trim())
    let hours = Math.min(9999999, parseInt(request.nextUrl.searchParams.get("hours") || "24"))
    let hoursBetween = Math.min(9999999, parseInt(request.nextUrl.searchParams.get("hoursBetween") || "6"))
    let start = parseInt(request.nextUrl.searchParams.get("start") || "0")
    let maxTime = Math.min(99999999, parseInt(request.nextUrl.searchParams.get("maxTime") || "99999999"))
    const days = Math.ceil(hours / 24)
    let lastTime = 0
    let count = 0
    let times = []
    for(let name of names){
        let n = await getCached(getAllNamesByNick, "getAllNamesByNick", name)
        if(n === null){
            n = await getCached(getAllNamesByTwitch, "getAllNamesByTwitch", name)
            if(n === null) {
                return NextResponse.json({error: "Unknown user: " + n}, {status: 404});
            }
        }

        let runs = await getCached(getAllPlayerRunsByPeriod, "getAllPlayerRunsByPeriod", n.uuid, days)
        for(let run of runs){
            if(start > 0 && run.time < start){
                continue
            }
            let diff = lastTime - run.time
            if(lastTime > 0 && diff > 60 * 60 * hoursBetween){
                break
            }
            if(Date.now() / 1000 - run.time > 60 * 60 * hours){
                break
            }
            if(run.nether > maxTime){
                continue
            }
            times.push(run.nether)
            count += 1
            lastTime = run.time
        }
    }
    if(count === 0){
        return NextResponse.json({count: 0, avg: "0:00"}, { status: 200 });
    }
    let avg = calculateAvg(times)

    return NextResponse.json({count: count, avg: formatTime(avg)}, { status: 200 });
}