import {observeApiRequest} from "@/app/telemetry.server";
import {NextRequest} from "next/server";
import { getAllUsers, getCached } from "@/app/data";
import {jsonResponse} from "@/app/api/_utils";

async function handleRequest(request: NextRequest) {
    const names = await getCached(getAllUsers, "getAllUsers");
    return jsonResponse(names, {cacheSeconds: 600, staleSeconds: 1_800});
}

export const GET = observeApiRequest("getAllUsers", handleRequest);
