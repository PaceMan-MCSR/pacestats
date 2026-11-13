import {NextRequest} from "next/server";
import {
    getCached,
    getPlayerRunsOffsetPage,
    getPlayerRunsPage,
    type PlayerRunFilter,
    type PlayerRunSort,
} from "@/app/data";
import {
    ApiInputError,
    integerParam,
    jsonResponse,
    rateLimit,
    stringParam,
    validationErrorResponse,
} from "@/app/api/_utils";

const filterColumns = new Set([
    "date", "nether", "bastion", "fortress", "first_structure", "second_structure",
    "first_portal", "stronghold", "end", "finish",
]);
const filterOperators = new Set([
    "before", "after", "during", "lessThan", "greaterThan", "isNotEmpty", "isEmpty",
]);
const dateFilterOperators = new Set(["before", "after", "during"]);
const sortDirections = new Set(["asc", "desc"]);

const parseFilters = (raw: string | null): PlayerRunFilter[] => {
    if (!raw) return [];
    if (raw.length > 4_000) throw new ApiInputError("filters is too long");

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new ApiInputError("filters must be valid JSON");
    }
    if (!Array.isArray(parsed) || parsed.length > 10) {
        throw new ApiInputError("filters must be an array with at most 10 entries");
    }

    return parsed.map((candidate): PlayerRunFilter => {
        if (!candidate || typeof candidate !== "object") throw new ApiInputError("Invalid filter");
        const filter = candidate as Record<string, unknown>;
        if (typeof filter.column !== "string" || !filterColumns.has(filter.column) ||
            typeof filter.operatorValue !== "string" || !filterOperators.has(filter.operatorValue)) {
            throw new ApiInputError("Invalid filter column or operator");
        }
        if ((filter.column === "date") !== dateFilterOperators.has(filter.operatorValue)) {
            throw new ApiInputError("Invalid operator for filter column");
        }

        const needsValue = !["isNotEmpty", "isEmpty"].includes(filter.operatorValue);
        if (needsValue && (typeof filter.value !== "number" || !Number.isFinite(filter.value))) {
            throw new ApiInputError("Invalid filter value");
        }
        if (filter.operatorValue === "during" &&
            (typeof filter.endValue !== "number" || !Number.isFinite(filter.endValue) || filter.endValue <= (filter.value as number))) {
            throw new ApiInputError("Invalid date range");
        }
        return filter as PlayerRunFilter;
    });
};

const parseSort = (column: string | null, direction: string | null): PlayerRunSort => {
    const normalizedColumn = column ?? "date";
    const normalizedDirection = direction ?? "desc";
    if (!filterColumns.has(normalizedColumn) || !sortDirections.has(normalizedDirection)) {
        throw new ApiInputError("Invalid sort column or direction");
    }
    return {
        column: normalizedColumn as PlayerRunSort["column"],
        direction: normalizedDirection as PlayerRunSort["direction"],
    };
};

export async function GET(request: NextRequest) {
    const limited = rateLimit(request, {namespace: "getPlayerRuns", limit: 120, windowMs: 60_000});
    if (limited) return limited;
    try {
        const uuid = stringParam(request.nextUrl.searchParams, "uuid", {required: true, maxLength: 64});
        if (request.nextUrl.searchParams.has("page")) {
            const page = integerParam(request.nextUrl.searchParams, "page", {defaultValue: 0, min: 0, max: 1_000_000});
            const pageSize = integerParam(request.nextUrl.searchParams, "pageSize", {
                defaultValue: 25,
                allowed: [10, 25, 50, 100],
            });
            const filters = parseFilters(request.nextUrl.searchParams.get("filters"));
            const sort = parseSort(
                request.nextUrl.searchParams.get("sort"),
                request.nextUrl.searchParams.get("direction")
            );
            const result = await getCached(
                getPlayerRunsOffsetPage,
                "getPlayerRunsOffsetPage",
                uuid,
                page,
                pageSize,
                filters,
                sort
            );
            return jsonResponse(result, {cacheSeconds: 5, staleSeconds: 15});
        }
        const limit = integerParam(request.nextUrl.searchParams, "limit", {defaultValue: 25, min: 1, max: 100});
        const beforeId = request.nextUrl.searchParams.has("beforeId")
            ? integerParam(request.nextUrl.searchParams, "beforeId", {min: 1, max: Number.MAX_SAFE_INTEGER})
            : null;
        const page = await getCached(getPlayerRunsPage, "getPlayerRunsPage", uuid, beforeId, limit);
        return jsonResponse(page, {cacheSeconds: 5, staleSeconds: 15});
    } catch (error) {
        const invalid = validationErrorResponse(error);
        if (invalid) return invalid;
        throw error;
    }
}
