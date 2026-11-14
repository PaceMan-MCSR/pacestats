import {NextRequest} from "next/server";
import {getCached, getWorldLiveData} from "@/app/data";
import {jsonResponse, stringParam, withApiRequest} from "@/app/api/_utils";

export const GET = withApiRequest("getWorld", async (request: NextRequest) => {
    const worldId = stringParam(request.nextUrl.searchParams, "worldId", {required: true, maxLength: 64});
    let data = await getCached(getWorldLiveData, "getWorldLiveData", worldId)
    return jsonResponse(data, {cacheSeconds: 5, staleSeconds: 10});
}, {limit: 240, concurrent: 16});
