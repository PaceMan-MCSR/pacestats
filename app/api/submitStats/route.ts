import {NextRequest, NextResponse} from "next/server";
import {getCached, getRunId, getUUIDByAccessKey, submitStats} from "@/app/data";

export async function POST(request: NextRequest) {
    try {
        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
        const body = await request.json()
        const accessKey = body.accessKey
        const uuid = await getCached(getUUIDByAccessKey, "getUUIDByAccessKey", accessKey)
        if (uuid === null) {
            return NextResponse.json({status: "error", message: "Invalid access key"}, {status: 401});
        }
        if(body.resets > 20000 || body.resets == body.totalResets){
            console.error("Rejecting reset count for  ", uuid, "resets:", body.resets, "totalResets:", body.totalResets, "time:", Date.now())
            return NextResponse.json({status: "error", message: "Rejecting because reset count"}, {status: 400});
        }
        const gameData = JSON.parse(body.gameData)
        const worldId = gameData.worldId
        const gameVersion = gameData.gameVersion
        const category = gameData.category
        if(gameVersion !== "1.16.1") {
            return NextResponse.json({status: "error", message: "Unsupported game version " + gameVersion}, {status: 400});
        }
        if(category !== "ANY") {
            return NextResponse.json({status: "error", message: "Unsupported category " + category}, {status: 400});
        }

        let runId = null;
        for(let i = 0; i < 10; i++){
            runId = await getRunId(uuid, worldId)
            if(runId !== null){
                break;
            }
            await delay(500)
        }
        if(runId === null){
            console.error("Missing worldId after 10 attempts for ", uuid, "gameData:", body.gameData, "version:", gameVersion, "category:", category, "time:", Date.now())
            return NextResponse.json({status: "error", message: "Could not find run with that worldId, please report this"}, {status: 400});
        }

        const wallTime = body.wallTime
        const playTime = body.playTime
        const enters = body.seedsPlayed
        const resets = body.resets
        const totalResets = body.totalResets
        const netherTime = body.netherTime || 0
        await submitStats(uuid, runId, wallTime, playTime, enters, resets, totalResets, netherTime)
    } catch (e) {
        console.error("Error in submitStats", e)
        return NextResponse.json({status: "error", message: "Unknown error"}, {status: 500});
    }
    return NextResponse.json({status: "success"}, { status: 200 });
}