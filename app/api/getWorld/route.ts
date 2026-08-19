import {NextRequest} from "next/server";
import {getCached, getWorldLiveData} from "@/app/data";
import {jsonResponse} from "@/app/api/_utils";

export async function GET(request: NextRequest) {
    let worldId = request.nextUrl.searchParams.get("worldId")
    let data = await getCached(getWorldLiveData, "getWorldLiveData", worldId)
    return jsonResponse(data, {cacheSeconds: 5, staleSeconds: 10});
}
