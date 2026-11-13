import {NextRequest, NextResponse} from "next/server";
import {jsonResponse} from "@/app/api/_utils";
import {
    getCached,
    getAllNamesByNick,
    getAllNamesByTwitch,
    getAllPlayerRunsByPeriod, calculateAvg,
    SESSION_PAGE_ROWS,
} from "@/app/data";
import {formatTime, getFirstStructure, getSecondStructure} from "@/app/utils";

/** Collects one split newest first until a long gap or the window edge. */
function walkSplit(runs: any[], split: string, hours: number, hoursBetween: number, maxTime: number) {
    let lastTime = 0
    const r = []
    let stopped = false

    for(let run of runs){
        let diff = lastTime - run.time
        if(lastTime > 0 && diff > 60 * 60 * hoursBetween){
            stopped = true
            break
        }
        if(Date.now() / 1000 - run.time > 60 * 60 * hours){
            stopped = true
            break
        }
        let relevantTime = 0
        const rod = run["obtainRod"] || null
        switch (split) {
            case "nether":
                relevantTime = run["nether"]
                break
            case "bastion":
                relevantTime = run["bastion"]
                break
            case "fortress":
                relevantTime = run["fortress"]
                if(rod !== null && rod < relevantTime){
                    relevantTime = rod
                }
                break
            case "first_structure":
                relevantTime = getFirstStructure(run["bastion"], run["fortress"]) || 0
                if(relevantTime === run["fortress"] && rod !== null && rod < relevantTime){
                    relevantTime = rod
                }
                break
            case "second_structure":
                const bastion = run["bastion"]
                const fortress = run["fortress"]
                const secondStructure = getSecondStructure(bastion, fortress)
                if(secondStructure != null){
                    const id = run["id"]
                    if(id >= 187307){ // when context logging was added, march 29th 2024
                        const rod = run["obtainRod"]
                        if(secondStructure === bastion && (rod === null || rod > secondStructure)){
                            continue
                        }
                        if(secondStructure === fortress && (fortress - bastion < 50000)){
                            continue
                        }
                    }
                }
                relevantTime = getSecondStructure(run["bastion"], run["fortress"]) || 0
                if(relevantTime === run["fortress"] && rod !== null && rod < relevantTime){
                    relevantTime = rod
                }
                break
            case "first_portal":
                relevantTime = run["first_portal"]
                break
            case "stronghold":
                relevantTime = run["stronghold"]
                break
            case "end":
                relevantTime = run["end"]
                break
            case "finish":
                relevantTime = run["finish"]
                break
        }
        if(relevantTime != null && relevantTime > 0 && relevantTime <= maxTime){
            r.push(relevantTime)
        }
        lastTime = run.time
    }
    return {r, stopped}
}

export async function GET(request: NextRequest) {
    let name = request.nextUrl.searchParams.get("name")
    let hours = Math.min(9999999, parseInt(request.nextUrl.searchParams.get("hours") || "24"))
    let hoursBetween = Math.min(9999999, parseInt(request.nextUrl.searchParams.get("hoursBetween") || "6"))
    let split = request.nextUrl.searchParams.get("split") || "nether"
    let maxTime = Math.min(99999999, parseInt(request.nextUrl.searchParams.get("maxTime") || "99999999"))
    let names = await getCached(getAllNamesByNick, "getAllNamesByNick", name)
    if(names === null){
        names = await getCached(getAllNamesByTwitch, "getAllNamesByTwitch", name)
        if(names === null){
            return NextResponse.json({error: "Unknown user"}, { status: 404 });
        }
    }
    const days = Math.ceil(hours / 24)
    // Most sessions end inside the newest page; read the whole window only
    // when the walk runs off the end of a full page.
    let runs = await getCached(getAllPlayerRunsByPeriod, "getAllPlayerRunsByPeriod", names.uuid, days, SESSION_PAGE_ROWS)

    const categories = [
        "nether",
        "bastion",
        "fortress",
        "first_structure",
        "second_structure",
        "first_portal",
        "stronghold",
        "end",
        "finish"
    ]

    if(!categories.includes(split)){
        return NextResponse.json({error: "Unknown split"}, { status: 404 });
    }


    if(runs.length === 0){
        return jsonResponse({count: 0, avg: "0:00", ms: 0}, {cacheSeconds: 5, staleSeconds: 10});
    }

    let walk = walkSplit(runs, split, hours, hoursBetween, maxTime)
    if(!walk.stopped && runs.length === SESSION_PAGE_ROWS){
        runs = await getCached(getAllPlayerRunsByPeriod, "getAllPlayerRunsByPeriod", names.uuid, days)
        walk = walkSplit(runs, split, hours, hoursBetween, maxTime)
    }
    const r = walk.r
    if(r.length === 0){
        return jsonResponse({count: 0, avg: "0:00", ms: 0}, {cacheSeconds: 5, staleSeconds: 10});
    }

    const avg = calculateAvg(r)

    return jsonResponse({count: r.length, avg: formatTime(avg), ms: avg}, {cacheSeconds: 5, staleSeconds: 10});
}
