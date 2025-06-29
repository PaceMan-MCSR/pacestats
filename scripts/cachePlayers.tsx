import mysql from 'mysql2/promise';
import Redis from 'ioredis';
import dotenv from 'dotenv';
import { getBans, getCached, getNick } from "@/app/data";


// --- Setup and Configuration ---
dotenv.config({ path: ".env.local" });

const mysqlConfig = {
    host: process.env.DB_HOST, port: 3306, user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
};
const redisUrl = process.env.REDIS_URL;

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

/**
 * Main function to calculate leaderboards and cache the result in Redis.
 */
async function calculateAndStoreNames() {
    console.log("Starting player calculation process...");
    let mysqlConnection: mysql.Connection | null = null;
    const redisClient = new Redis(redisUrl!);

    try {
        console.log("Connecting to MySQL and fetching data...");
        mysqlConnection = await getConn();
        const [results, fields] = await (mysqlConnection).execute(
            `SELECT DISTINCT uuid, twitch FROM pace;`
        );
        if (Array.isArray(results) && results.length === 0) {
            return null;
        }
        const nameMap : {
            [uuid: string]: { id: string, nick: string, twitches: string[] }
        } = {}
        const [results2, fields2] = await (mysqlConnection).execute(
            `SELECT DISTINCT uuid, twitch FROM pace;`
        );
        // @ts-ignore
        for(const row of results){
            const uuid = row["uuid"];
            const [results, fields] = await (mysqlConnection).execute(
                `SELECT nickname FROM pace WHERE uuid=? ORDER BY id DESC LIMIT 1;`,
                [uuid]
            );
            // @ts-ignore
            const nick = results[0]["nickname"]
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

        const res1 = await redisClient.call('JSON.SET', `users`, '$', JSON.stringify(Object.values(nameMap)));
        if (res1 !== 'OK') {
            console.error("Failed to set users in Redis:", res1);
            return;
        }
        console.log("User data cached in Redis successfully.");

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

async function calculateAndStorePlayerData(days: number) {
    let mysqlConnection: mysql.Connection | null = null;
    const redis = new Redis(redisUrl!);
    mysqlConnection = await getConn();
    const jsonString = await redis.call('JSON.GET', `leaderboards:${days}day`, '$');
    const parsedData = JSON.parse(jsonString as string);

}

await calculateAndStoreNames();
await calculateAndStorePlayerData(30);
