import mysql from 'mysql2/promise';
import Redis from 'ioredis';
import dotenv from 'dotenv';

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

export const processAndSaveAllPlayerRuns = async (): Promise<void> => {
    // 1. Fetch all runs for all players in a single query
    console.log('Fetching all runs from the database...');
    // Use the pool to execute the query. It handles getting/releasing connections automatically.
    const [rows] = await conn.execute(
        `SELECT
            uuid, id, nether, bastion, fortress,
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
            first_portal, stronghold, end, finish,
            lastUpdated, vodId, twitch
        FROM pace
        ORDER BY uuid, id DESC;`
    );
    console.log(`Fetched ${rows.length} total runs.`);
    const st1 = Date.now();

    // 2. Group the runs by player UUID (This part is already efficient)
    const runsByPlayer = rows.reduce((acc: any, run: any) => {
        if (!acc[run.uuid]) {
            acc[run.uuid] = "";
        }
        //acc[run.uuid].push(run);
        acc[run.uuid] += csvEncodeRun(run) + '\n'; // Concatenate runs for the player);
        return acc;
    }, {});

    console.log(`Processing and saving runs for ${Object.keys(runsByPlayer).length} players...`);
    const pipeline = redis.pipeline();

    for (const [uuid, runs] of Object.entries(runsByPlayer)) {
        //pipeline.call('JSON.SET', `playerRuns:${uuid}`, '$', JSON.stringify(runs));
        pipeline.call('SET', `playerRunsOptimized:${uuid}`, (runs as string).trim()); // Store runs as a single string
    }
    console.log(`Processed runs for ${Object.keys(runsByPlayer).length} players in ${Date.now() - st1}ms.`);

    // Execute all queued commands in a single batch.
    await pipeline.exec();

    console.log('Finished processing all players.');
};

const csvEncodeRun = (run: any): string => {
    return [
        run.id, run.nether, run.bastion, run.fortress,
        run.first_structure, run.second_structure,
        run.first_portal, run.stronghold, run.end, run.finish,
        run.lastUpdated.getTime(), run.vodId, run.twitch
    ].join(',');
}

const csvDecodeRun = (csv: string): any => {
    const parts = csv.split(',');
    return {
        id: parts[0],
        nether: parts[1],
        bastion: parts[2],
        fortress: parts[3],
        first_structure: parts[4],
        second_structure: parts[5],
        first_portal: parts[6],
        stronghold: parts[7],
        end: parts[8],
        finish: parts[9],
        lastUpdated: parts[10],
        vodId: parts[11] || null,
        twitch: parts[12] || null
    };
}

export const decodeAllRuns = async (): Promise<void> => {
    const st1 = Date.now();
    console.log('Decoding all runs from Redis...');
    const keys = await redis.keys('playerRunsOptimized:*');
    console.log(`Found ${keys.length} player runs in Redis.`);

    for (const key of keys) {
        const runs = await redis.call('GET', key) as any;//await redis.get(key);
        for(const run of runs.split('\n')){
            const decodedRun = csvDecodeRun(run);
            //console.log(decodedRun); // Process the decoded run as needed
        }
    }
    console.log(`Decoded all runs in ${Date.now() - st1}ms.`);

    console.log('Finished decoding all runs.');
}

async function mmm() {
    conn = await getConn()
    // --- Run the main function ---
    await processAndSaveAllPlayerRuns();
    //await decodeAllRuns();
    await conn.end();
    await redis.quit();
}

mmm();