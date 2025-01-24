import {NextRequest, NextResponse} from "next/server";
import {getCached, getWorldLiveData} from "@/app/data";

export async function GET(request: NextRequest) {
    let worldId = request.nextUrl.searchParams.get("worldId")
    let data = await getCached(getWorldLiveData, "getWorldLiveData", worldId)
    return NextResponse.json(data, { status: 200 });
}