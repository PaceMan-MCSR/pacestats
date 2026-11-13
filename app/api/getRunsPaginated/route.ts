import {NextRequest, NextResponse} from "next/server";
import {jsonResponse} from "@/app/api/_utils";
import { getCached, getRunsPaginated } from "@/app/data";

export async function GET(request: NextRequest) {
    const page = parseInt(request.nextUrl.searchParams.get("page") || "1")
    const data = await getCached(getRunsPaginated, "getRunsPaginated", page, 10000)
    return jsonResponse(data, {cacheSeconds: 30, staleSeconds: 60});
}
