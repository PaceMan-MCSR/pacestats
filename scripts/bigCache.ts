import mysql, { RowDataPacket } from 'mysql2/promise';
import Redis from 'ioredis';
import dotenv from 'dotenv';
import { FastestEntry } from "@/app/types";

interface QtyStats {
    min: number;
    good: number;
}

export const minQtys = new Map<number, { [days: string]: QtyStats }>([
    [1, {
        nether: {min: 5, good: 30},
        bastion: {min: 3, good: 10},
        fortress: {min: 1, good: 5},
        first_structure: {min: 3, good: 10},
        second_structure: {min: 1, good: 5},
        first_portal: {min: 1, good: 5},
        stronghold: {min: 1, good: 3},
        end: {min: 1, good: 2},
        finish: {min: 1, good: 2}
    }],
    [7, {
        nether: {min: 30, good: 80},
        bastion: {min: 5, good: 20},
        fortress: {min: 3, good: 10},
        first_structure: {min: 5, good: 20},
        second_structure: {min: 3, good: 10},
        first_portal: {min: 1, good: 5},
        stronghold: {min: 2, good: 4},
        end: {min: 1, good: 2},
        finish: {min: 1, good: 2}
    }],
    [30, {
        nether: {min: 200, good: 700},
        bastion: {min: 50, good: 80},
        fortress: {min: 5, good: 20},
        first_structure: {min: 30, good: 80},
        second_structure: {min: 5, good: 20},
        first_portal: {min: 5, good: 15},
        stronghold: {min: 3, good: 5},
        end: {min: 1, good: 2},
        finish: {min: 1, good: 2}
    }],
    [9999, {
        nether: {min: 500, good: 2000},
        bastion: {min: 50, good: 600},
        fortress: {min: 30, good: 100},
        first_structure: {min: 50, good: 600},
        second_structure: {min: 30, good: 100},
        first_portal: {min: 10, good: 60},
        stronghold: {min: 5, good: 30},
        end: {min: 4, good: 8},
        finish: {min: 3, good: 5}
    }]
])

export function getMinQty(category: string, days: number) {
    return minQtys.get(days)?.[category]?.min || 0;
}

// --- Setup and Configuration ---
dotenv.config({ path: ".env.local" });

const mysqlConfig = {
    host: process.env.DB_HOST, port: 3306, user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
};
const getConn = () => mysql.createConnection(mysqlConfig);
const redisUrl = process.env.REDIS_URL;
let redis = new Redis(redisUrl!);
let conn: any = null;

// --- Type Definitions and Enums (from your original code) ---
export enum CategoryType {
    COUNT,
    AVG,
    FASTEST,
    CONVERSION,
}

interface Entry {
    uuid: string;
    name: string;
    value: number;
    qty: number;
    avg: number;
}

interface PaceRow {
    id: number;
    nickname: string;
    uuid: string;
    nether: number | null;
    bastion: number | null;
    fortress: number | null;
    first_portal: number | null;
    second_portal: number | null;
    stronghold: number | null;
    end: number | null;
    finish: number | null;
    lootBastion: number | null;
    obtainObsidian: number | null;
    obtainCryingObsidian: number | null;
    obtainRod: number | null;
    insertTime: Date;
}

// --- Helper Functions (ported from your logic) ---

// This function establishes a new connection each time.
// In a real app, you'd use a connection pool. For a script, this is fine.

export const getFirstStructure = (bastion: number | null, fortress: number | null) : number | null => {
    if (bastion !== null && fortress == null) {
        return bastion
    } else if (bastion == null && fortress !== null) {
        return fortress
    }
    if (bastion !== null && fortress !== null) {
        if (bastion < fortress) {
            return bastion
        } else {
            return fortress
        }
    }
    return null
}

export const getSecondStructure = (bastion: number | null, fortress: number | null) : number | null => {
    if(bastion === null || fortress === null){
        return null;
    }
    if (bastion < fortress) {
        return fortress
    } else {
        return bastion
    }
}

function getPreviousSplit(split: string) {
    switch (split) {
        case "bastion":
            return "nether"
        case "fortress":
            return "bastion"
        case "first_structure":
            return "nether"
        case "second_structure":
            return "first_structure"
        case "first_portal":
            return "second_structure"
        case "stronghold":
            return "first_portal"
        case "end":
            return "stronghold"
        case "finish":
            return "end"
        default:
            return null
    }
}

export function calculateAvg(data: number[]): number {
    if(data == null || data.length === 0) return 0
    data = data.sort((a, b) => a - b)
    const length = data.length
    const p98 = length >= 50 ? Math.floor(length * 0.98) : length
    return data.slice(0, p98).reduce((a, b) => a + b, 0) / p98 || 0
}


/**
 * Main function to calculate leaderboards and cache the result in Redis.
 */
async function calculateAndStoreLeaderboards(days: number = 30) {
    console.log("Starting leaderboard calculation process...");
    try {
        // --- 1. FETCH DATA FROM MYSQL ---
        console.log("Connecting to MySQL and fetching data for the last 30 days...");
        let paceRows: PaceRow[] = [];
        if(days !== 9999) {
            const timePeriod = `INTERVAL ${days} DAY`;
            const [rows] = await conn.execute(
                `SELECT id, nickname, uuid,
            nether, bastion, fortress, first_portal, second_portal, stronghold, end, finish,
            lootBastion, obtainObsidian, obtainCryingObsidian, obtainRod
            FROM pace WHERE insertTime >= NOW() - ${timePeriod} ORDER BY id DESC;`
            );
            paceRows = rows as PaceRow[];
        } else {
            const [rows] = await conn.execute(
                `SELECT id, nickname, uuid,
            nether, bastion, fortress, first_portal, second_portal, stronghold, end, finish,
            lootBastion, obtainObsidian, obtainCryingObsidian, obtainRod
            FROM pace ORDER BY id DESC;`
            );
            paceRows = rows as PaceRow[];
        }
        console.log(`Fetched ${paceRows.length} rows from the database.`);

        const filters = [
            CategoryType.AVG,
            CategoryType.COUNT,
            CategoryType.FASTEST,
            CategoryType.CONVERSION
        ]

        // Define stats categories
        const categories = [
            "nether",
            "bastion",
            "first_structure",
            "second_structure",
            "fortress",
            "first_portal",
            "second_portal",
            "stronghold",
            "end",
            "finish"
        ]

        // Init categories
        let leaderboards: { [filter: number]: { [category: string]: Entry[] } } = {}
        for (const filter of filters) {
            leaderboards[filter] = {}
            for (const category of categories) {
                leaderboards[filter][category] = []
            }
        }

        const nickMap = new Map<string, string>()

        let splitData: {
            [uuid: string]: {
                [column: string]: number[]
            }
        } = {}

        let uuids: string[] = []
        // @ts-ignore
        for (let row of paceRows) {
            if (!uuids.includes(row["uuid"])/* && !bans.includes(row["uuid"])*/) {
                uuids.push(row["uuid"])
            }
        }

        for (let uuid of uuids) {
            splitData[uuid] = {}
            for (const category of categories) {
                splitData[uuid][category] = []
            }
            splitData[uuid]["first_structure"] = []
            splitData[uuid]["second_structure"] = []
            splitData[uuid]["fortress"] = []
        }

        // @ts-ignore
        for (let row of paceRows) {
            const uuid = row["uuid"]
            /*if (bans.includes(uuid)) {
                continue
            }*/
            const bastion = row["bastion"]
            const fortress = row["fortress"]
            const firstStructure = getFirstStructure(bastion, fortress)
            const secondStructure = getSecondStructure(bastion, fortress)
            for (const category of categories) {
                // Special case: 1st struct
                if(category === "first_structure"){
                    if(firstStructure !== null){
                        const rod = row["obtainRod"]
                        if(firstStructure === fortress && rod !== null && rod < fortress){
                            splitData[row["uuid"]]["first_structure"].push(rod)
                        } else {
                            splitData[row["uuid"]]["first_structure"].push(firstStructure)
                        }
                    }
                    continue
                }
                // Special case: 2nd struct
                if(category === "second_structure"){
                    if(secondStructure !== null){
                        const id = row["id"]
                        if(id >= 187307){ // when context logging was added, march 29th 2024
                            const rod = row["obtainRod"]
                            if(secondStructure === bastion && (rod === null || rod > secondStructure)){
                                continue
                            }
                            // @ts-ignore
                            if(secondStructure === fortress && (fortress - bastion < 50000)){
                                continue
                            }
                            if(secondStructure === fortress && rod !== null && rod < fortress){
                                splitData[row["uuid"]]["second_structure"].push(rod)
                            } else {
                                splitData[row["uuid"]]["second_structure"].push(secondStructure)
                            }
                        } else {
                            splitData[row["uuid"]]["second_structure"].push(secondStructure)
                        }
                    }
                    continue
                }
                if(category === "fortress"){
                    if(fortress !== null){
                        const rod = row["obtainRod"]
                        if(rod !== null && rod < fortress){
                            splitData[row["uuid"]]["fortress"].push(rod)
                        } else {
                            splitData[row["uuid"]]["fortress"].push(fortress)
                        }
                    }
                    continue
                }
                // Default, fetch stat from row
                // @ts-ignore
                if (row[category] !== null) {
                    if (!nickMap.has(uuid)) {
                        nickMap.set(row["uuid"], row["nickname"])
                    }
                    if(!splitData[uuid]){
                        splitData[uuid] = {}
                    }
                    if(!splitData[uuid][category]){
                        splitData[uuid][category] = []
                    }
                    // @ts-ignore
                    splitData[uuid][category].push(row[category])
                }
            }
        }

        for (let uuid in splitData) {
            for (const cat of categories) {
                for(const filter of filters) {
                    let val = 0
                    if(!splitData[uuid][cat] || splitData[uuid][cat].length === 0){
                        continue
                    }
                    if (filter === CategoryType.COUNT) {
                        val = splitData[uuid][cat].length
                    } else if (filter === CategoryType.AVG) {
                        val = calculateAvg(splitData[uuid][cat])
                    } else if(filter === CategoryType.FASTEST) {
                        val = Math.min(...splitData[uuid][cat])
                    } else if(filter === CategoryType.CONVERSION) {
                        const prev = getPreviousSplit(cat)
                        if (prev !== null) {
                            const oldSplit = splitData[uuid][prev].length
                            const newSplit = splitData[uuid][cat].length
                            val = (newSplit / oldSplit) * 100
                            if(val === Infinity){
                                val = 1
                            }
                        }
                    }
                    if(val > 0) {
                        leaderboards[filter][cat].push({
                            uuid: uuid,
                            name: nickMap.get(uuid) as string,
                            value: val,
                            qty: splitData[uuid][cat].length,
                            avg: calculateAvg(splitData[uuid][cat])
                        })
                    }
                }
            }
        }


        // Sort and truncate categories
        for(const filter of filters) {
            for (const category of categories) {
                let cat = leaderboards[filter][category]
                if(cat == null || cat.length === 0){
                    continue
                }
                // remove empty values
                cat = cat.filter((a) => a.value > 0)


                if (filter === CategoryType.AVG || filter === CategoryType.FASTEST) { // sort ascending (avg, fastest)
                    cat = cat.sort((a, b) => a.value - b.value || b.qty - a.qty)
                } else { // sort descending (qty, conversion)
                    cat = cat.sort((a, b) => b.value - a.value || b.qty - a.qty)
                }

                leaderboards[filter][category] = cat
            }
        }

        // cache top 10
        let topLeaderboards: { [filter: number]: { [category: string]: Entry[] } } = {}
        for (const filter of filters) {
            topLeaderboards[filter] = {}
            for (const category of categories) {
                topLeaderboards[filter][category] = []
            }
        }

        for (const filter of filters) {
            for (const category of categories) {
                const data = leaderboards[filter][category]
                let specific;
                if(filter === CategoryType.CONVERSION){
                    specific = data.filter((x: Entry) => x.qty >= getMinQty(category, days))
                } else if (filter === CategoryType.AVG){
                    specific = data.filter((x: Entry) => x.qty >= getMinQty(category, days))
                } else if (filter === CategoryType.FASTEST){
                    specific = data
                } else {
                    specific = data
                }
                topLeaderboards[filter][category] = specific.slice(0, 10)
            }
        }

        const res1 = await redis.call('JSON.SET', `topLeaderboards:${days}day`, '$', JSON.stringify(topLeaderboards));
        if (res1 !== 'OK') {
            throw new Error(`Failed to store top leaderboards for ${days} days in Redis.`);
        }
        console.log(`\n✅ Successfully cached top leaderboards for ${days} days in Redis.`);

        // --- 6. CACHE THE FINAL RESULT IN REDIS ---
        console.log("Storing calculated leaderboards in Redis...");
        const redisKey = `leaderboards:${days}day`; // A descriptive key
        const result = await redis.call('JSON.SET', redisKey, '$', JSON.stringify(leaderboards));

        if (result === 'OK') {
            console.log(`\n✅ Successfully calculated and cached leaderboards in Redis at key '${redisKey}'`);
        } else {
            throw new Error('Failed to store leaderboards in Redis.');
        }

    } catch (error) {
        console.error("\n❌ An error occurred during the process:", error);
        process.exit(1);
    }
}

async function calculateAndStoreNames() {
    try {
        // --- Step 1: Run two optimized queries in parallel ---

        // Query A: Get the MOST RECENT nickname for EACH distinct UUID.
        // This is a common pattern: Group by uuid to find the max(id), then join back
        // to the table to get the nickname associated with that specific row.
        const latestNicknamesQuery = `
            SELECT p.uuid, p.nickname
            FROM pace p
            INNER JOIN (
                SELECT uuid, MAX(id) as max_id
                FROM pace
                GROUP BY uuid
            ) as latest
            ON p.uuid = latest.uuid AND p.id = latest.max_id;
        `;

        // Query B: Get all non-null twitch usernames for each UUID.
        const allTwitchesQuery = `
            SELECT uuid, twitch
            FROM pace
            WHERE twitch IS NOT NULL;
        `;

        // Execute both queries concurrently using Promise.all for maximum speed
        const [
            [latestNicknameRows],
            [twitchRows]
        ] = await Promise.all([
            conn.execute(latestNicknamesQuery),
            conn.execute(allTwitchesQuery)
        ]);

        // --- Step 2: Combine the results efficiently in memory ---

        // Create a map for quick lookup of nicknames by UUID.
        const nameMap: { [uuid: string]: any } = {};

        // First, populate the map with all UUIDs and their latest nicknames.
        // This ensures every user is included, even if they have no twitch accounts linked.
        for (const row of latestNicknameRows) {
            nameMap[row.uuid] = {
                id: row.uuid,
                nick: row.nickname,
                twitches: [], // Initialize with an empty array
            };
        }

        // Now, iterate through the twitch data and add it to the existing user objects.
        for (const row of twitchRows) {
            // Since we already populated all users, we can be sure nameMap[row.uuid] exists.
            // (Unless there's a data integrity issue where a twitch entry exists for a non-existent UUID)
            if (nameMap[row.uuid]) {
                nameMap[row.uuid].twitches.push(row.twitch);
            }
        }

        // --- Step 3: Store the final result in Redis ---

        const finalUserList = Object.values(nameMap);

        if (finalUserList.length === 0) {
            console.log("No user data found to cache.");
            return;
        }

        const res = await redis.call('JSON.SET', 'users', '$', JSON.stringify(finalUserList));
        if (res !== 'OK') {
            console.error("Failed to set users in Redis:", res);
            return;
        }

        console.log(`User names for ${finalUserList.length} users cached in Redis successfully.`);

    } catch (error) {
        console.error("An error occurred in calculateAndStoreNames:", error);
    }
}

async function calculateAndStorePlayerStats(days: number) {
    const users = JSON.parse(await redis.call('JSON.GET', `users`, '$') as string)[0];
    const lb = JSON.parse(await redis.call('JSON.GET', `leaderboards:${days}day`, '$') as string)[0];

    const filters = [
        CategoryType.AVG,
        CategoryType.COUNT,
        CategoryType.FASTEST,
        CategoryType.CONVERSION
    ]

    const categories = [
        "nether",
        "bastion",
        "first_structure",
        "second_structure",
        "fortress",
        "first_portal",
        "second_portal",
        "stronghold",
        "end",
        "finish"
    ]
    for (const user of users) {
        const uuid = user.id;
        const data: { [category: string]: { [filter: number]: { ranking: number, value: number } } } = {}
        for (const category of categories) {
            data[category] = {}
        }
        for(const filter of filters) {
            for (const category of categories) {
                let minQty = getMinQty(category, days)
                if(filter === CategoryType.FASTEST || filter === CategoryType.COUNT){
                    minQty = 0;
                }
                const board = lb[filter][category]
                let i = 0
                for (const entry of board) {
                    if (entry.qty === 0) continue;
                    if (entry.qty < minQty && entry.uuid !== uuid) continue;
                    i++;
                    if (entry.uuid === uuid) {
                        data[category][filter] = {ranking: entry.qty < minQty ? -1 : i, value: entry.value}
                        break
                    }
                }
            }
        }
        redis.call('JSON.SET', `playerStats:${uuid}:${days}day`, '$', JSON.stringify(data));
    }
    console.log(`\n✅ Successfully cached player stats for ${days} days in Redis.`)
}

async function calculateAndStoreFastest(days: number) {
    const timePeriod = `INTERVAL ${days} DAY`;

    const categories = [
        "nether",
        "bastion",
        "first_structure",
        "second_structure",
        "fortress",
        "first_portal",
        "second_portal",
        "stronghold",
        "end",
        "finish"
    ]

    // Init categories
    let leaderboards: { [category: string]: FastestEntry[] } = {}
    for (const category of categories) {
        leaderboards[category] = []
    }

    const [rows, fields] = await (await getConn()).execute(
        `SELECT id, nickname, uuid, 
        nether, bastion, fortress, first_portal, second_portal, stronghold, end, finish,
        lootBastion, obtainObsidian, obtainCryingObsidian, obtainRod
        FROM pace WHERE insertTime >= NOW() - ${timePeriod} ORDER BY id DESC;`
    )

    const nickMap = new Map<string, string>()

    let splitData: {
        [uuid: string]: {
            [column: string]: { time: number, id: number }[]
        }
    } = {}

    let uuids: string[] = []
    // @ts-ignore
    for (let row of rows) {
        if (!uuids.includes(row["uuid"])) {
            uuids.push(row["uuid"])
        }
    }

    for (let uuid of uuids) {
        splitData[uuid] = {}
        for (const category of categories) {
            splitData[uuid][category] = []
        }
        splitData[uuid]["first_structure"] = []
        splitData[uuid]["second_structure"] = []
    }

    // @ts-ignore
    for (let row of rows) {
        const uuid = row["uuid"]
        const bastion = row["bastion"]
        const fortress = row["fortress"]
        const firstStructure = getFirstStructure(bastion, fortress)
        const secondStructure = getSecondStructure(bastion, fortress)
        for (const category of categories) {
            // Special case: 1st struct
            if(category === "first_structure"){
                if(firstStructure !== null){
                    splitData[row["uuid"]]["first_structure"].push({time: firstStructure, id: row["id"]})
                }
                continue
            }
            // Special case: 2nd struct
            if(category === "second_structure"){
                if(secondStructure !== null){
                    const id = row["id"]
                    if(id >= 187307){ // when context logging was added, march 29th 2024
                        const rod = row["obtainRod"]
                        if(secondStructure === bastion){
                            continue;
                        }
                        /*if(secondStructure === bastion && (rod === null || rod > secondStructure)){
                            continue
                        }*/
                        if(secondStructure === fortress && (fortress - bastion < 50000)){
                            continue
                        }
                    }
                    splitData[row["uuid"]]["second_structure"].push({time: secondStructure, id: row["id"]})
                }
                continue
            }
            // Default, fetch stat from row
            if (row[category] !== null) {
                if (!nickMap.has(uuid)) {
                    nickMap.set(row["uuid"], row["nickname"])
                }
                if(!splitData[uuid]){
                    splitData[uuid] = {}
                }
                if(!splitData[uuid][category]){
                    splitData[uuid][category] = []
                }
                splitData[uuid][category].push({time: row[category], id: row["id"]})
            }
        }
    }

    for (let uuid in splitData) {
        for (const cat of categories) {
            let val = 0
            if(!splitData[uuid][cat] || splitData[uuid][cat].length === 0){
                continue
            }
            val = Math.min(...splitData[uuid][cat].map((a) => a.time))
            if(val > 0) {
                // @ts-ignore
                let runId = splitData[uuid][cat].find((a) => a.time === val).id
                leaderboards[cat].push({
                    uuid: uuid,
                    name: nickMap.get(uuid) as string,
                    value: val,
                    runId: runId
                })
            }
        }
    }


    // Sort and truncate categories
    for (const category of categories) {
        let cat = leaderboards[category]
        if(cat == null || cat.length === 0){
            continue
        }
        // remove empty values
        cat = cat.filter((a) => a.value > 0)
        cat = cat.sort((a, b) => a.value - b.value)
        leaderboards[category] = cat
    }
    redis.call('JSON.SET', `fastestLeaderboards:${days}day`, '$', JSON.stringify(leaderboards));
    console.log(`\n✅ Successfully cached fastest leaderboards for ${days} days in Redis.`)
}

async function calculateAndStoreUserData() {
    try {
        // --- Step 1: Define and Run All Database Queries Concurrently ---

        // Query A: Get the latest nickname for each UUID.
        const latestNicknamesQuery = `
        SELECT p.uuid, p.nickname
        FROM pace p
        INNER JOIN (
            SELECT uuid, MAX(id) as max_id
            FROM pace
            GROUP BY uuid
        ) as latest ON p.uuid = latest.uuid AND p.id = latest.max_id;
    `;

        // Query B: Get all unique (uuid, twitch) pairs for the simple list.
        const allTwitchesQuery = `
        SELECT DISTINCT uuid, twitch
        FROM pace
        WHERE twitch IS NOT NULL;
    `;

        // Query C: Get the top 2 most recent, unique twitch accounts per user using a window function.
        const topTwitchAccountsQuery = `
        SELECT uuid, twitch, time
        FROM (
            SELECT
                uuid,
                twitch,
                UNIX_TIMESTAMP(latest_time) as time,
                ROW_NUMBER() OVER(PARTITION BY uuid ORDER BY latest_time DESC) as rn
            FROM (
                -- This inner query finds the most recent timestamp for each unique (uuid, twitch) pair
                SELECT uuid, twitch, MAX(insertTime) as latest_time
                FROM pace
                WHERE twitch IS NOT NULL
                GROUP BY uuid, twitch
            ) as unique_recent_twitches
        ) as ranked_twitches
        WHERE rn <= 2;
    `;

        // Execute all three queries in parallel for maximum speed
        const [
            [latestNicknameRows],
            [twitchRows],
            [topTwitchAccountRows]
        ] = await Promise.all([
            conn.execute(latestNicknamesQuery),
            conn.execute(allTwitchesQuery),
            conn.execute(topTwitchAccountsQuery)
        ]);

        // --- Step 2: Process and Combine Results in Memory ---

        const userMap: Record<string, any> = {};
        const twitchDetailsMap: any = {};

        // Pass 1: Populate base user data (id, nick) from the nicknames query.
        for (const row of latestNicknameRows) {
            userMap[row.uuid] = {
                id: row.uuid,
                nick: row.nickname,
                twitches: [],
            };
            // Also initialize the entry in our second map.
            twitchDetailsMap[row.uuid] = [];
        }

        // Pass 2: Add the simple list of all twitch usernames to the appropriate users.
        for (const row of twitchRows) {
            if (userMap[row.uuid]) { // Check if user exists to handle potential data inconsistencies
                userMap[row.uuid].twitches.push(row.twitch);
            }
        }

        // Pass 3: Add the detailed twitch account info (top 2) to the details map.
        for (const row of topTwitchAccountRows) {
            if (twitchDetailsMap[row.uuid]) { // Check if user exists
                twitchDetailsMap[row.uuid].push({
                    twitch: row.twitch,
                    time: row.time,
                    live: false
                });
            }
        }

        // --- Step 3: Store Both Datasets in Redis Concurrently ---
        const finalUserList = Object.values(userMap);

        if (finalUserList.length === 0) {
            console.log("No user data found to cache.");
            return;
        }

        const userSetResult = await redis.call('JSON.SET', 'users', '$', JSON.stringify(finalUserList));

        for(const t of Object.keys(twitchDetailsMap)) {
            if (twitchDetailsMap[t].length > 0) {
                redis.call('JSON.SET', `users:twitch_details:${t}`, '$', JSON.stringify(twitchDetailsMap[t]));
            }
        }

        if (userSetResult !== 'OK') {
            console.error("Failed to set 'users' in Redis:", userSetResult);
        } else {
            console.log(`Successfully cached data for ${finalUserList.length} users in 'users' key.`);
        }

    } catch (error) {
        console.error("An error occurred during updateUserCache:", error);
    }
}

export interface NPHResult {
    rtanph: number;
    rnph: number;
    lnph: number;
    count: number;
    avg: number;
    playtime: number;
    walltime: number;
    resets: number;
    totalResets: number;
    seedsPlayed: number;
    rpe: number;
}

export function roundNumber(num: number, decimals: number = 2) {
    return Math.round(num * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

interface NetherPaceRow {
    uuid: string;
    nether: number;
    twitch: string;
    wallTime: number; // Assumed to be in milliseconds
    playTime: number; // Assumed to be in milliseconds
    enters: number;
    isAccurate: boolean | number;
    time: number;     // UNIX timestamp in seconds
    resets: number;
    totalResets: number;
}

// Type for the final calculated data for a single player
interface NphData {
    rtanph: number;      // Nethers per hour (real-time)
    rnph: number;        // Nethers per hour (raw playtime)
    lnph: number;        // Nethers per hour (loadless playtime)
    count: number;       // Total nethers counted
    avg: number;         // Average nether entry time
    playtime: number;    // Total playtime in ms
    walltime: number;    // Total walltime in ms
    resets: number;      // Total resets during these sessions
    totalResets: number; // Player's all-time total resets
    seedsPlayed: number; // Percentage of seeds entered
    rpe: number;         // Resets per enter
}

async function calculateAndStoreNph(days: number) {
    // 1. Fetch data from the database
    const timePeriod = `INTERVAL ${days * 24} HOUR`;
    const [results, _] = await conn.execute(
        `SELECT nethers.uuid, pace.nether as nether, twitch, wallTime, playTime, enters, isAccurate, UNIX_TIMESTAMP(nethers.insertTime) as time, resets, totalResets
        FROM nethers INNER JOIN pace ON nethers.runId=pace.id
        WHERE nethers.insertTime >= NOW() - ${timePeriod} ORDER BY nethers.id DESC;`,
    );

    const rows = results as NetherPaceRow[];

    // 2. Group results by player UUID
    const groupedByUuid: Record<string, NetherPaceRow[]> = rows.reduce((acc, row) => {
        if (!acc[row.uuid]) {
            acc[row.uuid] = [];
        }
        acc[row.uuid].push(row);
        return acc;
    }, {} as Record<string, NetherPaceRow[]>);

    const hoursBetween = days * 24;

    // 3. Process each player's grouped data
    for (const uuid in groupedByUuid) {
        const playerRows = groupedByUuid[uuid];

        // --- Apply the exact calculation logic from the prompt ---
        let wallTime = 0;
        let playTime = 0;
        let firstTime = 0; // Most recent timestamp (since results are sorted DESC)
        let lastTime = 0;  // Oldest timestamp processed in the loop
        let nethers = 0;
        let resets = 0;
        let enters = 0;
        const times: number[] = [];

        for (const row of playerRows) {
            if (firstTime === 0) {
                firstTime = row.time;
            }
            // `diff` is the time gap between this entry and the previous (newer) one
            const diff = lastTime - row.time;
            if (lastTime > 0 && diff > 60 * 60 * hoursBetween) {
                break;
            }
            times.push(row.nether);
            playTime += row.playTime;
            wallTime += row.wallTime;
            lastTime = row.time; // Update `lastTime` to the current (older) timestamp
            nethers += 1;
            if (row.resets > 0) {
                resets += row.resets;
            }
            enters += row.enters;
        }

        // If the loop didn't process any rows for this player, skip them
        if (nethers === 0) {
            continue;
        }

        const avg = calculateAvg(times);

        // RTA (Real-Time Attack) is measured from the first to the last nether.
        // If only one nether, it's measured from that nether until now.
        let elapsedRtaMs = 0;
        if (nethers > 1) {
            elapsedRtaMs = (firstTime - lastTime) * 1000;
        } else {
            elapsedRtaMs = Date.now() - (lastTime * 1000);
        }

        // Convert times from milliseconds to hours for NPH calculation
        const elapsedRtaHours = elapsedRtaMs / (1000 * 60 * 60);
        const totalGameTimeHours = (wallTime + playTime) / (1000 * 60 * 60);
        const playTimeHours = playTime / (1000 * 60 * 60);

        // Store the final calculated data for the player
        const nph = {
            rtanph: roundNumber(elapsedRtaHours > 0 ? nethers / elapsedRtaHours : 0),
            rnph: roundNumber(totalGameTimeHours > 0 ? nethers / totalGameTimeHours : 0),
            lnph: roundNumber(playTimeHours > 0 ? nethers / playTimeHours : 0),
            count: nethers,
            avg: avg,
            playtime: playTime,
            walltime: wallTime,
            resets: resets,
            totalResets: playerRows[0].totalResets, // Taken from the most recent record
            seedsPlayed: roundNumber(resets > 0 ? (enters / resets) * 100 : 0),
            rpe: roundNumber(resets / nethers) // `nethers` is guaranteed to be > 0 here
        };
        redis.call('JSON.SET', `nph:${uuid}:${days}day`, '$', JSON.stringify(nph));
    }
    console.log("Cached NPH data for the last", days, "days in Redis.");
}

async function mmm() {
    conn = await getConn()
    // --- Run the main function ---
    const days = [9999]
    if(days[0] !== 9999){
        await calculateAndStoreUserData();
    }
    for (const day of days) {
        await calculateAndStoreNph(day);
        await calculateAndStoreLeaderboards(day);
        await calculateAndStorePlayerStats(day);
        await calculateAndStoreFastest(day);
    }
    await conn.end();
    await redis.quit();
    process.exit();
}
mmm();