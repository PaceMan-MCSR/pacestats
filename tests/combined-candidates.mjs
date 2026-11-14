import assert from 'node:assert/strict';
import {loadProducerModule} from '../scripts/producer-module.mjs';

const {producer, dispose} = await loadProducerModule('scripts/combined-summaries.ts', ['findStalePlayers'], process.cwd(), {hasMain: false});
try {
    const changed = Array.from({length: 2001}, (_, index) => ({uuid: `p-${index}`, id: index + 10, instant: 10_000_000}));
    changed.push({uuid: 'old', id: 5, instant: 1}, {uuid: 'old', id: 6, instant: 10_000_000}, {uuid: null, id: 7, instant: 1});
    const pipelineSizes = [];
    const connection = {async execute(sql) {return [sql.includes('FROM pace') ? changed : [{entityId: 'deleted'}, {entityId: ''}]];}};
    const redis = {pipeline() {
        const uuids = [];
        return {hget(key) {uuids.push(key.slice('combinedSplits:'.length)); return this;}, async exec() {
            pipelineSizes.push(uuids.length);
            return uuids.map(uuid => [null, uuid === 'p-0' ? '10' : '0']);
        }};
    }};
    const result = await producer.findStalePlayers(connection, redis, 100, 0);
    assert.deepEqual([...result].sort(), ['deleted', 'old', 'p-0'].sort());
    assert.deepEqual(pipelineSizes, [500, 500, 500, 500, 1]);
    await assert.rejects(producer.findStalePlayers(connection, {pipeline() {return {
        hget() {return this;}, async exec() {return [[new Error('reply error'), null]];},
    };}}, 100, 0), /reply error/);
    console.log('Combined stale candidates: 2,001 lookups bound to 500-command pipelines, closed/open/moved/deleted rules and reply errors passed.');
} finally {await dispose();}
