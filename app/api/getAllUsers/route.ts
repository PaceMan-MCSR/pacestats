import {NextRequest} from "next/server";
import { getAllUsers, getCached } from "@/app/data";
import {jsonResponse} from "@/app/api/_utils";

export async function GET(request: NextRequest) {
    const names = await getCached(getAllUsers, "getAllUsers");
    return jsonResponse(names, {cacheSeconds: 600, staleSeconds: 1_800});
}
