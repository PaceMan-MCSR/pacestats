/** Read-only MySQL checks for the cache jobs' backpressured row stream. */
import assert from "node:assert/strict";
import dotenv from "dotenv";
import mysql, {type Connection} from "mysql2/promise";
import {streamRowBatches} from "./cache-runtime";

dotenv.config({path: ".env.local", quiet: true});

const connect = () => mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 1));

async function main(): Promise<void> {
    const batchSize = 8;
    const conn = await connect();
    try {
        for (const count of [0, 1, 7, 8, 9, 16, 17, 100]) {
            const [expected] = await conn.query(`SELECT id FROM pace ORDER BY id LIMIT ${count}`);
            const actual: Array<{id: number}> = [];
            const batches: number[] = [];
            let active = false;
            await streamRowBatches<{id: number}>(conn, {
                sql: `SELECT id FROM pace ORDER BY id LIMIT ${count}`,
            }, [], batchSize, async (rows) => {
                assert.equal(active, false, "batch consumers overlapped");
                active = true;
                batches.push(rows.length);
                await pause();
                actual.push(...rows);
                active = false;
            });
            assert.deepEqual(actual.map((row) => row.id), (expected as Array<{id: number}>).map((row) => row.id));
            assert.ok(batches.every((size) => size > 0 && size <= batchSize));
            assert.equal(batches.length, Math.ceil(actual.length / batchSize));
        }

        // Array rows are used by the combined summaries; values must stay
        // bound correctly while asynchronous consumers pause the connection.
        const arrays: unknown[][] = [];
        await streamRowBatches<unknown[]>(conn, {
            sql: "SELECT id, ? AS label FROM pace ORDER BY id LIMIT 17",
            rowsAsArray: true,
        }, ["bound value"], batchSize, async (rows) => {
            await pause();
            arrays.push(...rows);
        });
        assert.ok(arrays.every((row) => row[1] === "bound value"));
        assert.equal(arrays.length, 17);
    } finally {
        await conn.end();
    }

    const failure = new Error("expected consumer failure");
    const failing = await connect();
    let batches = 0;
    try {
        await assert.rejects(streamRowBatches<{id: number}>(failing, {
            sql: "SELECT id FROM pace ORDER BY id LIMIT 100",
        }, [], batchSize, async () => {
            await pause();
            if (++batches === 2) throw failure;
        }), (error) => error === failure);
        await pause();
        assert.equal(batches, 2, "a failed stream continued processing batches");
    } finally {
        failing.destroy();
    }

    const invalid: Connection = await connect();
    try {
        await assert.rejects(streamRowBatches(invalid, {
            sql: "SELECT missing_cache_stream_column FROM pace LIMIT 1",
        }, [], batchSize, async () => assert.fail("invalid SQL returned a batch")), /Unknown column/);
    } finally {
        invalid.destroy();
    }
    console.log("Cache stream: row order, batch boundaries, backpressure, array rows, SQL binding and failures passed.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
