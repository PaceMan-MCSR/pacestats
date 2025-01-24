import {NextRequest, NextResponse} from "next/server";
import {
    getCached,
    getAllNamesByNick,
    getAllNamesByTwitch,
    jude,
} from "@/app/data";

export async function GET(request: NextRequest) {
    let name = request.nextUrl.searchParams.get("name")
    let names = await getCached(getAllNamesByNick, "getAllNamesByNick", name)
    if(names === null){
        names = await getCached(getAllNamesByTwitch, "getAllNamesByTwitch", name)
        if(names === null){
            return NextResponse.json({error: "Unknown user"}, { status: 404 });
        }
    }
    const runs = await getCached(jude, "jude", names.uuid)
    return NextResponse.json(runs, { status: 200 });
}