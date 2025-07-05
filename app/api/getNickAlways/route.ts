import {NextRequest, NextResponse} from "next/server";
import {getCached, getNickAlways} from "@/app/data";

export async function GET(request: NextRequest) {
    let uuid = request.nextUrl.searchParams.get("uuid")
    let name = await getCached(getNickAlways, "getNickAlways", uuid)
    return NextResponse.json({name: name}, { status: 200 });
}