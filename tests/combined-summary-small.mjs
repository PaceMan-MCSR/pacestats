import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {summarizeSplit, tailDepth, BucketAccumulator, combinedSplitCategories,
    combinedSplitRowsSql, insertTimeRangeSql, insertTimeRangeValues, bucketOf, bucketStart,
    closableBucket, COMBINED_BUCKET_SECONDS} from '../app/combinedSummary.ts';

function reference(values) {
    let total = 0;
    for (let index = 0; index < values.length; index++) total += values[index];
    const depth = tailDepth(values.length);
    const sorted = Float64Array.from(values).sort();
    const tail = new Array(depth);
    for (let index = 0; index < depth; index++) tail[index] = sorted[sorted.length - 1 - index];
    return [values.length, total, tail];
}
const unusual = [0, -0, 1, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
    Number.MIN_VALUE, Number.MAX_VALUE];
for (const a of unusual) {
    assert.deepEqual(summarizeSplit([a]), reference([a]));
    for (const b of unusual) assert.deepEqual(summarizeSplit([a, b]), reference([a, b]));
}
let seed = 42;
const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 0x1_0000_0000);
for (let count = 0; count <= 256; count++) {
    const values = Array.from({length: count}, () => Math.floor(random() * 1_000_000));
    const original = values.slice();
    assert.deepEqual(summarizeSplit(values), reference(values));
    assert.deepEqual(values, original, 'Summaries must leave their input unchanged');
}
console.log('Combined summaries: counts 0–256, special numeric values and input immutability passed.');

if (process.env.PERF_BENCHMARK !== '1') process.exit(0);
if (process.env.PERF_LOCAL_DOCKER !== '1' || !['127.0.0.1', 'localhost', 'mysql'].includes(process.env.DB_HOST)) {
    throw new Error('The read-only benchmark requires local Docker with PERF_LOCAL_DOCKER=1.');
}
const {default: mysql} = await import('mysql2/promise');
const connection = await mysql.createConnection({host: process.env.DB_HOST, user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME});
const groups = new Map();
let rowCount;
try {
    const bucket = closableBucket(new Date(process.env.PERF_AS_OF ?? '2026-11-14T13:48:34.311Z').getTime() / 1000);
    const from = bucketStart(bucket);
    const [rows] = await connection.execute({rowsAsArray: true, sql: `
        WITH source AS (SELECT id, uuid, nether, bastion, fortress, first_portal,
            stronghold, end, finish, obtainRod FROM pace WHERE ${insertTimeRangeSql()}),
        ${combinedSplitRowsSql('source')}
        SELECT uuid, id, ${combinedSplitCategories.join(', ')} FROM split_rows ORDER BY uuid, id;`},
    insertTimeRangeValues(from, from + COMBINED_BUCKET_SECONDS));
    rowCount = rows.length;
    for (const row of rows) {
        let player = groups.get(row[0]);
        if (!player) {player = new BucketAccumulator(); groups.set(row[0], player);}
        player.add(row[1], row, 2);
    }
    console.log(`Read-only fixture: bucket ${bucketOf(from)}, ${rows.length} runs, ${groups.size} players.`);
} finally {
    await connection.end();
}
const fixture = [...groups.values()].flatMap(player => player.splits);
for (const values of fixture) assert.deepEqual(summarizeSplit(values), reference(values));
const distribution = {empty: 0, single: 0, pair: 0, many: 0};
for (const values of fixture) distribution[values.length === 0 ? 'empty' : values.length === 1 ? 'single' : values.length === 2 ? 'pair' : 'many']++;
let sink = 0;
function sample(run) {
    const startCpu = process.cpuUsage();
    const start = performance.now();
    for (let repeat = 0; repeat < 30; repeat++) {
        for (const values of fixture) {
            const summary = run(values);
            sink += summary[0] + summary[1] + summary[2].length;
        }
    }
    const cpu = process.cpuUsage(startCpu);
    return {cpuMs: (cpu.user + cpu.system) / 1000, elapsedMs: performance.now() - start};
}
sample(reference); sample(summarizeSplit);
const rounds = [];
for (let round = 0; round < 7; round++) {
    const names = round % 2 === 0 ? ['reference', 'current'] : ['current', 'reference'];
    const values = {};
    for (const name of names) values[name] = sample(name === 'reference' ? reference : summarizeSplit);
    rounds.push(values);
}
assert.ok(Number.isFinite(sink));
const median = key => rounds.map(round => round[key].cpuMs).sort((a, b) => a - b)[3];
const result = {rows: rowCount, players: groups.size, summaries: fixture.length, distribution,
    repeats: 30, referenceCpuMs: median('reference'), currentCpuMs: median('current'), rounds};
console.log(JSON.stringify(result));
const output = process.env.PERF_OUTPUT ?? resolve('test-artifacts/performance/round3/combined-summary.json');
await mkdir(dirname(output), {recursive: true});
await writeFile(output, JSON.stringify(result, null, 2));
