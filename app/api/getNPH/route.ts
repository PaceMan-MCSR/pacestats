import {NextRequest, NextResponse} from "next/server";
import {booleanParam, integerParam, jsonResponse, stringParam, withApiRequest} from "@/app/api/_utils";
import {getCached, getAllNamesByNick, getAllNamesByTwitch, getNPH} from "@/app/data";

export const GET = withApiRequest("playerSessionStats", async (request: NextRequest) => {
    const name = stringParam(request.nextUrl.searchParams, "name", {required: true, maxLength: 64});
    const hours = integerParam(request.nextUrl.searchParams, "hours", {defaultValue: 24, min: 1, max: 9_999_999});
    const hoursBetween = integerParam(request.nextUrl.searchParams, "hoursBetween", {defaultValue: 2, min: 0, max: 9_999_999});
    const liveOnly = booleanParam(request.nextUrl.searchParams, "liveOnly");
    let names = await getCached(getAllNamesByNick, "getAllNamesByNick", name)
    if(names === null){
        names = await getCached(getAllNamesByTwitch, "getAllNamesByTwitch", name)
        if(names === null){
            return NextResponse.json({error: "Unknown user"}, { status: 404 });
        }
    }
    const nph = await getCached(getNPH, "getNPH", names.uuid, hours, hoursBetween, liveOnly)

    return jsonResponse(nph, {cacheSeconds: 5, staleSeconds: 10});
}, {limit: 120, concurrent: 4});
