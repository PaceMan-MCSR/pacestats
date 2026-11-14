/** Docker-only read-only fixed-window producer comparison. */
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import mysql from 'mysql2/promise';
import {loadProducerModule} from './producer-module.mjs';

if (process.env.PERF_LOCAL_DOCKER !== '1' || !['127.0.0.1', 'localhost', 'mysql'].includes(process.env.DB_HOST)) {
    throw new Error('Run this read-only benchmark inside local Docker with PERF_LOCAL_DOCKER=1.');
}
const kind = process.argv[2] ?? 'pace';
if (!['pace', 'nph'].includes(kind)) throw new Error('Expected pace or nph.');
const sourcePath = process.env.PERF_SOURCE_FILE ?? resolve('scripts/cache.ts');
const source = await readFile(sourcePath, 'utf8');
const streamed = source.includes(`async function read${kind === 'pace' ? 'Pace' : 'Nph'}Periods(`);
const names = kind === 'pace'
    ? [...(streamed ? ['readPacePeriods'] : ['fetchPaceRows', 'accumulatePacePeriods']), 'finalizePacePlayers']
    : [...(streamed ? ['readNphPeriods'] : ['fetchNetherRows', 'accumulateNphPeriods']), 'finalizeNph'];
const {producer, dispose} = await loadProducerModule(sourcePath, names);
let connection;
try {
    connection = await mysql.createConnection({host: process.env.DB_HOST, user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD, database: process.env.DB_NAME});
    const asOf = new Date(process.env.PERF_AS_OF ?? '2026-11-14T13:48:34.311Z');
    const cutoff = new Date(asOf.getTime() - 30 * 86_400_000);
    const days = [1, 7, 30];
    const pacer = {rowBatchSize: 2000, delayMs: 0};
    const cpu = process.cpuUsage();
    const start = performance.now();
    let periods;
    let rowCounts;
    if (streamed) {
        const run = kind === 'pace' ? producer.readPacePeriods : producer.readNphPeriods;
        const result = await run(connection, cutoff, asOf, days, Number(process.env.PERF_SQL_BATCH_SIZE ?? 5000), pacer);
        periods = kind === 'pace' ? result.periods : result;
        if (kind === 'pace') rowCounts = [...result.rowCounts];
    } else {
        const rows = await (kind === 'pace' ? producer.fetchPaceRows : producer.fetchNetherRows)(connection, cutoff, asOf);
        periods = await (kind === 'pace' ? producer.accumulatePacePeriods : producer.accumulateNphPeriods)(rows, days, asOf.getTime(), pacer);
        if (kind === 'pace') {
            const counts = new Map(days.map(day => [day, 0]));
            const asOfMs = asOf.getTime();
            for (const row of rows) {
                const ageMs = asOfMs - row.insertTime.getTime();
                for (const day of days) {
                    if (day === 9999 || ageMs <= day * 86_400_000) counts.set(day, counts.get(day) + 1);
                }
            }
            rowCounts = [...counts];
        }
    }
    const hash = createHash('sha256');
    const players = [];
    for (const day of days) {
        players.push([day, periods.get(day).size]);
        const result = kind === 'pace' ? producer.finalizePacePlayers(periods.get(day), day) : producer.finalizeNph(periods.get(day), day, asOf.getTime());
        hash.update(JSON.stringify([day, result]));
    }
    const used = process.cpuUsage(cpu);
    const result = {kind, sourcePath, streamed, asOf: asOf.toISOString(), rowCounts, players,
        durationMs: Math.round(performance.now() - start), cpuMs: Math.round((used.user + used.system) / 1000),
        peakRssMiB: process.resourceUsage().maxRSS / 1024, hash: hash.digest('hex')};
    console.log(JSON.stringify(result));
    const output = process.env.PERF_OUTPUT ?? resolve(`test-artifacts/performance/round3/period-${kind}.json`);
    await mkdir(dirname(output), {recursive: true});
    await writeFile(output, JSON.stringify(result, null, 2));
} finally {
    if (connection) await connection.end();
    await dispose();
}
