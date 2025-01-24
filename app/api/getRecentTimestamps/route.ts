import {NextRequest, NextResponse} from "next/server";
import {getAllNamesByNick, getAllNamesByTwitch, getCached, getRecentTimestamps, getUUID} from "@/app/data";
import {getLastSplit} from "@/app/utils";

function getSplitTimestamp(start: number, splitOffset: number | null){
    if(splitOffset === null){
        return null
    }
    return Math.round((start + (splitOffset / 1000)) * 1e3) / 1e3;
}

export async function GET(request: NextRequest) {
    let name = request.nextUrl.searchParams.get("name")
    let limit = Math.min(50, parseInt(request.nextUrl.searchParams.get("limit") || "20"))
    let names = await getCached(getAllNamesByNick, "getAllNamesByNick", name)
    let onlyFortress = request.nextUrl.searchParams.get("onlyFort") === "true"
    if(names === null){
        names = await getCached(getAllNamesByTwitch, "getAllNamesByTwitch", name)
        if(names === null){
            return NextResponse.json({error: "Unknown user"}, { status: 404 });
        }
    }
    const data = await getCached(getRecentTimestamps, "getRecentTimestamps", names.uuid, limit, onlyFortress)
    if(data.length === 0){
        return NextResponse.json({error: "No data found for this user"}, { status: 404 });
    }
    let response = []
    for(let run of data){
        // all runs with this timestamp dont have valid updateTime data
        if(run.netherRta === null || run.updateTime === 1711774799){
            continue
        }
        let runStart = run.insertTime - (run.netherRta / 1000)
        let formattedRun = {
            id: run.id,
            start: runStart,
            runName: getLastSplit(run, true).full,
            nether: getSplitTimestamp(runStart, run.netherRta),
            bastion: getSplitTimestamp(runStart, run.bastionRta),
            fortress: getSplitTimestamp(runStart, run.fortressRta),
            first_portal: getSplitTimestamp(runStart, run.first_portalRta),
            stronghold: getSplitTimestamp(runStart, run.strongholdRta),
            end: getSplitTimestamp(runStart, run.endRta),
            finish: getSplitTimestamp(runStart, run.finishRta),
            realUpdate: run.realUpdate,
            lastUpdated: run.updateTime
        }
        if(formattedRun.realUpdate == null){
            formattedRun.realUpdate = formattedRun.lastUpdated
        }
        // if run finished, set lastUpdated to run finish, rather than 5 mins after when paceman kills it
        if(formattedRun.finish !== null){
            formattedRun.lastUpdated = formattedRun.finish
            formattedRun.realUpdate = formattedRun.finish
        }
        response.push(formattedRun)
    }
    return NextResponse.json(response, { status: 200 });
}