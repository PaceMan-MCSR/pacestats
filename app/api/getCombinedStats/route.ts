import {NextRequest, NextResponse} from "next/server";
import {
    getCached,
    getAllNamesByNick,
    getAllNamesByTwitch,
    getAllPlayerRunsByPeriod, calculateAvg,
} from "@/app/data";
import {formatTime, getFirstStructure, getSecondStructure} from "@/app/utils";

export async function GET(request: NextRequest) {
    let names = (request.nextUrl.searchParams.get("names") || "").split(",").map(n => n.trim())
    let hours = Math.min(9999999, parseInt(request.nextUrl.searchParams.get("hours") || "24"))
    let hoursBetween = Math.min(9999999, parseInt(request.nextUrl.searchParams.get("hoursBetween") || "6"))
    let start = parseInt(request.nextUrl.searchParams.get("start") || "0")

    const days = Math.ceil(hours / 24)

    let lastTime = 0

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

    const splits = new Map<string, number[]>()
    for (const category of categories) {
        splits.set(category, [])

    }

    let response: { [category: string] : {count: number, avg: string} } = {}

    for(let name of names){
        let n = await getCached(getAllNamesByNick, "getAllNamesByNick", name)
        if(n === null){
            n = await getCached(getAllNamesByTwitch, "getAllNamesByTwitch", name)
            if(n === null) {
                return NextResponse.json({error: "Unknown user: " + n}, {status: 404});
            }
        }
        let runs = await getCached(getAllPlayerRunsByPeriod, "getAllPlayerRunsByPeriod", n.uuid, days)
        for(let run of runs){
            if(start > 0 && run.time < start){
                continue
            }
            let diff = lastTime - run.time
            if(lastTime > 0 && diff > 60 * 60 * hoursBetween){
                break
            }
            if(Date.now() / 1000 - run.time > 60 * 60 * hours){
                break
            }
            const bastion = run["bastion"]
            const fortress = run["fortress"]
            const firstStructure = getFirstStructure(bastion, fortress)
            const secondStructure = getSecondStructure(bastion, fortress)
            const rod = run["obtainRod"] || null
            if(firstStructure != null){
                if(firstStructure === fortress && rod !== null && rod < fortress){
                    splits.get("first_structure")?.push(rod)
                } else {
                    splits.get("first_structure")?.push(firstStructure)
                }
            }
            if(secondStructure != null){
                const id = run["id"]
                if(id >= 187307){ // when context logging was added, march 29th 2024
                    if(!(secondStructure === bastion && (rod === null || rod > secondStructure)) && !(secondStructure === fortress && (fortress - bastion < 50000))){
                        if(secondStructure === fortress && rod !== null && rod < fortress){
                            splits.get("second_structure")?.push(rod)
                        } else {
                            splits.get("second_structure")?.push(secondStructure)
                        }
                    }
                } else {
                    splits.get("second_structure")?.push(secondStructure)
                }
            }

            for (const category of categories) {
                if(category === "first_structure" || category === "second_structure"){
                    continue
                }
                if(run[category] != null){
                    splits.get(category)?.push(run[category])
                }
            }
            lastTime = run.time
        }
    }

    for (const category of categories) {
        const data = splits.get(category) as number[]
        const count = data.length
        if(count === 0){
            response[category] = {count: 0, avg: "0:00"}
        } else {
            response[category] = {count: count, avg: formatTime(calculateAvg(data))}
        }
    }

    return NextResponse.json(response, { status: 200 });
}