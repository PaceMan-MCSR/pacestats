import Redis from 'ioredis';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: ".env.local" });

// --- Configuration ---
const redisUrl = process.env.REDIS_URL;
const REDIS_INDEX_NAME = 'pace_idx'; // The name of your RediSearch index

// --- Type Definition for a Pace Row ---
// Should match the structure of your JSON documents
interface PaceRow {
    id: number;
    uuid: string;
    nickname: string;
    insertTime: string;
    lastUpdated: number;
    nether: number | boolean;
    bastion: number | boolean;
    fortress: number | boolean;
    first_portal: number | boolean;
    stronghold: number | boolean;
    end: number | boolean;
    finish: number | boolean;
}

/**
 * Fetches ALL pace data from Redis using the search index with pagination.
 * @returns A promise that resolves to an array of PaceRow objects.
 */
async function loadAllPacesFromRedis(): Promise<PaceRow[]> {
    if (!redisUrl) {
        throw new Error('REDIS_URL is not defined in .env.local');
    }

    console.log('Connecting to Redis...');
    const redisClient = new Redis(redisUrl);
    const allPaces: PaceRow[] = [];

    try {
        console.log('Successfully connected.');

        // --- 1. Define the "Select All" Query ---
        // The '*' query in RediSearch selects all documents in the index.
        const searchQuery = '*';

        // --- 2. Implement Pagination to Fetch All Documents Safely ---
        let offset = 0;
        const batchSize = 1000000; // Fetch in batches of 10,000 (the default max limit)
        let totalFound = 0;

        console.log(`Beginning paginated fetch for all documents in index '${REDIS_INDEX_NAME}'...`);

        do {
            const commandArgs = [
                REDIS_INDEX_NAME,
                searchQuery,
                'LIMIT', offset.toString(), batchSize.toString()
            ];

            const searchResult = await redisClient.call('FT.SEARCH', ...commandArgs) as (number | string | string[])[];

            // On the very first request, the first element is the total count.
            if (offset === 0) {
                totalFound = searchResult[0] as number;
                console.log(`Index contains a total of ${totalFound} documents.`);
                if (totalFound === 0) {
                    break; // No need to continue if there are no documents
                }
            }

            // --- 3. Parse the results from the current batch ---
            // The actual data starts at index 1. The format is [key, data, key, data, ...]
            for (let i = 1; i < searchResult.length; i += 2) {
                // The data part is nested: ['$', json_string]
                const jsonString = (searchResult[i+1] as string[])[1];
                allPaces.push(JSON.parse(jsonString));
            }

            console.log(`Fetched ${allPaces.length} / ${totalFound} documents...`);

            // Prepare for the next iteration
            offset += batchSize;

        } while (offset < totalFound); // Continue looping until we've fetched all known documents

        return allPaces;

    } catch (error) {
        console.error('An error occurred while fetching data from Redis:', error);
        if (error instanceof Error && error.message.includes("Unknown Index name")) {
            console.error(`\nCRITICAL: The index '${REDIS_INDEX_NAME}' does not exist.`);
        }
        return allPaces; // Return whatever we have managed to fetch
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
    const allPaceRows = await loadAllPacesFromRedis();
    console.timeEnd('ExecutionTime');

    if (allPaceRows.length > 0) {
        console.log(`\nSuccessfully loaded all ${allPaceRows.length} rows into the object.`);
        console.log('Here is the first row as an example:');
        console.log(allPaceRows[0]);
        console.log('And here is the last row as an example:');
        console.log(allPaceRows[allPaceRows.length - 1]);
    } else {
        console.log('\nNo rows were found in the index or an error occurred.');
    }
}

// Run the main function
main();