/** Docker: node --import tsx tests/run-snapshot.ts */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {sameRunSnapshot} from '../app/run/[worldid]/snapshot';
assert.ok(existsSync('/.dockerenv'), 'Use local Docker');
const row = {id: 42, worldId: 'fixture', nickname: 'Fixture', uuid: 'uuid', twitch: 'streamer',
    nether: 100_000, bastion: null, fortress: null, first_portal: null, stronghold: null, end: null, finish: null,
    netherRta: 100_100, bastionRta: null, fortressRta: null, first_portalRta: null, strongholdRta: null, endRta: null, finishRta: null,
    insertTime: 1_700_000_000, updateTime: 1_700_000_001, realUpdate: null, vodId: null, vodOffset: 0};
const snapshot = {data: row, isLive: true, liveStatusUnknown: false, time: 1};
assert.ok(sameRunSnapshot(snapshot, {...snapshot, data: {...row}, time: 999}));
assert.ok(sameRunSnapshot(snapshot, {data: {...row}, isLive: true, liveStatusUnknown: false}));
for (const key of Object.keys(row)) {
    const changed = {...row, [key]: typeof row[key as keyof typeof row] === 'string' ? 'changed' : 999};
    assert.equal(sameRunSnapshot(snapshot, {...snapshot, data: changed}), false, key);
}
for (const patch of [{isLive: false}, {liveStatusUnknown: true}, {extra: 1}, {data: null}]) {
    assert.equal(sameRunSnapshot(snapshot, {...snapshot, ...patch}), false);
}
assert.equal(sameRunSnapshot(snapshot, {...snapshot, data: {...row, extra: null}}), false);
const {nickname: _nickname, ...missing} = row;
assert.equal(sameRunSnapshot(snapshot, {...snapshot, data: missing}), false);
assert.equal(sameRunSnapshot({...snapshot, data: {nested: {value: 1}}}, {...snapshot, data: {nested: {value: 1}}}), false,
    'Unexpected nested fields conservatively trigger an update');
assert.ok(sameRunSnapshot(null, null));assert.ok(sameRunSnapshot(undefined, undefined));
assert.equal(sameRunSnapshot(null, undefined), false);assert.equal(sameRunSnapshot(snapshot, null), false);
assert.equal(sameRunSnapshot(snapshot, undefined), false);
console.log(`PASS: transport time is ignored; every ${Object.keys(row).length} row field plus live/unknown/null/new/missing/nested data remains observable`);
