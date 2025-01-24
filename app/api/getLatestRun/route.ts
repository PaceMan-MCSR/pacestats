import {NextRequest, NextResponse} from "next/server";
import {
    getCached,
    getAllNamesByNick,
    getAllNamesByTwitch,
    getLatestRun,
} from "@/app/data";

export async function GET(request: NextRequest) {
    const name = request.nextUrl.searchParams.get("name")
    const forceName = request.nextUrl.searchParams.get("forceName") || "false"
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
        return NextResponse.json([], { status: 200 });
    }

    return NextResponse.json(runs[0], { status: 200 });
}