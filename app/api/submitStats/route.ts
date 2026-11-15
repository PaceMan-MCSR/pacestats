import {observeApiRequest} from "@/app/telemetry.server";
import {NextRequest, NextResponse} from "next/server";
import {createHash} from "node:crypto";
import {getCached, getRunId, getUUIDByAccessKey, submitStats} from "@/app/data";
import {ApiInputError} from "@/app/api/_utils";

class InvalidAccessKeyError extends Error {}

const verifyAccessKey = async (accessKey: string): Promise<string> => {
    const uuid = await getUUIDByAccessKey(accessKey);
    // Rejections must not enter the 30-minute success cache: the verifier may
    // have been temporarily unavailable, and the next submission must retry it.
    if (uuid === null) throw new InvalidAccessKeyError();
    return uuid;
};

const objectValue = (value: unknown, name: string): Record<string, unknown> => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new ApiInputError(`${name} must be an object`);
    }
    return value as Record<string, unknown>;
};

const stringValue = (value: unknown, name: string, maxLength: number): string => {
    if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
        throw new ApiInputError(`${name} must be a nonempty string of at most ${maxLength} characters`);
    }
    return value;
};

const integerValue = (value: unknown, name: string, max: number): number => {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) {
        throw new ApiInputError(`${name} must be an integer between 0 and ${max}`);
    }
    return value;
};

const parseJson = (value: string, name: string): unknown => {
    try {
        return JSON.parse(value);
    } catch {
        throw new ApiInputError(`${name} must be valid JSON`);
    }
};

async function handleRequest(request: NextRequest) {
    try {
        const body = objectValue(parseJson(await request.text(), "Request body"), "Request body");
        const accessKey = stringValue(body.accessKey, "accessKey", 1024);
        if (typeof body.gameData !== "string") throw new ApiInputError("gameData must be a JSON string");
        const gameData = objectValue(parseJson(body.gameData, "gameData"), "gameData");
        const worldId = stringValue(gameData.worldId, "worldId", 64);
        if (gameData.gameVersion !== "1.16.1") {
            throw new ApiInputError("Unsupported game version");
        }
        if (gameData.category !== "ANY") {
            throw new ApiInputError("Unsupported category");
        }

        // Match the MySQL column ranges instead of relying on coercion or SQL
        // mode to reject, truncate or silently change untrusted tracker values.
        const wallTime = integerValue(body.wallTime, "wallTime", 0xFFFFFFFF);
        const playTime = integerValue(body.playTime, "playTime", 0xFFFFFFFF);
        const enters = integerValue(body.seedsPlayed, "seedsPlayed", 0xFFFF);
        const resets = Math.min(integerValue(body.resets, "resets", 0x7FFFFFFF), 20000);
        const totalResets = integerValue(body.totalResets, "totalResets", 0x7FFFFFFF);
        const netherTime = body.netherTime === undefined ? 0 : integerValue(body.netherTime, "netherTime", 0xFFFFFFFF);
        // Generic cache arguments normalize interval-like strings. Credentials
        // must match exactly, so cache their digest and verify the original.
        const accessKeyDigest = createHash("sha256").update(accessKey, "utf8").digest("hex");
        const uuid: string = await getCached(() => verifyAccessKey(accessKey), "getUUIDByAccessKey", accessKeyDigest);

        let runId = null;
        for (let i = 0; i < 10; i++) {
            runId = await getRunId(uuid, worldId);
            if (runId !== null) {
                break;
            }
            if (i < 9) await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (runId === null) {
            console.error("Missing worldId after 10 attempts for", uuid, "worldId:", worldId);
            return NextResponse.json({status: "error", message: "Could not find run with that worldId, please report this"}, {status: 400});
        }

        await submitStats(uuid, runId, wallTime, playTime, enters, resets, totalResets, netherTime);
    } catch (e) {
        if (e instanceof ApiInputError) {
            return NextResponse.json({status: "error", message: e.message}, {status: 400});
        }
        if (e instanceof InvalidAccessKeyError) {
            return NextResponse.json({status: "error", message: "Invalid access key"}, {status: 401});
        }
        console.error("Error in submitStats", e);
        return NextResponse.json({status: "error", message: "Unknown error"}, {status: 500});
    }
    return NextResponse.json({status: "success"}, { status: 200 });
}

export const POST = observeApiRequest("submitStats", handleRequest);
