import {NextRequest, NextResponse} from "next/server";
import {
    getCached,
    getCombinedNetherAggregate,
    resolveCombinedPlayerUuids,
} from "@/app/data";
import {formatTime} from "@/app/utils";
import {integerParam, validationErrorResponse} from "@/app/api/_utils";

const namesParam = (request: NextRequest) =>
    (request.nextUrl.searchParams.get("names") ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);

export async function GET(request: NextRequest) {
    try {
        const names = namesParam(request);
        const hours = integerParam(request.nextUrl.searchParams, "hours", {defaultValue: 24, min: 1});
        const hoursBetween = integerParam(request.nextUrl.searchParams, "hoursBetween", {defaultValue: 6, min: 1});
        const start = integerParam(request.nextUrl.searchParams, "start", {
            defaultValue: 0,
            min: 0,
            max: Number.MAX_SAFE_INTEGER,
        });
        const maxTime = integerParam(request.nextUrl.searchParams, "maxTime", {
            defaultValue: 99_999_999,
            min: 1,
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
        return NextResponse.json({
            count: aggregate.count,
            avg: formatTime(aggregate.average),
        }, {status: 200});
    } catch (error) {
        const invalid = validationErrorResponse(error);
        if (invalid) return invalid;
        throw error;
    }
}
