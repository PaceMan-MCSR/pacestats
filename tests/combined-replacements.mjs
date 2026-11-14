import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import Redis from 'ioredis';
import {BucketAccumulator, bucketStart, combinedSummaryKey} from '../app/combinedSummary.ts';
import {loadProducerModule} from '../scripts/producer-module.mjs';

if (process.env.PERF_LOCAL_DOCKER !== '1') throw new Error('Run inside local Docker with PERF_LOCAL_DOCKER=1.');
const {producer, dispose} = await loadProducerModule('scripts/combined-summaries.ts', ['rebuildPlayers', 'replacePlayersScript'], process.cwd(), {hasMain: false});
const redis = new Redis(process.env.REDIS_URL);
const prefix = `codex-perf-r4:${randomUUID()}`;
const lease = {key: `${prefix}:lease`, token: randomUUID(), assertHeld() {}, async verifyHeld() {}};
const uuids = Array.from({length: 70}, (_, index) => `${prefix}:p-${String(index).padStart(2, '0')}`);
const ownedKeys = [lease.key, ...uuids.map(combinedSummaryKey)];
let before;
try {
    await redis.select(13);
    before = await redis.dbsize();
    console.log(`DB13 size before owned fixtures: ${before}`);
    await redis.set(lease.key, lease.token, 'EX', 60);
    for (const uuid of uuids) await redis.hset(combinedSummaryKey(uuid), 'obsolete', 'old');
    const rows = [];
    let id = 1;
    for (let player = 0; player < 60; player++) {
        const count = player === 30 ? 20_000 : 1;
        for (let run = 0; run < count; run++) rows.push([uuids[player], id++, bucketStart(691) + 1, ...Array(9).fill(run + 100_000)]);
    }
    const expected = new Map();
    for (const row of rows) {
        if (!expected.has(row[0])) expected.set(row[0], new BucketAccumulator());
        expected.get(row[0]).add(row[1], row, 3);
    }
    const connection = {connection: {query() {return {stream() {return Readable.from(rows);}};}, destroy() {assert.fail('Unexpected SQL failure');}}};
    const writes = [];
    const guardedRedis = {async eval(script, keyCount, ...args) {
        const argv = args.slice(keyCount);
        const bytes = argv.slice(1).reduce((sum, value) => sum + String(value).length, 0);
        assert.ok(keyCount <= 26);
        if (bytes > 256 * 1024 + 100) assert.equal(keyCount, 2, 'Large summaries must be sent alone');
        writes.push({players: keyCount - 1, bytes});
        return redis.eval(script, keyCount, ...args);
    }};
    assert.equal(await producer.rebuildPlayers(connection, guardedRedis, uuids, 691, 100, 31, lease), rows.length);
    assert.ok(writes.length < uuids.length);
    for (const uuid of uuids) {
        const actual = await redis.hgetall(combinedSummaryKey(uuid));
        const player = expected.get(uuid);
        assert.deepEqual(actual, player ? {'691': JSON.stringify(player.summary()), m: String(player.maxId)} : {});
    }
    const target = combinedSummaryKey(uuids[0]);
    const original = await redis.hgetall(target);
    await assert.rejects(redis.eval(producer.replacePlayersScript, 2, lease.key, target, 'wrong-token', '0'), /CACHE_LOCK_LOST/);
    assert.deepEqual(await redis.hgetall(target), original, 'Lost lease must not mutate a player');
    console.log(`Combined replacements: ${uuids.length} players in ${writes.length} bounded calls, large-player isolation, absent/obsolete removal and real Lua lease guard passed.`);
} finally {
    if (before !== undefined) {
        await redis.del(...ownedKeys);
        const after = await redis.dbsize();
        console.log(`DB13 size after owned fixture cleanup: ${after}`);
        assert.equal(after, before);
    }
    await redis.quit();
    await dispose();
}
