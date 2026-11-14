import assert from 'node:assert/strict';
import {recentRunRows} from '../app/components/profile/recentRunPresentation';
import {formatIfNotNull} from '../app/utils';

const run = {id: 42, twitch: null, lastUpdated: 1712345678000, nether: 123456,
    bastion: 0, fortress: null, first_portal: 456789, stronghold: 555555, end: 666666,
    elytra: 777777, credits: 888888, finish: 999999, uuid: 'not-rendered', nickname: 'not-rendered',
    worldId: 'not-rendered', vodId: 'not-rendered', second_portal: 444444, updatedTime: 1712345678000};
for (const aa of [false, true]) {
    const [row] = recentRunRows([run], aa);
    const fields = aa ? ['nether', 'bastion', 'fortress', 'stronghold', 'end', 'elytra', 'credits', 'finish'] as const
        : ['nether', 'bastion', 'fortress', 'first_portal', 'stronghold', 'end', 'finish'] as const;
    assert.equal(row.id, run.id);
    assert.equal(row.time, run.lastUpdated / 1000);
    assert.equal(row.live, false);
    assert.deepEqual(row.cells, fields.map(field => formatIfNotNull(run[field])));
    assert.equal(recentRunRows([{...run, twitch: 'live'}], aa)[0].live, true);
    assert.ok(JSON.stringify(row).length < JSON.stringify(run).length / 2);
}
console.log('Recent pace models preserve both split orders, zero/null values, timestamps, links and live flags without metadata');
