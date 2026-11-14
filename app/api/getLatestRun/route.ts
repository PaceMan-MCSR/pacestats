import {NextRequest, NextResponse} from "next/server";
import {
    getCached,
    getAllNamesByNick,
    getAllNamesByTwitch,
    getLatestRun,
} from "@/app/data";
import {booleanParam, jsonResponse, stringParam, withApiRequest} from "@/app/api/_utils";

export const GET = withApiRequest("getLatestRun", async (request: NextRequest) => {
    const name = stringParam(request.nextUrl.searchParams, "name", {required: true, maxLength: 64});
    const forceName = booleanParam(request.nextUrl.searchParams, "forceName");
    let uuid = null;
    let names = await getCached(getAllNamesByNick, "getAllNamesByNick", name)
    if(names === null && forceName){
        return NextResponse.json({error: "Unknown user"}, { status: 401 });
    }
    if (names === null) {
        names = await getCached(getAllNamesByTwitch, "getAllNamesByTwitch", name)
        if (names === null) {
            return NextResponse.json({error: "Unknown user"}, {status: 401});
        }
    }
    uuid = names.uuid
    if(uuid === null || uuid === undefined){
        return NextResponse.json({error: "Unknown user"}, { status: 401 });
    }
    const runs = await getCached(getLatestRun, "getLatestRun", uuid)
    if(runs.length === 0){
        return jsonResponse([], {cacheSeconds: 5, staleSeconds: 10});
    }

    return jsonResponse(runs[0], {cacheSeconds: 5, staleSeconds: 10});
}, {limit: 240, concurrent: 16});
