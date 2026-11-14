import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import {BucketAccumulator, bucketStart, combinedSummaryKey} from '../app/combinedSummary.ts';
import {loadProducerModule} from '../scripts/producer-module.mjs';

if (process.env.PERF_LOCAL_DOCKER !== '1' || !['127.0.0.1', 'localhost', 'mysql'].includes(process.env.DB_HOST)) {
    throw new Error('Run inside local Docker with PERF_LOCAL_DOCKER=1. SQL fixture is a read-only CTE; Redis writes are mocked.');
}
const sourcePath = process.env.PERF_SOURCE_FILE ?? 'scripts/combined-summaries.ts';
const {producer, dispose} = await loadProducerModule(sourcePath, ['rebuildPlayers'], process.cwd(), {hasMain: false});
const connection = await mysql.createConnection({host: process.env.DB_HOST, user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME});
try {
    const uuids = ['same-id', 'SAME-ID', 'same-id '];
    const fixture = [];
    const expected = new Map(uuids.map(uuid => [uuid, new Map()]));
    const fixtureValues = [];
    const selects = [];
    for (let bucket = 680; bucket <= 691; bucket++) {
        for (const uuid of uuids) {
            const id = fixture.length + 200000;
            const instant = bucketStart(bucket) + 1;
            // This collation treats case and trailing spaces as equivalent.
            selects.push(`SELECT CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci AS uuid,
                ? AS id, FROM_UNIXTIME(?) AS insertTime, 100000 AS nether, 180000 AS bastion,
                240000 AS fortress, 300000 AS first_portal, 500000 AS stronghold,
                600000 AS end, 700000 AS finish, 230000 AS obtainRod`);
            fixtureValues.push(uuid, id, instant);
            fixture.push({uuid, id, instant});
            const accumulator = new BucketAccumulator();
            accumulator.add(id, [100000, 180000, 240000, 180000, 230000, 300000, 500000, 600000, 700000], 0);
            expected.get(uuid).set(String(bucket), JSON.stringify(accumulator.summary()));
        }
    }
    const fixturesSql = `pace AS (${selects.join(' UNION ALL ')})`;
    const queryConnection = {connection: {query(options) {
        const sql = options.sql.replace('WITH window_rows AS (', `WITH ${fixturesSql}, window_rows AS (`);
        assert.ok(sql.includes(fixturesSql));
        return connection.connection.query({...options, sql, values: [...fixtureValues, ...options.values]});
    }, destroy() {connection.connection.destroy();}}};
    const lease = {key: 'dry-lease', token: 'dry-token', assertHeld() {}, async verifyHeld() {}};
    const actual = new Map();
    const writes = new Map();
    const redis = {async eval(_script, keyCount, ...args) {
        let offset = keyCount + 1;
        for (let index = 1; index < keyCount; index++) {
            const count = Number(args[offset++]);
            const fields = args.slice(offset, offset + count);
            offset += count;
            const key = args[index];
            writes.set(key, (writes.get(key) ?? 0) + 1);
            actual.set(key, Object.fromEntries(Array.from({length: fields.length / 2}, (_, field) => fields.slice(field * 2, field * 2 + 2))));
        }
    }};
    for (const batchSize of [1, 7, 5000]) {
        actual.clear(); writes.clear();
        assert.equal(await producer.rebuildPlayers(queryConnection, redis, [...uuids, 'missing'], 691, 50, batchSize, lease), fixture.length);
        for (const uuid of uuids) {
            const fields = Object.fromEntries(expected.get(uuid));
            fields.m = String(Math.max(...fixture.filter(row => row.uuid === uuid).map(row => row.id)));
            assert.deepEqual(actual.get(combinedSummaryKey(uuid)), fields, `All buckets for exact UUID ${JSON.stringify(uuid)}, batch=${batchSize}`);
            assert.equal(writes.get(combinedSummaryKey(uuid)), 1, 'Each exact UUID must be replaced once');
        }
        assert.deepEqual(actual.get(combinedSummaryKey('missing')), {});
    }
    console.log('Combined rebuild ordering: real case-insensitive/PAD SPACE SQL fixture preserves all12 buckets for each exact UUID across batches1/7/5000; missing player deletion passed.');
} finally {await connection.end(); await dispose();}
