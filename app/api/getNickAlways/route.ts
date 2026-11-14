import {NextRequest, NextResponse} from "next/server";
import {ApiInputError, jsonResponse, stringParam, withApiRequest} from "@/app/api/_utils";
import {getCached, getNickAlways} from "@/app/data";

export const GET = withApiRequest("getNickAlways", async (request: NextRequest) => {
    const uuid = stringParam(request.nextUrl.searchParams, "uuid", {required: true, maxLength: 36});
    if (!/^(?:[\da-f]{32}|[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})$/i.test(uuid)) throw new ApiInputError("uuid must be a Minecraft UUID");
    let name = await getCached(getNickAlways, "getNickAlways", uuid)
    return jsonResponse({name: name}, {cacheSeconds: 600, staleSeconds: 1_800});
}, {limit: 240, concurrent: 8});
