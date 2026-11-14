import assert from 'node:assert/strict';
import {loadProducerModule} from '../scripts/producer-module.mjs';

const {producer, dispose} = await loadProducerModule('scripts/cache.ts', ['readFullState']);
try {
    let scanned = false;
    for (const raw of [null, '', JSON.stringify({version: 999})]) {
        assert.equal(await producer.readFullState({async hget() {return raw;}, async hscan() {scanned = true;}}), null);
        assert.equal(scanned, false, 'Missing/old metadata must avoid reading player payloads');
    }
    const meta = {version: 1, asOf: '2026-11-14T00:00:00Z'};
    let page = 0;
    const pages = [['19', ['__meta', JSON.stringify(meta), 'a', '{"p":{"firstId":2}}']], ['0', ['b', '{"n":{"count":3}}']]];
    const state = await producer.readFullState({async hget() {return JSON.stringify(meta);}, async hscan() {return pages[page++];}});
    assert.deepEqual(state.meta, meta);
    assert.deepEqual([...state.players], [['a', {p: {firstId: 2}}], ['b', {n: {count: 3}}]]);
    await assert.rejects(producer.readFullState({async hget() {return JSON.stringify(meta);}, async hscan() {return ['0', ['a', 'broken']];}}), SyntaxError);
    console.log('Full state paging: absent/version rejection before payload reads, metadata/player separation and malformed JSON passed.');
} finally {await dispose();}
