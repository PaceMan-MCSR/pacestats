import dotenv from "dotenv";
import Redis from "ioredis";
import mysql, {type Connection} from "mysql2/promise";

dotenv.config({path: ".env.local", quiet: true});

const mysqlConfig = {
    host: process.env.DB_HOST,
    port: 3306,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: 15_000,
};

type PlanRow = {
    table: string;
    type: string;
    possible_keys: string | null;
    key: string | null;
    rows: number;
    Extra: string;
};

async function timed<T>(work: () => Promise<T>): Promise<{durationMs: number; value: T}> {
    const startedAt = performance.now();
    const value = await work();
    return {durationMs: Math.round((performance.now() - startedAt) * 100) / 100, value};
}

async function explain(conn: Connection, sql: string, params: any[] = []): Promise<PlanRow[]> {
    const [rows] = await conn.execute(`EXPLAIN ${sql}`, params);
    return rows as PlanRow[];
}

function parseInfo(info: string, selected: Set<string>): Record<string, string> {
    const output: Record<string, string> = {};
    for (const line of info.split("\r\n")) {
        const separator = line.indexOf(":");
        if (separator <= 0) continue;
        const key = line.slice(0, separator);
        if (selected.has(key)) output[key] = line.slice(separator + 1);
    }
    return output;
}

async function main(): Promise<void> {
    if (!process.env.REDIS_URL) throw new Error("REDIS_URL is required.");
    const redis = new Redis(process.env.REDIS_URL, {connectTimeout: 10_000, maxRetriesPerRequest: 1});
    let conn: Connection | null = null;
    try {
        conn = await mysql.createConnection(mysqlConfig);
        const [normal, full, recent, identity, memoryInfo, statsInfo, slowlog] = await Promise.all([
            redis.hgetall("cache:metadata:normal"),
            redis.hgetall("cache:metadata:full"),
            redis.hgetall("cache:recent:state"),
            redis.hgetall("cache:identity:state"),
            redis.info("memory"),
            redis.info("stats"),
            redis.slowlog("GET", 20),
        ]);

        const tables = ["pace", "aa", "nethers"];
        const indexes: Record<string, Array<{name: string; columns: string}>> = {};
        for (const table of tables) {
            const [rows] = await conn.query(`SHOW INDEX FROM \`${table}\``) as any;
            const grouped = new Map<string, string[]>();
            for (const row of rows) {
                const columns = grouped.get(row.Key_name) || [];
                columns[Number(row.Seq_in_index) - 1] = row.Column_name;
                grouped.set(row.Key_name, columns);
            }
            indexes[table] = [...grouped].map(([name, columns]) => ({name, columns: columns.join(", ")}));
        }

        const [[countRow]] = await conn.query("SELECT COUNT(*) AS count FROM pace") as any;
        const [[netherCountRow]] = await conn.query("SELECT COUNT(*) AS count FROM nethers") as any;
        const rowCount = Number(countRow.count);
        const netherRowCount = Number(netherCountRow.count);
        const pageSize = 5_000;
        const firstPageSql = `SELECT id, uuid, insertTime FROM pace
            WHERE insertTime <= NOW(3)
            ORDER BY uuid ASC, id ASC LIMIT ${pageSize}`;
        const firstPage = await timed(async () => {
            const [rows] = await conn!.query(firstPageSql) as any;
            return rows as Array<{id: number; uuid: string}>;
        });
        const primaryPacePage = await timed(async () => {
            const [rows] = await conn!.query(
                `SELECT id, nickname, uuid, nether, bastion, fortress, first_portal, second_portal,
                    stronghold, end, finish, obtainRod, insertTime
                 FROM pace WHERE id > 0 ORDER BY id ASC LIMIT ${pageSize}`,
            );
            return rows;
        });
        const primaryNetherPage = await timed(async () => {
            const [rows] = await conn!.query(
                `SELECT nethers.id, nethers.uuid, pace.nether, wallTime, playTime, enters,
                    UNIX_TIMESTAMP(nethers.insertTime) AS time, resets, totalResets
                 FROM nethers INNER JOIN pace ON nethers.runId = pace.id
                 WHERE nethers.id > 0 ORDER BY nethers.id ASC LIMIT ${pageSize}`,
            );
            return rows;
        });

        let latePageDurationMs: number | null = null;
        let lateCursorLookupMs: number | null = null;
        if (rowCount > pageSize) {
            const offset = Math.max(0, Math.floor(rowCount * 0.75));
            const cursorLookup = await timed(async () => {
                const [rows] = await conn!.query(
                    `SELECT uuid, id FROM pace ORDER BY uuid ASC, id ASC LIMIT ${offset}, 1`,
                ) as any;
                return rows[0] as {uuid: string; id: number};
            });
            lateCursorLookupMs = cursorLookup.durationMs;
            const latePage = await timed(async () => {
                const [rows] = await conn!.execute(
                    `SELECT id, uuid, insertTime FROM pace
                     WHERE insertTime <= NOW(3) AND (uuid > ? OR (uuid = ? AND id > ?))
                     ORDER BY uuid ASC, id ASC LIMIT ${pageSize}`,
                    [cursorLookup.value.uuid, cursorLookup.value.uuid, cursorLookup.value.id],
                );
                return rows;
            });
            latePageDurationMs = latePage.durationMs;
        }

        const plans = {
            legacyUuidAggregatePage: await explain(conn, firstPageSql),
            primaryAggregatePage: await explain(
                conn,
                `SELECT id, uuid FROM pace WHERE id > ? ORDER BY id ASC LIMIT ${pageSize}`,
                [0],
            ),
            legacyUuidHistoryPage: await explain(
                conn,
                `SELECT id, uuid FROM pace WHERE id <= ? ORDER BY uuid ASC, id ASC LIMIT ${pageSize}`,
                [Number.MAX_SAFE_INTEGER],
            ),
            primaryHistoryPage: await explain(
                conn,
                `SELECT id, uuid FROM pace WHERE id > ? AND id <= ? ORDER BY id ASC LIMIT ${pageSize}`,
                [0, Number.MAX_SAFE_INTEGER],
            ),
            changedRows: await explain(
                conn,
                `SELECT id, uuid, lastUpdated FROM pace
                 WHERE lastUpdated <= NOW(3) AND lastUpdated > NOW(3) - INTERVAL 2 SECOND
                 ORDER BY lastUpdated ASC, id ASC LIMIT ${pageSize}`,
            ),
        };

        const slowCommands = (slowlog as any[]).map((entry) => ({
            occurredAt: new Date(Number(entry[1]) * 1_000).toISOString(),
            durationMicroseconds: Number(entry[2]),
            command: Array.isArray(entry[3]) ? String(entry[3][0]) : "unknown",
        }));

        console.log(JSON.stringify({
            generatedAt: new Date().toISOString(),
            cacheMetadata: {normal, full, recent, identity},
            redis: {
                ...parseInfo(memoryInfo, new Set([
                    "used_memory_human", "used_memory_peak_human", "mem_fragmentation_ratio",
                ])),
                ...parseInfo(statsInfo, new Set([
                    "instantaneous_ops_per_sec", "total_net_input_bytes", "total_net_output_bytes",
                ])),
                slowCommands,
            },
            mysql: {
                paceRows: rowCount,
                netherRows: netherRowCount,
                indexes,
                plans,
                pageBenchmarks: {
                    pageSize,
                    firstPageDurationMs: firstPage.durationMs,
                    primaryPacePageDurationMs: primaryPacePage.durationMs,
                    primaryNetherPageDurationMs: primaryNetherPage.durationMs,
                    lateCursorLookupMs,
                    latePageDurationMs,
                },
            },
        }, null, 2));
    } finally {
        if (conn) await conn.end();
        try { await redis.quit(); } catch { redis.disconnect(); }
    }
}

main().catch((error) => {
    console.error("Cache profiling failed:", error);
    process.exitCode = 1;
});
