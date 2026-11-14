import assert from 'node:assert/strict';
import {trackerRows} from '../app/player/[nick]/nethers/presentation';
import {formatIfNotNull, numberWithCommas} from '../app/utils';

const runs = Array.from({length: 100}, (_, i) => ({
    runId: i + 1, time: 1700000000 + i, vodId: i % 2 ? 'vod' : null,
    nether: i % 3 ? 137500 : null, wallTime: 500000, playTime: 0,
    enters: i, resets: i % 2 ? 1234 : 0, totalResets: 45678,
    sceneChanges: JSON.stringify(Array.from({length: 20}, (_, j) => ({scene: j, time: j * 1000}))),
    twitch: 'example', isAccurate: 1,
}));
const rows = trackerRows(runs);
assert.equal(rows.length, 100);
for (let i = 0; i < runs.length; i++) {
    const run = runs[i], row = rows[i];
    assert.equal(row.id, run.runId);
    assert.equal(row.time, run.time);
    assert.equal(row.live, Boolean(run.vodId));
    assert.deepEqual(row.cells, [formatIfNotNull(run.nether), formatIfNotNull(run.wallTime),
        formatIfNotNull(run.playTime), run.enters, run.resets ? numberWithCommas(run.resets) : '',
        numberWithCommas(run.totalResets)]);
}
assert.deepEqual(trackerRows(Object.fromEntries(runs.map(run => [run.runId, run]))), rows);
assert.ok(JSON.stringify(rows).length < JSON.stringify(runs).length / 3);
console.log(`Tracker rendered model: ${JSON.stringify(runs).length} -> ${JSON.stringify(rows).length} bytes; values/order/live flags preserved`);
