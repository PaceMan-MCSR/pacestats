import {spawn} from "node:child_process";
import dotenv from "dotenv";
import Redis from "ioredis";
import mysql from "mysql2/promise";

dotenv.config({path: ".env.local", quiet: true});

async function runRecentJob(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, ["--import", "tsx", "scripts/recent.ts"], {
            cwd: process.cwd(),
            env: process.env,
            stdio: "inherit",
        });
        child.once("error", reject);
        child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Recent job exited with ${code}.`)));
    });
}

async function main(): Promise<void> {
    if (!process.env.REDIS_URL) throw new Error("REDIS_URL is required.");
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: 3306,
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        connectTimeout: 15_000,
    });
    const redis = new Redis(process.env.REDIS_URL, {connectTimeout: 10_000, maxRetriesPerRequest: 1});
    try {
        const [rows] = await conn.query(
            `SELECT uuid, COUNT(*) AS runCount
             FROM pace
             GROUP BY uuid
             ORDER BY runCount DESC
             LIMIT 1`,
        ) as any;
        if (rows.length === 0) throw new Error("The pace table is empty.");
        await redis.sadd("cache:recent:dirty", rows[0].uuid);
        const startedAt = performance.now();
        await runRecentJob();
        const wallTimeMs = Math.round((performance.now() - startedAt) * 100) / 100;
        const state = await redis.hgetall("cache:recent:state");
        console.log(JSON.stringify({
            benchmark: "busiest-player incremental refresh",
            sourceRows: Number(rows[0].runCount),
            wallTimeMs,
            cacheMetadata: state,
        }, null, 2));
    } finally {
        await conn.end();
        try { await redis.quit(); } catch { redis.disconnect(); }
    }
}

main().catch((error) => {
    console.error("Incremental benchmark failed:", error);
    process.exitCode = 1;
});
