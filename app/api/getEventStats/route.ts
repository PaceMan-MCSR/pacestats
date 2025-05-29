import { NextRequest, NextResponse } from "next/server";
import {
  getCached,
  getAllNamesByNick,
  getAllNamesByTwitch,
  getAllPlayerRunsByMultiplePeriods, calculateAvg,
} from "@/app/data";
import { formatTime, getFirstStructure, getSecondStructure } from "@/app/utils";

// Define the Run type based on the properties we're accessing
interface Run {
  time: number;
  bastion?: number;
  fortress?: number;
  obtainRod?: number;
  id: number;
  nether?: number;
  first_portal?: number;
  stronghold?: number;
  end?: number;
  finish?: number;
  [key: string]: number | undefined;
}

export async function GET(request: NextRequest) {
  let names = (request.nextUrl.searchParams.get("names") || "").split(",").map(n => n.trim()).filter(n => n !== "")
  let startTimes = (request.nextUrl.searchParams.get("startTimes") || "").split(",").map(t => parseInt(t)).filter(t => !isNaN(t))
  let endTimes = (request.nextUrl.searchParams.get("endTimes") || "").split(",").map(t => parseInt(t)).filter(t => !isNaN(t))

  if (names.length === 0) {
    return NextResponse.json({ error: "No players specified" }, { status: 400 });
  }

  if (startTimes.length !== endTimes.length) {
    return NextResponse.json({ error: "Number of start times must match number of end times" }, { status: 400 });
  }

  // If no time periods specified, use a single period from 0 to now
  if (startTimes.length === 0) {
    startTimes = [0];
    endTimes = [Math.floor(Date.now() / 1000)];
  }

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

  let playerStats: { [player: string]: { [category: string]: { count: number, avg: string } } } = {}

  for (let name of names) {
    let n = await getCached(getAllNamesByNick, "getAllNamesByNick", name)
    if (n === null) {
      n = await getCached(getAllNamesByTwitch, "getAllNamesByTwitch", name)
      if (n === null) {
        continue; // Skip unknown players
      }
    }

    // Initialize data structures for this player
    const allSplits = new Map<string, number[]>()
    for (const category of categories) {
      allSplits.set(category, [])
    }

    // Get runs that fall within any of the specified time periods
    const periodRuns = await getAllPlayerRunsByMultiplePeriods(n.uuid, startTimes, endTimes);

    // Process all runs that fall within the specified time periods
    for (const run of periodRuns) {
      const bastion = run["bastion"] as number | undefined
      const fortress = run["fortress"] as number | undefined
      const firstStructure = getFirstStructure(
        bastion !== undefined ? bastion : null,
        fortress !== undefined ? fortress : null
      )
      const secondStructure = getSecondStructure(
        bastion !== undefined ? bastion : null,
        fortress !== undefined ? fortress : null
      )
      const rod = run["obtainRod"] as number | undefined || null

      if (firstStructure != null) {
        if (firstStructure === fortress && rod !== null && rod < fortress!) {
          allSplits.get("first_structure")?.push(rod)
        } else {
          allSplits.get("first_structure")?.push(firstStructure)
        }
      }

      if (secondStructure != null) {
        const id = run["id"] as number
        if (id >= 187307) { // when context logging was added, march 29th 2024
          if (!(secondStructure === bastion && (rod === null || (rod !== undefined && rod > secondStructure))) &&
            !(secondStructure === fortress && (fortress !== undefined && bastion !== undefined && (fortress - bastion < 50000)))) {
            if (secondStructure === fortress && rod !== null && fortress !== undefined && rod < fortress) {
              allSplits.get("second_structure")?.push(rod)
            } else {
              allSplits.get("second_structure")?.push(secondStructure)
            }
          }
        } else {
          allSplits.get("second_structure")?.push(secondStructure)
        }
      }

      for (const category of categories) {
        if (category === "first_structure" || category === "second_structure") {
          continue
        }
        const value = run[category] as number | undefined
        if (value != null) {
          allSplits.get(category)?.push(value)
        }
      }
    }

    // Create stats for this player (summed across all time periods)
    let playerData: { [category: string]: { count: number, avg: string } } = {}

    for (const category of categories) {
      const data = allSplits.get(category) as number[]
      const count = data.length
      if (count === 0) {
        playerData[category] = { count: 0, avg: "0:00" }
      } else {
        playerData[category] = { count: count, avg: formatTime(calculateAvg(data)) }
      }
    }

    playerStats[name] = playerData
  }

  return NextResponse.json(playerStats, { status: 200 });
} 