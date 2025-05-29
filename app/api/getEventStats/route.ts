import { NextRequest, NextResponse } from "next/server";
import {
  getCached,
  getAllPlayerRunsByMultiplePeriods,
  calculateAvg,
  getEventInfo
} from "@/app/data";
import { formatTime, getFirstStructure, getSecondStructure } from "@/app/utils";

export async function GET(request: NextRequest) {
  const vanity = request.nextUrl.searchParams.get("vanity")

  if (!vanity) {
    return NextResponse.json({ error: "No event vanity specified" }, { status: 400 });
  }

  // Fetch event data with caching
  const eventInfo = await getCached(getEventInfo, "getEventInfo", vanity);

  if (!eventInfo) {
    return NextResponse.json({ error: "Failed to fetch event data or invalid event data" }, { status: 404 });
  }

  const { whitelist, starts, ends, name } = eventInfo;

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

  // Process each player in the whitelist
  for (let uuid of whitelist) {
    // Initialize data structures for this player
    const allSplits = new Map<string, number[]>()
    for (const category of categories) {
      allSplits.set(category, [])
    }

    // Get runs that fall within any of the specified time periods with caching
    const periodRuns = await getCached(
      getAllPlayerRunsByMultiplePeriods,
      "getAllPlayerRunsByMultiplePeriods",
      uuid,
      starts,
      ends
    );

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

    playerStats[uuid] = playerData
  }

  return NextResponse.json({
    event: {
      name,
      vanity,
      starts,
      ends
    },
    stats: playerStats
  }, { status: 200 });
} 