import {integerParam, jsonResponse, withApiRequest} from "@/app/api/_utils";
import { getCached, getRunsPaginated } from "@/app/data";

export const GET = withApiRequest("getRunsPaginated", async (request) => {
    const page = integerParam(request.nextUrl.searchParams, "page", {defaultValue: 1, min: 1, max: 1_000_000});
    // Retain the documented legacy 10k export, with an opt-in smaller page.
    const pageSize = integerParam(request.nextUrl.searchParams, "pageSize", {defaultValue: 10_000, min: 1, max: 10_000});
    const data = await getCached(getRunsPaginated, "getRunsPaginated", page, pageSize);
    return jsonResponse(data, {cacheSeconds: 30, staleSeconds: 60});
}, {limit: 12, concurrent: 2});
