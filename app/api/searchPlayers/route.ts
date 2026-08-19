import {NextRequest} from "next/server";
import {getCached, searchPlayers} from "@/app/data";
import {
    integerParam,
    jsonResponse,
    rateLimit,
    stringParam,
    validationErrorResponse,
} from "@/app/api/_utils";

export async function GET(request: NextRequest) {
    const limited = rateLimit(request, {namespace: "searchPlayers", limit: 120, windowMs: 60_000});
    if (limited) return limited;
    try {
        const query = stringParam(request.nextUrl.searchParams, "q", {required: true, maxLength: 64});
        if (query.length < 2) return jsonResponse([], {cacheSeconds: 30});
        const limit = integerParam(request.nextUrl.searchParams, "limit", {defaultValue: 8, min: 1, max: 20});
        const results = await getCached(searchPlayers, "searchPlayers", query.toLocaleLowerCase(), limit);
        return jsonResponse(results, {cacheSeconds: 60, staleSeconds: 120});
    } catch (error) {
        const invalid = validationErrorResponse(error);
        if (invalid) return invalid;
        throw error;
    }
}
