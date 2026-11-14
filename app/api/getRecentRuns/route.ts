import {NextRequest, NextResponse} from "next/server";
import {integerParam, jsonResponse, stringParam, withApiRequest} from "@/app/api/_utils";
import {
    getCached,
    getAllNamesByNick,
    getAllNamesByTwitch,
    getAllPlayerRunsByPeriod,
} from "@/app/data";

export const GET = withApiRequest("getRecentRuns", async (request: NextRequest) => {
    const name = stringParam(request.nextUrl.searchParams, "name", {required: true, maxLength: 64});
    const hours = integerParam(request.nextUrl.searchParams, "hours", {defaultValue: 9_999_999, min: 1, max: 9_999_999});
    const hoursBetween = integerParam(request.nextUrl.searchParams, "hoursBetween", {defaultValue: 9_999_999, min: 1, max: 9_999_999});
    const limit = integerParam(request.nextUrl.searchParams, "limit", {defaultValue: 10, min: 1, max: 1_000});
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


    return jsonResponse(response, {cacheSeconds: 5, staleSeconds: 10});
});
