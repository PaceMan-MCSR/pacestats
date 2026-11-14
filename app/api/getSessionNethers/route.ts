import {NextRequest, NextResponse} from "next/server";
import {
    getCached,
    getAllNamesByNick,
    getAllNamesByTwitch,
    getNPH,
    calculateAvg, getNethersByPeriod,
    SESSION_PAGE_ROWS,
} from "@/app/data";
import {formatDecimals} from "@/app/utils";
import {booleanParam, integerParam, jsonResponse, stringParam, withApiRequest} from "@/app/api/_utils";

/** Collects nether times newest first until a long gap or the window edge. */
function walkNethers(runs: any[], hours: number, hoursBetween: number) {
    let lastTime = 0 // oldest
    let firstTime = 0 // most recent
    let count = 0
    let times = []
    let stopped = false
    for(let run of runs){
        let diff = lastTime - run.time
        if(lastTime > 0 && diff > 60 * 60 * hoursBetween){
            stopped = true
            break
        }
        if(Date.now() / 1000 - run.time > 60 * 60 * hours){
            stopped = true
            break
        }
        if(count === 0){
            firstTime = run.time
        }
        times.push(run.nether)
        count += 1
        lastTime = run.time
    }
    return {count, times, stopped}
}

export const GET = withApiRequest("playerSessionStats", async (request: NextRequest) => {
    const name = stringParam(request.nextUrl.searchParams, "name", {required: true, maxLength: 64});
    const hours = integerParam(request.nextUrl.searchParams, "hours", {defaultValue: 24, min: 1, max: 9_999_999});
    const hoursBetween = integerParam(request.nextUrl.searchParams, "hoursBetween", {defaultValue: 6, min: 0, max: 9_999_999});
    const liveOnly = booleanParam(request.nextUrl.searchParams, "liveOnly");
    const dp = integerParam(request.nextUrl.searchParams, "dp", {defaultValue: 0, min: 0, max: 3});
    let names = await getCached(getAllNamesByNick, "getAllNamesByNick", name)
    if(names === null){
        names = await getCached(getAllNamesByTwitch, "getAllNamesByTwitch", name)
        if(names === null){
            return NextResponse.json({error: "Unknown user"}, { status: 404 });
        }
    }
    const days = Math.ceil(hours / 24)
    const initialLimit = hoursBetween >= hours ? 100_000 : SESSION_PAGE_ROWS
    let runs = await getCached(getNethersByPeriod, "getNethersByPeriod", names.uuid, days, initialLimit, liveOnly)
    if(runs.length === 0){
        return jsonResponse(
            {count: 0, avg: (dp > 0 ? "0:00." + ("0".repeat(dp)) : "0:00"), rnph: 0, uuid: names.uuid},
            {cacheSeconds: 5, staleSeconds: 10}
        );
    }

    let walk = walkNethers(runs, hours, hoursBetween)
    if(initialLimit === SESSION_PAGE_ROWS && !walk.stopped && runs.length === SESSION_PAGE_ROWS){
        runs = await getCached(getNethersByPeriod, "getNethersByPeriod", names.uuid, days, 9999999, liveOnly)
        walk = walkNethers(runs, hours, hoursBetween)
    }
    const {count, times} = walk
    if(count === 0){
        return jsonResponse(
            {count: 0, avg: (dp > 0 ? "0:00." + ("0".repeat(dp)) : "0:00"), rnph: 0, uuid: names.uuid},
            {cacheSeconds: 5, staleSeconds: 10}
        );
    }
    let avg = calculateAvg(times)
    let nph = await getCached(getNPH, "getNPH", names.uuid, hours, hoursBetween, liveOnly)

    return jsonResponse(
        {count: count, avg: formatDecimals(avg, dp), rnph: nph.rnph, uuid: names.uuid},
        {cacheSeconds: 5, staleSeconds: 10}
    );
}, {limit: 120, concurrent: 4});
