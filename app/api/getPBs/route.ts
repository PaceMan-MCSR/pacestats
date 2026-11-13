import {NextRequest, NextResponse} from "next/server";
import {jsonResponse} from "@/app/api/_utils";
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

    return jsonResponse(pbs, {cacheSeconds: 60, staleSeconds: 120});
}
