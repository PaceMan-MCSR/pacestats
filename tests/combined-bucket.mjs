import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {BucketAccumulator} from '../app/combinedSummary.ts';
import {loadProducerModule} from '../scripts/producer-module.mjs';

const {producer, dispose} = await loadProducerModule('scripts/combined-summaries.ts', ['closeBucket'], process.cwd(), {hasMain: false});
try {
    for (const fixture of [[], [[null, 1, 0, ...Array(9).fill(null)]],
        [null, 'a', 'a', 'a', 'b', 'b', 'c'].map((uuid, index) => [uuid, index + 1, 0, ...Array.from({length: 9}, (_, split) => (index + split) % 3 ? index * 100 + split : null)])]) {
        const expected = new Map();
        for (const row of fixture) {
            if (row[0] === null) continue;
            if (!expected.has(row[0])) expected.set(row[0], new BucketAccumulator());
            expected.get(row[0]).add(row[1], row, 3);
        }
        for (const sqlBatchSize of [1, 2, 5000]) {
            const captured = new Map();
            let writes = 0;
            const connection = {connection: {query(options) {
                assert.match(options.sql, /ORDER BY uuid ASC, BINARY uuid ASC/);
                assert.equal(options.rowsAsArray, true);
                assert.equal(options.values.length, 4);
                return {stream() {return Readable.from(fixture);}};
            }, destroy() {assert.fail('Unexpected SQL destruction');}}};
            const lease = {key: 'lease', token: 'token', assertHeld() {}, async verifyHeld() {}};
            const redis = {async eval(_script, keyCount, ...args) {
                writes++;
                assert.ok(keyCount <= 3);
                for (let index = 1; index < keyCount; index++) captured.set(args[index].slice('combinedSplits:'.length), args.slice(keyCount + 2 + (index - 1) * 2, keyCount + 4 + (index - 1) * 2));
            }};
            assert.equal(await producer.closeBucket(connection, redis, 691, 2, sqlBatchSize, lease), fixture.length);
            assert.equal(writes, Math.ceil(expected.size / 2));
            for (const [uuid, accumulator] of expected) assert.deepEqual(captured.get(uuid), [JSON.stringify(accumulator.summary()), String(accumulator.maxId)]);
        }
    }
    console.log('Combined bucket: empty/null UUIDs, cross-batch player groups, exact summaries/max IDs and bounded writes passed.');
} finally {await dispose();}
