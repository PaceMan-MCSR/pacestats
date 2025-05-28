import {
    CategoryType, formatTime,
    getEventTime,
    getFirstStructure,
    getMinAAQty,
    getMinQty,
    getSecondStructure,
    roundNumber
} from "@/app/utils";
import mysql from 'mysql2/promise';
import {Entry, FastestEntry} from "@/app/types";
import WebSocket from 'ws';

const NodeCache = require("node-cache");

const cache = new NodeCache({
    stdTTL: 60 * 10, // default 10 mins
    checkperiod: 60 * 60, // 1 hour auto cache clear
    useClones: false
});

const AsyncLock = require("async-lock");
const lock = new AsyncLock();
let conn : mysql.Connection;

const connectDb = async () => {
    conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        multipleStatements: true
    });
    await conn.connect();
}

export const getConn = async () : Promise<mysql.Connection> => {
    if (conn === undefined) {
        await connectDb()
    }
    try {
        // @ts-ignore
        await conn.ping();
    } catch (e) {
        console.error("Error in getConn", e)
        await connectDb()
    }
    return conn;
}

const ttls = {
    getWorld: 5,
    getBans: 60 * 10,
    getUUID: 60 * 60 * 6,
    getAllUsers: 60 * 10,
    getAllNamesByNick: 60 * 10,
    getAllNamesByTwitch: 60 * 10,
    getTwitchAccounts: 60,
    getNick: 60 * 30,
    getNickAlways: 60 * 30,
    isTwitchLive: 30,
    getAllData: 60 * 5,
    getAllAAData: 60 * 5,
    getPlayerRuns: 10,
    getRecentAARuns: 10,
    getAllPlayerRuns: 10,
    getAllPlayerRunsOptimized: 10,
    getAllPlayerRunsByPeriod: 20,
    getRecentTimestamps: 10,
    getLeaderboards: {
        default: 60 * 10,
        "1 day": 60,
        "7 day": 60 * 5,
        "30 day": 60 * 10
    },
    getTrimmedLeaderboards: {
        default: 60 * 10,
        "1 day": 60,
        "7 day": 60 * 5,
        "30 day": 60 * 10
    },
    getFastestLeaderboards: 60 * 30,
    getLiveRuns: 5,
    getWorldLiveData: 5,
    getNPH: 5,
    getLatestRun: 5,
    getRecentNethers: 10,
    getUUIDByAccessKey: 60 * 30,
    getRunId: 60 * 30,
    getNPHLeaderboards: 30,
    getAALB: 30,
    getTrimmedAALB: 30,
    jude: 30,
    getNethersByPeriod: 2,
    getSessionStats: 10,
    getAllUserInfo: 5,
    getAllAARuns: 20,
    getAllPBs: 60,
    getPBs: 10,
    getLowestId: 60,
    getHighestId: 60,
    getRunsPaginated: 60
}

export const getLiveRuns = async () => {
    const res = await fetch(process.env.LIVERUNS_ENDPOINT as string, {
        cache: "no-store"
    })
    return await res.json()
}

export const getWorldLiveData = async (worldId: string) => {
    let data = await getCached(getWorld, "getWorld", worldId)
    const liveRuns = await getCached(getLiveRuns, "getLiveRuns")
    if(data){
        const run = liveRuns.find((run: any) => run.worldId === data.data.worldId)
        data.isLive = !!run && !run.isCheated && !run.isHidden
        if(run){
            data.data = {
                ...data.data,
                nether: getEventTime(run, "rsg.enter_nether", false),
                bastion: getEventTime(run, "rsg.enter_bastion", false),
                fortress: getEventTime(run, "rsg.enter_fortress", false),
                first_portal: getEventTime(run, "rsg.first_portal", false),
                stronghold: getEventTime(run, "rsg.enter_stronghold", false),
                end: getEventTime(run, "rsg.enter_end", false),
                finish: getEventTime(run, "rsg.finish", false),

                netherRta: getEventTime(run, "rsg.enter_nether", true),
                bastionRta: getEventTime(run, "rsg.enter_bastion", true),
                fortressRta: getEventTime(run, "rsg.enter_fortress", true),
                first_portalRta: getEventTime(run, "rsg.first_portal", true),
                strongholdRta: getEventTime(run, "rsg.enter_stronghold", true),
                endRta: getEventTime(run, "rsg.enter_end", true),
                finishRta: getEventTime(run, "rsg.finish", true),
            }
        }
    }
    return data
}

export const getWorld = async (worldId: string) => {
    let results;
    let fields;
    if(worldId.length < 20){
        [results, fields] = await (await getConn()).execute(
            `SELECT id, worldId, nickname, uuid, twitch, nether, bastion, fortress, first_portal, stronghold, end, finish, 
        netherRta, bastionRta, fortressRta, first_portalRta, strongholdRta, endRta, finishRta,
        UNIX_TIMESTAMP(insertTime) as insertTime, UNIX_TIMESTAMP(lastUpdated) as updateTime, UNIX_TIMESTAMP(realUpdated) as realUpdate,
        vodId, vodOffset
        FROM pace WHERE id=? ORDER BY id ASC LIMIT 1;`,
            [worldId]
        );
    } else {
        [results, fields] = await (await getConn()).execute(
            `SELECT id, worldId, nickname, uuid, twitch, nether, bastion, fortress, first_portal, stronghold, end, finish, 
        netherRta, bastionRta, fortressRta, first_portalRta, strongholdRta, endRta, finishRta,
        UNIX_TIMESTAMP(insertTime) as insertTime, UNIX_TIMESTAMP(lastUpdated) as updateTime, UNIX_TIMESTAMP(realUpdated) as realUpdate,
        vodId, vodOffset
        FROM pace WHERE worldId=? ORDER BY id ASC LIMIT 1;`,
            [worldId]
        );
    }

    if (Array.isArray(results) && results.length === 0) {
        return null;
    }
    // @ts-ignore
    return {data: results[0], time: Date.now()};
};

export const getBans = async () => {
    return []
    /*const [results, fields] = await (await getConn()).execute(
        `SELECT uuid FROM bans;`
    );
    if (Array.isArray(results) && results.length === 0) {
        return null;
    }
    // @ts-ignore
    const uuids = results.map((x: any) => x["uuid"]);
    return uuids;*/
}

export const getUUID = async (nick: string) => {
    const [results, fields] = await (await getConn()).execute(
        `SELECT uuid FROM pace WHERE nickname=? ORDER BY id DESC LIMIT 1;`,
        [nick]
    );
    if (Array.isArray(results) && results.length === 0) {
        return null;
    }
    // @ts-ignore
    return results[0]["uuid"];
};

export const deleteRun = async (id: string) => {
    const [results, fields] = await (await getConn()).execute(
        `DELETE FROM nethers WHERE runId=? LIMIT 1;`,
        [id]
    );
    const [results2, fields2] = await (await getConn()).execute(
        `DELETE FROM pace WHERE id=? LIMIT 1;`,
        [id]
    );
    // @ts-ignore
    return results2.affectedRows === 1;
};

export const getAllUsers = async () => {
    const bans = await getCached(getBans, "getBans");
    const [results, fields] = await (await getConn()).execute(
        `SELECT DISTINCT uuid, twitch FROM pace;`
    );
    if (Array.isArray(results) && results.length === 0) {
        return null;
    }
    const nameMap : {
        [uuid: string]: { id: string, nick: string, twitches: string[] }
    } = {}
    // @ts-ignore
    for(const row of results){
        const uuid = row["uuid"];
        if(bans.includes(uuid)){
            continue;
        }
        const nick = await getCached(getNick, "getNick", uuid);
        const twitch = row["twitch"];
        if(twitch === null){
            if(!nameMap.hasOwnProperty(uuid)){
                nameMap[uuid] = {id: uuid, nick: nick, twitches: []};
            }
        } else {
            if (nameMap.hasOwnProperty(uuid)) {
                nameMap[uuid].twitches.push(twitch);
            } else {
                nameMap[uuid] = {id: uuid, nick: nick, twitches: [twitch]};
            }
        }
    }
    return Object.values(nameMap);
}

export const getAllNamesByNick = async (nick: string) => {
    const [results, fields] = await (await getConn()).execute(
        `SELECT uuid, nickname FROM pace WHERE nickname=? ORDER BY id DESC LIMIT 1;`,
        [nick]
    );
    if (Array.isArray(results) && results.length === 0) {
        return null;
    }
    const bans = await getCached(getBans, "getBans");
    // @ts-ignore
    if(bans.includes(results[0]["uuid"])){
        return null;
    }
    // @ts-ignore
    return {nick: await getCached(getNick, "getNick", results[0]["uuid"]), uuid: results[0]["uuid"]};
}

export const getAllNamesByTwitch = async (twitch: string) => {
    const [results, fields] = await (await getConn()).execute(
        `SELECT uuid, nickname FROM pace WHERE twitch=? ORDER BY id DESC LIMIT 1;`,
        [twitch]
    );
    if (Array.isArray(results) && results.length === 0) {
        return null;
    }
    const bans = await getCached(getBans, "getBans");
    // @ts-ignore
    if(bans.includes(results[0]["uuid"])){
        return null;
    }
    // @ts-ignore
    return {nick: await getCached(getNick, "getNick", results[0]["uuid"]), uuid: results[0]["uuid"]};
}

export const getTwitchAccounts = async (uuid: string) => {
    const [results, fields] = await (await getConn()).execute(
        `SELECT twitch, UNIX_TIMESTAMP(insertTime) AS time FROM pace WHERE uuid=? AND twitch IS NOT NULL ORDER BY insertTime DESC;`,
        [uuid]
    ) as any[];
    if (Array.isArray(results) && results.length === 0) {
        return null;
    }
    const bans = await getCached(getBans, "getBans");
    if(bans.includes(uuid)){
        return null;
    }

    const twitches: { twitch: string, time: number }[] = [];
    for (const row of results) {
        if (twitches.some((t: any) => t.twitch === row["twitch"])) {
            continue
        }
        twitches.push({twitch: row["twitch"], time: row["time"]})
    }
    return twitches.slice(0, 2);
}

export const getNick = async (uuid: string) => {
    const [results, fields] = await (await getConn()).execute(
        `SELECT nickname FROM pace WHERE uuid=? ORDER BY id DESC LIMIT 1;`,
        [uuid]
    );

    if (Array.isArray(results) && results.length === 0) {
        return null;
    }

    const bans = await getCached(getBans, "getBans");
    if(bans.includes(uuid)){
        return null;
    }

    // @ts-ignore
    return results[0]["nickname"];
}

export const getNickAlways = async (uuid: string) => {
    let nick = await getCached(getNick, "getNick", uuid);
    if(nick !== null){
        return nick;
    }
    const res = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`)
    if(res.status !== 200){
        return "Unknown"
    } else {
        return (await res.json()).name
    }
}

export const isTwitchLive = async (twitch: string) => {
    return false; // TODO fix
    let isLive = false
    const res = await fetch(`https://static-cdn.jtvnw.net/previews-ttv/live_user_${twitch}-80x45.jpg`, {
        cache: "no-store"
    })
    if (res.status !== 200) {
        console.log("Error checking if " + twitch + " is live: " + res.status)
        return false
    }
    isLive = res.headers.get('vary') === null
    return isLive
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

function getPreviousAASplit(split: string) {
    switch (split) {
        case "bastion":
            return "nether"
        case "fortress":
            return "bastion"
        case "stronghold":
            return "fortress"
        case "end":
            return "stronghold"
        case "elytra":
            return "end"
        case "credits":
            return "elytra"
        case "finish":
            return "credits"
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

export const getAllData = async (interval: string = "30 DAY", filterCategory: string) => {
    const timePeriod = "INTERVAL " + interval;
    const [rows, fields] = await (await getConn()).execute(
        `SELECT id, nickname, uuid, twitch, nether, bastion, fortress, first_portal, second_portal,
        stronghold, end, finish, insertTime, worldId, vodId, vodOffset, obtainObsidian, obtainCryingObsidian, obtainRod,
        lastUpdated, realUpdated
        FROM pace WHERE insertTime >= NOW() - ${timePeriod};`
    )
    return rows
}

export const getAllAAData = async (interval: string = "30 DAY", filterCategory: string) => {
    const timePeriod = "INTERVAL " + interval;
    const [rows, fields] = await (await getConn()).execute(
        `SELECT * FROM aa WHERE insertTime >= NOW() - ${timePeriod};`
    )
    return rows
}

export const getPlayerRuns = async (uuid: string, limit : number = 5) => {
    const bans = await getCached(getBans, "getBans");
    if (bans.includes(uuid)) {
        return []
    }
    const [rows, fields] = await (await getConn()).execute(
        `SELECT *, UNIX_TIMESTAMP(insertTime) AS time FROM pace WHERE uuid=? AND (bastion > 0 AND fortress > 0) ORDER BY id DESC LIMIT ${limit};`,
        [uuid]
    )
    return rows
}

export const getRecentAARuns = async (uuid: string, limit : number = 5) => {
    const [rows, fields] = await (await getConn()).execute(
        `SELECT *, UNIX_TIMESTAMP(insertTime) AS time FROM aa WHERE uuid=? AND (elytra > 0) ORDER BY id DESC LIMIT ${limit};`,
        [uuid]
    )
    return rows
}

export const getAllAARuns = async (uuid: string) => {
    const [rows, fields] = await (await getConn()).execute(
        `SELECT *, UNIX_TIMESTAMP(insertTime) AS time FROM aa WHERE uuid=? ORDER BY id DESC;`,
        [uuid]
    )
    return rows
}

export const getAllPlayerRuns = async (uuid: string, limit : number = 100) => {
    const bans = await getCached(getBans, "getBans");
    if (bans.includes(uuid)) {
        return []
    }
    const [rows, fields] = await (await getConn()).execute(
        `SELECT *, UNIX_TIMESTAMP(insertTime) AS time, UNIX_TIMESTAMP(lastUpdated) AS updatedTime FROM pace WHERE uuid=? ORDER BY id DESC LIMIT ${limit};`,
        [uuid]
    )
    return rows
}

export const getAllUserInfo = async () => {
    const [rows, fields] = await (await getConn()).execute(
        `SELECT uuid, displayName, color, bgColor FROM users;`
    )
    return rows
}

export const getAllPlayerRunsOptimized = async (uuid: string) => {
    const [rows, fields] = await (await getConn()).execute(
        `SELECT id, nether, bastion, fortress, 
            CASE
                WHEN bastion is null and fortress is null THEN null
                WHEN bastion is null and fortress is not null THEN fortress
                WHEN bastion is not null and fortress is null THEN bastion 
                WHEN bastion <= fortress then bastion 
                ELSE fortress 
            END as first_structure, 
            CASE 
                WHEN bastion is null and fortress is null THEN null
                WHEN bastion is null and fortress is not null THEN null
                WHEN bastion is not null and fortress is null THEN null
                WHEN bastion <= fortress then fortress
                ELSE bastion 
            END as second_structure, 
            first_portal,
            stronghold, 
            end,
            finish, 
            lastUpdated,
            vodId,
            twitch
        FROM pace
        WHERE uuid=? ORDER BY id DESC;`,
        [uuid]
    )
    return rows
}

export const getLatestRun = async (uuid: string) => {
    const [rows, fields] = await (await getConn()).execute<[]>(
        `SELECT id, netherRta, UNIX_TIMESTAMP(insertTime) AS time FROM pace WHERE uuid=? ORDER BY id DESC LIMIT 1;`,
        [uuid]
    )
    if(rows.length === 0) return []
    return rows
}

export const getAllPlayerRunsByPeriod = async (uuid: string, days: number, limit : number = 9999999, liveOnly: boolean = false) => {
    let query = `SELECT id, nether, bastion, fortress, first_portal, stronghold, end, finish, 
        lootBastion, obtainObsidian, obtainCryingObsidian, obtainRod,
        UNIX_TIMESTAMP(insertTime) AS time, UNIX_TIMESTAMP(lastUpdated) AS updatedTime, UNIX_TIMESTAMP(realUpdated) AS realUpdated
        FROM pace WHERE uuid=? AND insertTime >= NOW() - INTERVAL ? DAY ORDER BY id DESC LIMIT ${limit};`;
    if(liveOnly){
        query = `SELECT id, nether, bastion, fortress, first_portal, stronghold, end, finish, 
        lootBastion, obtainObsidian, obtainCryingObsidian, obtainRod,
        UNIX_TIMESTAMP(insertTime) AS time, UNIX_TIMESTAMP(lastUpdated) AS updatedTime, UNIX_TIMESTAMP(realUpdated) AS realUpdated
        FROM pace WHERE uuid=? AND twitch IS NOT NULL AND insertTime >= NOW() - INTERVAL ? DAY ORDER BY id DESC LIMIT ${limit};`;
    }
    const [rows, fields] = await (await getConn()).execute(
        query,
        [uuid, days]
    )
    return rows
}

export const getNethersByPeriod = async (uuid: string, days: number, limit : number = 9999999, liveOnly: boolean = false) => {
    let query = `SELECT nether, UNIX_TIMESTAMP(insertTime) AS time FROM pace WHERE uuid=? AND insertTime >= NOW() - INTERVAL ? DAY ORDER BY id DESC LIMIT ${limit};`;
    if(liveOnly){
        query = `SELECT nether, UNIX_TIMESTAMP(insertTime) AS time FROM pace WHERE uuid=? AND twitch IS NOT NULL AND insertTime >= NOW() - INTERVAL ? DAY ORDER BY id DESC LIMIT ${limit};`;
    }
    const [rows, fields] = await (await getConn()).execute(
        query,
        [uuid, days]
    )
    return rows
}

export const jude = async (uuid: string) => {
    let query = `SELECT id, nether, bastion, fortress, first_portal, stronghold, end, finish, 
        lootBastion, obtainObsidian, obtainCryingObsidian, obtainRod,
        UNIX_TIMESTAMP(insertTime) AS time, UNIX_TIMESTAMP(lastUpdated) AS updatedTime, UNIX_TIMESTAMP(realUpdated) AS realUpdated
        FROM pace WHERE uuid=? AND finish IS NOT NULL AND insertTime >= NOW() - INTERVAL ? DAY ORDER BY id DESC LIMIT 1;`;
    const [rows, fields] = await (await getConn()).execute(
        query,
        [uuid]
    )
    return rows
}

export const getRecentTimestamps = async (uuid: string, limit : number = 5, onlyFortress : boolean = false) => {
    const bans = await getCached(getBans, "getBans");
    if (bans.includes(uuid)) {
        return []
    }
    let query = `SELECT *, UNIX_TIMESTAMP(insertTime) AS insertTime, UNIX_TIMESTAMP(lastUpdated) AS updateTime, UNIX_TIMESTAMP(realUpdated) AS realUpdate FROM pace WHERE uuid=? ORDER BY id DESC LIMIT ${limit};`
    if(onlyFortress){
        query = `SELECT *, UNIX_TIMESTAMP(insertTime) AS insertTime, UNIX_TIMESTAMP(lastUpdated) AS updateTime, UNIX_TIMESTAMP(realUpdated) AS realUpdate FROM pace WHERE uuid=? AND bastion > 0 AND fortress > 0 ORDER BY id DESC LIMIT ${limit};`
    }
    const [rows, fields] = await (await getConn()).execute(
        query,
        [uuid]
    )
    return rows
}

// func name is passed as string because func.name breaks in minified prod builds
export const getCached = async (func: Function, funcName: string, ...args: any[]) => {
    const key = funcName + args.map(arg => arg.toString()).join("")
    await lock.acquire(key, async () => {
        if(cache.has(key)){
            return cache.get(key)
        }
        const result = await func(...args)
        // @ts-ignore
        let ttl = ttls[funcName]
        if(ttl instanceof Object){
            ttl = ttl[args[0]] || ttl.default
        }
        cache.set(key, result, ttl)
    })
    return cache.get(key)
}

export const getTrimmedLeaderboards = async (days: number, limit = 10, skipFastest = false) => {
    const lb = await getCached(getLeaderboards, "getLeaderboards", days + " DAY")
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
    let leaderboards: { [filter: number]: { [category: string]: Entry[] } } = {}
    for (const filter of filters) {
        leaderboards[filter] = {}
        for (const category of categories) {
            leaderboards[filter][category] = []
        }
    }
    for (const filter of filters) {
        if(filter === CategoryType.FASTEST && skipFastest){
            continue
        }
        for (const category of categories) {
            const data = lb[filter][category]
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
            leaderboards[filter][category] = specific.slice(0, limit)
        }
    }
    return leaderboards
}

export const getTrimmedAALB = async (days: number, limit = 10, skipFastest = false) => {
    const lb = await getCached(getAALB, "getAALB", days + " DAY")
    const filters = [
        CategoryType.AVG,
        CategoryType.COUNT,
        CategoryType.FASTEST,
        CategoryType.CONVERSION
    ]
    const categories = [
        "nether",
        "bastion",
        "fortress",
        "stronghold",
        "end",
        "elytra",
        "credits",
        "finish"
    ]
    let leaderboards: { [filter: number]: { [category: string]: Entry[] } } = {}
    for (const filter of filters) {
        leaderboards[filter] = {}
        for (const category of categories) {
            leaderboards[filter][category] = []
        }
    }
    for (const filter of filters) {
        if(filter === CategoryType.FASTEST && skipFastest){
            continue
        }
        for (const category of categories) {
            const data = lb[filter][category]
            let specific;
            if(filter === CategoryType.CONVERSION){
                specific = data.filter((x: Entry) => x.qty >= getMinAAQty(category, days))
            } else if (filter === CategoryType.AVG){
                specific = data.filter((x: Entry) => x.qty >= getMinAAQty(category, days))
            } else if (filter === CategoryType.FASTEST){
                specific = data
            } else {
                specific = data
            }
            leaderboards[filter][category] = specific.slice(0, limit)
        }
    }
    return leaderboards
}

export const getLeaderboards = async (interval: string = "30 DAY") => {
    // How far back to look for entries
    const timePeriod = "INTERVAL " + interval;

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

    const [rows, fields] = await (await getConn()).execute(
        `SELECT id, nickname, uuid, 
        nether, bastion, fortress, first_portal, second_portal, stronghold, end, finish,
        lootBastion, obtainObsidian, obtainCryingObsidian, obtainRod
        FROM pace WHERE insertTime >= NOW() - ${timePeriod} ORDER BY id DESC;`
    )

    //const bans = await getCached(getBans, "getBans");

    const nickMap = new Map<string, string>()

    let splitData: {
        [uuid: string]: {
            [column: string]: number[]
        }
    } = {}

    let uuids: string[] = []
    // @ts-ignore
    for (let row of rows) {
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
    for (let row of rows) {
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
    return leaderboards;
};

export const getAALB = async (interval: string = "30 DAY") => {
    const timePeriod = "INTERVAL " + interval;

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
        "fortress",
        "stronghold",
        "end",
        "elytra",
        "credits",
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

    const [rows, fields] = await (await getConn()).execute(
        `SELECT id, nickname, uuid, 
        nether, bastion, fortress, stronghold, end, elytra, credits, finish
        FROM aa WHERE insertTime >= NOW() - ${timePeriod} ORDER BY id DESC;`
    )

    const nickMap = new Map<string, string>()

    let splitData: {
        [uuid: string]: {
            [column: string]: number[]
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
    }

    // @ts-ignore
    for (let row of rows) {
        const uuid = row["uuid"]
        const nether = row["nether"]
        const end = row["end"]
        const elytra = row["elytra"]
        const credits = row["credits"]
        const finish = row["finish"]
        if(nether < 120_000 && end === null){
            continue
        }
        if(credits !== null && elytra === null){
            continue
        }
        for (const category of categories) {
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
                    const prev = getPreviousAASplit(cat)
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
    return leaderboards;
};

export const getNPHLeaderboards = async (days: number) => {
    // How far back to look for entries
    const timePeriod = "INTERVAL " + days + " DAY";

    let query = `SELECT pace.nickname, pace.uuid, pace.nether as nether, wallTime, playTime, UNIX_TIMESTAMP(nethers.insertTime) as time
        FROM nethers INNER JOIN pace ON nethers.runId=pace.id 
        WHERE nethers.insertTime >= NOW() - ${timePeriod} ORDER BY nethers.id DESC;`;

    const [rows, _] = await (await getConn()).execute<any[]>(
        query,
    );
    const nickMap = new Map<string, string>()
    let uuids: string[] = []
    // @ts-ignore
    for (let row of rows) {
        if (!uuids.includes(row["uuid"])) {
            uuids.push(row["uuid"])
        }
    }

    const data: {[uuid: string] : {
        enters: number,
        enterTime: number,
        wallTime: number,
        playTime: number
    } } = {};

    let output: {
        uuid: string,
        nick: string,
        qty: number,
        avg: number,
        nph: number
    }[] = [];

    for (let uuid of uuids) {
        data[uuid] = {enters: 0, enterTime: 0, wallTime: 0, playTime: 0}
    }

    // @ts-ignore
    for (let row of rows) {
        const uuid = row["uuid"]
        if (!nickMap.has(uuid)) {
            nickMap.set(row["uuid"], row["nickname"])
        }
        data[uuid]["enterTime"] += row["nether"]
        data[uuid]["wallTime"] += row["wallTime"]
        data[uuid]["playTime"] += row["playTime"]
        data[uuid]["enters"] += 1
    }


    for (let uuid in data) {
        const wallTime = data[uuid]["wallTime"]
        const playTime = data[uuid]["playTime"]
        const enterTime = data[uuid]["enterTime"]
        const qty = data[uuid]["enters"]
        const avg = enterTime / qty
        /*if(qty < 500 || avg > 95000){
            continue
        }*/

        const nph = qty / (((wallTime + playTime) / 1000) / 60 / 60)

        output.push({
            uuid: uuid,
            nick: nickMap.get(uuid) as string,
            qty: qty,
            avg: avg,
            nph: roundNumber(nph)
        })
    }

    return output;
};

export const getFastestLeaderboards = async (interval: string = "30 DAY") => {
    // How far back to look for entries
    const timePeriod = "INTERVAL " + interval;

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
                        if(secondStructure === bastion && (rod === null || rod > secondStructure)){
                            continue
                        }
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
    return leaderboards;
};

export const getRecentNethers = async (uuid: string, limit: number = 100, liveOnly: boolean = false) => {
    let query = `SELECT runId, pace.nether, pace.vodId, twitch, wallTime, playTime, enters, isAccurate, UNIX_TIMESTAMP(nethers.insertTime) as time, resets, totalResets, sceneChanges
        FROM nethers INNER JOIN pace ON nethers.runId=pace.id 
        WHERE nethers.uuid=? ORDER BY nethers.id DESC;`;
    if (liveOnly) {
        query = `SELECT runId, pace.vodId, pace.nether, twitch, wallTime, playTime, enters, isAccurate, UNIX_TIMESTAMP(nethers.insertTime) as time, resets, totalResets, sceneChanges
        FROM nethers INNER JOIN pace ON nethers.runId=pace.id 
        WHERE nethers.uuid=? AND pace.twitch IS NOT NULL ORDER BY nethers.id DESC;`;
    }
    const [results, _] = await (await getConn()).execute<any[]>(
        query,
        [uuid]
    );

    return results;
}

export const getNPH = async (uuid: string, hours: number, hoursBetween: number, liveOnly: boolean = false) => {
    const timePeriod = "INTERVAL " + hours + " HOUR";
    let query = `SELECT pace.nether as nether, twitch, wallTime, playTime, enters, isAccurate, UNIX_TIMESTAMP(nethers.insertTime) as time, resets, totalResets
        FROM nethers INNER JOIN pace ON nethers.runId=pace.id 
        WHERE nethers.uuid=? AND nethers.insertTime >= NOW() - ${timePeriod} ORDER BY nethers.id DESC;`;
    if (liveOnly) {
        query = `SELECT pace.nether as nether, twitch, wallTime, playTime, enters, isAccurate, UNIX_TIMESTAMP(nethers.insertTime) as time, resets, totalResets
        FROM nethers INNER JOIN pace ON nethers.runId=pace.id 
        WHERE nethers.uuid=? AND pace.twitch IS NOT NULL AND nethers.insertTime >= NOW() - ${timePeriod} ORDER BY nethers.id DESC;`;
    }
    const [results, _] = await (await getConn()).execute<any[]>(
        query,
        [uuid]
    );

    if (results.length === 0) {
        return {
            rtanph: 0,
            rnph: 0,
            lnph: 0,
            count: 0,
            avg: 0,
            playtime: 0,
            walltime: 0,
            resets: 0,
            totalResets: 0,
            seedsPlayed: 0,
            rpe: 0
        };
    }

    let wallTime = 0;
    let playTime = 0;
    let firstTime = 0;
    let lastTime = 0;
    let nethers = 0;
    let resets = 0;
    let enters = 0;
    let times = [];
    for (const row of results) {
        if(firstTime === 0){
            firstTime = row.time
        }
        let diff = lastTime - row.time
        if(lastTime > 0 && diff > 60 * 60 * hoursBetween){
            break
        }
        times.push(row.nether)
        playTime += row.playTime;
        wallTime += row.wallTime;
        lastTime = row.time;
        nethers += 1;
        if(row.resets > 0) {
            resets += row.resets;
        }
        enters += row.enters;
    }
    let avg = calculateAvg(times)

    let elapsedRta = Date.now() - (lastTime * 1000)
    if(nethers > 1){
        elapsedRta = (firstTime - lastTime) * 1000
    }

    return {
        rtanph: roundNumber(nethers / (elapsedRta / 1000 / 60 / 60)),
        rnph: roundNumber(nethers / (((wallTime + playTime) / 1000) / 60 / 60)),
        lnph: roundNumber(nethers / (playTime / 1000 / 60 / 60)),
        count: nethers,
        avg: avg,
        playtime: playTime,
        walltime: wallTime,
        resets: resets,
        totalResets: results[0].totalResets,
        seedsPlayed: roundNumber((enters / resets) * 100),
        rpe: roundNumber(resets / nethers)
    };
}

export const submitStats = async (
    uuid: string,
    runId: number,
    wallTime: number,
    playTime: number,
    seedsPlayed: number,
    resets: number,
    totalResets: number,
    netherTime: number
) => {
    await (await getConn()).execute(
        `INSERT INTO nethers 
    (uuid, runId, wallTime, playTime, enters, isAccurate, resets, totalResets, netherTime, sceneChanges)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuid, runId, wallTime, playTime, seedsPlayed, true, resets, totalResets, netherTime, 0]
    )
    try {
        const ws = new WebSocket(`${process.env.PRIVATE_WS}/push/${uuid}/${process.env.WS_TOKEN}`);
        ws.on("open", () => {
            ws.close();
        });
    } catch (e) {
        console.error("Error connecting to ws:", e)
    }
}

export const getUUIDByAccessKey = async (accessKey: string) => {
    try {
        const url = process.env.GETUSER_ENDPOINT
        const res = await fetch(`${url}?accessCode=${accessKey}`, {
            cache: "no-store"
        });
        const data = await res.json();
        if (res.status !== 200) {
            return null;
        }
        return data.uuid;
    } catch (e) {
        console.error("Error checking accessKey " + accessKey + ":", e)
        return null;
    }
}

export const getRunId = async (uuid: string, worldId: string) => {
    const [results, fields] = await (await getConn()).execute<any>(
        `SELECT id FROM pace WHERE uuid=? AND worldId=? LIMIT 1;`,
        [uuid, worldId]
    );
    if(results.length === 0) {
        return null;
    }

    return results[0].id;
}

export const getSessionStats = async (uuid: string, hours: number, hoursBetween: number) => {
    const days = Math.ceil(hours / 24)
    const runs = await getCached(getAllPlayerRunsByPeriod, "getAllPlayerRunsByPeriod", uuid, days)

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

    if(runs.length === 0){
        for (const category of categories) {
            response[category] = {count: 0, avg: "0:00"}
        }
        return response
    }

    for(let run of runs){
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
                const rod = run["obtainRod"]
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

    for (const category of categories) {
        const data = splits.get(category) as number[]
        const count = data.length
        if(count === 0){
            response[category] = {count: 0, avg: "0:00"}
        } else {
            response[category] = {count: count, avg: formatTime(calculateAvg(data))}
        }
    }
    return response
}

export const getAllPBs = async () => {
    const users = await getCached(getAllUsers, "getAllUsers")
    let query = `select min(finish) as finish, uuid, UNIX_TIMESTAMP(insertTime) as timestamp from pace where finish is not null group by uuid order by finish asc`;
    const [results, _] = await (await getConn()).execute<any[]>(
      query,
    );
    for (let result of results) {
        let user = users.find((x: any) => x.id === result.uuid)
        if(user){
            result.name = user.nick
        }
        result.pb = formatTime(result.finish)
    }
    results.sort((a, b) => a.finish - b.finish)
    return results;
}

export const getPBs = async (nicks: string[], uuids: string[]) => {
    const all = await getCached(getAllPBs, "getAllPBs")
    if(nicks.length > 0){
        return all.filter((x: any) => nicks.includes(x.name))
    }
    if(uuids.length > 0){
        return all.filter((x: any) => uuids.includes(x.uuid))
    }
    return all;
}

export const getLowestId = async () => {
    const [results, _] = await (await getConn()).execute<any[]>(
        `SELECT id FROM pace ORDER BY id ASC LIMIT 1;`
    );
    return results[0].id;
}

export const getHighestId = async () => {
    const [results, _] = await (await getConn()).execute<any[]>(
        `SELECT id FROM pace ORDER BY id DESC LIMIT 1;`
    );
    return results[0].id;
}

function filterNullValues(obj: any) {
    return Object.entries(obj).reduce((acc, [key, value]) => {
        if (value !== null) {
            // @ts-ignore
            acc[key] = value;
        }
        return acc;
    }, {});
}

function filterNullValuesInArray(arrayOfObjects: any) {
    return arrayOfObjects.map(filterNullValues);
}

export const getRunsPaginated = async (page: number, pageSize: number) => {
    const minId = await getCached(getLowestId, "getLowestId");
    const maxId = await getCached(getHighestId, "getHighestId");
    const pageCount = Math.ceil((maxId - minId) / pageSize);
    if(page < 1 || page > pageCount){
        return {
            error: "Invalid page number",
            pageCount: pageCount,
            runs: []
        }
    }
    const minForPage = minId + (page - 1) * pageSize;
    const maxForPage = minForPage + pageSize;
    const [results, _] = await (await getConn()).execute<any[]>(
      `SELECT id, nickname, uuid, twitch, nether, bastion, fortress, first_portal, second_portal,
        stronghold, end, finish, insertTime as time, worldId, vodId, vodOffset, obtainObsidian, obtainCryingObsidian, obtainRod
        FROM pace WHERE id >= ? AND id < ? ORDER BY id DESC;`,
      [minForPage, maxForPage]
    );
    return {
        pageCount,
        runs: filterNullValuesInArray(results)
    };
}