import {NextRequest, NextResponse} from "next/server";
import {
    getCached,
    getAllNamesByNick,
    getAllNamesByTwitch,
    getSessionStats,
} from "@/app/data";
import {integerParam, jsonResponse, stringParam, withApiRequest} from "@/app/api/_utils";

export const GET = withApiRequest("playerSessionStats", async (request: NextRequest) => {
    const name = stringParam(request.nextUrl.searchParams, "name", {required: true, maxLength: 64});
    const hours = integerParam(request.nextUrl.searchParams, "hours", {defaultValue: 24, min: 1, max: 9_999_999});
    const hoursBetween = integerParam(request.nextUrl.searchParams, "hoursBetween", {defaultValue: 6, min: 0, max: 9_999_999});
    let names = await getCached(getAllNamesByNick, "getAllNamesByNick", name)
    if(names === null){
        names = await getCached(getAllNamesByTwitch, "getAllNamesByTwitch", name)
        if(names === null){
            return NextResponse.json({error: "Unknown user"}, { status: 404 });
        }
    }
    const stats = await getCached(getSessionStats, "getSessionStats", names.uuid, hours, hoursBetween);
    return jsonResponse(stats, {cacheSeconds: 10, staleSeconds: 20});
}, {limit: 120, concurrent: 4});
