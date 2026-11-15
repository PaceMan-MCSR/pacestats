import {NextRequest, NextResponse} from "next/server";
import {ApiInputError, hasValidApiKey, validationErrorResponse} from "@/app/api/_utils";
import {OverlaySnapshotError, readOverlaySnapshot} from "@/app/obs/snapshot.server";

const noStore = {"Cache-Control": "private, no-store"};

const failure = (error: string, status: number, retry = false) => NextResponse.json({error}, {
    status,
    headers: retry ? {...noStore, "Retry-After": "1"} : noStore,
});

/** Internal WS broker projection. Browser clients never receive its credential. */
export async function GET(request: NextRequest) {
    // Authenticate before allocating rate-limit buckets or checking out SQL.
    if (!hasValidApiKey(request, process.env.WS_TOKEN)) return failure("Unauthorized", 401);
    try {
        return NextResponse.json(await readOverlaySnapshot(request.nextUrl.searchParams), {headers: noStore});
    } catch (error) {
        if (error instanceof ApiInputError) return validationErrorResponse(error)!;
        if (error instanceof OverlaySnapshotError) return failure(error.message, error.status, error.status === 429);
        console.error("Unable to read OBS snapshot:", error);
        return failure("Overlay data is temporarily unavailable", 503, true);
    }
}
