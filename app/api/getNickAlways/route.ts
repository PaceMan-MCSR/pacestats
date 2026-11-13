import {NextRequest, NextResponse} from "next/server";
import {jsonResponse} from "@/app/api/_utils";
import {getCached, getNickAlways} from "@/app/data";

export async function GET(request: NextRequest) {
    let uuid = request.nextUrl.searchParams.get("uuid")
    let name = await getCached(getNickAlways, "getNickAlways", uuid)
    return jsonResponse({name: name}, {cacheSeconds: 600, staleSeconds: 1_800});
}
