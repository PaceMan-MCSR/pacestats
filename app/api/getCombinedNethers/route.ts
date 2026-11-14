import {NextRequest, NextResponse} from "next/server";
import {
    getCached,
    getCombinedNetherAggregate,
    resolveCombinedPlayerUuids,
} from "@/app/data";
import {formatTime} from "@/app/utils";
import {integerParam, jsonResponse, listParam, validationErrorResponse, withApiRequest} from "@/app/api/_utils";

export const GET = withApiRequest("combinedStats", async (request: NextRequest) => {
    try {
        const names = listParam(request.nextUrl.searchParams, "names", 20, 64);
        const hours = Math.min(9_999 * 24, integerParam(request.nextUrl.searchParams, "hours", {defaultValue: 24, min: 1, max: 9_999_999}));
        const hoursBetween = integerParam(request.nextUrl.searchParams, "hoursBetween", {defaultValue: 6, min: 1, max: 9_999_999});
        const start = integerParam(request.nextUrl.searchParams, "start", {
            defaultValue: 0,
            min: 0,
            max: Number.MAX_SAFE_INTEGER,
        });
        const maxTime = integerParam(request.nextUrl.searchParams, "maxTime", {
            defaultValue: 99_999_999,
            min: 1,
            max: 99_999_999,
        });

        const resolution = await getCached(
            resolveCombinedPlayerUuids,
            "resolveCombinedPlayerUuids",
            names
        );
        if (resolution.unknown.length > 0) {
            return NextResponse.json(
                {error: `Unknown user: ${resolution.unknown[0]}`},
                {status: 404}
            );
        }

        const aggregate = await getCached(
            getCombinedNetherAggregate,
            "getCombinedNetherAggregate",
            resolution.uuids,
            hours,
            hoursBetween,
            start,
            maxTime
        );
        return jsonResponse({
            count: aggregate.count,
            avg: formatTime(aggregate.average),
        }, {cacheSeconds: 5, staleSeconds: 10});
    } catch (error) {
        const invalid = validationErrorResponse(error);
        if (invalid) return invalid;
        throw error;
    }
}, {limit: 30, concurrent: 2});
