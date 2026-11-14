/** Docker only: node --import tsx tests/cache-producer-metadata.mjs */
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {loadProducerModule} from '../scripts/producer-module.mjs';

const {producer, dispose} = await loadProducerModule(resolve('scripts/cache.ts'), ['accumulatePaceRow', 'summarizePacePlayer']);
try {
    const row = (id, time, overrides = {}) => ({id, nickname: `name${id}`, uuid: 'player',
        nether: 120000, bastion: null, fortress: null, first_portal: null, second_portal: null,
        stronghold: null, end: null, finish: null, obtainRod: null, insertTime: new Date(time), ...overrides});
    const rows = [
        row(187305, 1000, {bastion: 180000, fortress: 200000}),
        row(187306, 2000, {bastion: 180000, fortress: 200000}),
        row(187307, 2000, {bastion: 180000, fortress: 200000}),
        row(187308, 1000, {bastion: 180000, fortress: 300000, obtainRod: 280000}),
        row(187309, 2000, {bastion: 180000, fortress: 300000, obtainRod: 280000}),
    ];
    const summarize = (source) => {
        const players = new Map();
        for (const run of source) producer.accumulatePaceRow(players, run);
        return producer.summarizePacePlayer(players.get('player'));
    };
    const expected = summarize(rows);
    assert.equal(expected.firstId, 187305);
    assert.equal(expected.name, 'name187309');
    assert.equal(expected.latestNameId, 187309);
    assert.equal(expected.latestNameInsertTimeMs, 2000);
    assert.deepEqual(expected.minima.nether, [120000, 187309], 'fastest ties prefer the newest timestamp and then id');
    assert.deepEqual(expected.minima.fortress, [200000, 187307]);
    assert.deepEqual(expected.stats.second_structure, [4, 240000, 200000], 'historic runs bypass the modern structure filter');
    assert.deepEqual(expected.minima.second_structure, [200000, 187306]);
    assert.deepEqual(summarize([...rows].reverse()), expected);
    assert.deepEqual(summarize([rows[2], rows[4], rows[0], rows[3], rows[1]]), expected);

    const sameTime = summarize([row(2, 1000), row(1, 1000)]);
    assert.equal(sameTime.name, 'name2');
    assert.deepEqual(sameTime.minima.nether, [120000, 2]);
    const fastestEarlier = summarize([row(1, 2000), row(2, 1000, {nether: 119999})]);
    assert.deepEqual(fastestEarlier.minima.nether, [119999, 2]);
    assert.equal(fastestEarlier.latestNameId, 1);
    const corrected = summarize([row(1, 1000, {fortress: 250000, obtainRod: 200000})]);
    assert.deepEqual(corrected.stats.fortress, [1, 200000, 200000]);
    assert.deepEqual(corrected.minima.fortress, [250000, 1], 'clickable fastest uses the unadjusted split');
    const zero = summarize([row(1, 0, {nether: 0})]);
    assert.deepEqual(zero.stats.nether, [1, 0, 0]);
    assert.equal(zero.latestNameInsertTimeMs, 0);
    const invalid = summarize([row(1, NaN), row(2, 2000)]);
    assert.equal(invalid.latestNameId, 1);
    assert.ok(Number.isNaN(invalid.latestNameInsertTimeMs));
    console.log('Producer metadata: row-order independence, timestamp/id ties, historic split rules, rod correction, zero and invalid dates passed.');
} finally {
    await dispose();
}
