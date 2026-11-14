/** Local Docker SQL with fake Redis: no cache writes or source mutations. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import mysql from 'mysql2/promise';
import {loadProducerModule} from './producer-module.mjs';

if (process.env.PERF_LOCAL_DOCKER !== '1' || !['127.0.0.1', 'localhost', 'mysql'].includes(process.env.DB_HOST)) {
    throw new Error('Run inside local Docker with PERF_LOCAL_DOCKER=1. Redis writes are mocked.');
}
const sourcePath = process.env.PERF_SOURCE_FILE ?? resolve('scripts/combined-summaries.ts');
const kind = process.argv[2] ?? 'closeBucket';
assert.ok(['closeBucket', 'rebuildPlayers', 'findStalePlayers'].includes(kind));
const {producer, dispose} = await loadProducerModule(sourcePath, [kind], process.cwd(), {hasMain: false});
const connection = await mysql.createConnection({host: process.env.DB_HOST, user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME});
const lease = {key: 'dry-lease', token: 'dry-token', assertHeld() {}, async verifyHeld() {}};
const values = new Map();
let commands = 0;
const redis = {
    async eval(_script, keyCount, ...args) {
        commands++;
        const keys = args.slice(0, keyCount);
        const argv = args.slice(keyCount);
        assert.equal(keys[0], lease.key); assert.equal(argv[0], lease.token);
        if (kind === 'closeBucket') {
            for (let index = 1; index < keys.length; index++) values.set(keys[index], argv.slice(2 + (index - 1) * 2, 4 + (index - 1) * 2));
        } else if (keys.length === 2) values.set(keys[1], argv.slice(1));
        else {
            let offset = 1;
            for (let index = 1; index < keys.length; index++) {
                const length = Number(argv[offset++]);
                values.set(keys[index], argv.slice(offset, offset + length));
                offset += length;
            }
            assert.equal(offset, argv.length);
        }
        return keys.length - 1;
    },
    pipeline() {
        const keys = [];
        return {hget(key) {keys.push(key); return this;}, async exec() {commands++; return keys.map(() => [null, '0']);}};
    },
};
try {
    const cpu = process.cpuUsage();
    const start = performance.now();
    let rows;
    const bucket = Number(process.env.PERF_BUCKET ?? 691);
    if (kind === 'closeBucket') rows = await producer.closeBucket(connection, redis, bucket, 25, 5000, lease, 0);
    else if (kind === 'rebuildPlayers') {
        const [uuids] = await connection.query('SELECT uuid FROM pace WHERE uuid IS NOT NULL GROUP BY uuid ORDER BY COUNT(*) DESC LIMIT 50');
        rows = await producer.rebuildPlayers(connection, redis, uuids.map(row => row.uuid).sort(), bucket, 50, 5000, lease, 0);
    } else {
        const stale = await producer.findStalePlayers(connection, redis, Number(process.env.PERF_CHECKED_FROM ?? 1794278400), bucket);
        for (const uuid of stale) values.set(uuid, true);
        rows = stale.size;
    }
    const used = process.cpuUsage(cpu);
    const result = {sourcePath, kind, rows, keys: values.size, commands,
        hash: createHash('sha256').update(JSON.stringify([...values].sort(([a], [b]) => a.localeCompare(b)))).digest('hex'),
        durationMs: Math.round(performance.now() - start), cpuMs: Math.round((used.user + used.system) / 1000),
        peakRssMiB: process.resourceUsage().maxRSS / 1024};
    console.log(JSON.stringify(result));
    const output = process.env.PERF_OUTPUT ?? resolve(`test-artifacts/performance/round4/combined-${kind}.json`);
    await mkdir(dirname(output), {recursive: true});
    await writeFile(output, JSON.stringify(result, null, 2));
} finally {await connection.end(); await dispose();}
