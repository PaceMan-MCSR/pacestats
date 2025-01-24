import {NextRequest, NextResponse} from "next/server";
import { deleteRun } from "@/app/data";

export async function GET(request: NextRequest) {
    let runId = request.nextUrl.searchParams.get("runId") || "0"
    let apiKey = request.nextUrl.searchParams.get("key") || ""
    if (apiKey !== process.env.DELETE_RUN_KEY) {
        return NextResponse.json({error: "Invalid API Key"}, { status: 401 });
    }
    const deleted = await deleteRun(runId)

    return NextResponse.json({success: deleted}, { status: 200 });
}