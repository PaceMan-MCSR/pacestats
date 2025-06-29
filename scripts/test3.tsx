import mysql from 'mysql2/promise';
import Redis from 'ioredis';
import dotenv from 'dotenv';

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
const redisUrl = process.env.REDIS_URL;

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
const getConn = () => mysql.createConnection(mysqlConfig);

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
    let mysqlConnection: mysql.Connection | null = null;
    const redisClient = new Redis(redisUrl!);

    try {
        // --- 1. FETCH DATA FROM MYSQL ---
        console.log("Connecting to MySQL and fetching data for the last 30 days...");
        mysqlConnection = await getConn();
        let paceRows: PaceRow[] = [];
        if(days !== 9999) {
            const timePeriod = `INTERVAL ${days} DAY`;
            const [rows] = await mysqlConnection.execute(
                `SELECT id, nickname, uuid, 
            nether, bastion, fortress, first_portal, second_portal, stronghold, end, finish,
            lootBastion, obtainObsidian, obtainCryingObsidian, obtainRod
            FROM pace WHERE insertTime >= NOW() - ${timePeriod} ORDER BY id DESC;`
            );
            paceRows = rows as PaceRow[];
        } else {
            const [rows] = await mysqlConnection.execute(
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

        const res1 = await redisClient.call('JSON.SET', `topLeaderboards:${days}day`, '$', JSON.stringify(topLeaderboards));
        if (res1 !== 'OK') {
            throw new Error(`Failed to store top leaderboards for ${days} days in Redis.`);
        }
        console.log(`\n✅ Successfully cached top leaderboards for ${days} days in Redis.`);

        // --- 6. CACHE THE FINAL RESULT IN REDIS ---
        console.log("Storing calculated leaderboards in Redis...");
        const redisKey = `leaderboards:${days}day`; // A descriptive key
        const result = await redisClient.call('JSON.SET', redisKey, '$', JSON.stringify(leaderboards));

        if (result === 'OK') {
            console.log(`\n✅ Successfully calculated and cached leaderboards in Redis at key '${redisKey}'`);
        } else {
            throw new Error('Failed to store leaderboards in Redis.');
        }

    } catch (error) {
        console.error("\n❌ An error occurred during the process:", error);
        process.exit(1);
    } finally {
        // --- 7. CLEAN UP CONNECTIONS ---
        if (mysqlConnection) {
            await mysqlConnection.end();
            console.log("MySQL connection closed.");
        }
        await redisClient.quit();
        console.log("Redis connection closed.");
    }
}

// --- Run the main function ---
const days = [1, 7, 30]
for (const day of days) {
    calculateAndStoreLeaderboards(day);
}