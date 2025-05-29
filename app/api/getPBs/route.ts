import {NextRequest, NextResponse} from "next/server";
import {
    getCached,
    getPBs
} from "@/app/data";

export async function GET(request: NextRequest) {
    let names = (request.nextUrl.searchParams.get("names") || "").split(",").map(n => n.trim())
    let uuids = (request.nextUrl.searchParams.get("uuids") || "").split(",").map(n => n.trim())
    if(uuids.length === 1 && uuids[0] === ""){
        uuids = []
    }
    if(names.length === 1 && names[0] === ""){
        names = []
    }
    const pbs = await getCached(getPBs, "getPBs", names, uuids)

    return NextResponse.json(pbs, { status: 200 });
}