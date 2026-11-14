import {NextRequest} from "next/server";
import {jsonResponse, listParam, rateLimit, validationErrorResponse} from "@/app/api/_utils";
import {
    getCached,
    getPBs
} from "@/app/data";

export async function GET(request: NextRequest) {
    const limited = rateLimit(request, {namespace: "getPBs", limit: 120, windowMs: 60_000});
    if (limited) return limited;
    try {
        const names = listParam(request.nextUrl.searchParams, "names", 100, 64);
        const uuids = listParam(request.nextUrl.searchParams, "uuids", 100, 64);
        const pbs = await getCached(getPBs, "getPBs", names, uuids);
        return jsonResponse(pbs, {cacheSeconds: 60, staleSeconds: 120});
    } catch (error) {
        const invalid = validationErrorResponse(error);
        if (invalid) return invalid;
        throw error;
    }
}
