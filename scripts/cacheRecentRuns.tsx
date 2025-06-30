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

    // 2. Group the runs by player UUID (This part is already efficient)
    const runsByPlayer = rows.reduce((acc: any, run: any) => {
        if (!acc[run.uuid]) {
            acc[run.uuid] = [];
        }
        acc[run.uuid].push(run);
        return acc;
    }, {});

    console.log(`Processing and saving runs for ${Object.keys(runsByPlayer).length} players...`);
    const pipeline = redis.pipeline();

    for (const [uuid, runs] of Object.entries(runsByPlayer)) {
        pipeline.call('JSON.SET', `playerRuns:${uuid}`, '$', JSON.stringify(runs));
    }

    // Execute all queued commands in a single batch.
    await pipeline.exec();

    console.log('Finished processing all players.');
};

async function mmm() {
    conn = await getConn()
    // --- Run the main function ---
    await processAndSaveAllPlayerRuns();
    await conn.end();
    await redis.quit();
}

mmm();