import {NextRequest, NextResponse} from "next/server";
import {
    getCached,
    getAllNamesByNick,
    getAllNamesByTwitch,
    jude,
} from "@/app/data";
import {jsonResponse, stringParam, withApiRequest} from "@/app/api/_utils";

export const GET = withApiRequest("getLatestCompletion", async (request: NextRequest) => {
    const name = stringParam(request.nextUrl.searchParams, "name", {required: true, maxLength: 64});
    let names = await getCached(getAllNamesByNick, "getAllNamesByNick", name)
    if(names === null){
        names = await getCached(getAllNamesByTwitch, "getAllNamesByTwitch", name)
        if(names === null){
            return NextResponse.json({error: "Unknown user"}, { status: 404 });
        }
    }
    const runs = await getCached(jude, "jude", names.uuid)
    return jsonResponse(runs, {cacheSeconds: 30, staleSeconds: 60});
}, {limit: 240, concurrent: 16});
