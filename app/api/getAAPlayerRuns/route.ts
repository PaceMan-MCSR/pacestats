import {NextRequest} from "next/server";
import {getAAPlayerRunsPage, getCached} from "@/app/data";
import {
    integerParam,
    jsonResponse,
    rateLimit,
    stringParam,
    validationErrorResponse,
} from "@/app/api/_utils";

export async function GET(request: NextRequest) {
    const limited = rateLimit(request, {namespace: "getAAPlayerRuns", limit: 120, windowMs: 60_000});
    if (limited) return limited;
    try {
        const uuid = stringParam(request.nextUrl.searchParams, "uuid", {required: true, maxLength: 64});
        const limit = integerParam(request.nextUrl.searchParams, "limit", {defaultValue: 25, min: 1, max: 100});
        const beforeId = request.nextUrl.searchParams.has("beforeId")
            ? integerParam(request.nextUrl.searchParams, "beforeId", {min: 1, max: Number.MAX_SAFE_INTEGER})
            : null;
        const page = await getCached(getAAPlayerRunsPage, "getAAPlayerRunsPage", uuid, beforeId, limit);
        return jsonResponse(page, {cacheSeconds: 30, staleSeconds: 60});
    } catch (error) {
        const invalid = validationErrorResponse(error);
        if (invalid) return invalid;
        throw error;
    }
}
