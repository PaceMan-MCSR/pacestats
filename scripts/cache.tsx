import mysql from 'mysql2/promise';
import Redis from 'ioredis';
import dotenv from 'dotenv';

// (Configuration remains the same)
dotenv.config({ path: ".env.local" });
const mysqlConfig = {
    host: process.env.DB_HOST, port: 3306, user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
};
const redisUrl = process.env.REDIS_URL;
const BATCH_SIZE = 5000;
const REDIS_KEY_PREFIX = 'pace:';


async function syncPaceDataToRedis() {
    // ... (connection and error handling logic is the same) ...
    let mysqlConnection: mysql.Connection | null = null;
    const redisClient = new Redis(redisUrl!);

    try {
        console.log('Connecting to MySQL...');
        mysqlConnection = await mysql.createConnection(mysqlConfig);
        console.log('Successfully connected to MySQL.');

        // ... (Clearing old data logic is the same) ...

        console.log('Fetching all rows from the `pace` table...');
        const [rows] = await mysqlConnection.execute(`SELECT * FROM pace ORDER BY id DESC;`);

        // --- START: DATA MAPPING FIX ---
        const paceData = (rows as mysql.RowDataPacket[]).map(row => {
            // Convert boolean-like fields from TinyInt(1) buffers or numbers
            Object.keys(row).forEach(key => {
                if (Buffer.isBuffer(row[key]) && row[key].length === 1) {
                    row[key] = (row[key][0] === 1);
                }
            });

            // *** THE CRUCIAL FIX IS HERE ***
            // Ensure `lastUpdated` is a Unix timestamp (a number)
            if (row.lastUpdated) {
                const date = new Date(row.lastUpdated);
                // Check if the date is valid before converting
                if (!isNaN(date.getTime())) {
                    // Convert to Unix timestamp (seconds)
                    row.lastUpdated = Math.floor(date.getTime() / 1000);
                } else {
                    // If date is invalid, set to 0 or null to avoid indexing errors
                    row.lastUpdated = 0;
                }
            }

            // Ensure other numeric fields are numbers, not booleans (e.g., store 0 not false)
            const numericFields = ['nether', 'bastion', 'fortress', 'first_portal', 'stronghold', 'end', 'finish'];
            numericFields.forEach(key => {
                if (row[key] === false) {
                    row[key] = 0;
                }
            });

            return row;
        });
        // --- END: DATA MAPPING FIX ---

        const totalRows = paceData.length;
        console.log(`Found ${totalRows} total rows to sync.`);

        // ... (The rest of the script for batching and populating Redis is the same) ...
        console.log(`Setting JSON documents in batches of ${BATCH_SIZE}...`);
        const totalBatches = Math.ceil(totalRows / BATCH_SIZE);
        for (let i = 0; i < totalRows; i += BATCH_SIZE) {
            const chunk = paceData.slice(i, i + BATCH_SIZE);
            const pipeline = redisClient.pipeline();
            for (const row of chunk) {
                if (row.uuid) {
                    const redisKey = REDIS_KEY_PREFIX + row.id;
                    pipeline.call('JSON.SET', redisKey, '$', JSON.stringify(row));
                }
            }
            await pipeline.exec();
            console.log(`Synced batch ${i / BATCH_SIZE + 1} of ${totalBatches} (${Math.min(i + BATCH_SIZE, totalRows)}/${totalRows})`);
        }

    } catch (error) {
        console.error('\nAn error occurred during the synchronization process:', error);
        process.exit(1);
    } finally {
        console.log('Closing connections...');
        if (mysqlConnection) await mysqlConnection.end();
        await redisClient.quit();
    }
}

syncPaceDataToRedis();