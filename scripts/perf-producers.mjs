/** Docker-only producer dry run: real SQL rows, hashes in place of Redis writes. */
import {createHash} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {PerformanceObserver} from 'node:perf_hooks';
import mysql from 'mysql2/promise';
import {loadProducerModule} from './producer-module.mjs';

if (process.env.PERF_LOCAL_DOCKER !== '1' || !['127.0.0.1', 'localhost', 'mysql'].includes(process.env.DB_HOST)) {
    throw new Error('Run inside local Docker with PERF_LOCAL_DOCKER=1; this benchmark never writes Redis.');
}
const kind = process.argv[2] ?? 'pace';
if (!['pace', 'nph', 'histories'].includes(kind)) throw new Error('Expected pace, nph or histories.');
const root = process.env.PERF_SOURCE_ROOT ?? process.cwd();
const output = process.env.PERF_OUTPUT ?? resolve(process.cwd(), `test-artifacts/performance/round2/producer-${kind}.json`);
const sourcePath = process.env.PERF_SOURCE_FILE ?? resolve(root, `scripts/${kind === 'histories' ? 'recent' : 'cache'}.ts`);
// Keep the real entry point private. The disposable module adds exports to a
// copy with main removed, so both revisions run the exact producer functions.
const exportNames = kind === 'histories' ? 'fullRebuild' : kind === 'pace' ? 'readPaceSummaries' : 'readNphSummaries';
const {producer, dispose} = await loadProducerModule(sourcePath, [exportNames], root);
const hashes = new Map();
const lease = {key: 'dry-run', token: 'dry-run', assertHeld() {}, async verifyHeld() {}};
let connection;
let gcCount = 0;
let gcMs = 0;
const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) { gcCount++; gcMs += entry.duration; }
});
try {
    connection = await mysql.createConnection({host: process.env.DB_HOST, user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD, database: process.env.DB_NAME});
    const cpu = process.cpuUsage();
    observer.observe({entryTypes: ['gc']});
    const started = performance.now();
    let rows;
    let count;
    let hash;
    if (kind === 'histories') {
        const redis = {pipeline() {
            let commands = 0;
            const pipeline = {
                set(key, value) {
                    hashes.set(key.replace(/^cache:staging:[^:]+:/, ''), createHash('sha256').update(value).digest('hex'));
                    commands++;
                    return pipeline;
                },
                async exec() { return Array.from({length: commands}, () => [null, 'OK']); },
            };
            return pipeline;
        }};
        const result = await producer.fullRebuild(connection, redis, 'dry-run', Number.MAX_SAFE_INTEGER,
            5_000, 25, 21_600, lease);
        rows = result.rowCount;
        count = hashes.size;
        hash = createHash('sha256').update(JSON.stringify([...hashes].sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
    } else {
        const run = kind === 'pace' ? producer.readPaceSummaries : producer.readNphSummaries;
        const result = await run(connection, null, Number.MAX_SAFE_INTEGER, new Date(), 5_000, lease,
            {delayMs: 0, rowBatchSize: 2_000, lease});
        rows = result.rowCount;
        count = result.summaries.size;
        hash = createHash('sha256').update(JSON.stringify([...result.summaries].sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
    }
    const durationMs = performance.now() - started;
    const used = process.cpuUsage(cpu);
    await new Promise((done) => setImmediate(done));
    const result = {kind, sourcePath, rows, count, hash, durationMs: Math.round(durationMs),
        cpuMs: Math.round((used.user + used.system) / 1_000), peakRssMiB: process.resourceUsage().maxRSS / 1_024,
        gcCount, gcMs: Math.round(gcMs)};
    console.log(JSON.stringify(result));
    await mkdir(dirname(output), {recursive: true});
    await writeFile(output, JSON.stringify(result, null, 2));
} finally {
    observer.disconnect();
    if (connection) await connection.end();
    await dispose();
}
