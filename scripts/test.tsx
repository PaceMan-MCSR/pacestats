import Redis from 'ioredis';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: ".env.local" });

// --- Configuration ---
const redisUrl = process.env.REDIS_URL;
const REDIS_INDEX_NAME = 'pace_idx'; // The name of your RediSearch index

// --- Type Definition for a Pace Row ---
// This should match the structure of your JSON documents
interface PaceRow {
    id: number;
    uuid: string;
    nickname: string;
    insertTime: string; // Stored as a string in JSON
    lastUpdated: number; // Stored as a Unix timestamp (number)
    nether: number | boolean;
    bastion: number | boolean;
    fortress: number | boolean;
    first_portal: number | boolean;
    stronghold: number | boolean;
    end: number | boolean;
    finish: number | boolean;
}

/**
 * Fetches pace data from the last 30 days directly from Redis using the search index.
 * @returns A promise that resolves to an array of PaceRow objects.
 */
async function loadRecentPacesFromRedis(): Promise<PaceRow[]> {
    if (!redisUrl) {
        throw new Error('REDIS_URL is not defined in .env.local');
    }

    console.log('Connecting to Redis...');
    const redisClient = new Redis(redisUrl);

    try {
        console.log('Successfully connected.');

        // --- 1. Calculate the Timestamp for 30 Days Ago ---
        const now = new Date();
        const thirtyDaysAgo = new Date(now);
        thirtyDaysAgo.setDate(now.getDate() - 30);

        // Convert to a Unix timestamp in SECONDS, as this matches our sync script's format
        const thirtyDaysAgoTimestamp = Math.floor(thirtyDaysAgo.getTime() / 1000);
        console.log(`Fetching records with a 'lastUpdated' timestamp after ${thirtyDaysAgoTimestamp}`);

        // --- 2. Construct and Execute the RediSearch Query ---
        // This query finds all documents where the numeric `lastUpdated` field is
        // between our calculated timestamp and infinity (i.e., now).
        const searchQuery = `@lastUpdated:[${thirtyDaysAgoTimestamp} +inf]`;

        // We use redis.call() for commands not natively in ioredis's types.
        // We must add a high LIMIT to get all results, not just the default 10.
        const commandArgs = [
            REDIS_INDEX_NAME,
            searchQuery,
            'LIMIT', '0', '1000000' // A large number to fetch all matches
        ];

        console.log(`Executing FT.SEARCH with query: "${searchQuery}"`);
        const searchResult = await redisClient.call('FT.SEARCH', ...commandArgs);

        // --- 3. Parse the Search Result ---
        const totalFound = searchResult[0] as number;
        console.log(`Query returned ${totalFound} matching documents.`);
        if (totalFound === 0) {
            return [];
        }

        const paceData: PaceRow[] = [];
        // The actual data starts at index 1. It's a flat array of [key, value, key, value, ...].
        // The value is another array: ['$', <json_string>]
        for (let i = 1; i < searchResult.length; i += 2) {
            const jsonString = searchResult[i+1][1]; // Extract the JSON string
            const paceObject = JSON.parse(jsonString);
            paceData.push(paceObject);
        }

        return paceData;

    } catch (error) {
        console.error('An error occurred while fetching data from Redis:', error);
        // Handle case where the index doesn't exist
        if (error instanceof Error && error.message.includes("Unknown Index name")) {
            console.error(`\nCRITICAL: The index '${REDIS_INDEX_NAME}' does not exist.`);
            console.error("Please run the FT.CREATE command in redis-cli first.");
        }
        return []; // Return an empty array on error
    } finally {
        console.log('Closing Redis connection.');
        await redisClient.quit();
    }
}

/**
 * Main function to execute the script and display the result.
 */
async function main() {
    console.time('ExecutionTime');
    const recentPaces = await loadRecentPacesFromRedis();
    console.timeEnd('ExecutionTime');

    if (recentPaces.length > 0) {
        console.log(`\nSuccessfully loaded ${recentPaces.length} rows into an object.`);
        console.log('Here is the first row as an example:');
        console.log(recentPaces[0]);
    } else {
        console.log('\nNo recent rows were found or an error occurred.');
    }
}

// Run the main function
main();